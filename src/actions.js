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
			description: 'Lock, unlock, or toggle a destination using dropdown selection',
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
						{ id: 'T', label: 'Toggle' },
					],
				},
			],
			callback: async function (action) {
				await self.sendLockCommand(action.options.dst, action.options.lock)
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
				await self.sendRouteCommand(levels, options.dst, options.src)
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
				await self.sendRouteCommand(levels, dst, src)
			},
		}

		// =========================================================================
		// Selection Workflow Actions
		// These support the "select destination, then select source, then take" pattern
		// =========================================================================

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
					default: self.CHOICES_DESTINATIONS[0].id,
				},
			],
			callback: async function (action) {
				let destination = action.options.dst
				self.setSelectedDestination(destination)

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
				let source = action.options.src
				self.setSelectedSource(source)

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

				if (!dst || !src) {
					const msg = `Take failed: source or destination not set (src=${src || ''}, dst=${dst || ''}, levels=${levels})`
					self.log('error', msg)
					throw new Error(msg)
				}

				await self.sendRouteCommand(levels, dst, src)
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
				let dst = self.getVariableValue('dst')

				if (!dst) {
					const msg = `Route Source to Selected Destination failed: no destination selected (src=${options.src}, levels=${levels})`
					self.log('error', msg)
					throw new Error(msg)
				}

				await self.sendRouteCommand(levels, dst, options.src)
			},
		}

		self.setActionDefinitions(actions)
	},
}
