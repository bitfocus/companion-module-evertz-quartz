module.exports = {
	initActions: function () {
		let self = this
		let actions = {}

		actions['fire_salvo'] = {
			name: 'Fire Salvo',
			description: 'Fire a salvo',
			options: [
				{
					type: 'textinput',
					label: 'Salvo ID',
					id: 'salvo',
					default: '1',
					useVariables: true,
				},
			],
			callback: async function (action) {
				let options = action.options
				let salvo = await self.parseVariablesInString(options.salvo)
				let command = `.F${salvo}`
				self.sendCommand(command)
			},
		}

		actions['lock_destination'] = {
			name: 'Lock/Unlock Destination',
			description: 'Lock/Unlock a Destination',
			options: [
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination',
					width: 6,
					default: self.CHOICES_DESTINATIONS[0].id,
					choices: self.CHOICES_DESTINATIONS,
				},
				{
					type: 'dropdown',
					id: 'lock',
					label: 'Lock/Unlock',
					width: 6,
					default: 'L',
					choices: [
						{ id: 'L', label: 'Lock' },
						{ id: 'U', label: 'Unlock' },
					],
				},
			],
			callback: async function (action) {
				let options = action.options
				let lock = options.lock
				let command = `.B${lock},${options.dst}`
				self.sendCommand(command)
			},
		}

		actions['set_xpt'] = {
			name: 'Route Source to Destination',
			description: 'Route a source to a destination',
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source',
					width: 6,
					default: self.CHOICES_SOURCES[0].id,
					choices: self.CHOICES_SOURCES,
				},
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination',
					width: 6,
					default: self.CHOICES_DESTINATIONS[0].id,
					choices: self.CHOICES_DESTINATIONS,
				},
				{
					type: 'textinput',
					id: 'levels',
					label: 'Levels',
					width: 6,
					default: 'V',
					useVariables: true,
				},
			],
			callback: async function (action) {
				let options = action.options
				let levels = await self.parseVariablesInString(options.levels)
				let command = `.S${levels}${options.dst},${options.src}`
				self.sendCommand(command)
			},
		}

		actions['set_destination'] = {
			name: 'Set Destination',
			description: 'Set the Destination for the next Source routing',
			options: [
				{
					type: 'dropdown',
					label: 'Destination',
					id: 'destination',
					default: self.CHOICES_DESTINATIONS[0].id,
					choices: self.CHOICES_DESTINATIONS,
				},
			],
			callback: async function (action) {
				let options = action.options
				let destination = options.destination
				self.selectedDestination = destination

				//get the name from CHOICES_DESTINATIONS based on the ID
				let destination_name = self.CHOICES_DESTINATIONS.find((element) => element.id == destination).label

				let variableObj = {}
				variableObj.destination = destination
				variableObj.destination_name = destination_name
				self.setVariableValues(variableObj)
			},
		}

		actions['route_source'] = {
			name: 'Route Source to Selected Destination',
			description: 'Route a Source to previously selected Destination',
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source',
					width: 3,
					default: self.CHOICES_SOURCES[0].id,
					choices: self.CHOICES_SOURCES,
				},
				{
					type: 'textinput',
					id: 'levels',
					label: 'Levels',
					width: 6,
					default: 'V',
					useVariables: true,
				},
			],
			callback: async function (action) {
				let options = action.options
				let levels = await self.parseVariablesInString(options.levels)
				let command = `.S${levels}${self.selectedDestination},${options.src}`
				self.sendCommand(command)
			},
		}

		self.setActionDefinitions(actions)
	},
}
