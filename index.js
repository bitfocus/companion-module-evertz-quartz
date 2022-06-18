const tcp = require('../../tcp')
const instance_skel = require('../../instance_skel')

class instance extends instance_skel {
	/**
	 * Create an instance of the module
	 *
	 * @param {EventEmitter} system - the brains of the operation
	 * @param {string} id - the instance ID
	 * @param {Object} config - saved user configuration parameters
	 * @since 1.0.0
	 */
	constructor(system, id, config) {
		super(system, id, config)
		this.actions() // export actions
		this.init_presets() // export presets

		this.destinations = []
		this.sources = []
		this.response = ''
	}

	updateConfig(config) {
		this.init_presets()
		
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.config = config

		this.init_tcp()
		this.config.needNameRefresh = true
	}

	init() {
		this.init_presets()
		this.init_tcp()
		this.initVariables()
		this.config.needNameRefresh = true
	}

	initVariables() {
		let variables = [
			{ name: 'destination', label: 'Destination' }
		]
		this.setVariableDefinitions(variables)
		this.setVariable('destination', 0)
	}

	readNames() {
		// called when connected after init and config update
		// runs async so the response is handled in separate function parseQuartzResponse()
		this.destinations = []
		this.sources = []
		this.log('info', 'Refreshing names from router')
		
		// build string to read destinations
		let cmd = ''
		for (let i = 1; i <= this.config.max_destinations; i++) {
			cmd += '.RD' + i + '\r'
		}
		
		// build string to read sources
		for (let i = 1; i <= this.config.max_sources; i++) {
			cmd += '.RS' + i + '\r'
		}
		
		let sendBuf = Buffer.from(cmd, 'latin1')
		this.log('debug', 'Sending command: ' + cmd)
		this.debug('Sending command:', cmd)

		if (this.socket !== undefined && this.socket.connected) {
			this.socket.send(sendBuf)
		} else {
			this.debug('Socket not connected :(')
		}
	
		this.config.needNameRefresh = false
	}

	parseQuartzResponse(data) {
		// responses may be fragmented in multiple packets
		// wait until we have a complete response contained between . and \r

		this.response += data.toString('utf-8')

		if (this.response.slice(0,1) == '.' && this.response.slice(-1) == '\r') {
			// we now have all the pieces
			let lines = this.response.split('\r')
			for (let i = 0; i < lines.length; i++) {
				let line = lines[i]
				if (line) {
					if (line.slice(0,4) == '.RAD') {
						// destination name
						let id = line.split(',')[0].slice(4)
						let label = line.split(',')[1]
						this.destinations.push({id: id, label: '[' + id + '] ' + label})
					}
					else if (line.slice(0,4) == '.RAS') {
						// source name
						let id = line.split(',')[0].slice(4)
						let label = line.split(',')[1]
						this.sources.push({id: id, label: '[' + id + '] ' + label})
					}
					else if (line == '.E') {
						this.log('error', 'Received error from Evertz.  Are maximums too high?')
					}
				}
			}
			this.response = ''
		}

		this.actions() // rebuild names tables
		// this.debug('destinations', this.destinations)
		// this.debug('sources', this.sources)
	}
		
	init_tcp() {
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		this.status(this.STATE_WARNING, 'Connecting')

		if (this.config.host) {
			this.socket = new tcp(this.config.host, this.config.port)

			this.socket.on('status_change', (status, message) => {
				this.status(status, message)
			})

			this.socket.on('error', (err) => {
				this.debug('Network error', err)
				this.status(this.STATE_ERROR, err)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('connect', () => {
				this.status(this.STATE_OK)
				this.debug('Connected')
				if (this.config.needNameRefresh) { this.readNames() }
			})

			this.socket.on('data', (data) => {
				this.parseQuartzResponse(data)
			})
		}
	}

	// Return config fields for web config
	config_fields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 6,
				regex: this.REGEX_IP
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 3,
				default: 23,
				regex: this.REGEX_PORT
			},
			{
				type: 'number',
				id: 'max_destinations',
				label: 'Max Destinations',
				width: 4,
				default: 100,
				required: true
			},
			{
				type: 'number',
				id: 'max_sources',
				label: 'Max Sources',
				width: 4,
				default: 100,
				required: true
			}
		]
	}

	// When module gets deleted
	destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
		}

		this.debug('destroy', this.id)
	}

	init_presets() {
		let presets = []
		this.setPresetDefinitions(presets)
	}

	actions(system) {
		this.setActions({
			set_xpt: {
				label: 'Route source to destination',
				options: [
					{
						type: 'dropdown',
						id: 'src',
						label: 'Source:',
						width: 6,
						required: true,
						choices: this.sources
					},
					{
						type: 'dropdown',
						id: 'dst',
						label: 'Destination:',
						width: 6,
						required: true,
						choices: this.destinations
					},
					{
						type: 'textinput',
						id: 'levels',
						label: 'Levels:',
						width: 6,
						default: 'V',
						required: true
					},
				]
			},

			set_destination: {
				label: 'Select destination',
				options: [
					{
						type: 'dropdown',
						id: 'dst',
						label: 'Destination:',
						width: 3,
						required: true,
						choices: this.destinations
					},
				]
			},
			
			route_source: {
				label: 'Route source to previous selected destination',
				options: [
					{
						type: 'dropdown',
						id: 'src',
						label: 'Source:',
						width: 3,
						required: true,
						choices: this.sources
					},
					{
						type: 'textinput',
						id: 'levels',
						label: 'Levels:',
						width: 6,
						default: 'V',
						required: true
					}
				]
			}
		})
	}

	action(action) {
		let cmd
		
		switch (action.action) {
			case 'set_xpt':
				cmd = '.S' + action.options.levels + action.options.dst + ',' + action.options.src + '\r'
				break
			
			case 'set_destination':
				this.setVariable('destination', action.options.dst)
				return

			case 'route_source':
				this.getVariable('destination', dst => {
					if (dst) {
						cmd = '.S' + action.options.levels + dst + ',' + action.options.src + '\r'
					}
				})
		}

		/*
		 * create a binary buffer pre-encoded 'latin1' (8bit no change bytes)
		 * sending a string assumes 'utf8' encoding
		 * which then escapes character values over 0x7F
		 * and destroys the 'binary' content
		 */
		let sendBuf = Buffer.from(cmd, 'latin1')
		this.log('debug', 'Sending command: ' + cmd)
		this.debug('Sending command:', cmd)

		if (this.socket !== undefined && this.socket.connected) {
			this.socket.send(sendBuf)
		} else {
			this.debug('Socket not connected :(')
		}
	}
}
exports = module.exports = instance
