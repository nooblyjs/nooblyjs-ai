'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const spaceUserStore = require('../../../src/wiki/components/spaceUserStore');

let base, spaceDir;

beforeAll(async () => {
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'spaceus-'));
    spaceDir = path.join(base, 'content-alpha');
    await fsp.mkdir(path.join(base, 'spaces'), { recursive: true });
    await fsp.mkdir(spaceDir, { recursive: true });
    await fsp.writeFile(
        path.join(base, 'spaces', 'spaces.json'),
        JSON.stringify([
            { id: 1, name: 'Alpha Space', path: spaceDir },
            { id: 2, name: 'Beta Space', configuration: { filing: { baseDir: path.join(base, 'content-beta') } } }
        ]),
        'utf8'
    );
});

afterAll(async () => {
    await fsp.rm(base, { recursive: true, force: true });
});

describe('spaceUserStore — resolveSpaceDir', () => {
    test('resolves by name and by id, and reads configuration.filing.baseDir', async () => {
        expect(await spaceUserStore.resolveSpaceDir(base, 'Alpha Space')).toBe(spaceDir);
        expect(await spaceUserStore.resolveSpaceDir(base, 1)).toBe(spaceDir);
        expect(await spaceUserStore.resolveSpaceDir(base, 'Beta Space')).toBe(path.join(base, 'content-beta'));
    });

    test('falls back to the default space (id 1) for missing/unknown identifiers', async () => {
        expect(await spaceUserStore.resolveSpaceDir(base, null)).toBe(spaceDir);
        expect(await spaceUserStore.resolveSpaceDir(base, 'Nope')).toBe(spaceDir);
    });
});

describe('spaceUserStore — read/write land inside the space', () => {
    test('writeJson then readJson round-trips under <space>/.system/useractivity/<prefix>/', async () => {
        const data = { starred: [], recent: [{ path: 'a.md', spaceName: 'Alpha Space' }] };
        await spaceUserStore.writeJson(base, 'Alpha Space', 'srbooysen@x.com', 'activity.json', data);

        const onDisk = path.join(spaceDir, '.system', 'useractivity', 'srbooysen', 'activity.json');
        expect(fs.existsSync(onDisk)).toBe(true);
        expect(JSON.parse(fs.readFileSync(onDisk, 'utf8'))).toEqual(data);
        expect(await spaceUserStore.readJson(base, 'Alpha Space', 'srbooysen@x.com', 'activity.json')).toEqual(data);
    });

    test('readJson returns fallback when missing', async () => {
        expect(await spaceUserStore.readJson(base, 'Alpha Space', 'nobody@x.com', 'pins.json', [])).toEqual([]);
    });
});

describe('spaceUserStore — spaceOf(req)', () => {
    test('reads space from query, body, or nested context', () => {
        expect(spaceUserStore.spaceOf({ query: { space: 'Q' }, body: {} })).toBe('Q');
        expect(spaceUserStore.spaceOf({ query: {}, body: { spaceName: 'B' } })).toBe('B');
        expect(spaceUserStore.spaceOf({ query: {}, body: { context: { spaceName: 'C' } } })).toBe('C');
        expect(spaceUserStore.spaceOf({ query: {}, body: {} })).toBeNull();
    });
});
