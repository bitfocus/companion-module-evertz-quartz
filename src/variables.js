/**
 * @fileoverview Variable Definitions for Evertz Quartz Router Control
 *
 * Defines Companion variables that expose router state to buttons and triggers:
 *
 * 1. Selection workflow variables - Track user's destination/source selections
 * 2. Port label variables - Source/destination names from the router
 * 3. Crosspoint state variables - Active source ID per level × destination
 *    (configurable, can be disabled for large routers)
 *
 * @module variables
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

const { parseLevelsConfig } = require('./constants')

module.exports = {
	/**
	 * Initializes variable definitions for the module
	 *
	 * Creates variable definitions based on current configuration.
	 * Called during module init and when configuration changes.
	 *
	 * Naming:
	 *   src_{id}_name / dst_{id}_name - Port labels from the router
	 *   dst_{id}_lock_state - Destination lock state (Unlocked/Locked/Owned)
	 *   xpt_{level}_{destination} - Active source ID for a crosspoint
	 *
	 * @returns {void}
	 */
	initVariables() {
		const self = this
		const variables = []
		const maxDest = self.config.max_destinations || 16
		const maxSrc = self.config.max_sources || 16

		// =========================================================================
		// Selection Workflow Variables
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
		// Port Label Variables (always defined)
		// =========================================================================

		for (let src = 1; src <= maxSrc; src++) {
			variables.push({
				variableId: `src_${src}_name`,
				name: `Source ${src} - Name`,
			})
		}

		for (let dest = 1; dest <= maxDest; dest++) {
			variables.push({
				variableId: `dst_${dest}_name`,
				name: `Destination ${dest} - Name`,
			})
			variables.push({
				variableId: `dst_${dest}_lock_state`,
				name: `Destination ${dest} - Lock State`,
			})
		}

		// =========================================================================
		// Crosspoint State Variables
		// 'V' is always defined. Other levels are added when enable_xpt_variables
		// is on, per xpt_levels config.
		// =========================================================================

		const xptLevels = new Set(['V'])
		if (self.config.enable_xpt_variables) {
			for (const level of parseLevelsConfig(self.config.xpt_levels)) {
				xptLevels.add(level)
			}
		}

		for (const level of xptLevels) {
			const levelLower = level.toLowerCase()

			for (let dest = 1; dest <= maxDest; dest++) {
				variables.push({
					variableId: `xpt_${levelLower}_${dest}`,
					name: `Crosspoint ${level} - Destination ${dest} - Current Source ID`,
				})
			}
		}

		self.setVariableDefinitions(variables)

		// Initialize new variables to empty string
		const initialValues = {}

		for (let src = 1; src <= maxSrc; src++) {
			initialValues[`src_${src}_name`] = ''
		}
		for (let dest = 1; dest <= maxDest; dest++) {
			initialValues[`dst_${dest}_name`] = ''
			initialValues[`dst_${dest}_lock_state`] = ''
		}

		for (const level of xptLevels) {
			const levelLower = level.toLowerCase()
			for (let dest = 1; dest <= maxDest; dest++) {
				initialValues[`xpt_${levelLower}_${dest}`] = ''
			}
		}

		self.setVariableValues(initialValues)
	},
}
