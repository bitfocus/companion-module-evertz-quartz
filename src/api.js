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

		// Validate socket state
		if (!self.socket || !self.socket.isConnected) {
			self.log('warn', 'Cannot send command: not connected')
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
	 * Checks if the socket is currently connected
	 * 
	 * @returns {boolean} True if connected, false otherwise
	 */
	isConnected() {
		const self = this
		return self.socket && self.socket.isConnected
	},
}