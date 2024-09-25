const { InstanceStatus, TCPHelper } = require('@companion-module/base')

module.exports = {
	async initConnection() {
		let self = this

		//clear any existing intervals
		clearInterval(self.INTERVAL)

		if (self.config.host && self.config.host !== '') {
			self.updateStatus(InstanceStatus.Connecting)

			self.socket = new TCPHelper(self.config.host, self.config.port)

			self.socket.on('error', (error) => {
				self.log('error', error)
				self.updateStatus(InstanceStatus.UnknownError)
			})

			self.socket.on('connect', () => {
				self.updateStatus(InstanceStatus.Ok)
				self.getData() //get initial data
				//start polling, if enabled
				if (self.config.polling) {
					self.INTERVAL = setInterval(() => {
						self.getData()
					}, self.config.pollInterval)
				}
			})

			self.socket.on('data', (data) => {
				self.processData(data)
			})

			self.socket.on('close', () => {
				self.updateStatus(InstanceStatus.ConnectionFailure)
			})
		}
	},

	getData() {
		let self = this

		self.readNames()
	},

	async readNames() {
		let self = this
		
		// called when connected after init and config update
		// runs async so the response is handled in separate function parseQuartzResponse()
		self.log('info', 'Refreshing Names from Router')

		// build string to read destinations
		let cmd = ''
		for (let i = 1; i <= self.config.max_destinations; i++) {
			cmd += '.RD' + i + '\r'
		}

		// build string to read sources
		for (let i = 1; i <= self.config.max_sources; i++) {
			cmd += '.RS' + i + '\r'
		}

		self.sendCommand(cmd)
	},

	async processData(data) {
		let self = this

		// responses may be fragmented in multiple packets
		// wait until we have a complete response contained between . and \r

		self.response += data.toString('utf-8')

		if (self.config.verbose) {
			self.log('debug', 'Received data: ' + self.response)
		}

		if (self.response.slice(0, 1) == '.' && self.response.slice(-1) == '\r') {
			// we now have all the pieces
			if (self.config.verbose) {
				self.log('debug', 'Received complete response: ' + self.response)
			}

			let TEMP_DESTINATIONS = []
			let TEMP_SOURCES = []

			let lines = self.response.split('\r')
			for (let i = 0; i < lines.length; i++) {
				let line = lines[i]
				if (line) {
					if (line.slice(0, 4) == '.RAD') {
						// destination name
						let id = line.split(',')[0].slice(4)
						let label = line.split(',')[1]
						TEMP_DESTINATIONS.push({ id: id, label: '[' + id + '] ' + label })
					} else if (line.slice(0, 4) == '.RAS') {
						// source name
						let id = line.split(',')[0].slice(4)
						let label = line.split(',')[1]
						TEMP_SOURCES.push({ id: id, label: '[' + id + '] ' + label })
					} else if (line == '.E') {
						self.log('error', 'Received error from Evertz.  Are maximums too high?')
					}
				}
			}

			self.response = '' // clear response buffer

			let update = false

			// update destinations and sources, if they are different
			if (JSON.stringify(TEMP_DESTINATIONS) !== JSON.stringify(self.CHOICES_DESTINATIONS)) {
				//and temp is not empty
				if (TEMP_DESTINATIONS.length > 0) {
					self.CHOICES_DESTINATIONS = TEMP_DESTINATIONS
					update = true
				}
			}

			if (JSON.stringify(TEMP_SOURCES) !== JSON.stringify(self.CHOICES_SOURCES)) {
				//and temp is not empty
				if (TEMP_SOURCES.length > 0) {
					self.CHOICES_SOURCES = TEMP_SOURCES
					update = true
				}
			}

			if (update) {
				self.initActions()
			}
		}
	},

	async sendCommand(cmd) {
		let self = this

		//add carriage return, if it doesn't end with that
		if (cmd.slice(-1) != '\r') {
			cmd += '\r'
		}

		if (self.socket && self.socket.isConnected) {
			let sendBuf = Buffer.from(cmd, 'latin1')
			if (self.config.verbose) {
				self.log('debug', 'Sending command: ' + cmd)
			}
			self.socket.send(sendBuf)
			self.lastCommand = cmd //store the last command for debugging purposes
		}
	},
}
