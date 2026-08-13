/**
 * @fileoverview Preset Definitions for Evertz Quartz Router Control
 *
 * Builds ready-to-use buttons for the take workflow:
 *   - One "Select Source" button per source (Sources category)
 *   - One "Select Destination" button per destination (Destinations category)
 *   - One "Toggle Lock" button per destination (Locks category)
 *   - A single "Take" button (Take category)
 *
 * Rebuilt whenever CHOICES_SOURCES/CHOICES_DESTINATIONS change (source/destination
 * names arrive from the router), alongside initActions()/initFeedbacks().
 *
 * @module presets
 */

const { combineRgb } = require('@companion-module/base')
const { parseLevelsConfig } = require('./constants')

module.exports = {
	/**
	 * Initializes preset definitions for the module
	 *
	 * @returns {void}
	 */
	initPresets: function () {
		const self = this
		const presets = {}

		const colorWhite = combineRgb(255, 255, 255)
		const colorBlack = combineRgb(0, 0, 0)
		const colorRed = combineRgb(200, 0, 0)
		const colorGreen = combineRgb(0, 200, 0)
		const colorBlue = combineRgb(0, 0, 200)
		const colorYellow = combineRgb(200, 200, 0)

		// Names haven't loaded from the router yet - nothing useful to build presets from
		const hasSources = self.CHOICES_SOURCES[0].id !== '0'
		const hasDestinations = self.CHOICES_DESTINATIONS[0].id !== '0'

		if (hasSources) {
			for (const source of self.CHOICES_SOURCES) {
				presets[`select_source_${source.id}`] = {
					type: 'button',
					category: 'Sources',
					name: `Select Source: ${source.label}`,
					style: {
						text: source.label,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorBlack,
					},
					steps: [
						{
							down: [{ actionId: 'set_source_take', options: { src: source.id } }],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'selected_source',
							options: { src: source.id },
							style: {
								color: colorWhite,
								bgcolor: colorBlue,
							},
						},
						{
							feedbackId: 'source_routed_to_selected_destination',
							options: { src: source.id },
							style: {
								color: colorWhite,
								bgcolor: colorGreen,
							},
						},
					],
				}
			}
		}

		if (hasDestinations) {
			for (const destination of self.CHOICES_DESTINATIONS) {
				presets[`select_destination_${destination.id}`] = {
					type: 'button',
					category: 'Destinations',
					name: `Select Destination: ${destination.label}`,
					style: {
						text: destination.label,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorBlack,
					},
					steps: [
						{
							down: [{ actionId: 'set_destination_take', options: { dst: destination.id } }],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'selected_destination',
							options: { dst: destination.id },
							style: {
								color: colorWhite,
								bgcolor: colorYellow,
							},
						},
					],
				}
			}
		}

		if (hasDestinations) {
			for (const destination of self.CHOICES_DESTINATIONS) {
				presets[`toggle_lock_${destination.id}`] = {
					type: 'button',
					category: 'Locks',
					name: `Toggle Lock: ${destination.label}`,
					style: {
						text: `Lock\\n${destination.label}`,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorBlack,
					},
					steps: [
						{
							down: [{ actionId: 'lock_destination', options: { dst: destination.id, lock: 'T' } }],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'destination_locked',
							options: { dst: destination.id },
							style: {
								color: colorWhite,
								bgcolor: colorRed,
								text: `Unlock\\n${destination.label}`,
							},
						},
					],
				}
			}
		}

		presets['take'] = {
			type: 'button',
			category: 'Take',
			name: 'Take',
			style: {
				text: 'TAKE',
				size: '18',
				color: colorWhite,
				bgcolor: colorRed,
			},
			steps: [
				{
					down: [
						{ actionId: 'take', options: { levels: parseLevelsConfig(self.config.xpt_levels).join('') } },
					],
					up: [],
				},
			],
			feedbacks: [],
		}

		self.setPresetDefinitions(presets)
	},
}
