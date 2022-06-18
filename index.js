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
	}

	init() {
		this.init_presets()
		this.init_tcp()
		this.initVariables()
	}

	initVariables() {
		let variables = [
			{ name: 'destination', label: 'Destination' }
		]
		this.setVariableDefinitions(variables)
		this.setVariable('destination', 0)
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
			})

			this.socket.on('data', (data) => {
				this.debug('Received data:', data.toString('utf-8'))
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
				regex: this.REGEX_IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 3,
				default: 4050,
				regex: this.REGEX_PORT,
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
			setxpt: {
				label: 'Route source to destination',
				options: [
					{
						type: 'number',
						id: 'src',
						label: 'Source:',
						width: 1,
						min: 1,
						max: 9999,
						required: true
					},
					{
						type: 'number',
						id: 'dst',
						label: 'Destination:',
						width: 1,
						min: 1,
						max: 9999,
						required: true
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
			},

			set_destination: {
				label: 'Select destination',
				options: [
					{
						type: 'number',
						id: 'dst',
						label: 'Destination:',
						width: 3,
						required: true
					}
				]
			},
			
			route_source: {
				label: 'Route source to previous selected destination',
				options: [
					{
						type: 'number',
						id: 'src',
						label: 'Source:',
						width: 3,
						required: true
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
			case 'setxpt':
				cmd = '.S' + action.options.levels + action.options.dst + ',' + action.options.src + '\r'
				this.debug(cmd)
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
		this.debug('cmd', cmd)

		if (sendBuf != '') {
			if (this.socket !== undefined && this.socket.connected) {
				this.socket.send(sendBuf)
			} else {
				this.debug('Socket not connected :(')
			}
		}
	}
}
exports = module.exports = instance
