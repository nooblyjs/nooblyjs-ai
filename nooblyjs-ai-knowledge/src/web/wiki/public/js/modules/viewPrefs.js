/**
 * View Preferences
 * Persist list-view mode (details/grid/cards/feature) per surface in localStorage.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-03
 */

 // Local variables
const PREFIX = 'wiki:view:';
// A mode missing from this list is silently dropped by writeViewPref and
// ignored by readViewPref — so every new view mode MUST be added here or it
// will not survive a reload.
const VALID = ['details', 'grid', 'cards', 'feature'];

/**
 * Determine what view the customer has selected from localstorage
 * @param {string} key 
 * @param {string} fallback  default 'cards'
 * @returns 
 */
export function readViewPref(key, fallback = 'list') {
    try {
        const v = localStorage.getItem(PREFIX + key);
        if (v == null) return fallback;
        return VALID.includes(v) ? v : fallback;
    } catch (_) {
        return fallback;
    }
}

export function writeViewPref(key, viewMode) {
    if (!VALID.includes(viewMode)) return;
    try {
        localStorage.setItem(PREFIX + key, viewMode);
    } catch (_) { /* quota / privacy mode — non-fatal */ }
}

export const VK = {
    homeRecent: 'home:recent',
    homeStarred: 'home:starred',
    homeFolder: 'home:folder',
    pageRecent: 'page:recent',
    pageStarred: 'page:starred',
    pageSearch: 'page:search',
    folder: (spaceId, folderPath) => `folder:${spaceId}:${folderPath || ''}`
};
