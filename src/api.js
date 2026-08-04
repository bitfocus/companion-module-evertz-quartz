/**
 * @fileoverview TCP Connection Management for Evertz Quartz Module
 * 
 * This module handles the TCP socket lifecycle for communicating with
 * Evertz routers. It provides connection management, reconnection logic,
 * and raw data transmission without any protocol-specific knowledge.
 * 
 * Protocol parsing and framing is handled by the quartz.js module.
 * 
 * @module api
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

const { InstanceStatus, TCPHelper } = require('@companion-module/base')
const { isDestinationLocked } = require('./constants')

/**
 * Connection management methods
 * 
 * These methods are mixed into the main instance class via Object.assign().
 * They handle TCP socket lifecycle and provide hooks for the main module
 * to respond to connection events.
 * 
 * @mixin
 */
module.exports = {
	/**
	 * Initializes the TCP connection to the router
	 * 
	 * Creates a new TCP socket, sets up event handlers, and attempts
	 * to connect to the configured host and port. Cleans up any existing
	 * connection before establishing a new one.
	 * 
	 * @async
	 * @returns {Promise<void>}
	 * 
	 * @fires socket#connect
	 * @fires socket#data
	 * @fires socket#error
	 * @fires socket#close
	 */
	async initConnection() {
		const self = this

		// Clean up existing connection and intervals
		self._cleanupConnection()

		// Validate configuration
		if (!self.config.host || self.config.host === '') {
			self.log('warn', 'No host configured')
			self.updateStatus(InstanceStatus.BadConfig)
			return
		}

		self.updateStatus(InstanceStatus.Connecting)

		// Create new TCP socket
		self.socket = new TCPHelper(self.config.host, self.config.port)

		// Handle connection errors
		self.socket.on('error', (error) => {
			self._handleConnectionError(error)
		})

		// Handle successful connection
		self.socket.on('connect', () => {
			self._handleConnectionOpen()
		})

		// Handle incoming data - pass raw data to handler
		self.socket.on('data', (data) => {
			self._handleData(data)
		})

		// Handle connection close
		self.socket.on('close', () => {
			self._handleConnectionClose()
		})
	},

	/**
	 * Cleans up the existing connection and related resources
	 * 
	 * Clears polling intervals and destroys the socket if it exists.
	 * Called before establishing a new connection or during shutdown.
	 * 
	 * @private
	 * @returns {void}
	 */
	_cleanupConnection() {
		const self = this

		// Clear polling interval
		if (self.INTERVAL) {
			clearInterval(self.INTERVAL)
			self.INTERVAL = null
		}

		// Clear reconnect interval
		if (self.RECONNECT_INTERVAL) {
			clearInterval(self.RECONNECT_INTERVAL)
			self.RECONNECT_INTERVAL = null
		}

		// Destroy existing socket
		if (self.socket) {
			self.socket.destroy()
			self.socket = null
		}

		// Reset parser state if it exists
		if (self.parser) {
			self.parser.reset()
		}
	},

	/**
	 * Handles socket connection errors
	 * 
	 * Logs the error and updates the instance status.
	 * 
	 * @private
	 * @param {Error} error - The error that occurred
	 * @returns {void}
	 */
	_handleConnectionError(error) {
		const self = this
		self.log('error', `Connection error: ${error.message}`)
		self.updateStatus(InstanceStatus.ConnectionFailure)
	},

	/**
	 * Handles successful socket connection
	 * 
	 * Updates status, triggers initial data fetch, and starts
	 * polling at the configured interval.
	 * 
	 * @private
	 * @returns {void}
	 */
	_handleConnectionOpen() {
		const self = this

		self.log('info', `Connected to ${self.config.host}:${self.config.port}`)
		self.updateStatus(InstanceStatus.Ok)

		// Trigger initial data retrieval
		self.onConnected()

		// Start polling - convert seconds to milliseconds
		const intervalMs = (self.config.pollInterval || 5) * 1000
		self.INTERVAL = setInterval(() => {
			self.poll()
		}, intervalMs)
	},

	/**
	 * Handles incoming socket data
	 * 
	 * Passes raw data to the protocol parser. Optionally logs
	 * the data if verbose logging is enabled.
	 * 
	 * @private
	 * @param {Buffer} data - Raw data received from socket
	 * @returns {void}
	 */
	_handleData(data) {
		const self = this

		if (self.config.verbose) {
			self.log('debug', `Received raw data: ${data.toString('utf-8')}`)
		}

		// Pass data to protocol parser (handled in index.js)
		if (self.parser) {
			self.parser.feed(data)
		}
	},

	/**
	 * Handles socket connection close
	 * 
	 * Updates status and could trigger reconnection logic.
	 * 
	 * @private
	 * @returns {void}
	 */
	_handleConnectionClose() {
		const self = this
		self.log('warn', 'Connection closed')
		self.updateStatus(InstanceStatus.ConnectionFailure)
	},

	/**
	 * Sends a raw command string to the router
	 * 
	 * Automatically appends carriage return if not present.
	 * Logs the command if verbose logging is enabled.
	 * 
	 * @async
	 * @param {string} cmd - Command string to send
	 * @returns {Promise<boolean>} True if command was sent, false otherwise
	 * 
	 * @example
	 * await self.sendCommand('.RD1')  // Read destination 1 name
	 * await self.sendCommand('.SV1,5') // Route source 5 to destination 1 on video level
	 */
	async sendCommand(cmd) {
		const self = this
		const cmdForLog = String(cmd).replace(/\r/g, '')

		// Validate socket state
		if (!self.socket || !self.socket.isConnected) {
			self.log('warn', `Cannot send command: not connected (${cmdForLog})`)
			return false
		}

		// Ensure command ends with carriage return
		let command = cmd
		if (!command.endsWith('\r')) {
			command += '\r'
		}

		// Log if verbose
		if (self.config.verbose) {
			self.log('debug', `Sending command: ${command.replace(/\r/g, '\\r')}`)
		}

		// Send command
		const sendBuffer = Buffer.from(command, 'latin1')
		self.socket.send(sendBuffer)

		// Store for debugging
		self.lastCommand = command

		return true
	},

	/**
	 * Sends a route (set crosspoint) command with required success/failure logging.
	 *
	 * Throws when the command cannot be sent so Companion surfaces the failure.
	 *
	 * @async
	 * @param {string} levels - Level string (e.g. 'V', 'VABC')
	 * @param {number|string} destination - Destination ID
	 * @param {number|string} source - Source ID
	 * @returns {Promise<void>}
	 */
	async sendRouteCommand(levels, destination, source) {
		const self = this
		const command = `.S${levels}${destination},${source}`
		const routeDesc = `source ${source} -> destination ${destination} (levels ${levels})`

		const sent = await self.sendCommand(command)
		if (!sent) {
			const msg = `Route failed: ${routeDesc}`
			self.log('error', msg)
			throw new Error(msg)
		}

		self.log('info', `Route sent: ${routeDesc}`)
	},

	/**
	 * Sends a lock/unlock/toggle command with required success/failure logging.
	 *
	 * Quartz format is `.BL{dest}` / `.BU{dest}` (no comma).
	 * Toggle uses the last known lock state for that destination.
	 * Throws when the command cannot be sent.
	 *
	 * @async
	 * @param {number|string} destination - Destination ID
	 * @param {string} lockState - 'L' to lock, 'U' to unlock, 'T' to toggle
	 * @returns {Promise<void>}
	 */
	async sendLockCommand(destination, lockState) {
		const self = this

		let state = lockState
		if (state === 'T') {
			const destNum = typeof destination === 'string' ? parseInt(destination, 10) : destination
			const currentlyLocked = isDestinationLocked(self.locks?.[destNum])
			state = currentlyLocked ? 'U' : 'L'
		} else if (state !== 'U') {
			state = 'L'
		}

		const actionLabel = state === 'L' ? 'Lock' : 'Unlock'
		const command = `.B${state}${destination}`
		const desc = `${actionLabel} destination ${destination}`

		const sent = await self.sendCommand(command)
		if (!sent) {
			const msg = `${actionLabel} failed: destination ${destination}`
			self.log('error', msg)
			throw new Error(msg)
		}

		self.log('info', `${desc} sent`)

		// Optimistically update local state when controllers omit .BA
		if (typeof self._applyLockStatus === 'function') {
			self._applyLockStatus(destination, state === 'L' ? 255 : 0)
		}

		// Interrogate for authoritative status when the controller supports it
		await self.sendCommand(`.BI${destination}`)
	},

	/**
	 * Checks if the socket is currently connected
	 * 
	 * @returns {boolean} True if connected, false otherwise
	 */
	isConnected() {
		const self = this
		return self.socket && self.socket.isConnected
	},
}