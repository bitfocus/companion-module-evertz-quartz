/**
 * @fileoverview Feedback Definitions for Evertz Quartz Router Control
 *
 * @module feedbacks
 */

const { combineRgb } = require('@companion-module/base')
const { isDestinationLocked } = require('./constants')

module.exports = {
	/**
	 * Initializes feedback definitions for the module
	 *
	 * @returns {void}
	 */
	initFeedbacks() {
		const self = this
		const feedbacks = {}

		const colorWhite = combineRgb(255, 255, 255)
		const colorRed = combineRgb(255, 0, 0)

		feedbacks['destination_locked'] = {
			type: 'boolean',
			name: 'Destination Locked',
			description: 'True when the selected destination is locked',
			defaultStyle: {
				color: colorWhite,
				bgcolor: colorRed,
			},
			options: [
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination',
					default: self.CHOICES_DESTINATIONS[0].id,
					choices: self.CHOICES_DESTINATIONS,
				},
			],
			callback: (feedback) => {
				const dest = parseInt(feedback.options.dst, 10)
				return isDestinationLocked(self.locks?.[dest])
			},
		}

		self.setFeedbackDefinitions(feedbacks)
	},
}
