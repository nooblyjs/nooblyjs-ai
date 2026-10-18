/**
 * @fileoverview User Pins API routes
 *
 * Per-user pinned folders/documents stored per CONTENT ROOT at:
 *   <space content dir>/.system/useractivity/<prefix>/pins.json
 *
 * A PIN BELONGS TO A PATH, NOT TO A SPACE — several spaces are views of one
 * content root, so a pin follows the user into every view that can see the
 * target. Records no longer carry a `spaceName`; scoping is the space's real
 * visibility matcher. See components/userArtifacts.js for why the old name
 * stamp had to go (it orphaned every pin whenever a space was renamed).
 *
 * @author noobly Team
 * @version 1.1.0
 * @since 2026-05-14
 */

'use strict';

const path = require('node:path');

const spaceUserStore = require('../components/spaceUserStore');
const userArtifacts = require('../components/userArtifacts');

const VALID_TYPES = new Set(['folder', 'document']);

/**
 * Read the raw store, with legacy records normalised (space stamp dropped,
 * duplicates collapsed). The cleaned shape reaches disk on the next write.
 */
async function readPins(appBaseDir, space, identity) {
    const parsed = await spaceUserStore.readJson(appBaseDir, space, identity, 'pins.json', []);
    return userArtifacts.normalise(parsed);
}

async function writePins(appBaseDir, space, identity, pins) {
    await spaceUserStore.writeJson(appBaseDir, space, identity, 'pins.json', pins);
}

const pinKey = userArtifacts.recordKey;

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const appBaseDir = services.appBaseDir
        || path.resolve(__dirname, '../../../.application');

    /**
     * GET /applications/wiki/api/pins?space=<name|id>
     *
     * The current user's pins, scoped to what `space` actually exposes. The
     * caller does NOT filter afterwards — matching a space label is not an
     * access check, and it is what made a renamed space hide every pin.
     */
    app.get('/applications/wiki/api/pins', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }
            const spaceRef = req.query.space || req.query.spaceName;
            const [space, pins] = await Promise.all([
                spaceUserStore.resolveSpace(appBaseDir, spaceRef),
                readPins(appBaseDir, spaceRef, req.user.email)
            ]);
            res.json({ success: true, pins: userArtifacts.filterVisible(space, pins) });
        } catch (err) {
            log.error('[Pins] GET failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/pins
     * Body: { type: 'folder'|'document', path, spaceName?, title }
     *
     * `spaceName` is still accepted — it names WHICH STORE to write to (i.e.
     * which content root), not what the pin belongs to — but it is not recorded
     * on the pin. Callers that omit it get the default space's root.
     */
    app.post('/applications/wiki/api/pins', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }
            const { type, path: itemPath, spaceName, title } = req.body || {};

            if (!VALID_TYPES.has(type)) {
                return res.status(400).json({ success: false, error: 'Invalid or missing type' });
            }
            if (!itemPath) {
                return res.status(400).json({ success: false, error: 'path is required' });
            }

            const identity = req.user.email;
            const pins = await readPins(appBaseDir, spaceName, identity);
            const newPin = {
                type,
                path: String(itemPath).replace(/\\/g, '/'),
                title: title || String(itemPath).split('/').pop() || itemPath,
                pinnedAt: new Date().toISOString()
            };
            const key = pinKey(newPin);
            const existed = pins.some(p => pinKey(p) === key);
            if (!existed) {
                pins.push(newPin);
            }
            // Written even when the pin already existed: `pins` is the NORMALISED
            // list, so this is what migrates a legacy store off the old
            // space-stamped shape.
            await writePins(appBaseDir, spaceName, identity, pins);

            const space = await spaceUserStore.resolveSpace(appBaseDir, spaceName);
            res.json({
                success: true,
                pin: newPin,
                alreadyPinned: existed,
                pins: userArtifacts.filterVisible(space, pins)
            });
        } catch (err) {
            log.error('[Pins] POST failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/pins
     * Body: { type, path, spaceName? }
     * Removes a pin (no-op if not present).
     */
    app.delete('/applications/wiki/api/pins', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }
            const { type, path: itemPath, spaceName } = req.body || {};
            if (!VALID_TYPES.has(type) || !itemPath) {
                return res.status(400).json({ success: false, error: 'type and path are required' });
            }

            const identity = req.user.email;
            const pins = await readPins(appBaseDir, spaceName, identity);
            const target = pinKey({ type, path: itemPath });
            const filtered = pins.filter(p => pinKey(p) !== target);
            // Always write: even a no-op delete persists the normalised shape.
            await writePins(appBaseDir, spaceName, identity, filtered);

            const space = await spaceUserStore.resolveSpace(appBaseDir, spaceName);
            res.json({ success: true, pins: userArtifacts.filterVisible(space, filtered) });
        } catch (err) {
            log.error('[Pins] DELETE failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki user pins routes registered');
};
