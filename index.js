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

const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base')
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
} = require('./src/quartz')

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

			case MessageType.POWER_UP:
				this.log('info', 'Router power up or reset detected')
				// Re-request names after router reset
				this._requestNames()
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
		this._updateChoiceList(this.CHOICES_SOURCES, entry, 'source')
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
		const validLevels = 'VABCDEFGHIJKLMNO'
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
	 * Sets both the source ID variable and the resolved source name variable.
	 * Only updates if crosspoint variables are enabled in config.
	 * 
	 * @private
	 * @param {string} level - Level character (e.g., 'V' for video)
	 * @param {number} destination - Destination ID
	 * @param {number} source - Source ID currently routed to destination
	 * @returns {void}
	 */
	_updateCrosspointVariable(level, destination, source) {
		// Skip if crosspoint variables are disabled
		if (!this.config.enable_xpt_variables) {
			return
		}

		// Build variable IDs using lowercase level for consistency
		const levelLower = level.toLowerCase()
		const idVar = `xpt_${levelLower}_${destination}`
		const nameVar = `xpt_${levelLower}_${destination}_name`

		// Look up source name from CHOICES_SOURCES
		// Format in CHOICES_SOURCES is { id: '5', label: '[5] CAM-1' }
		// We want just the name part, not the bracketed ID prefix
		let sourceName = ''
		const sourceEntry = this.CHOICES_SOURCES.find((entry) => entry.id === String(source))
		if (sourceEntry && sourceEntry.id !== '0') {
			// Extract name from label by removing the '[id] ' prefix
			// Label format: '[5] CAM-1' -> we want 'CAM-1'
			const match = sourceEntry.label.match(/^\[\d+\]\s*(.*)$/)
			sourceName = match ? match[1] : sourceEntry.label
		}

		// Update both variables in a single call for efficiency
		this.setVariableValues({
			[idVar]: String(source),
			[nameVar]: sourceName,
		})
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
	_handleProtocolError(message) {
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
	 * @returns {void}
	 */
	_updateChoiceList(list, entry, type) {
		// Remove placeholder if present
		if (list.length === 1 && list[0].id === '0') {
			list.length = 0
		}

		// Find existing entry
		const existingIndex = list.findIndex((e) => e.id === entry.id)

		if (existingIndex >= 0) {
			// Update existing entry if label changed
			if (list[existingIndex].label !== entry.label) {
				list[existingIndex] = entry
				this._scheduleActionsRefresh()
			}
		} else {
			// Add new entry
			list.push(entry)
			this._scheduleActionsRefresh()
		}
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
	}

	/**
	 * Called on polling interval
	 * 
	 * Refreshes names and crosspoint state from the router.
	 * 
	 * @returns {void}
	 */
	poll() {
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
		const cmd = buildReadNamesCommand(
			this.config.max_destinations,
			this.config.max_sources
		)
		this.sendCommand(cmd)
	}

	/**
	 * Requests current crosspoint state from the router
	 * 
	 * Interrogates all destinations on the video level to get
	 * the current routing state. The router responds with .A
	 * messages containing the current source for each destination.
	 * 
	 * Note: The router also sends unsolicited .U messages whenever
	 * routes change, so polling is supplementary to real-time updates.
	 * 
	 * @private
	 * @returns {void}
	 */
	_requestCrosspoints() {
		// Request crosspoints for video level
		// TODO: Could be extended to request other levels via config
		const cmd = buildInterrogateAllCommand('V', this.config.max_destinations)
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
		const entry = this.CHOICES_SOURCES.find((e) => e.id === String(id))
		if (entry && entry.id !== '0') {
			const match = entry.label.match(/^\[\d+\]\s*(.*)$/)
			const name = match ? match[1] : entry.label
			return `${name} (${id})`
		}
		return `Src ${id}`
	}
}

runEntrypoint(QuartzInstance, upgrades)