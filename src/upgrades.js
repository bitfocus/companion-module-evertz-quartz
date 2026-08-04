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
]
