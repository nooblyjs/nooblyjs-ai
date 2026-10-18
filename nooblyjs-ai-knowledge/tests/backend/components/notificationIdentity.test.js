'use strict';

/**
 * NotificationManager — identity keying and file collapse.
 *
 * Reported as "notifications are not working at all", with a zero-byte
 * `notifications.json` warning on every boot. The warning was a red herring
 * (userStore tolerates that file); these are the two defects underneath it that
 * live in this component:
 *
 *  1. THE FOLDER NAME IS NOT AN IDENTITY. `userDir()` sanitises an email to its
 *     local-part — `admin@localhost` → `admin/` — and the mapping is one-way.
 *     The loader keyed users by the FOLDER name while `subscribe()` and
 *     `addToHistory()` key by the email, so a user's loaded history was filed
 *     under `admin` and looked up under `admin@localhost`: it read back empty
 *     while sitting right there on disk.
 *
 *  2. TWO KEYS, ONE FILE. Both of those keys reached the writer, and both
 *     resolve to the same path, so each sync wrote it twice in Set-iteration
 *     order — an empty record could land on top of a full one. A stale
 *     `spaceName` does the same thing from the other direction: it resolves to
 *     no space, falls back to the default, and lands on a directory another key
 *     is already writing (normal here, where four spaces share one content
 *     root).
 *
 * Plus the reported symptom itself: an unreadable notifications.json must be
 * TRACKED so the next sync replaces it, or it warns forever.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NotificationManager = require('../../../src/wiki/components/notificationManager');

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Wait for `check()` to hold. Delivery is fire-and-forget inside the core
 * callback and writes history to disk on the way, so it lands several ticks
 * after publishChange() resolves — a single setImmediate is not enough.
 */
async function until(check, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (check()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return false;
}

/** Core notifying double — records topics, and lets a test fire one. */
function makeNotifying() {
    const subs = new Map();
    return {
        topics: () => [...subs.keys()],
        async subscribe(topic, cb) {
            if (!subs.has(topic)) subs.set(topic, []);
            subs.get(topic).push(cb);
        },
        unsubscribe(topic, cb) {
            const list = subs.get(topic) || [];
            const i = list.indexOf(cb);
            if (i >= 0) list.splice(i, 1);
        },
        async notify(topic, message) {
            for (const cb of subs.get(topic) || []) cb(message);
        }
    };
}

describe('NotificationManager — identity and persistence', () => {
    let appBaseDir;
    let contentRoot;
    let userDir;

    const SPACE = 'Engineering Space';
    const EMAIL = 'admin@localhost';

    /** Path of one of the user's files inside the content root. */
    const file = (name) => path.join(userDir, name);
    const readJson = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));

    function makeManager(notifying = makeNotifying(), deliver = () => {}) {
        return new NotificationManager({}, noopLog, appBaseDir, notifying, deliver);
    }

    beforeEach(() => {
        appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-'));
        contentRoot = path.join(appBaseDir, 'content');
        userDir = path.join(contentRoot, '.system', 'useractivity', 'admin');
        fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
        fs.mkdirSync(userDir, { recursive: true });
        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([{ id: 1, name: SPACE, visibility: 'team', path: contentRoot }]),
            'utf8'
        );
    });

    afterEach(() => {
        fs.rmSync(appBaseDir, { recursive: true, force: true });
    });

    test('history stored under the folder name is readable by the real identity', async () => {
        // Exactly the shape found on the reporting machine: the file names the
        // user by FOLDER, everything at runtime names them by email.
        fs.writeFileSync(file('notifications.json'), JSON.stringify({
            userId: 'admin',
            notifications: [{ id: 'n1', path: 'Readme.md', read: false, spaceName: SPACE }]
        }), 'utf8');
        fs.writeFileSync(file('subscriptions.json'), JSON.stringify([
            { id: 's1', userId: EMAIL, spaceName: SPACE, type: 'document', path: 'Readme.md' }
        ]), 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();

        await expect(mgr.getHistory(EMAIL, SPACE)).resolves.toHaveLength(1);
        await expect(mgr.getUnreadCount(EMAIL, SPACE)).resolves.toBe(1);
    });

    test('a zero-byte notifications.json is repaired by the next sync', async () => {
        fs.writeFileSync(file('notifications.json'), '', 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();
        await mgr._syncToDisk();

        // Valid JSON again, so the boot-time warning stops.
        expect(readJson('notifications.json')).toEqual({ userId: 'admin', notifications: [] });
    });

    test('an empty legacy key cannot overwrite the record it shares a file with', async () => {
        // Loader tracks the user; the runtime then adds history under the email.
        // Both keys resolve to ONE file — the full one has to win, whatever
        // order the write set happens to be in.
        fs.writeFileSync(file('notifications.json'), JSON.stringify({ userId: 'admin', notifications: [] }), 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();

        await mgr.addToHistory(EMAIL, { path: 'Readme.md', spaceName: SPACE });
        await mgr._syncToDisk();

        const saved = readJson('notifications.json');
        expect(saved.notifications).toHaveLength(1);
        expect(saved.userId).toBe(EMAIL);
    });

    test('subscriptions survive a sync when the loader and the runtime key differ', async () => {
        fs.writeFileSync(file('subscriptions.json'), JSON.stringify([
            { id: 's1', userId: EMAIL, spaceName: SPACE, type: 'folder', path: 'Technology/' }
        ]), 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();
        await mgr._syncToDisk();

        expect(readJson('subscriptions.json')).toHaveLength(1);
        await expect(mgr.getSubscriptions(EMAIL, SPACE)).resolves.toHaveLength(1);
    });

    test('a subscription stamped with a DEAD space name cannot wipe the live file', async () => {
        // Fault left in place deliberately (subscriptions are still identified
        // by the space's display name): a renamed space leaves records stamped
        // with a name that resolves to nothing. spaceUserStore then falls back
        // to the default space — the same directory — so two keys target one
        // file. The subscriptions must still be there afterwards.
        fs.writeFileSync(file('subscriptions.json'), JSON.stringify([
            { id: 's1', userId: EMAIL, spaceName: 'Engineering Collaboration Space', type: 'folder', path: 'Technology/' },
            { id: 's2', userId: EMAIL, spaceName: 'Engineering Collaboration Space', type: 'folder', path: 'Product/' }
        ]), 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();
        await mgr._syncToDisk();

        expect(readJson('subscriptions.json')).toHaveLength(2);
    });

    test('delivery reaches the identity that subscribed', async () => {
        const notifying = makeNotifying();
        const delivered = [];
        const mgr = makeManager(notifying, (userId, payload) => delivered.push({ userId, payload }));
        await mgr.initialize();
        mgr.stopSync();

        await mgr.subscribe(EMAIL, SPACE, 'folder', 'Technology');
        await mgr.publishChange('Technology/Roadmap.md', {
            type: 'document', path: 'Technology/Roadmap.md', spaceName: SPACE
        });
        await until(() => delivered.length > 0);

        expect(delivered).toHaveLength(1);
        expect(delivered[0].userId).toBe(EMAIL);
        await expect(mgr.getHistory(EMAIL, SPACE)).resolves.toHaveLength(1);
    });

    test('a change in a space the user did not subscribe to is not delivered', async () => {
        const notifying = makeNotifying();
        const delivered = [];
        const mgr = makeManager(notifying, (userId) => delivered.push(userId));
        await mgr.initialize();
        mgr.stopSync();

        await mgr.subscribe(EMAIL, SPACE, 'folder', 'Technology');
        await mgr.publishChange('Technology/Roadmap.md', {
            type: 'document', path: 'Technology/Roadmap.md', spaceName: 'Some Other Space'
        });
        // Nothing to wait FOR, so give the fire-and-forget path room to be wrong.
        await until(() => delivered.length > 0, 200);

        expect(delivered).toEqual([]);
    });
    test('spaces sharing one content root load a subscription ONCE', async () => {
        // Four spaces on one baseDir is the normal arrangement here, so this
        // walk opens the same subscriptions.json four times. It used to push
        // what it read every time and the next sync wrote the multiplied array
        // back, so the file grew four-fold on EVERY boot — 1024 records for one
        // real subscription, observed in production.
        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([
                { id: 1, name: SPACE, path: contentRoot },
                { id: 2, name: 'Financial Services Space', path: contentRoot },
                { id: 3, name: 'People Space', path: contentRoot },
                { id: 4, name: 'Retail Space', path: contentRoot }
            ]),
            'utf8'
        );
        fs.writeFileSync(file('subscriptions.json'), JSON.stringify([
            { id: 's1', userId: EMAIL, spaceName: SPACE, type: 'folder', path: 'Technology/' }
        ]), 'utf8');

        const mgr = makeManager();
        await mgr.initialize();
        mgr.stopSync();

        expect(mgr.subscriptions).toHaveLength(1);

        await mgr._syncToDisk();
        expect(readJson('subscriptions.json')).toHaveLength(1);

        // And it stays at one across restarts — the growth was compounding.
        const second = makeManager();
        await second.initialize();
        second.stopSync();
        await second._syncToDisk();
        expect(readJson('subscriptions.json')).toHaveLength(1);
    });
});
