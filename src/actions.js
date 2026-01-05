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

		actions['set_destination_take'] = {
			name: 'Select Destination for Take',
			description: 'Set the destination for routing with the Take Action',
			options: [
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination:',
					width: 3,
					required: true,
					choices: self.CHOICES_DESTINATIONS, // Assuming self.CHOICES_DESTINATIONS contains the list of destinations
				},
			],
			callback: async function (action) {
				let options = action.options
				let destination = options.dst
		
				// Save the selected destination in the correct variable
				self.setVariableValues({ dst: destination })
		
				// Optionally log the action for debugging
				self.log('info', `Selected Destination for Take: ${destination}`)
			},
		}
		
		actions['set_source_take'] = {
			name: 'Select Source for Take',
			description: 'Set a source for routing with the Take Action',
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source:',
					width: 3,
					required: true,
					choices: self.CHOICES_SOURCES, // Assuming self.CHOICES_SOURCES contains the list of sources
				},
			],
			callback: async function (action) {
				let options = action.options
				let source = options.src
		
				// Save the selected source in the correct variable
				self.setVariableValues({ src: source })
		
				// Optionally log the action for debugging
				self.log('info', `Selected Source for Take: ${source}`)
			},
		}

		actions['take'] = {
			name: 'Take',
			description: 'Execute a Take action to route the selected source to the selected destination',
			options: [
				{
					type: 'textinput',
					id: 'levels',
					label: 'Levels:',
					width: 6,
					default: 'VABCDEFGH',
					required: true,
					useVariables: true,
				},
			],
			callback: async function (action) {
				let options = action.options
				let levels = await self.parseVariablesInString(options.levels) // Parse levels for variables
				let dst = self.getVariableValue('dst') // Retrieve the selected destination for Take
				let src = self.getVariableValue('src') // Retrieve the selected source for Take
		
				if (dst && src) {
					let command = `.S${levels}${dst},${src}` // Construct the command
					self.sendCommand(command) // Send the command
					self.log('info', `Take action executed: ${command}`) // Log the command
				} else {
					self.log('error', 'Take action failed: Source or Destination not set') // Log error if variables are missing
				}
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
