'use strict';

const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const userStore = require('../../../src/wiki/components/userStore');

describe('userStore — folder naming (userDir)', () => {
    test('email maps to lowercased local-part', () => {
        expect(userStore.userDir('srbooysen@example.com')).toBe('srbooysen');
        expect(userStore.userDir('Stephen.R.Booysen@gmail.com')).toBe('stephen.r.booysen');
    });

    test('non-email identity passes through, lowercased', () => {
        expect(userStore.userDir('anonymous')).toBe('anonymous');
        expect(userStore.userDir('Admin')).toBe('admin');
    });

    test('strips unsafe characters', () => {
        expect(userStore.userDir('we ird/name@x.com')).toBe('we_ird_name');
    });

    test('empty / nullish falls back to anonymous', () => {
        expect(userStore.userDir('')).toBe('anonymous');
        expect(userStore.userDir(null)).toBe('anonymous');
        expect(userStore.userDir(undefined)).toBe('anonymous');
    });
});

describe('userStore — path building (userPath)', () => {
    test('builds <base>/.system/useractivity/<prefix>/<file>', () => {
        const p = userStore.userPath('/data', 'srbooysen@example.com', 'activity.json');
        expect(p).toBe(path.join('/data', '.system', 'useractivity', 'srbooysen', 'activity.json'));
    });
});

describe('userStore — JSON + text IO', () => {
    let base;

    beforeAll(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'userstore-'));
    });

    afterAll(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    test('readJson returns the fallback when the file is missing', async () => {
        expect(await userStore.readJson(base, 'nobody@x.com', 'pins.json', [])).toEqual([]);
        expect(await userStore.readJson(base, 'nobody@x.com', 'activity.json')).toBeNull();
    });

    test('writeJson then readJson round-trips and creates the folder', async () => {
        const data = { starred: [], recent: [{ path: 'a.md' }] };
        await userStore.writeJson(base, 'srbooysen@example.com', 'activity.json', data);

        // File landed in the expected per-user location.
        const onDisk = userStore.userPath(base, 'srbooysen@example.com', 'activity.json');
        expect(JSON.parse(await fs.readFile(onDisk, 'utf8'))).toEqual(data);

        // And reads back through the helper.
        expect(await userStore.readJson(base, 'srbooysen@example.com', 'activity.json')).toEqual(data);
    });

    test('readText returns the fallback when missing, round-trips when present', async () => {
        expect(await userStore.readText(base, 'srbooysen@example.com', 'dashboard.md', null)).toBeNull();

        await userStore.writeText(base, 'srbooysen@example.com', 'dashboard.md', '# Hi\n');
        expect(await userStore.readText(base, 'srbooysen@example.com', 'dashboard.md')).toBe('# Hi\n');
    });
});
