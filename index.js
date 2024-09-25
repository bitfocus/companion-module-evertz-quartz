// Evertz Quartz
const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base')
const upgrades = require('./src/upgrades')

const config = require('./src/config')

const actions = require('./src/actions')
const feedbacks = require('./src/feedbacks')
const variables = require('./src/variables')
const presets = require('./src/presets')

const api = require('./src/api')

const constants = require('./src/constants')

class quartzInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		// Assign the methods from the listed files to this class
		Object.assign(this, {
			...config,

			...actions,
			...feedbacks,
			...variables,
			...presets,

			...api,

			...constants,
		})

		this.CHOICES_DESTINATIONS = [{ id: '0', label: 'No Destinations Loaded' }] //store the destinations for the dropdowns
		this.CHOICES_SOURCES = [{ id: '0', label: 'No Sources Loaded' }] //store the sources for the dropdowns

		this.response = '' //store the response from the router

		this.selectedDestination = 0 //store the selected destination for routing
	}

	async init(config) {
		this.configUpdated(config)
	}

	async destroy() {
		try {
			clearInterval(this.INTERVAL)
			clearInterval(this.RECONNECT_INTERVAL)

			if (this.socket) {
				this.socket.destroy()
			}
		} catch (error) {
			this.log('error', 'destroy error:' + error)
		}
	}

	async configUpdated(config) {
		this.config = config

		this.config.needNameRefresh = true

		this.initConnection()

		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
	}
}

runEntrypoint(quartzInstance, upgrades)
