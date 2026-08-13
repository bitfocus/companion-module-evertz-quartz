const { DEFAULT_XPT_LEVEL_SYSTEM } = require('./constants')

module.exports = [
	function (_context, _props) {
		// Initial empty upgrade from module template era
		return {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
	function (_context, props) {
		// Add xpt_levels level-system config (new in this release)
		const config = props.config
		if (!config || config.xpt_levels !== undefined) {
			return {
				updatedConfig: null,
				updatedActions: [],
				updatedFeedbacks: [],
			}
		}

		return {
			updatedConfig: {
				...config,
				xpt_levels: DEFAULT_XPT_LEVEL_SYSTEM,
			},
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
	function (_context, props) {
		// 'set_destination' is deprecated in favor of 'set_destination_take' (same
		// selection state, now shared with the Take workflow). Convert instances in place.
		const updatedActions = []

		for (const action of props.actions) {
			if (action.actionId !== 'set_destination') {
				continue
			}

			updatedActions.push({
				...action,
				actionId: 'set_destination_take',
				options: {
					dst: action.options.destination,
				},
			})
		}

		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
]
