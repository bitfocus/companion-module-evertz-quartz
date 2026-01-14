/**
 * @fileoverview Action Definitions for Evertz Quartz Router Control
 * 
 * Defines Companion actions for controlling Evertz routers via Quartz protocol.
 * Actions fall into several categories:
 * 
 * - Direct routing: Route source to destination immediately
 * - Selection workflow: Select destination, select source, then take
 * - System control: Fire salvos, lock/unlock destinations
 * 
 * @module actions
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

module.exports = {
	/**
	 * Initializes action definitions for the module
	 * 
	 * Called during module init and when configuration changes.
	 * Actions reference CHOICES_DESTINATIONS and CHOICES_SOURCES arrays
	 * which are populated from router responses.
	 * 
	 * @returns {void}
	 */
	initActions: function () {
		let self = this
		let actions = {}

		// =========================================================================
		// System Control Actions
		// =========================================================================

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

		// =========================================================================
		// Direct Routing Actions
		// =========================================================================

		actions['set_xpt'] = {
			name: 'Route Source to Destination',
			description: 'Route a source to a destination using dropdown selection',
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

		actions['set_xpt_by_id'] = {
			name: 'Route Source to Destination (by ID)',
			description: 'Route a source to a destination using numeric IDs with variable support',
			options: [
				{
					type: 'textinput',
					id: 'src',
					label: 'Source ID',
					width: 6,
					default: '1',
					useVariables: true,
				},
				{
					type: 'textinput',
					id: 'dst',
					label: 'Destination ID',
					width: 6,
					default: '1',
					useVariables: true,
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
				let src = await self.parseVariablesInString(options.src)
				let dst = await self.parseVariablesInString(options.dst)
				let levels = await self.parseVariablesInString(options.levels)
				let command = `.S${levels}${dst},${src}`
				self.sendCommand(command)
			},
		}

		// =========================================================================
		// Selection Workflow Actions
		// These support the "select destination, then select source, then take" pattern
		// =========================================================================

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

				// Get the name from CHOICES_DESTINATIONS based on the ID
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
					choices: self.CHOICES_DESTINATIONS,
				},
			],
			callback: async function (action) {
				let options = action.options
				let destination = options.dst
		
				// Save the selected destination in the correct variable
				self.setVariableValues({ dst: destination })
		
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
					choices: self.CHOICES_SOURCES,
				},
			],
			callback: async function (action) {
				let options = action.options
				let source = options.src
		
				// Save the selected source in the correct variable
				self.setVariableValues({ src: source })
		
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
				let levels = await self.parseVariablesInString(options.levels)
				let dst = self.getVariableValue('dst')
				let src = self.getVariableValue('src')
		
				if (dst && src) {
					let command = `.S${levels}${dst},${src}`
					self.sendCommand(command)
					self.log('info', `Take action executed: ${command}`)
				} else {
					self.log('error', 'Take action failed: Source or Destination not set')
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