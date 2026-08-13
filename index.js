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
	buildReadNamesCommand,
	buildInterrogateAllCommand,
	buildLockInterrogateAllCommand,
} = require('./src/quartz')

const { parseLevelsConfig, VALID_LEVELS, lockStatusToLabel } = require('./src/constants')

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
		 * Currently selected destination for "route to selected" workflow
		 * @type {number|string}
		 */
		this.selectedDestination = 0

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
		// Clean up existing parser
		if (this.parser) {
			this.parser.removeAllListeners()
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
				// Re-request state after router reset
				this._requestNames()
				this._requestCrosspoints()
				this._requestLocks()
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
		const validLevels = VALID_LEVELS
		let remaining = data
		let updated = false

		// Parse potentially multiple level/dest/src groups
		// Format: {level}{dest},{src}[{level}{dest},{src}...]
		while (remaining.length > 0) {
			// First character should be a level
			const level = remaining[0]
			if (!validLevels.includes(level)) {
				// Not a crosspoint response, skip
				break
			}

			remaining = remaining.slice(1)

			// Find the comma separating dest from src
			const commaIndex = remaining.indexOf(',')
			if (commaIndex === -1) {
				break
			}

			const destStr = remaining.slice(0, commaIndex)
			remaining = remaining.slice(commaIndex + 1)

			// Find end of source number (next level letter or end of string)
			let srcEndIndex = 0
			while (srcEndIndex < remaining.length && !validLevels.includes(remaining[srcEndIndex])) {
				srcEndIndex++
			}

			const srcStr = remaining.slice(0, srcEndIndex)
			remaining = remaining.slice(srcEndIndex)

			// Parse and store
			const destination = parseInt(destStr, 10)
			const source = parseInt(srcStr, 10)

			if (!isNaN(destination) && !isNaN(source)) {
				// Update internal crosspoint state
				if (!this.crosspoints[level]) {
					this.crosspoints[level] = {}
				}
				this.crosspoints[level][destination] = source

				// Update Companion variables to reflect current routing
				this._updateCrosspointVariable(level, destination, source)

				updated = true

				if (this.config.verbose) {
					this.log('debug', `Interrogate: Dest ${destination} = Source ${source} (Level ${level})`)
				}
			}
		}

		if (updated) {
			this.checkFeedbacks()
		}
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
		// 'V' is always tracked
		// Other levels only update their variable when enable_xpt_variables
		// is on and the level is in the configured xpt_levels set.
		if (level !== 'V') {
			if (!this.config.enable_xpt_variables) {
				return
			}
			const trackedLevels = parseLevelsConfig(this.config.xpt_levels)
			if (!trackedLevels.includes(level)) {
				return
			}
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
		this._requestNames()
		this._requestCrosspoints()
		this._requestLocks()
	}

	/**
	 * Called on polling interval
	 *
	 * Refreshes names, crosspoint state, and lock state from the router.
	 *
	 * @returns {void}
	 */
	poll() {
		this._requestNames()
		this._requestCrosspoints()
		this._requestLocks()
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

		const levels = new Set(['V'])
		if (this.config.enable_xpt_variables) {
			for (const level of parseLevelsConfig(this.config.xpt_levels)) {
				levels.add(level)
			}
		}

		let cmd = ''
		for (const level of levels) {
			cmd += buildInterrogateAllCommand(level, maxDest)
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
