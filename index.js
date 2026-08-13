/**
 * @fileoverview Evertz Quartz Router Control Module for Bitfocus Companion
 *
 * This module enables control of Evertz EQX series routers using the Quartz protocol.
 * It provides actions for routing, salvos, and destination locks, with support for
 * polling router state.
 *
 * Architecture:
 * - index.js: Module lifecycle, state management, Companion integration
 * - api.js: TCP socket lifecycle (connect, disconnect, send)
 * - quartz.js: Protocol handling (command building, response parsing, framing)
 * - actions.js: Companion action definitions
 * - feedbacks.js: Companion feedback definitions
 * - variables.js: Companion variable definitions
 * - presets.js: Companion preset definitions
 * - config.js: Module configuration fields
 *
 * @module companion-module-evertz-quartz
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

const { InstanceBase, runEntrypoint } = require('@companion-module/base')
const upgrades = require('./src/upgrades')

const config = require('./src/config')
const actions = require('./src/actions')
const feedbacks = require('./src/feedbacks')
const variables = require('./src/variables')
const presets = require('./src/presets')
const api = require('./src/api')
const constants = require('./src/constants')

const {
	QuartzParser,
	MessageType,
	parseCrosspointGroups,
	buildReadNamesCommand,
	buildInterrogateAllCommand,
	buildListRoutesAllCommand,
	buildLockInterrogateAllCommand,
	buildLockInterrogateCommand,
} = require('./src/quartz')

const { getXptVariableLevels, lockStatusToLabel } = require('./src/constants')

/**
 * How long to wait for a .L reply before falling back to .I, in milliseconds.
 * @type {number}
 */
const LIST_ROUTES_PROBE_TIMEOUT = 2000

/**
 * How long to wait for a .BA reply when interrogating a single destination's
 * lock status on demand, in milliseconds.
 * @type {number}
 */
const LOCK_STATUS_INTERROGATE_TIMEOUT = 500

/**
 * @typedef {Object} ChoiceEntry
 * @property {string} id - Unique identifier for the choice
 * @property {string} label - Display label for the choice
 */

/**
 * Evertz Quartz Router Control Module
 *
 * Main module class that handles all interaction between Companion
 * and Evertz routers using the Quartz protocol.
 *
 * @extends InstanceBase
 */
class QuartzInstance extends InstanceBase {
	/**
	 * Creates a new QuartzInstance
	 *
	 * Initializes state and assigns mixin methods from separate modules.
	 *
	 * @param {Object} internal - Internal Companion instance data
	 */
	constructor(internal) {
		super(internal)

		// Assign methods from separate modules (mixin pattern)
		Object.assign(this, {
			...config,
			...actions,
			...feedbacks,
			...variables,
			...presets,
			...api,
			...constants,
		})

		/**
		 * Available destinations for dropdown choices
		 * @type {ChoiceEntry[]}
		 */
		this.CHOICES_DESTINATIONS = [{ id: '0', label: 'No Destinations Loaded' }]

		/**
		 * Available sources for dropdown choices
		 * @type {ChoiceEntry[]}
		 */
		this.CHOICES_SOURCES = [{ id: '0', label: 'No Sources Loaded' }]

		/**
		 * Current crosspoint state - maps destination to source per level
		 * Structure: { [level]: { [destination]: source } }
		 * Example: { 'V': { 1: 5, 2: 3 }, 'A': { 1: 5, 2: 3 } }
		 * @type {Object.<string, Object.<number, number>>}
		 */
		this.crosspoints = {}

		/**
		 * Current destination lock status codes from .BA responses
		 * Structure: { [destination]: status }
		 * 0=unlocked, 1-254=panel lock, 255=unprotected lock
		 * @type {Object.<number, number>}
		 */
		this.locks = {}

		/**
		 * Quartz protocol parser instance
		 * @type {QuartzParser|null}
		 */
		this.parser = null

		/**
		 * Whether the router supports .L (list routes). null = not yet probed.
		 * @type {boolean|null}
		 */
		this._listRoutesSupported = null

		/** In-flight .L support probe, to dedupe concurrent callers. @type {Promise<boolean>|null} */
		this._listRoutesProbePromise = null

		/**
		 * Whether a full refresh (probe + names + crosspoints + locks) is running.
		 * Polling is skipped while it is, so poll replies can't reach the probe.
		 * @type {boolean}
		 */
		this._refreshInProgress = false

		/**
		 * Polling interval reference
		 * @type {NodeJS.Timeout|null}
		 */
		this.INTERVAL = null

		/**
		 * Reconnection interval reference
		 * @type {NodeJS.Timeout|null}
		 */
		this.RECONNECT_INTERVAL = null

		/**
		 * TCP socket instance
		 * @type {TCPHelper|null}
		 */
		this.socket = null

		/**
		 * Last command sent (for debugging)
		 * @type {string}
		 */
		this.lastCommand = ''
	}

	/**
	 * Module initialization
	 *
	 * Called by Companion when the module instance is created.
	 * Triggers configuration update which handles actual initialization.
	 *
	 * @async
	 * @param {Object} config - Module configuration from Companion
	 * @returns {Promise<void>}
	 */
	async init(config) {
		await this.configUpdated(config)
	}

	/**
	 * Module destruction
	 *
	 * Called by Companion when the module instance is being removed.
	 * Cleans up connections, intervals, and resources.
	 *
	 * @async
	 * @returns {Promise<void>}
	 */
	async destroy() {
		try {
			// Clear polling interval
			if (this.INTERVAL) {
				clearInterval(this.INTERVAL)
				this.INTERVAL = null
			}

			// Clear reconnection interval
			if (this.RECONNECT_INTERVAL) {
				clearInterval(this.RECONNECT_INTERVAL)
				this.RECONNECT_INTERVAL = null
			}

			// Clean up parser
			if (this.parser) {
				this.parser.removeAllListeners()
				this.parser = null
			}

			// Destroy socket
			if (this.socket) {
				this.socket.destroy()
				this.socket = null
			}
		} catch (error) {
			this.log('error', `Destroy error: ${error.message}`)
		}
	}

	/**
	 * Configuration update handler
	 *
	 * Called when module configuration changes. Re-initializes
	 * the parser, connection, and Companion definitions.
	 *
	 * @async
	 * @param {Object} config - Updated module configuration
	 * @returns {Promise<void>}
	 */
	async configUpdated(config) {
		this.config = config

		// Initialize protocol parser with message handler
		this._initParser()

		// Initialize TCP connection
		this.initConnection()

		// Initialize Companion definitions
		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
	}

	/**
	 * Initializes the Quartz protocol parser
	 *
	 * Creates a new parser instance and wires up message handlers
	 * to update module state.
	 *
	 * @private
	 * @returns {void}
	 */
	_initParser() {
		if (this.parser) {
			// Config changed, not a fresh init: just clear buffered partial data.
			// Recreating the parser here would tear down listeners registered by
			// in-flight operations (e.g. the .L support probe), orphaning them.
			this.parser.reset()
			return
		}

		// Create new parser
		this.parser = new QuartzParser()

		// Handle parsed messages
		this.parser.on('message', (message) => {
			this._handleParsedMessage(message)
		})
	}

	/**
	 * Handles a parsed protocol message
	 *
	 * Routes the message to appropriate handlers based on type
	 * and updates module state accordingly.
	 *
	 * @private
	 * @param {ParsedMessage} message - Parsed message from QuartzParser
	 * @returns {void}
	 */
	_handleParsedMessage(message) {
		switch (message.type) {
			case MessageType.DESTINATION_NAME:
				this._handleDestinationName(message)
				break

			case MessageType.SOURCE_NAME:
				this._handleSourceName(message)
				break

			case MessageType.CROSSPOINT_UPDATE:
				this._handleCrosspointUpdate(message)
				break

			case MessageType.ACKNOWLEDGE:
				this._handleAcknowledge(message)
				break

			case MessageType.LOCK_STATUS:
				this._handleLockStatus(message)
				break

			case MessageType.POWER_UP:
				this.log('info', 'Router power up or reset detected')
				// Re-request state and re-probe .L support after reset
				this._listRoutesSupported = null
				this._refreshFromRouter()
				break

			case MessageType.ERROR:
				this._handleProtocolError(message)
				break

			case MessageType.UNKNOWN:
				if (this.config.verbose) {
					this.log('debug', `Unknown message: ${message.raw}`)
				}
				break
		}
	}

	/**
	 * Handles a destination name message
	 *
	 * Updates the CHOICES_DESTINATIONS array with the received name.
	 * Triggers action refresh if the list changes.
	 *
	 * @private
	 * @param {DestinationNameMessage} message - Destination name message
	 * @returns {void}
	 */
	_handleDestinationName(message) {
		const entry = {
			id: String(message.id),
			label: `[${message.id}] ${message.name}`,
		}

		// Update or add entry
		this._updateChoiceList(this.CHOICES_DESTINATIONS, entry, 'destination')

		this.setVariableValues({
			[`dst_${message.id}_name`]: message.name,
		})
	}

	/**
	 * Handles a source name message
	 *
	 * Updates the CHOICES_SOURCES array with the received name.
	 * Triggers action refresh if the list changes.
	 *
	 * @private
	 * @param {SourceNameMessage} message - Source name message
	 * @returns {void}
	 */
	_handleSourceName(message) {
		const entry = {
			id: String(message.id),
			label: `[${message.id}] ${message.name}`,
		}

		// Update or add entry
		const changed = this._updateChoiceList(this.CHOICES_SOURCES, entry, 'source')

		this.setVariableValues({
			[`src_${message.id}_name`]: message.name,
		})

		// Crosspoints already routed from this source are now showing a stale name
		if (changed) {
			this._refreshCrosspointNameVariables(message.id)
		}
	}

	/**
	 * Refreshes the video-level crosspoint name variables for a source
	 *
	 * Crosspoint name variables hold the name of the routed source, so they are
	 * empty or stale whenever the router reports a name for a source that is
	 * already routed somewhere.
	 *
	 * @private
	 * @param {number} source - Source ID whose name changed
	 * @returns {void}
	 */
	_refreshCrosspointNameVariables(source) {
		if (!getXptVariableLevels(this.config).includes('V')) {
			return
		}

		const destinations = this.crosspoints['V']
		if (!destinations) {
			return
		}

		const sourceName = this._getSourceLabel(source)
		const values = {}

		for (const [destination, routedSource] of Object.entries(destinations)) {
			if (routedSource === source) {
				values[`xpt_v_${destination}_name`] = sourceName
			}
		}

		if (Object.keys(values).length > 0) {
			this.setVariableValues(values)
		}
	}

	/**
	 * Handles a destination lock status message
	 *
	 * Updates internal lock state, Companion variables, and feedbacks.
	 *
	 * @private
	 * @param {LockStatusMessage} message - Lock status message (.BA)
	 * @returns {void}
	 */
	_handleLockStatus(message) {
		const { destination, status } = message
		this.locks[destination] = status

		const label = lockStatusToLabel(status)
		this.setVariableValues({
			[`dst_${destination}_lock_state`]: label,
		})

		if (this.config.verbose) {
			this.log('debug', `Lock status: Dest ${destination} = ${label} (${status})`)
		}

		this.checkFeedbacks('destination_locked')
	}

	/**
	 * Handles a crosspoint update message
	 *
	 * Updates internal crosspoint state and Companion variables.
	 * Called both for responses to our commands and for unsolicited
	 * updates when panels or other controllers change routes.
	 *
	 * @private
	 * @param {CrosspointUpdateMessage} message - Crosspoint update message
	 * @returns {void}
	 */
	_handleCrosspointUpdate(message) {
		const { levels, destination, source } = message

		// Update internal state and variables for each level in the message
		for (const level of levels) {
			if (!this.crosspoints[level]) {
				this.crosspoints[level] = {}
			}
			this.crosspoints[level][destination] = source

			// Update Companion variables to reflect new routing
			this._updateCrosspointVariable(level, destination, source)
		}

		// Always log route changes for audit trail in professional environments
		// This captures both our own commands and external changes (panels, other controllers)
		const levelStr = levels.join('')
		const destName = this._getDestinationName(destination)
		const srcName = this._getSourceName(source)
		this.log('info', `Route: ${srcName} -> ${destName} (Level ${levelStr})`)

		// Trigger feedback check for any feedbacks monitoring this route
		this.checkFeedbacks()
	}

	/**
	 * Handles an acknowledge message
	 *
	 * The .A response can contain crosspoint data from interrogate (.I) or
	 * list (.L) commands. Format: .A{level}{dest},{src} or multiple pairs.
	 *
	 * @private
	 * @param {AcknowledgeMessage} message - Acknowledge message
	 * @returns {void}
	 */
	_handleAcknowledge(message) {
		// Simple .A with no data - just an acknowledgment
		if (!message.data) {
			return
		}

		if (this.config.verbose) {
			this.log('debug', `Acknowledge with data: ${message.data}`)
		}

		// Try to parse as interrogate response: {level}{dest},{src}
		// Example: V001,005 means dest 1 has source 5 on level V
		this._parseInterrogateData(message.data)
	}

	/**
	 * Parses interrogate response data and updates crosspoint state
	 *
	 * Handles both single interrogate responses (.IV1 -> .AV001,005)
	 * and list responses (.LV1,- -> .AV001,005V002,003V003,001...)
	 *
	 * Updates both internal state and Companion variables for each
	 * crosspoint parsed.
	 *
	 * @private
	 * @param {string} data - Data portion of .A response (after the .A prefix)
	 * @returns {void}
	 */
	_parseInterrogateData(data) {
		const groups = parseCrosspointGroups(data)
		if (groups.length === 0) {
			return
		}

		for (const { level, destination, source } of groups) {
			// Update internal crosspoint state
			if (!this.crosspoints[level]) {
				this.crosspoints[level] = {}
			}
			this.crosspoints[level][destination] = source

			// Update Companion variables to reflect current routing
			this._updateCrosspointVariable(level, destination, source)

			if (this.config.verbose) {
				this.log('debug', `Interrogate: Dest ${destination} = Source ${source} (Level ${level})`)
			}
		}

		this.checkFeedbacks()
	}

	/**
	 * Updates Companion variables for a crosspoint change
	 *
	 * Sets the active source ID variable for the level/destination, plus the
	 * resolved source name variable on the video level.
	 *
	 * @private
	 * @param {string} level - Level character (e.g., 'V' for video)
	 * @param {number} destination - Destination ID
	 * @param {number} source - Source ID currently routed to destination
	 * @returns {void}
	 */
	_updateCrosspointVariable(level, destination, source) {
		// Only levels that have variables defined for them are published — none
		// at all when enable_xpt_variables is off.
		if (!getXptVariableLevels(this.config).includes(level)) {
			return
		}

		const levelLower = level.toLowerCase()
		const values = {
			[`xpt_${levelLower}_${destination}`]: String(source),
		}

		// Names are only published for the video level
		if (level === 'V') {
			values[`xpt_${levelLower}_${destination}_name`] = this._getSourceLabel(source)
		}

		this.setVariableValues(values)
	}

	/**
	 * Handles a protocol error message
	 *
	 * Logs the error for debugging. Common cause is max_sources
	 * or max_destinations being set higher than router capacity.
	 *
	 * @private
	 * @param {ErrorMessage} message - Error message
	 * @returns {void}
	 */
	_handleProtocolError(_message) {
		this.log('error', 'Received error from router. Are max_destinations or max_sources too high?')
	}

	/**
	 * Updates a choice list with a new entry
	 *
	 * Handles the "No X Loaded" placeholder and avoids duplicates.
	 * Triggers action refresh when the list changes.
	 *
	 * @private
	 * @param {ChoiceEntry[]} list - The choice list to update
	 * @param {ChoiceEntry} entry - The entry to add or update
	 * @param {string} type - Type name for logging ('destination' or 'source')
	 * @returns {boolean} True when the list changed
	 */
	_updateChoiceList(list, entry, _type) {
		// Remove placeholder if present
		if (list.length === 1 && list[0].id === '0') {
			list.length = 0
		}

		// Find existing entry
		const existingIndex = list.findIndex((e) => e.id === entry.id)

		if (existingIndex >= 0) {
			// Nothing to do when the label is unchanged
			if (list[existingIndex].label === entry.label) {
				return false
			}

			list[existingIndex] = entry
		} else {
			// Add new entry
			list.push(entry)
		}

		this._scheduleActionsRefresh()
		return true
	}

	/**
	 * Schedules an actions refresh
	 *
	 * Uses a debounce mechanism to avoid excessive refreshes
	 * when many names arrive in quick succession.
	 *
	 * @private
	 * @returns {void}
	 */
	_scheduleActionsRefresh() {
		// Simple debounce - refresh after all messages processed
		if (this._refreshTimeout) {
			clearTimeout(this._refreshTimeout)
		}

		this._refreshTimeout = setTimeout(() => {
			this.initActions()
			this.initFeedbacks()
			this.initPresets()
			this._refreshTimeout = null
		}, 100)
	}

	/**
	 * Called when TCP connection is established
	 *
	 * Triggers initial data retrieval from the router.
	 * This is called by api.js when the socket connects.
	 *
	 * @returns {void}
	 */
	onConnected() {
		this.log('info', 'Refreshing data from router')
		this._listRoutesSupported = null // reconnect may land on different hardware
		this._listRoutesProbePromise = null // discard any probe still pending from the previous connection
		this._refreshFromRouter()
	}

	/**
	 * Refreshes names, crosspoint state, and lock state from the router.
	 *
	 * Probes .L support before anything else is asked for, so the probe window
	 * stays free of the .A replies that name/crosspoint/lock queries produce and
	 * so the crosspoint request already knows whether it can batch.
	 *
	 * @private
	 * @returns {Promise<void>}
	 */
	async _refreshFromRouter() {
		this._refreshInProgress = true
		try {
			await this._probeListRoutesSupport()
			this._requestNames()
			this._requestCrosspoints()
			this._requestLocks()
		} finally {
			this._refreshInProgress = false
		}
	}

	/**
	 * Probes .L (list routes) support with a single .LV1,-.
	 *
	 * Only a multi-route .A settles the probe as supported: that shape can only
	 * have come from a .L, whereas a bare .A (command ack) or a single-route .A
	 * (an .I reply from a poll that was already in flight) is indistinguishable
	 * from unrelated traffic. Anything else — including .E from an unrelated
	 * command — is left to the timeout, which falls back to .I. Falling back is
	 * always safe: .I is universally supported, just chattier.
	 *
	 * Result is cached until the next connect or router power-up.
	 *
	 * @private
	 * @returns {Promise<boolean>}
	 */
	_probeListRoutesSupport() {
		if (this._listRoutesSupported !== null) {
			return Promise.resolve(this._listRoutesSupported)
		}
		if (this._listRoutesProbePromise) {
			return this._listRoutesProbePromise
		}
		if (!this.parser) {
			return Promise.resolve(false)
		}

		const parser = this.parser

		this._listRoutesProbePromise = new Promise((resolve) => {
			let settled = false

			const finish = (supported) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				parser.off('message', onMessage)
				this._listRoutesSupported = supported
				this._listRoutesProbePromise = null
				this.log(
					'info',
					`Crosspoint polling: .L ${supported ? 'is supported — batching enabled' : 'not supported — using .I'}`,
				)
				resolve(supported)
			}

			// Only the very next message can be attributed to this probe with any
			// confidence — there's no request ID to correlate against, so waiting
			// for a qualifying message anywhere in the full timeout window risks
			// matching unrelated traffic from another controller on the router.
			const onMessage = (message) => {
				finish(message.type === MessageType.ACKNOWLEDGE && parseCrosspointGroups(message.data).length > 1)
			}

			const timer = setTimeout(() => finish(false), LIST_ROUTES_PROBE_TIMEOUT)

			parser.on('message', onMessage)
			this.sendCommand('.LV1,-') // sendCommand appends \r
		})

		return this._listRoutesProbePromise
	}

	/**
	 * Called on polling interval
	 *
	 * Refreshes names and crosspoint state. Lock state isn't re-polled here —
	 * the router pushes .BA unsolicited on change; full refresh happens on
	 * connect/power-up instead (see onConnected()).
	 *
	 * Skipped while a refresh is running: it already requests everything a poll
	 * would, and its .L probe must not see poll replies.
	 *
	 * @returns {void}
	 */
	poll() {
		if (this._refreshInProgress) {
			return
		}

		this._requestNames()
		this._requestCrosspoints()
	}

	/**
	 * Requests source and destination names from the router
	 *
	 * Builds and sends the appropriate Quartz commands to
	 * retrieve all configured source and destination names.
	 *
	 * @private
	 * @returns {void}
	 */
	_requestNames() {
		const cmd = buildReadNamesCommand(this.config.max_destinations, this.config.max_sources)
		this.sendCommand(cmd)
	}

	/**
	 * Requests current crosspoint state from the router
	 *
	 * Always interrogates the base 'V' level (matches this module's original
	 * behavior — video routing state is core functionality independent of
	 * the optional xpt_* variables). When enable_xpt_variables is on, also
	 * interrogates every other level configured via xpt_levels.
	 *
	 * Uses .L (list routes, up to 8 per response) instead of one .I per
	 * destination when the router's been probed as supporting it — see
	 * _probeListRoutesSupport(). Falls back to .I otherwise.
	 *
	 * The router responds with .A messages containing the current source
	 * for each destination.
	 *
	 * Note: The router also sends unsolicited .U messages whenever
	 * routes change, so polling is supplementary to real-time updates.
	 *
	 * @private
	 * @returns {void}
	 */
	_requestCrosspoints() {
		const maxDest = this.config.max_destinations

		const levels = new Set(['V', ...getXptVariableLevels(this.config)])

		const buildAll = this._listRoutesSupported === true ? buildListRoutesAllCommand : buildInterrogateAllCommand

		let cmd = ''
		for (const level of levels) {
			cmd += buildAll(level, maxDest)
		}
		this.sendCommand(cmd)
	}

	/**
	 * Requests lock status for all configured destinations
	 *
	 * @private
	 * @returns {void}
	 */
	_requestLocks() {
		const cmd = buildLockInterrogateAllCommand(this.config.max_destinations)
		this.sendCommand(cmd)
	}

	/**
	 * Gets the source currently routed to a destination on a given level
	 *
	 * @param {string} level - Level character (e.g., 'V')
	 * @param {number|string} destination - Destination ID
	 * @returns {number|undefined} Source ID, or undefined if unknown
	 */
	getRoutedSource(level, destination) {
		const destNum = typeof destination === 'string' ? parseInt(destination, 10) : destination
		return this.crosspoints[level]?.[destNum]
	}

	/**
	 * Gets the lock status code for a destination
	 *
	 * @param {number|string} destination - Destination ID
	 * @returns {number|undefined} Quartz lock status, or undefined if unknown
	 */
	getLockStatus(destination) {
		const destNum = typeof destination === 'string' ? parseInt(destination, 10) : destination
		return this.locks[destNum]
	}

	/**
	 * Interrogates and awaits the lock status for a single destination.
	 *
	 * Used by sendLockCommand()'s Toggle branch when local lock state is
	 * unknown, so toggle direction isn't guessed blind. Falls back to the
	 * (still unknown) cached value if no reply arrives in time.
	 *
	 * @param {number} destNum - Destination ID
	 * @returns {Promise<number|undefined>} Lock status, or undefined on timeout
	 */
	_interrogateLockStatus(destNum) {
		if (!this.parser) {
			return Promise.resolve(this.locks[destNum])
		}

		const parser = this.parser

		return new Promise((resolve) => {
			let settled = false

			const finish = (status) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				parser.off('message', onMessage)
				resolve(status)
			}

			const onMessage = (message) => {
				if (message.type === MessageType.LOCK_STATUS && message.destination === destNum) {
					finish(message.status)
				}
			}

			const timer = setTimeout(() => finish(this.locks[destNum]), LOCK_STATUS_INTERROGATE_TIMEOUT)

			parser.on('message', onMessage)
			this.sendCommand(buildLockInterrogateCommand(destNum))
		})
	}

	/**
	 * Sets the currently selected destination for the Take workflow
	 *
	 * Single write path for destination selection: updates `dst` (the Take
	 * workflow variable) together with the legacy `destination`/`destination_name`
	 * aliases, and refreshes the feedbacks that depend on the selection.
	 *
	 * @param {number|string} destination - Destination ID
	 * @returns {void}
	 */
	setSelectedDestination(destination) {
		const entry = this.CHOICES_DESTINATIONS.find((element) => element.id == destination)

		this.setVariableValues({
			dst: destination,
			destination: destination,
			destination_name: entry ? entry.label : '',
		})

		this.checkFeedbacks('selected_destination', 'source_routed_to_selected_destination')
	}

	/**
	 * Sets the currently selected source for the Take workflow
	 *
	 * @param {number|string} source - Source ID
	 * @returns {void}
	 */
	setSelectedSource(source) {
		this.setVariableValues({ src: source })
		this.checkFeedbacks('selected_source')
	}

	/**
	 * Gets a formatted destination name for logging
	 *
	 * Returns "Name (ID)" if name is known, otherwise just "Dest ID"
	 *
	 * @private
	 * @param {number} id - Destination ID
	 * @returns {string} Formatted destination identifier
	 */
	_getDestinationName(id) {
		const entry = this.CHOICES_DESTINATIONS.find((e) => e.id === String(id))
		if (entry && entry.id !== '0') {
			const match = entry.label.match(/^\[\d+\]\s*(.*)$/)
			const name = match ? match[1] : entry.label
			return `${name} (${id})`
		}
		return `Dest ${id}`
	}

	/**
	 * Gets a formatted source name for logging
	 *
	 * Returns "Name (ID)" if name is known, otherwise just "Src ID"
	 *
	 * @private
	 * @param {number} id - Source ID
	 * @returns {string} Formatted source identifier
	 */
	_getSourceName(id) {
		const name = this._getSourceLabel(id)
		return name === '' ? `Src ${id}` : `${name} (${id})`
	}

	/**
	 * Gets the router-reported name for a source
	 *
	 * Strips the '[id] ' prefix carried by CHOICES_SOURCES labels, so the result
	 * is the bare name suitable for a Companion variable.
	 *
	 * @private
	 * @param {number} id - Source ID
	 * @returns {string} Source name, or empty string when the name is unknown
	 */
	_getSourceLabel(id) {
		const entry = this.CHOICES_SOURCES.find((e) => e.id === String(id))
		if (!entry || entry.id === '0') {
			return ''
		}

		const match = entry.label.match(/^\[\d+\]\s*(.*)$/)
		return match ? match[1] : entry.label
	}
}

runEntrypoint(QuartzInstance, upgrades)
