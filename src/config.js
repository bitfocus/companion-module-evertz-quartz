/**
 * @fileoverview Module Configuration for Evertz Quartz Router Control
 * 
 * Defines the configuration fields displayed in Companion's module settings.
 * These settings control connection parameters, polling behavior, and debugging.
 * 
 * @module config
 * @author Companion Module Contributors
 * @see {@link https://github.com/bitfocus/companion-module-evertz-quartz}
 */

const { Regex } = require('@companion-module/base')

/**
 * Configuration field definitions
 * 
 * These methods are mixed into the main instance class via Object.assign().
 * 
 * @mixin
 */
module.exports = {
	/**
	 * Returns the configuration field definitions for the module
	 * 
	 * These fields are displayed in Companion's module configuration UI.
	 * 
	 * @returns {Object[]} Array of configuration field definitions
	 */
	getConfigFields() {
		return [
			// Module information header
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This module controls Evertz EQX/EQT series routers using the Quartz protocol.',
			},
			{
				type: 'static-text',
				id: 'hr1',
				width: 12,
				label: ' ',
				value: '<hr />',
			},

			// Connection settings
			{
				type: 'textinput',
				id: 'host',
				label: 'IP Address',
				width: 4,
				default: '',
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Port',
				width: 3,
				default: '23',
			},
			{
				type: 'static-text',
				id: 'hostinfo',
				width: 5,
				label: ' ',
				value: 'Other port numbers may be used for Quartz. Check your device manual and configuration settings.',
			},

			// Router size settings
			{
				type: 'number',
				id: 'max_destinations',
				label: 'Max Destinations',
				width: 4,
				default: 16,
				min: 1,
				max: 4096,
				required: true,
			},
			{
				type: 'number',
				id: 'max_sources',
				label: 'Max Sources',
				width: 4,
				default: 16,
				min: 1,
				max: 4096,
				required: true,
			},
			{
				type: 'static-text',
				id: 'sizeinfo',
				width: 4,
				label: ' ',
				value: 'Set to match your router configuration. Higher values increase name query time.',
			},
			{
				type: 'static-text',
				id: 'hr2',
				width: 12,
				label: ' ',
				value: '<hr />',
			},

			// Polling settings
			{
				type: 'number',
				id: 'pollInterval',
				label: 'Polling Interval (seconds)',
				width: 3,
				default: 5,
				min: 1,
				max: 60,
				required: true,
			},
			{
				type: 'static-text',
				id: 'pollinginfo',
				width: 9,
				label: ' ',
				value: 'Polling refreshes source/destination names and crosspoint state periodically. Crosspoints also update in real-time via router notifications.',
			},
			{
				type: 'static-text',
				id: 'hr3',
				width: 12,
				label: ' ',
				value: '<hr />',
			},

			// Variable settings
			{
				type: 'checkbox',
				id: 'enable_xpt_variables',
				label: 'Expose Crosspoint Variables',
				width: 4,
				default: true,
			},
			{
				type: 'static-text',
				id: 'xptvarinfo',
				width: 8,
				label: ' ',
				value: 'Creates variables for each destination showing the currently routed source (ID and name). Disable for large routers to reduce variable count (2 per destination).',
			},
			{
				type: 'static-text',
				id: 'hr4',
				width: 12,
				label: ' ',
				value: '<hr />',
			},

			// Debugging settings
			{
				type: 'checkbox',
				id: 'verbose',
				label: 'Enable Verbose Logging',
				default: false,
				width: 3,
			},
			{
				type: 'static-text',
				id: 'verboseinfo',
				width: 9,
				label: ' ',
				value: 'Verbose logging outputs all sent and received data to the log, which can be useful for troubleshooting.',
			},
		]
	},
}