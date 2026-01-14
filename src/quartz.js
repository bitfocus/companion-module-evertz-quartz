/**
 * @fileoverview Quartz Protocol Implementation for Evertz Routers
 * 
 * This module handles the Quartz protocol used by Evertz EQX/EQT series routers.
 * It provides command building, response parsing, and message framing.
 * 
 * Quartz protocol framing:
 * - Commands and responses start with '.' 
 * - Messages are terminated with '\r' (carriage return, 0x0D)
 * - Multiple commands can be batched in a single transmission
 * - Responses may arrive fragmented across multiple TCP packets
 * 
 * @module quartz
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 * @see Evertz Application Note 65 - Quartz Routing Switcher Remote Control Protocol
 */

const EventEmitter = require('events')

/**
 * Quartz protocol command prefixes
 * @readonly
 * @enum {string}
 */
const CommandPrefix = {
	/** Read destination name (.RD) */
	READ_DESTINATION: '.RD',
	/** Read source name (.RS) */
	READ_SOURCE: '.RS',
	/** Read level name (.RL) */
	READ_LEVEL: '.RL',
	/** Interrogate single crosspoint (.I) */
	INTERROGATE: '.I',
	/** List routes - up to 8 at a time (.L) */
	LIST_ROUTES: '.L',
	/** Set crosspoint / route (.S) */
	SET_CROSSPOINT: '.S',
	/** Fire salvo (.F) */
	FIRE_SALVO: '.F',
	/** Lock/unlock/interrogate destination (.B) */
	LOCK: '.B',
	/** Queue/Salvo commands (.Q) */
	QUEUE: '.Q',
	/** Multiple set crosspoint (.M) */
	MULTI_SET: '.M',
}

/**
 * Quartz protocol response prefixes
 * @readonly
 * @enum {string}
 */
const ResponsePrefix = {
	/** Acknowledge response (.A) */
	ACKNOWLEDGE: '.A',
	/** Destination name response (.RAD) */
	DESTINATION_NAME: '.RAD',
	/** Source name response (.RAS) */
	SOURCE_NAME: '.RAS',
	/** Level name response (.RAL) */
	LEVEL_NAME: '.RAL',
	/** Crosspoint update - sent when routes change (.U) */
	UPDATE: '.U',
	/** Lock status response (.BA) */
	LOCK_STATUS: '.BA',
	/** Error response (.E) */
	ERROR: '.E',
	/** Power up notification (.P) */
	POWER_UP: '.P',
}

/**
 * Parsed message types emitted by the parser
 * @readonly
 * @enum {string}
 */
const MessageType = {
	/** Destination name received */
	DESTINATION_NAME: 'destinationName',
	/** Source name received */
	SOURCE_NAME: 'sourceName',
	/** Crosspoint status update (route changed) */
	CROSSPOINT_UPDATE: 'crosspointUpdate',
	/** Acknowledge response */
	ACKNOWLEDGE: 'acknowledge',
	/** Lock status response */
	LOCK_STATUS: 'lockStatus',
	/** Router power up or reset */
	POWER_UP: 'powerUp',
	/** Protocol error from router */
	ERROR: 'error',
	/** Unrecognized message */
	UNKNOWN: 'unknown',
}

/**
 * @typedef {Object} DestinationNameMessage
 * @property {string} type - Always MessageType.DESTINATION_NAME
 * @property {number} id - Destination ID (1-based)
 * @property {string} name - Destination name from router
 */

/**
 * @typedef {Object} SourceNameMessage
 * @property {string} type - Always MessageType.SOURCE_NAME
 * @property {number} id - Source ID (1-based)
 * @property {string} name - Source name from router
 */

/**
 * @typedef {Object} CrosspointUpdateMessage
 * @property {string} type - Always MessageType.CROSSPOINT_UPDATE
 * @property {string[]} levels - Array of level characters that changed (e.g., ['V', 'A'])
 * @property {number} destination - Destination ID
 * @property {number} source - Source ID now routed to destination
 */

/**
 * @typedef {Object} AcknowledgeMessage
 * @property {string} type - Always MessageType.ACKNOWLEDGE
 * @property {string} [data] - Optional data following .A (e.g., interrogate response)
 * @property {string} raw - Raw message string
 */

/**
 * @typedef {Object} LockStatusMessage
 * @property {string} type - Always MessageType.LOCK_STATUS
 * @property {number} destination - Destination ID
 * @property {number} status - Lock status (0=unlocked, 1-254=panel address, 255=unprotected lock)
 */

/**
 * @typedef {Object} PowerUpMessage
 * @property {string} type - Always MessageType.POWER_UP
 */

/**
 * @typedef {Object} ErrorMessage
 * @property {string} type - Always MessageType.ERROR
 * @property {string} raw - Raw error string from router
 */

/**
 * @typedef {Object} UnknownMessage
 * @property {string} type - Always MessageType.UNKNOWN
 * @property {string} raw - Raw unparsed message
 */

/**
 * @typedef {DestinationNameMessage|SourceNameMessage|CrosspointUpdateMessage|AcknowledgeMessage|LockStatusMessage|PowerUpMessage|ErrorMessage|UnknownMessage} ParsedMessage
 */

/**
 * Quartz Protocol Parser
 * 
 * Handles message framing and parsing for the Quartz protocol.
 * Accumulates incoming data until complete messages are received,
 * then parses and emits structured message objects.
 * 
 * @extends EventEmitter
 * @fires QuartzParser#message
 * 
 * @example
 * const parser = new QuartzParser()
 * parser.on('message', (msg) => {
 *   if (msg.type === MessageType.DESTINATION_NAME) {
 *     console.log(`Destination ${msg.id}: ${msg.name}`)
 *   }
 * })
 * parser.feed(dataFromSocket)
 */
class QuartzParser extends EventEmitter {
	/**
	 * Creates a new QuartzParser instance
	 */
	constructor() {
		super()

		/**
		 * Buffer for accumulating fragmented responses
		 * @type {string}
		 * @private
		 */
		this._buffer = ''
	}

	/**
	 * Feeds raw data into the parser
	 * 
	 * Data is accumulated and processed incrementally. Complete messages
	 * (terminated with \r) are parsed and emitted immediately. Incomplete
	 * data remains in the buffer until more data arrives.
	 * 
	 * @param {Buffer|string} data - Raw data received from socket
	 * @returns {void}
	 * 
	 * @example
	 * socket.on('data', (data) => parser.feed(data))
	 */
	feed(data) {
		// Convert Buffer to string if necessary
		const chunk = Buffer.isBuffer(data) ? data.toString('utf-8') : data
		this._buffer += chunk

		// Process any complete messages in the buffer
		this._processBuffer()
	}

	/**
	 * Processes the internal buffer, extracting and parsing complete messages
	 * 
	 * Quartz framing: messages start with '.' and end with '\r'
	 * Multiple messages may be present in the buffer. Any incomplete
	 * message at the end is retained for the next feed() call.
	 * 
	 * @private
	 * @returns {void}
	 */
	_processBuffer() {
		// Process all complete messages (those ending with \r)
		let crIndex
		while ((crIndex = this._buffer.indexOf('\r')) !== -1) {
			// Extract the complete message (including any leading whitespace/previous \r)
			const message = this._buffer.slice(0, crIndex)
			
			// Remove processed message from buffer (including the \r)
			this._buffer = this._buffer.slice(crIndex + 1)

			// Parse if it looks like a Quartz message
			if (message.length > 0) {
				// Find the start of the actual message (.)
				const dotIndex = message.lastIndexOf('.')
				if (dotIndex !== -1) {
					const cleanMessage = message.slice(dotIndex)
					const parsed = this._parseLine(cleanMessage)
					if (parsed) {
						/**
						 * Message event - emitted when a complete message is parsed
						 * @event QuartzParser#message
						 * @type {ParsedMessage}
						 */
						this.emit('message', parsed)
					}
				}
			}
		}
	}

	/**
	 * Parses a single Quartz protocol line into a structured message
	 * 
	 * @private
	 * @param {string} line - Single line from the protocol (without \r terminator)
	 * @returns {ParsedMessage|null} Parsed message object, or null if empty
	 */
	_parseLine(line) {
		// Destination name response: .RAD{id},{name}
		if (line.startsWith(ResponsePrefix.DESTINATION_NAME)) {
			return this._parseNameResponse(line, ResponsePrefix.DESTINATION_NAME, MessageType.DESTINATION_NAME)
		}

		// Source name response: .RAS{id},{name}
		if (line.startsWith(ResponsePrefix.SOURCE_NAME)) {
			return this._parseNameResponse(line, ResponsePrefix.SOURCE_NAME, MessageType.SOURCE_NAME)
		}

		// Update response: .U{levels}{dest},{srce}
		// This is sent when crosspoints change (from any source - panels, commands, etc.)
		if (line.startsWith(ResponsePrefix.UPDATE)) {
			return this._parseUpdateResponse(line)
		}

		// Lock status response: .BA{dest},{status}
		if (line.startsWith(ResponsePrefix.LOCK_STATUS)) {
			return this._parseLockStatusResponse(line)
		}

		// Acknowledge response: .A or .A{data}
		if (line.startsWith(ResponsePrefix.ACKNOWLEDGE)) {
			return this._parseAcknowledgeResponse(line)
		}

		// Error response: .E
		if (line === ResponsePrefix.ERROR || line.startsWith(ResponsePrefix.ERROR)) {
			return {
				type: MessageType.ERROR,
				raw: line,
			}
		}

		// Power up response: .P
		if (line === ResponsePrefix.POWER_UP || line.startsWith(ResponsePrefix.POWER_UP)) {
			return {
				type: MessageType.POWER_UP,
			}
		}

		// Unknown response - still emit for debugging/extensibility
		return {
			type: MessageType.UNKNOWN,
			raw: line,
		}
	}

	/**
	 * Parses a name response (destination or source)
	 * 
	 * Format: .RA[D|S]{id},{name}
	 * Example: .RAD001,Camera 1
	 * 
	 * @private
	 * @param {string} line - Raw response line
	 * @param {string} prefix - The response prefix to strip
	 * @param {string} type - The message type to assign
	 * @returns {DestinationNameMessage|SourceNameMessage|UnknownMessage} Parsed message
	 */
	_parseNameResponse(line, prefix, type) {
		const payload = line.slice(prefix.length)
		const commaIndex = payload.indexOf(',')

		if (commaIndex === -1) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		const id = parseInt(payload.slice(0, commaIndex), 10)
		const name = payload.slice(commaIndex + 1)

		return {
			type,
			id,
			name,
		}
	}

	/**
	 * Parses a crosspoint update response
	 * 
	 * Format: .U{levels}{dest},{srce}
	 * Example: .UV001,002 (destination 1 routed to source 2 on level V)
	 * Example: .UVAB001,002 (destination 1 routed to source 2 on levels V, A, B)
	 * 
	 * Per protocol spec, levels are always in order: V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O
	 * 
	 * @private
	 * @param {string} line - Raw response line
	 * @returns {CrosspointUpdateMessage|UnknownMessage} Parsed update message
	 */
	_parseUpdateResponse(line) {
		// Strip the .U prefix
		const payload = line.slice(ResponsePrefix.UPDATE.length)

		if (payload.length < 3) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		// Find where the levels end and the destination number begins
		// Levels are letters (V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O)
		// Destination is numeric
		let levelEndIndex = 0
		const validLevels = 'VABCDEFGHIJKLMNO'
		
		while (levelEndIndex < payload.length && validLevels.includes(payload[levelEndIndex])) {
			levelEndIndex++
		}

		if (levelEndIndex === 0) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		const levels = payload.slice(0, levelEndIndex).split('')
		const rest = payload.slice(levelEndIndex)

		const commaIndex = rest.indexOf(',')
		if (commaIndex === -1) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		const destination = parseInt(rest.slice(0, commaIndex), 10)
		const source = parseInt(rest.slice(commaIndex + 1), 10)

		if (isNaN(destination) || isNaN(source)) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		return {
			type: MessageType.CROSSPOINT_UPDATE,
			levels,
			destination,
			source,
		}
	}

	/**
	 * Parses a lock status response
	 * 
	 * Format: .BA{dest},{status}
	 * Status values:
	 *   0 = unlocked
	 *   1-254 = protected lock by panel at Q-link address (n-1)
	 *   255 = unprotected lock
	 * 
	 * @private
	 * @param {string} line - Raw response line
	 * @returns {LockStatusMessage|UnknownMessage} Parsed lock status message
	 */
	_parseLockStatusResponse(line) {
		const payload = line.slice(ResponsePrefix.LOCK_STATUS.length)
		const commaIndex = payload.indexOf(',')

		if (commaIndex === -1) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		const destination = parseInt(payload.slice(0, commaIndex), 10)
		const status = parseInt(payload.slice(commaIndex + 1), 10)

		if (isNaN(destination) || isNaN(status)) {
			return {
				type: MessageType.UNKNOWN,
				raw: line,
			}
		}

		return {
			type: MessageType.LOCK_STATUS,
			destination,
			status,
		}
	}

	/**
	 * Parses an acknowledge response
	 * 
	 * Format: .A or .A{data}
	 * 
	 * The .A response is used for:
	 * - Simple acknowledgment (just .A)
	 * - Interrogate response (.A{level}{dest},{srce})
	 * - List response (.A{level}{dest},{srce}{level}{dest},{srce}...)
	 * 
	 * @private
	 * @param {string} line - Raw response line
	 * @returns {AcknowledgeMessage} Parsed acknowledge message
	 */
	_parseAcknowledgeResponse(line) {
		const data = line.slice(ResponsePrefix.ACKNOWLEDGE.length)
		
		return {
			type: MessageType.ACKNOWLEDGE,
			data: data.length > 0 ? data : undefined,
			raw: line,
		}
	}

	/**
	 * Clears the internal buffer
	 * 
	 * Call this when resetting the connection to avoid
	 * stale data from a previous session.
	 * 
	 * @returns {void}
	 */
	reset() {
		this._buffer = ''
	}
}

// =============================================================================
// Command Builders
// =============================================================================

/**
 * Builds a command to read destination names
 * 
 * @param {number} maxDestinations - Maximum destination ID to query
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildReadDestinationsCommand(16)
 * // Returns: '.RD1\r.RD2\r.RD3\r...'
 */
function buildReadDestinationsCommand(maxDestinations) {
	let cmd = ''
	for (let i = 1; i <= maxDestinations; i++) {
		cmd += `${CommandPrefix.READ_DESTINATION}${i}\r`
	}
	return cmd
}

/**
 * Builds a command to read source names
 * 
 * @param {number} maxSources - Maximum source ID to query
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildReadSourcesCommand(16)
 * // Returns: '.RS1\r.RS2\r.RS3\r...'
 */
function buildReadSourcesCommand(maxSources) {
	let cmd = ''
	for (let i = 1; i <= maxSources; i++) {
		cmd += `${CommandPrefix.READ_SOURCE}${i}\r`
	}
	return cmd
}

/**
 * Builds a command to read all names (destinations and sources)
 * 
 * @param {number} maxDestinations - Maximum destination ID to query
 * @param {number} maxSources - Maximum source ID to query
 * @returns {string} Formatted Quartz command string
 */
function buildReadNamesCommand(maxDestinations, maxSources) {
	return buildReadDestinationsCommand(maxDestinations) + buildReadSourcesCommand(maxSources)
}

/**
 * Builds a command to route a source to a destination
 * 
 * @param {string} levels - Level string (e.g., 'V', 'VA', 'VABCDEFGH')
 * @param {number|string} destination - Destination ID
 * @param {number|string} source - Source ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildRouteCommand('V', 1, 5)
 * // Returns: '.SV1,5'
 */
function buildRouteCommand(levels, destination, source) {
	return `${CommandPrefix.SET_CROSSPOINT}${levels}${destination},${source}`
}

/**
 * Builds a command to fire a salvo
 * 
 * @param {number|string} salvoId - Salvo identifier (1-32)
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildSalvoCommand(1)
 * // Returns: '.F1'
 */
function buildSalvoCommand(salvoId) {
	return `${CommandPrefix.FIRE_SALVO}${salvoId}`
}

/**
 * Builds a command to lock a destination
 * 
 * @param {number|string} destination - Destination ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildLockCommand(1)
 * // Returns: '.BL1'
 */
function buildLockCommand(destination) {
	return `${CommandPrefix.LOCK}L${destination}`
}

/**
 * Builds a command to unlock a destination
 * 
 * @param {number|string} destination - Destination ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildUnlockCommand(1)
 * // Returns: '.BU1'
 */
function buildUnlockCommand(destination) {
	return `${CommandPrefix.LOCK}U${destination}`
}

/**
 * Builds a command to interrogate a destination's lock status
 * 
 * @param {number|string} destination - Destination ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildLockInterrogateCommand(1)
 * // Returns: '.BI1'
 */
function buildLockInterrogateCommand(destination) {
	return `${CommandPrefix.LOCK}I${destination}`
}

/**
 * Builds a command to interrogate a single crosspoint
 * 
 * @param {string} level - Single level character (e.g., 'V')
 * @param {number|string} destination - Destination ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildInterrogateCommand('V', 1)
 * // Returns: '.IV1'
 */
function buildInterrogateCommand(level, destination) {
	return `${CommandPrefix.INTERROGATE}${level}${destination}`
}

/**
 * Builds a command to list routes (up to 8 at a time)
 * 
 * @param {string} level - Single level character (e.g., 'V')
 * @param {number|string} startDestination - Starting destination ID
 * @returns {string} Formatted Quartz command string
 * 
 * @example
 * const cmd = buildListRoutesCommand('V', 1)
 * // Returns: '.LV1,-'
 */
function buildListRoutesCommand(level, startDestination) {
	return `${CommandPrefix.LIST_ROUTES}${level}${startDestination},-`
}

/**
 * Builds commands to interrogate all crosspoints for a level
 * 
 * Uses the interrogate command (.I) for each destination.
 * 
 * @param {string} level - Single level character (e.g., 'V')
 * @param {number} maxDestinations - Maximum destination ID to query
 * @returns {string} Formatted Quartz command string
 */
function buildInterrogateAllCommand(level, maxDestinations) {
	let cmd = ''
	for (let i = 1; i <= maxDestinations; i++) {
		cmd += `${CommandPrefix.INTERROGATE}${level}${i}\r`
	}
	return cmd
}

module.exports = {
	// Classes
	QuartzParser,

	// Constants
	CommandPrefix,
	ResponsePrefix,
	MessageType,

	// Command builders
	buildReadDestinationsCommand,
	buildReadSourcesCommand,
	buildReadNamesCommand,
	buildRouteCommand,
	buildSalvoCommand,
	buildLockCommand,
	buildUnlockCommand,
	buildLockInterrogateCommand,
	buildInterrogateCommand,
	buildListRoutesCommand,
	buildInterrogateAllCommand,
}