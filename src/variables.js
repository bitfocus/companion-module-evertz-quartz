/**
 * @fileoverview Variable Definitions for Evertz Quartz Router Control
 * 
 * Defines Companion variables that expose router state to buttons and triggers.
 * Variables fall into two categories:
 * 
 * 1. Selection workflow variables - Track user's destination/source selections
 *    for the "select then take" pattern (always enabled)
 * 
 * 2. Crosspoint state variables - Expose real-time routing state showing which
 *    source is routed to each destination (configurable, can be disabled for
 *    large routers to reduce variable count)
 * 
 * @module variables
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

module.exports = {
	/**
	 * Initializes variable definitions for the module
	 * 
	 * Creates variable definitions based on current configuration.
	 * Called during module init and when configuration changes.
	 * 
	 * Variable naming convention for crosspoints:
	 *   xpt_{level}_{destination} - Source ID (numeric)
	 *   xpt_{level}_{destination}_name - Source name (from router)
	 * 
	 * @returns {void}
	 */
	initVariables() {
		const self = this
		const variables = []

		// =========================================================================
		// Selection Workflow Variables
		// These support the "select destination, then select source" routing pattern
		// =========================================================================

		variables.push({
			variableId: 'destination',
			name: 'Selected Destination',
		})

		variables.push({
			variableId: 'destination_name',
			name: 'Selected Destination Name',
		})

		variables.push({
			variableId: 'dst',
			name: 'Selected Destination for Take',
		})

		variables.push({
			variableId: 'src',
			name: 'Selected Source for Take',
		})

		// =========================================================================
		// Crosspoint State Variables
		// Expose real-time routing state: which source is on each destination
		// Disabled by config for large routers (2 variables per destination)
		// =========================================================================

		if (self.config.enable_xpt_variables) {
			const maxDest = self.config.max_destinations || 16

			for (let dest = 1; dest <= maxDest; dest++) {
				// Source ID variable: numeric value of routed source
				variables.push({
					variableId: `xpt_v_${dest}`,
					name: `Crosspoint V Dest ${dest} (Source ID)`,
				})

				// Source name variable: human-readable name from router
				variables.push({
					variableId: `xpt_v_${dest}_name`,
					name: `Crosspoint V Dest ${dest} (Source Name)`,
				})
			}
		}

		self.setVariableDefinitions(variables)

		// Initialize crosspoint variables to empty string if enabled
		// This ensures variables exist with a known state before data arrives
		if (self.config.enable_xpt_variables) {
			const initialValues = {}
			const maxDest = self.config.max_destinations || 16

			for (let dest = 1; dest <= maxDest; dest++) {
				initialValues[`xpt_v_${dest}`] = ''
				initialValues[`xpt_v_${dest}_name`] = ''
			}

			self.setVariableValues(initialValues)
		}
	},
}