/**
 * @fileoverview Feedback Definitions for Evertz Quartz Router Control
 *
 * @module feedbacks
 */

const { combineRgb } = require('@companion-module/base')
const { isDestinationLocked, getXptVariableLevels } = require('./constants')

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

		// True if `source` is routed to `destination` on 'V' or any level exposed as an xpt_* variable.
		// 'V' is checked unconditionally because index.js._requestCrosspoints always polls it,
		// regardless of the 'Expose Crosspoint Variables' option.
		const isSourceRoutedToDestination = (source, destination) => {
			const levels = new Set(['V', ...getXptVariableLevels(self.config)])
			return [...levels].some((level) => self.getRoutedSource(level, destination) === source)
		}

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

		feedbacks['selected_destination'] = {
			type: 'boolean',
			name: 'Selected Destination',
			description: 'True when the destination is the currently selected destination for Take',
			defaultStyle: {
				color: colorWhite,
				bgcolor: combineRgb(0, 102, 204),
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
				return String(self.getVariableValue('dst')) === String(feedback.options.dst)
			},
		}

		feedbacks['selected_source'] = {
			type: 'boolean',
			name: 'Selected Source',
			description: 'True when the source is the currently selected source for Take',
			defaultStyle: {
				color: colorWhite,
				bgcolor: combineRgb(0, 153, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source',
					default: self.CHOICES_SOURCES[0].id,
					choices: self.CHOICES_SOURCES,
				},
			],
			callback: (feedback) => {
				return String(self.getVariableValue('src')) === String(feedback.options.src)
			},
		}

		feedbacks['source_routed'] = {
			type: 'boolean',
			name: 'Source Routed to Destination',
			description: 'True when the source is routed to the destination on any tracked level',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source',
					default: self.CHOICES_SOURCES[0].id,
					choices: self.CHOICES_SOURCES,
				},
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination',
					default: self.CHOICES_DESTINATIONS[0].id,
					choices: self.CHOICES_DESTINATIONS,
				},
			],
			callback: (feedback) => {
				const src = parseInt(feedback.options.src, 10)
				return isSourceRoutedToDestination(src, feedback.options.dst)
			},
		}

		feedbacks['source_routed_to_selected_destination'] = {
			type: 'boolean',
			name: 'Source Routed to Selected Destination',
			description: 'True when the source is routed to the currently selected destination for Take',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source',
					default: self.CHOICES_SOURCES[0].id,
					choices: self.CHOICES_SOURCES,
				},
			],
			callback: (feedback) => {
				const dst = self.getVariableValue('dst')
				if (!dst) {
					return false
				}
				const src = parseInt(feedback.options.src, 10)
				return isSourceRoutedToDestination(src, dst)
			},
		}

		self.setFeedbackDefinitions(feedbacks)
	},
}
