/**
 * @fileoverview Shared constants for Evertz Quartz Router Control
 *
 * @module constants
 */

/**
 * Legal Quartz level characters (MAGNUM / full set).
 * 8-level: V,A,B,C,D,E,F,G
 * 16-level: V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O
 * MAGNUM (26): V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,W,X,Y,Z
 *
 * @readonly
 * @type {string}
 */
const VALID_LEVELS = 'VABCDEFGHIJKLMNOPQRSTUWXYZ'

/**
 * Config dropdown IDs for router level systems.
 *
 * @readonly
 * @enum {string}
 */
const XptLevelSystem = {
	EIGHT: '8',
	SIXTEEN: '16',
	MAGNUM: 'magnum',
}

/**
 * Level characters for each router level system.
 *
 * @readonly
 * @type {Object.<string, string>}
 */
const XPT_LEVEL_SETS = {
	[XptLevelSystem.EIGHT]: 'VABCDEFG',
	[XptLevelSystem.SIXTEEN]: 'VABCDEFGHIJKLMNO',
	[XptLevelSystem.MAGNUM]: 'VABCDEFGHIJKLMNOPQRSTUWXYZ',
}

/**
 * Default level system for variable tracking / interrogation.
 *
 * @readonly
 * @type {string}
 */
const DEFAULT_XPT_LEVEL_SYSTEM = XptLevelSystem.EIGHT

/**
 * Dropdown choices for the xpt_levels config field.
 *
 * @readonly
 * @type {{ id: string, label: string }[]}
 */
const XPT_LEVEL_CHOICES = [
	{ id: XptLevelSystem.EIGHT, label: '8 Level (V,A–G)' },
	{ id: XptLevelSystem.SIXTEEN, label: '16 Level (V,A–O)' },
	{ id: XptLevelSystem.MAGNUM, label: 'MAGNUM (26 Level)' },
]

/**
 * Resolves configured level system into unique valid level characters.
 *
 * Accepts dropdown IDs (`8`, `16`, `magnum`) or a legacy raw levels string.
 *
 * @param {string|undefined|null} levelsConfig - Config value from xpt_levels
 * @returns {string[]} Level characters (e.g. ['V', 'A', 'B', 'C'])
 */
function parseLevelsConfig(levelsConfig) {
	if (levelsConfig && XPT_LEVEL_SETS[levelsConfig]) {
		return XPT_LEVEL_SETS[levelsConfig].split('')
	}

	// Legacy freeform strings (e.g. 'VABC') — keep working if present in old configs
	const raw =
		typeof levelsConfig === 'string' && levelsConfig.length > 0
			? levelsConfig.toUpperCase()
			: XPT_LEVEL_SETS[DEFAULT_XPT_LEVEL_SYSTEM]

	const seen = new Set()
	const levels = []

	for (const ch of raw) {
		if (!VALID_LEVELS.includes(ch) || seen.has(ch)) {
			continue
		}
		seen.add(ch)
		levels.push(ch)
	}

	return levels.length > 0 ? levels : XPT_LEVEL_SETS[DEFAULT_XPT_LEVEL_SYSTEM].split('')
}

module.exports = {
	VALID_LEVELS,
	XptLevelSystem,
	XPT_LEVEL_SETS,
	DEFAULT_XPT_LEVEL_SYSTEM,
	XPT_LEVEL_CHOICES,
	parseLevelsConfig,

	/**
	 * Human-readable lock labels for Companion variables / router middleware.
	 * Maps Quartz .BA status values.
	 */
	LockState: {
		UNLOCKED: 'Unlocked',
		LOCKED: 'Locked',
		OWNED: 'Owned',
	},

	/**
	 * Converts a Quartz lock status code to a label.
	 *
	 * @param {number} status - 0=unlocked, 1-254=panel lock, 255=unprotected lock
	 * @returns {string}
	 */
	lockStatusToLabel(status) {
		if (status === 0) return 'Unlocked'
		if (status === 255) return 'Locked'
		if (status >= 1 && status <= 254) return 'Owned'
		return 'Unlocked'
	},

	/**
	 * Whether a Quartz lock status means the destination is locked.
	 *
	 * @param {number|undefined} status
	 * @returns {boolean}
	 */
	isDestinationLocked(status) {
		return typeof status === 'number' && status !== 0
	},
}
