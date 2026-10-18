/**
 * @fileoverview Tests for the wiki feature flags.
 *
 * The flags moved out of `.env` into the core settings store (group "wiki"), so
 * what matters here is: defaults apply when nothing is stored, a stored value
 * wins, a string "false" typed into the admin screen is honoured rather than
 * read as truthy, seeding never clobbers an admin's choice, and an unavailable
 * settings service degrades to the defaults instead of failing the page load.
 *
 * Not every entry is a boolean — `clientCacheVersion` is a string stamp, covered
 * in clientCacheEpoch.test.js. Assertions about "every flag" are derived from
 * FLAGS rather than written out, so adding one doesn't fail tests that were
 * never about the specific set.
 */

'use strict';

const featureFlags = require('../../../src/wiki/config/featureFlags');

const { GROUP, FLAGS, readFlags, ensureDefaults, toBoolean } = featureFlags;

/** Every flag at its default, as readFlags returns them. */
const DEFAULTS = Object.fromEntries(FLAGS.map((f) => [f.name, f.default]));

/** DEFAULTS with some values replaced. */
const defaultsWith = (overrides) => ({ ...DEFAULTS, ...overrides });

/** Settings keys, in seeding order. */
const ALL_KEYS = FLAGS.map((f) => f.key);

/** Minimal in-memory stand-in for the core settings service. */
function makeSettings(initial = {}) {
    const store = new Map(Object.entries(initial));
    const keyOf = (key, group) => `${group}.${key}`;
    return {
        store,
        get: jest.fn(async (key, group) => store.get(keyOf(key, group))),
        has: jest.fn(async (key, group) => store.has(keyOf(key, group))),
        set: jest.fn(async (key, value, group) => {
            store.set(keyOf(key, group), value);
            return value;
        }),
    };
}

describe('wiki feature flags - toBoolean', () => {
    it.each([
        [true, true], [false, false],
        ['true', true], ['false', false],
        ['TRUE', true], ['  False  ', false],
        ['yes', true], ['no', false],
        ['on', true], ['off', false],
        ['1', true], ['0', false],
        [1, true], [0, false],
    ])('coerces %p to %p', (input, expected) => {
        // Fallback is deliberately the opposite, so a coercion miss is visible.
        expect(toBoolean(input, !expected)).toBe(expected);
    });

    it.each([undefined, null, '', 'maybe', {}])('falls back for %p', (input) => {
        expect(toBoolean(input, true)).toBe(true);
        expect(toBoolean(input, false)).toBe(false);
    });
});

describe('wiki feature flags - readFlags', () => {
    it('returns the defaults when the store holds nothing', async () => {
        expect(await readFlags(makeSettings())).toEqual(DEFAULTS);
    });

    it('returns stored values over the defaults', async () => {
        const settings = makeSettings({
            [`${GROUP}.aiChatEnabled`]: false,
            [`${GROUP}.editingEnabled`]: true,
        });
        expect(await readFlags(settings)).toEqual(defaultsWith({
            aiChatEnabled: false,
            editingEnabled: true,
        }));
    });

    it('honours a string "false" typed into the admin screen', async () => {
        const settings = makeSettings({ [`${GROUP}.editingEnabled`]: 'false' });
        expect((await readFlags(settings)).editingEnabled).toBe(false);
    });

    it('reads every flag from the wiki group', async () => {
        const settings = makeSettings();
        await readFlags(settings);
        for (const key of ALL_KEYS) {
            expect(settings.get).toHaveBeenCalledWith(key, GROUP);
        }
    });

    it('degrades to defaults when there is no settings service', async () => {
        expect(await readFlags(undefined)).toEqual(DEFAULTS);
    });

    it('degrades to defaults when a read throws, without rejecting', async () => {
        const settings = makeSettings();
        settings.get.mockRejectedValue(new Error('store unreadable'));
        const warn = jest.fn();

        expect(await readFlags(settings, { warn })).toEqual(DEFAULTS);
        expect(warn).toHaveBeenCalled();
    });

    it('ignores process.env — the store is the only source', async () => {
        const previous = process.env.WIKI_EDITING_ENABLED;
        process.env.WIKI_EDITING_ENABLED = 'false';
        try {
            expect((await readFlags(makeSettings())).editingEnabled).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.WIKI_EDITING_ENABLED;
            else process.env.WIKI_EDITING_ENABLED = previous;
        }
    });
});

describe('wiki feature flags - ensureDefaults', () => {
    it('creates every missing flag so the Settings screen can show them', async () => {
        const settings = makeSettings();
        const created = await ensureDefaults(settings);

        expect(created).toEqual(ALL_KEYS);
        expect(settings.store.get(`${GROUP}.aiChatEnabled`)).toBe(true);
        expect(settings.set).toHaveBeenCalledWith(
            'aiChatEnabled',
            true,
            GROUP,
            expect.objectContaining({ type: 'boolean', description: expect.any(String) })
        );
    });

    it('never overwrites a value an admin has already set', async () => {
        const settings = makeSettings({ [`${GROUP}.aiChatEnabled`]: false });

        expect(await ensureDefaults(settings))
            .toEqual(ALL_KEYS.filter((k) => k !== 'aiChatEnabled'));
        expect(settings.store.get(`${GROUP}.aiChatEnabled`)).toBe(false);
    });

    it('is idempotent', async () => {
        const settings = makeSettings();
        await ensureDefaults(settings);
        expect(await ensureDefaults(settings)).toEqual([]);
    });

    it('does not throw when there is no settings service', async () => {
        const warn = jest.fn();
        expect(await ensureDefaults(undefined, { warn })).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('survives a write failure and reports nothing created', async () => {
        const settings = makeSettings();
        settings.set.mockRejectedValue(new Error('read-only store'));
        const warn = jest.fn();

        expect(await ensureDefaults(settings, { warn })).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(ALL_KEYS.length);
    });
});
