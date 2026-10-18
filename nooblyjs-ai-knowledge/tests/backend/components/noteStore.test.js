'use strict';

/**
 * Per-user notes about a piece of content.
 *
 * The layout the user asked for is load-bearing, not incidental: one plain .txt
 * per note under `<content root>/.system/useractivity/<prefix>/notes/`, named
 * after the content it is about, so the folder is readable and editable outside
 * the app. Everything that makes that workable is asserted here:
 *
 *   - the file really is named after the content, and a SECOND note about the
 *     same content gets a suffix instead of overwriting the first;
 *   - the .txt holds the note body and nothing else (no header to parse, no
 *     metadata to corrupt) — the index owns the association;
 *   - a target path is one key however it is spelt ('/x', 'x\\y', 'x/'), or the
 *     same content quietly ends up with two note lists;
 *   - an index entry can never point outside the notes folder, which is what
 *     stops a hand-edited (or crafted) `file` from being a traversal.
 *
 * A VOICE NOTE is the same note with a recording beside it, and the suites at
 * the bottom pin the properties that keeps: the pair shares a stem so it reads
 * as one thing in a directory listing, deleting the note takes BOTH files (the
 * index is the only record of what a recording was of, so a stranded .webm is
 * unrecoverable), re-recording replaces rather than accumulating, and the
 * narrow file-name rule that protects the .txt is not widened to let audio in.
 *
 * PICTURES are the same idea with one difference that the suites pin directly:
 * a note has at most one recording but MANY pictures, so they are an array with
 * per-picture ids, adding never replaces, and removing one leaves the rest —
 * while the file naming, the allow-list and the delete-takes-everything rule
 * are exactly the ones audio already established.
 */

const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const noteStore = require('../../../src/wiki/components/noteStore');

const USER = 'srbooysen@example.com';

/** A target, the shape every store call now takes. */
function T(type, targetPath) {
    return { type, path: targetPath };
}

/**
 * Where USER's notes for `target` should land.
 *
 * Notes are FOLDER-LOCAL: they sit in the folder the target is in (or, for a
 * folder target, inside it), so the expected path depends on the target rather
 * than being one fixed directory per content root.
 */
function notesPathFor(base, target, ...parts) {
    const folder = noteStore.folderFor(target);
    return path.join(base, folder, '.system', 'useractivity', 'srbooysen', 'notes', ...parts);
}

/** Notes about the content ROOT — the one case that did not move. */
function notesPath(base, ...parts) {
    return notesPathFor(base, T('folder', ''), ...parts);
}

/** The two folders this suite writes into: 'a' (documents) and 'a/b'. */
const AT_A = T('document', 'a/b.md');
const AT_AB = T('folder', 'a/b');

describe('noteStore — target keys', () => {
    test('a path is one key however it is spelt', () => {
        const canonical = noteStore.targetKey('folder', 'Solution Design/Distribution');
        expect(noteStore.targetKey('folder', '/Solution Design/Distribution')).toBe(canonical);
        expect(noteStore.targetKey('folder', 'Solution Design\\Distribution')).toBe(canonical);
        expect(noteStore.targetKey('folder', 'Solution Design/Distribution/')).toBe(canonical);
    });

    test('the space root collapses to one key whether it arrives as "" or "/"', () => {
        expect(noteStore.targetKey('folder', '/')).toBe(noteStore.targetKey('folder', ''));
    });

    test('a folder and a document at the same path are different targets', () => {
        expect(noteStore.targetKey('folder', 'a/b')).not.toBe(noteStore.targetKey('document', 'a/b'));
    });

    test('an unknown type is treated as a document', () => {
        expect(noteStore.targetKey('banana', 'a/b')).toBe(noteStore.targetKey('document', 'a/b'));
    });
});

describe('noteStore — file naming', () => {
    test('the file is named after the content, extension dropped', () => {
        expect(noteStore.slugify('Distribution')).toBe('distribution');
        expect(noteStore.slugify('Payment Gateway.md')).toBe('payment-gateway');
        expect(noteStore.slugify('REX Trails / Q3 plan')).toBe('rex-trails-q3-plan');
    });

    test('a title with nothing usable in it still produces a name', () => {
        expect(noteStore.slugify('///')).toBe('note');
        expect(noteStore.slugify('')).toBe('note');
        expect(noteStore.slugify(null)).toBe('note');
    });
});

describe('noteStore — CRUD on disk', () => {
    let base;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-'));
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    test('a note is a .txt named after the content, holding only the body', async () => {
        const note = await noteStore.create(base, USER, {
            type: 'folder',
            path: 'Solution Design/Distribution',
            title: 'Distribution',
            text: 'Check with the AI platform team before reusing REX Trails infra.'
        });

        const file = notesPathFor(base, T('folder', 'Solution Design/Distribution'),
            'distribution.txt');
        await expect(fs.readFile(file, 'utf8'))
            .resolves.toBe('Check with the AI platform team before reusing REX Trails infra.');
        expect(note.id).toBeTruthy();
        expect(note.path).toBe('Solution Design/Distribution');
    });

    test('a second note about the same content is suffixed, never overwritten', async () => {
        await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'Distribution', text: 'first' });
        await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'Distribution', text: 'second' });

        await expect(fs.readFile(notesPathFor(base, AT_AB, 'distribution.txt'), 'utf8')).resolves.toBe('first');
        await expect(fs.readFile(notesPathFor(base, AT_AB, 'distribution-2.txt'), 'utf8')).resolves.toBe('second');
    });

    test('a file already sitting in the notes folder is not clobbered', async () => {
        // The folder is meant to be hand-editable — a file the index has never
        // heard of still owns its name.
        await fs.mkdir(notesPathFor(base, AT_AB), { recursive: true });
        await fs.writeFile(notesPathFor(base, AT_AB, 'distribution.txt'), 'written by hand', 'utf8');

        await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'Distribution', text: 'from the app' });

        await expect(fs.readFile(notesPathFor(base, AT_AB, 'distribution.txt'), 'utf8')).resolves.toBe('written by hand');
        await expect(fs.readFile(notesPathFor(base, AT_AB, 'distribution-2.txt'), 'utf8')).resolves.toBe('from the app');
    });

    test('notes are listed for their target only, newest edit first', async () => {
        const older = await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'B', text: 'older' });
        await noteStore.create(base, USER, { type: 'folder', path: 'a/c', title: 'C', text: 'other folder' });
        const newer = await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'B', text: 'newer' });

        // create() stamps both in the same millisecond on a fast box; make the
        // ordering unambiguous by touching one.
        await noteStore.update(base, USER, newer, newer.id, 'newer, edited');

        const notes = await noteStore.listForTarget(base, USER, T('folder', 'a/b'));
        expect(notes.map(n => n.id)).toEqual([newer.id, older.id]);
        expect(notes[0].text).toBe('newer, edited');
    });

    test('a document and a folder at the same path keep separate notes', async () => {
        await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'B', text: 'about the folder' });
        await noteStore.create(base, USER, { type: 'document', path: 'a/b', title: 'B', text: 'about the document' });

        const folderNotes = await noteStore.listForTarget(base, USER, T('folder', 'a/b'));
        const docNotes = await noteStore.listForTarget(base, USER, T('document', 'a/b'));
        expect(folderNotes).toHaveLength(1);
        expect(docNotes).toHaveLength(1);
        expect(folderNotes[0].text).toBe('about the folder');
    });

    test('a note is found however the caller spells the path', async () => {
        await noteStore.create(base, USER, { type: 'folder', path: 'a/b', title: 'B', text: 'note' });
        await expect(noteStore.listForTarget(base, USER, T('folder', '/a/b/'))).resolves.toHaveLength(1);
        await expect(noteStore.listForTarget(base, USER, T('folder', 'a\\b'))).resolves.toHaveLength(1);
    });

    test('update replaces the body and moves the edit time forward', async () => {
        const note = await noteStore.create(base, USER, { type: 'document', path: 'a/b.md', title: 'B', text: 'draft' });
        const updated = await noteStore.update(base, USER, note, note.id, 'final');

        expect(updated.text).toBe('final');
        expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(note.updatedAt));
        await expect(fs.readFile(notesPathFor(base, AT_A, 'b.txt'), 'utf8')).resolves.toBe('final');
    });

    test('update of an unknown id is a miss, not a create', async () => {
        await expect(noteStore.update(base, USER, T('document', 'a/b.md'), 'nsuchthing', 'text'))
            .resolves.toBeNull();
    });

    test('delete removes the record AND the file', async () => {
        const note = await noteStore.create(base, USER, { type: 'document', path: 'a/b.md', title: 'B', text: 'gone soon' });
        await expect(noteStore.remove(base, USER, note, note.id)).resolves.toMatchObject({ id: note.id });

        await expect(fs.access(notesPathFor(base, AT_A, 'b.txt'))).rejects.toThrow();
        await expect(noteStore.listForTarget(base, USER, T('document', 'a/b.md'))).resolves.toEqual([]);
        await expect(noteStore.remove(base, USER, note, note.id)).resolves.toBeNull();
    });

    test('a body longer than the cap is clamped rather than refused', async () => {
        const note = await noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B',
            text: 'x'.repeat(noteStore.MAX_TEXT_LENGTH + 500)
        });
        expect(note.text).toHaveLength(noteStore.MAX_TEXT_LENGTH);
    });

    test('notes survive with an empty body (a note being written right now)', async () => {
        const note = await noteStore.create(base, USER, { type: 'document', path: 'a/b.md', title: 'B', text: '' });
        const notes = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(notes).toEqual([expect.objectContaining({ id: note.id, text: '' })]);
    });
});

describe('noteStore — a corrupt or hostile index cannot escape the notes folder', () => {
    let base;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-'));
        await fs.mkdir(notesPathFor(base, AT_A), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    /** Write notes.json directly, as a hand edit (or an attacker) would. */
    async function writeIndex(records) {
        await fs.writeFile(notesPathFor(base, AT_A, 'notes.json'), JSON.stringify(records), 'utf8');
    }

    test('a traversing file name is dropped, so the record is unreachable', async () => {
        await writeIndex([
            { id: 'evil', file: '../../../../../../etc/passwd', type: 'document', path: 'a/b.md' }
        ]);
        await expect(noteStore.listForTarget(base, USER, T('document', 'a/b.md'))).resolves.toEqual([]);
        await expect(noteStore.remove(base, USER, T('document', 'a/b.md'), 'evil')).resolves.toBeNull();
    });

    test('a non-.txt file name is dropped', async () => {
        await writeIndex([{ id: 'x', file: 'notes.json', type: 'document', path: 'a/b.md' }]);
        await expect(noteStore.listForTarget(base, USER, T('document', 'a/b.md'))).resolves.toEqual([]);
    });

    test('junk records are skipped, good ones alongside them still work', async () => {
        await writeIndex([
            null,
            'nonsense',
            { file: 'orphan.txt' },                                        // no id
            { id: 'good', file: 'good.txt', type: 'document', path: 'a/b.md', updatedAt: '2026-08-01T00:00:00.000Z' }
        ]);
        await fs.writeFile(notesPathFor(base, AT_A, 'good.txt'), 'still here', 'utf8');

        const notes = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(notes).toEqual([expect.objectContaining({ id: 'good', text: 'still here' })]);
    });

    test('an index entry whose file has been deleted reads as an empty note, not a crash', async () => {
        await writeIndex([{ id: 'ghost', file: 'ghost.txt', type: 'document', path: 'a/b.md' }]);
        const notes = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(notes).toEqual([expect.objectContaining({ id: 'ghost', text: '' })]);
    });

    test('an unparseable index degrades to "no notes" rather than throwing', async () => {
        await fs.writeFile(notesPathFor(base, AT_A, 'notes.json'), '{ not json', 'utf8');
        await expect(noteStore.listIndex(base, USER, T('document', 'a/b.md'))).resolves.toEqual([]);
    });
});

describe('noteStore — voice notes', () => {
    let base;

    /** Stand-in for a MediaRecorder blob; the bytes only have to survive. */
    const TAKE_ONE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    const TAKE_TWO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x09, 0x09]);

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-audio-'));
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    async function voiceNote(overrides = {}) {
        return noteStore.create(base, USER, {
            type: 'document',
            path: 'a/Payment Gateway.md',
            title: 'Payment Gateway',
            text: '',
            audio: { buffer: TAKE_ONE, mime: 'audio/webm;codecs=opus', durationMs: 4200 },
            ...overrides
        });
    }

    test('the recording lands beside the body, under the same stem', async () => {
        await voiceNote();

        const names = (await fs.readdir(notesPathFor(base, AT_A))).sort();
        expect(names).toEqual(['notes.json', 'payment-gateway.txt', 'payment-gateway.webm']);
    });

    test('the bytes survive the round trip exactly', async () => {
        const note = await voiceNote();
        const found = await noteStore.readAudio(base, USER, note, note.id);

        expect(found.buffer.equals(TAKE_ONE)).toBe(true);
        expect(found.mime).toBe('audio/webm');
    });

    test('codec parameters pick the container but are not stored as the type', async () => {
        const note = await voiceNote();
        // `audio/webm;codecs=opus` is what MediaRecorder reports; the file is a
        // .webm and the type it is served back as has to be a real media type.
        expect(note.audio.mime).toBe('audio/webm');
        expect(note.audio.durationMs).toBe(4200);
        expect(note.audio.size).toBe(TAKE_ONE.length);
    });

    test("Safari's mp4 recording is stored as .m4a", async () => {
        await voiceNote({ audio: { buffer: TAKE_ONE, mime: 'audio/mp4', durationMs: 900 } });
        expect(await fs.readdir(notesPathFor(base, AT_A))).toContain('payment-gateway.m4a');
    });

    test('the on-disk file name never reaches the caller', async () => {
        // A client that can name a file is a client that can try to name
        // another one; audio is addressed by NOTE id, exactly like the text.
        const note = await voiceNote();
        expect(note.audio.file).toBeUndefined();
        expect(JSON.stringify(note)).not.toContain('payment-gateway.webm');
    });

    test('an unsupported recording type is refused rather than guessed at', async () => {
        await expect(noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B', text: '',
            audio: { buffer: TAKE_ONE, mime: 'application/x-msdownload' }
        })).rejects.toMatchObject({ code: 'UNSUPPORTED_AUDIO_TYPE' });
    });

    test('a recording can be attached to a note that already has words', async () => {
        const note = await noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B', text: 'typed first'
        });
        expect(note.audio).toBeNull();

        const withAudio = await noteStore.attachAudio(base, USER, note, note.id, {
            buffer: TAKE_ONE, mime: 'audio/webm', durationMs: 1500
        });

        expect(withAudio.audio.durationMs).toBe(1500);
        expect(withAudio.text).toBe('typed first');   // the words are untouched
        expect(await fs.readdir(notesPathFor(base, AT_A))).toContain('b.webm');
    });

    test('re-recording replaces the take instead of piling up -2, -3 files', async () => {
        const note = await voiceNote();
        await noteStore.attachAudio(base, USER, note, note.id, { buffer: TAKE_TWO, mime: 'audio/webm' });

        const names = (await fs.readdir(notesPathFor(base, AT_A))).sort();
        expect(names).toEqual(['notes.json', 'payment-gateway.txt', 'payment-gateway.webm']);

        const found = await noteStore.readAudio(base, USER, note, note.id);
        expect(found.buffer.equals(TAKE_TWO)).toBe(true);
    });

    test('attaching to an unknown id is a miss, not a create', async () => {
        await expect(noteStore.attachAudio(base, USER, T('document', 'a/b.md'), 'nsuchthing', {
            buffer: TAKE_ONE, mime: 'audio/webm'
        })).resolves.toBeNull();
    });

    test('removing the recording keeps the note and its words', async () => {
        const note = await voiceNote({ text: 'the caption' });
        const after = await noteStore.removeAudio(base, USER, note, note.id);

        expect(after.audio).toBeNull();
        expect(after.text).toBe('the caption');
        await expect(fs.access(notesPathFor(base, AT_A, 'payment-gateway.webm'))).rejects.toThrow();
        await expect(fs.access(notesPathFor(base, AT_A, 'payment-gateway.txt'))).resolves.toBeUndefined();
        await expect(noteStore.readAudio(base, USER, note, note.id)).resolves.toBeNull();
    });

    test('deleting the note takes the recording with it', async () => {
        // The index is the ONLY record that this file was a recording of that
        // note. Leaving it behind orphans it beyond recovery.
        const note = await voiceNote();
        await noteStore.remove(base, USER, note, note.id);

        expect(await fs.readdir(notesPathFor(base, AT_A))).toEqual(['notes.json']);
    });

    test('a note about content whose slug is taken keeps its recording alongside', async () => {
        await voiceNote();
        const second = await voiceNote();

        // Second note is `-2`; so is its recording, so the pairs stay obvious.
        expect((await fs.readdir(notesPathFor(base, AT_A))).sort()).toEqual([
            'notes.json',
            'payment-gateway-2.txt', 'payment-gateway-2.webm',
            'payment-gateway.txt', 'payment-gateway.webm'
        ]);
        const found = await noteStore.readAudio(base, USER, second, second.id);
        expect(found.file).toBe('payment-gateway-2.webm');
    });

    test('a listed voice note carries what a player needs before it fetches bytes', async () => {
        await voiceNote();
        const [listed] = await noteStore.listForTarget(base, USER, T('document', 'a/Payment Gateway.md'));

        expect(listed.audio).toEqual({
            mime: 'audio/webm',
            durationMs: 4200,
            size: TAKE_ONE.length,
            recordedAt: expect.any(String)
        });
    });
});

describe('noteStore — a corrupt or hostile audio entry cannot escape either', () => {
    let base;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-audio-evil-'));
        await fs.mkdir(notesPathFor(base, AT_A), { recursive: true });
        await fs.writeFile(notesPathFor(base, AT_A, 'good.txt'), 'the words', 'utf8');
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    async function writeIndex(audio) {
        await fs.writeFile(notesPathFor(base, AT_A, 'notes.json'), JSON.stringify([{
            id: 'good', file: 'good.txt', type: 'document', path: 'a/b.md', audio
        }]), 'utf8');
    }

    test('a traversing recording name is dropped, and the note survives without it', async () => {
        // Losing the audio beats losing the note: the words are still worth
        // showing, and the recording was unreachable either way.
        await writeIndex({ file: '../../../../../../etc/passwd', mime: 'audio/webm' });

        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.text).toBe('the words');
        expect(note.audio).toBeNull();
        await expect(noteStore.readAudio(base, USER, T('document', 'a/b.md'), 'good'))
            .resolves.toBeNull();
    });

    test('an extension outside the allow-list is dropped', async () => {
        // The .txt rule was never widened to admit recordings; audio got its
        // own equally narrow one, so this is refused the same way.
        await writeIndex({ file: 'payload.exe', mime: 'audio/webm' });
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.audio).toBeNull();
    });

    test('a made-up media type is not served back as itself', async () => {
        await writeIndex({ file: 'good.webm', mime: 'text/html' });
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.audio.mime).toBe('application/octet-stream');
    });

    test('an index entry whose recording is gone reads as no recording, not a crash', async () => {
        await writeIndex({ file: 'vanished.webm', mime: 'audio/webm' });
        await expect(noteStore.readAudio(base, USER, T('document', 'a/b.md'), 'good'))
            .resolves.toBeNull();
    });

    test('nonsense in the duration is dropped rather than shown', async () => {
        await writeIndex({ file: 'good.webm', mime: 'audio/webm', durationMs: 'ages' });
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.audio.durationMs).toBeNull();
    });
});

describe('noteStore — pictures', () => {
    let base;

    /** Stand-ins for pasted images; only the bytes have to survive. */
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02]);

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-img-'));
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    async function noteWithPicture(overrides = {}) {
        return noteStore.create(base, USER, {
            type: 'document',
            path: 'a/Payment Gateway.md',
            title: 'Payment Gateway',
            text: 'see the screenshot',
            images: [{ buffer: PNG, mime: 'image/png', width: 1920, height: 1080 }],
            ...overrides
        });
    }

    test('the picture lands beside the body, under the same stem', async () => {
        await noteWithPicture();

        expect((await fs.readdir(notesPathFor(base, AT_A))).sort())
            .toEqual(['notes.json', 'payment-gateway.png', 'payment-gateway.txt']);
    });

    test('the bytes survive the round trip exactly', async () => {
        const note = await noteWithPicture();
        const found = await noteStore.readImage(base, USER, note, note.id, note.images[0].id);

        expect(found.buffer.equals(PNG)).toBe(true);
        expect(found.mime).toBe('image/png');
    });

    test('the measured size is carried, so the panel can reserve the space', async () => {
        const note = await noteWithPicture();
        expect(note.images[0]).toMatchObject({
            mime: 'image/png', width: 1920, height: 1080, size: PNG.length
        });
        expect(note.images[0].id).toBeTruthy();
    });

    test('the on-disk file name never reaches the caller', async () => {
        const note = await noteWithPicture();
        expect(note.images[0].file).toBeUndefined();
        expect(JSON.stringify(note)).not.toContain('payment-gateway.png');
    });

    test('a note holds SEVERAL pictures, each with its own id', async () => {
        // The difference from audio: adding never replaces.
        let note = await noteWithPicture();
        note = await noteStore.addImage(base, USER, note, note.id, { buffer: JPEG, mime: 'image/jpeg' });

        expect(note.images).toHaveLength(2);
        expect(note.images[0].id).not.toBe(note.images[1].id);
        expect((await fs.readdir(notesPathFor(base, AT_A))).sort()).toEqual([
            'notes.json', 'payment-gateway.jpg', 'payment-gateway.png', 'payment-gateway.txt'
        ]);
    });

    test('pictures keep the order they were pasted in', async () => {
        let note = await noteWithPicture();
        const first = note.images[0].id;
        note = await noteStore.addImage(base, USER, note, note.id, { buffer: JPEG, mime: 'image/jpeg' });

        expect(note.images.map(i => i.id)[0]).toBe(first);
        expect(note.images[1].mime).toBe('image/jpeg');
    });

    test('a picture can be pasted into a note that was typed first', async () => {
        const note = await noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B', text: 'typed first'
        });
        expect(note.images).toEqual([]);

        const withPicture = await noteStore.addImage(base, USER, note, note.id, {
            buffer: PNG, mime: 'image/png'
        });
        expect(withPicture.images).toHaveLength(1);
        expect(withPicture.text).toBe('typed first');
    });

    test('a note fills up rather than growing without limit', async () => {
        let note = await noteWithPicture();
        while (note.images.length < noteStore.MAX_IMAGES_PER_NOTE) {
            note = await noteStore.addImage(base, USER, note, note.id, { buffer: PNG, mime: 'image/png' });
        }

        // Refused, and named as such — the panel shows this to the user rather
        // than silently dropping the picture they just pasted.
        await expect(noteStore.addImage(base, USER, note, note.id, { buffer: PNG, mime: 'image/png' }))
            .rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' });
    });

    test('an unsupported picture type is refused rather than guessed at', async () => {
        await expect(noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B', text: '',
            images: [{ buffer: PNG, mime: 'application/pdf' }]
        })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
    });

    test('SVG is refused — it is a document that can carry script', async () => {
        // Deliberately absent from IMAGE_TYPES. A paste is a screenshot or a
        // photo in practice, so this costs nothing anybody will miss.
        expect(noteStore.imageExtensionFor('image/svg+xml')).toBeNull();
        const existing = await noteWithPicture();
        await expect(noteStore.addImage(base, USER, existing, existing.id, {
            buffer: Buffer.from('<svg onload="alert(1)"/>'), mime: 'image/svg+xml'
        })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
    });

    test('removing one picture keeps the note, its words and the others', async () => {
        let note = await noteWithPicture();
        note = await noteStore.addImage(base, USER, note, note.id, { buffer: JPEG, mime: 'image/jpeg' });
        const [first, second] = note.images;

        const after = await noteStore.removeImage(base, USER, note, note.id, first.id);

        expect(after.images.map(i => i.id)).toEqual([second.id]);
        expect(after.text).toBe('see the screenshot');
        await expect(fs.access(notesPathFor(base, AT_A, 'payment-gateway.png'))).rejects.toThrow();
        await expect(fs.access(notesPathFor(base, AT_A, 'payment-gateway.jpg'))).resolves.toBeUndefined();
    });

    test('removing an unknown picture is a miss, not a wipe', async () => {
        const note = await noteWithPicture();
        await expect(noteStore.removeImage(base, USER, note, note.id, 'inope')).resolves.toBeNull();
        const [still] = await noteStore.listForTarget(base, USER, T('document', 'a/Payment Gateway.md'));
        expect(still.images).toHaveLength(1);
    });

    test('deleting the note takes every picture with it', async () => {
        let note = await noteWithPicture();
        note = await noteStore.addImage(base, USER, note, note.id, { buffer: JPEG, mime: 'image/jpeg' });
        await noteStore.remove(base, USER, note, note.id);

        expect(await fs.readdir(notesPathFor(base, AT_A))).toEqual(['notes.json']);
    });

    test('a note can carry a recording AND pictures at once', async () => {
        const note = await noteStore.create(base, USER, {
            type: 'document', path: 'a/b.md', title: 'B', text: 'both',
            audio: { buffer: Buffer.from([1, 2, 3]), mime: 'audio/webm', durationMs: 500 },
            images: [{ buffer: PNG, mime: 'image/png' }]
        });

        expect(note.audio.mime).toBe('audio/webm');
        expect(note.images).toHaveLength(1);
        expect((await fs.readdir(notesPathFor(base, AT_A))).sort())
            .toEqual(['b.png', 'b.txt', 'b.webm', 'notes.json']);
    });
});

describe('noteStore — a corrupt or hostile picture entry cannot escape either', () => {
    let base;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-img-evil-'));
        await fs.mkdir(notesPathFor(base, AT_A), { recursive: true });
        await fs.writeFile(notesPathFor(base, AT_A, 'good.txt'), 'the words', 'utf8');
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    async function writeIndex(images) {
        await fs.writeFile(notesPathFor(base, AT_A, 'notes.json'), JSON.stringify([{
            id: 'good', file: 'good.txt', type: 'document', path: 'a/b.md', images
        }]), 'utf8');
    }

    test('a traversing picture name is dropped, and the note survives without it', async () => {
        await writeIndex([{ id: 'i1', file: '../../../../../../etc/passwd', mime: 'image/png' }]);

        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.text).toBe('the words');
        expect(note.images).toEqual([]);
        await expect(noteStore.readImage(base, USER, T('document', 'a/b.md'), 'good', 'i1')).resolves.toBeNull();
    });

    test('an extension outside the allow-list is dropped', async () => {
        await writeIndex([{ id: 'i1', file: 'payload.svg', mime: 'image/png' }]);
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images).toEqual([]);
    });

    test('a picture entry with no id is dropped — it could never be addressed', async () => {
        await writeIndex([{ file: 'good.png', mime: 'image/png' }]);
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images).toEqual([]);
    });

    test('a traversal that survives the extension check is still confined', async () => {
        // `../escape.png` reduces to `escape.png` — path.basename runs BEFORE
        // the allow-list, so a name that traverses is neutralised rather than
        // rejected (the .txt rule has always worked this way). The entry stays,
        // but it can only ever name a file inside the notes folder, so the
        // planted file one level up must not be reachable through it.
        // One level up from the notes folder — which is now inside folder 'a',
        // not at the content root.
        await fs.writeFile(path.join(notesPathFor(base, AT_A), '..', 'escape.png'),
            'planted, outside the notes folder', 'utf8');
        await writeIndex([
            { id: 'evil', file: '../escape.png', mime: 'image/png' },
            { id: 'i2', file: 'good.png', mime: 'image/png' }
        ]);

        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images.map(i => i.id)).toEqual(['evil', 'i2']);

        // Nothing on disk at notes/escape.png, and the planted file is NOT it.
        await expect(noteStore.readImage(base, USER, T('document', 'a/b.md'), 'good', 'evil')).resolves.toBeNull();
    });

    test('a made-up media type is not served back as itself', async () => {
        await writeIndex([{ id: 'i1', file: 'good.png', mime: 'text/html' }]);
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images[0].mime).toBe('application/octet-stream');
    });

    test('nonsense dimensions are dropped rather than shown', async () => {
        await writeIndex([{ id: 'i1', file: 'good.png', mime: 'image/png', width: 'huge', height: -4 }]);
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images[0].width).toBeNull();
        expect(note.images[0].height).toBeNull();
    });

    test('an index claiming more pictures than the cap is trimmed to it', async () => {
        await writeIndex(Array.from({ length: 40 }, (unused, n) => ({
            id: `i${n}`, file: 'good.png', mime: 'image/png'
        })));
        const [note] = await noteStore.listForTarget(base, USER, T('document', 'a/b.md'));
        expect(note.images).toHaveLength(noteStore.MAX_IMAGES_PER_NOTE);
    });
});

describe('recording limits — the client stops before the server refuses', () => {
    /**
     * These two numbers live in different files and different runtimes, and the
     * ORDER between them is the whole safety property of a long recording:
     *
     *   client MAX_RECORD_BYTES  <  server MAX_AUDIO_BYTES
     *
     * The recorder watches its own size and stops itself at the first, where
     * everything captured so far is still saved. The second is multer's upload
     * limit. Invert them — by trimming the server number, or by letting the
     * client run further — and the failure moves to AFTER the upload, as a 413
     * at the end of a two-hour recording, with nothing kept. Nothing else in
     * the build compares them, so this does.
     */
    // `fs` at the top of this file is fs.promises; this needs the sync API.
    const controller = require('node:fs').readFileSync(
        path.join(__dirname, '../../../src/web/wiki/public/js/modules/notesController.js'),
        'utf8'
    );

    /** Read a `const NAME = <arithmetic>;` out of the controller source. */
    function constantOf(name) {
        const match = new RegExp(`const ${name} = ([0-9*\\s]+);`).exec(controller);
        if (!match) throw new Error(`${name} is no longer declared in notesController.js`);
        return match[1].split('*').reduce((total, part) => total * Number(part.trim()), 1);
    }

    test('the client stops recording below the server upload limit', () => {
        expect(constantOf('MAX_RECORD_BYTES')).toBeLessThan(noteStore.MAX_AUDIO_BYTES);
    });

    test('the prompt interval fits inside the size the client allows', () => {
        // At 32 kbps a recording grows ~0.24 MB per minute. One prompt interval
        // must fit comfortably, or the size guard would stop the recording
        // before the user is ever asked whether to continue — which would look
        // like the prompt being broken rather than a limit being reached.
        const bytesPerMs = constantOf('AUDIO_BITS_PER_SECOND') / 8 / 1000;
        const promptBytes = constantOf('RECORD_PROMPT_MS') * bytesPerMs;

        expect(promptBytes).toBeLessThan(constantOf('MAX_RECORD_BYTES') / 2);
    });
});

describe('noteStore — notes are stored with the content they are about', () => {
    let base;

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-local-'));
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    test('the folder is derived from the target, not supplied by a caller', () => {
        // A document's notes sit beside it; a folder's sit inside it, the same
        // way its _folder.md context roll-up does; the root's stay at the root.
        expect(noteStore.folderFor(T('document', 'Sell/SAP/Diagram.md'))).toBe('Sell/SAP');
        expect(noteStore.folderFor(T('folder', 'Sell/SAP'))).toBe('Sell/SAP');
        expect(noteStore.folderFor(T('document', 'Top.md'))).toBe('');
        expect(noteStore.folderFor(T('folder', ''))).toBe('');
    });

    test('a note lands beside its document, not at the content root', async () => {
        const target = T('document', 'Sell/SAP Commerce/Diagram.md');
        await noteStore.create(base, USER, { ...target, title: 'Diagram.md', text: 'beside it' });

        const beside = path.join(base, 'Sell', 'SAP Commerce',
            '.system', 'useractivity', 'srbooysen', 'notes');
        expect((await fs.readdir(beside)).sort()).toEqual(['diagram.txt', 'notes.json']);

        // And nothing was written to the old space-root location.
        await expect(fs.access(path.join(base, '.system'))).rejects.toThrow();
    });

    test('attachments land in the same folder as the note they belong to', async () => {
        const target = T('document', 'Sell/SAP Commerce/Diagram.md');
        const note = await noteStore.create(base, USER, {
            ...target, title: 'Diagram.md', text: '',
            audio: { buffer: Buffer.from([1, 2, 3]), mime: 'audio/webm' },
            images: [{ buffer: Buffer.from([4, 5, 6]), mime: 'image/png' }]
        });

        const beside = path.join(base, 'Sell', 'SAP Commerce',
            '.system', 'useractivity', 'srbooysen', 'notes');
        expect((await fs.readdir(beside)).sort())
            .toEqual(['diagram.png', 'diagram.txt', 'diagram.webm', 'notes.json']);
        expect(note.audio).toBeTruthy();
        expect(note.images).toHaveLength(1);
    });

    test('two folders keep separate indexes, so identical names never collide', async () => {
        // The same document name in two places used to share one index and get
        // a `-2` suffix; now each folder owns its own.
        await noteStore.create(base, USER, {
            ...T('document', 'Sell/Diagram.md'), title: 'Diagram.md', text: 'in Sell'
        });
        await noteStore.create(base, USER, {
            ...T('document', 'Buy/Diagram.md'), title: 'Diagram.md', text: 'in Buy'
        });

        const sell = path.join(base, 'Sell', '.system', 'useractivity', 'srbooysen', 'notes');
        const buy = path.join(base, 'Buy', '.system', 'useractivity', 'srbooysen', 'notes');
        expect(await fs.readFile(path.join(sell, 'diagram.txt'), 'utf8')).toBe('in Sell');
        expect(await fs.readFile(path.join(buy, 'diagram.txt'), 'utf8')).toBe('in Buy');
    });

    test('a note about a folder is stored inside that folder', async () => {
        const target = T('folder', 'Sell/SAP Commerce');
        await noteStore.create(base, USER, { ...target, title: 'SAP Commerce', text: 'about it' });

        const inside = path.join(base, 'Sell', 'SAP Commerce',
            '.system', 'useractivity', 'srbooysen', 'notes', 'sap-commerce.txt');
        await expect(fs.readFile(inside, 'utf8')).resolves.toBe('about it');
    });
});

describe('noteStore — concurrent writers cannot lose each other\'s changes', () => {
    let base;
    const TARGET = T('document', 'Sell/Diagram.md');

    beforeEach(async () => {
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'notestore-race-'));
    });

    afterEach(async () => {
        await fs.rm(base, { recursive: true, force: true });
    });

    /** Files in the note folder that no index record points at. */
    async function orphansIn(dir) {
        const index = JSON.parse(await fs.readFile(path.join(dir, 'notes.json'), 'utf8'));
        const referenced = new Set(['notes.json']);
        index.forEach(record => {
            referenced.add(record.file);
            if (record.audio) referenced.add(record.audio.file);
            (record.images || []).forEach(image => referenced.add(image.file));
        });
        return (await fs.readdir(dir)).filter(file => !referenced.has(file));
    }

    test('a text save and a picture upload starting together both survive', async () => {
        // THE BUG THIS EXISTS FOR. Every mutation is a read-modify-write of the
        // whole index. Unserialised, the second reads before the first writes
        // and then overwrites it — which stranded a real pasted picture on disk
        // with nothing pointing at it. Atomic file writes do not help: they stop
        // a TORN file, not a lost update.
        const note = await noteStore.create(base, USER, {
            ...TARGET, title: 'Diagram.md', text: 'first'
        });

        // Repeated, because ONE pair is not a reliable detector: whether the
        // two interleave badly depends on how their file I/O happens to land,
        // and an unlocked store passes this perhaps half the time. Four rounds
        // makes a regression something the suite catches rather than notices
        // occasionally. (With the lock it is deterministic either way.)
        for (const round of [1, 2, 3, 4]) {
            await Promise.all([
                noteStore.update(base, USER, TARGET, note.id, `typed while pasting ${round}`),
                noteStore.addImage(base, USER, TARGET, note.id, {
                    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, round]), mime: 'image/png'
                })
            ]);
        }

        const [after] = await noteStore.listForTarget(base, USER, TARGET);
        expect(after.text).toBe('typed while pasting 4');
        expect(after.images).toHaveLength(4);

        const dir = path.join(base, 'Sell', '.system', 'useractivity', 'srbooysen', 'notes');
        expect(await orphansIn(dir)).toEqual([]);
    });

    test('a burst of picture uploads keeps every one of them', async () => {
        const note = await noteStore.create(base, USER, { ...TARGET, title: 'Diagram.md', text: '' });

        await Promise.all([1, 2, 3, 4, 5].map(n => noteStore.addImage(base, USER, TARGET, note.id, {
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, n]), mime: 'image/png'
        })));

        const [after] = await noteStore.listForTarget(base, USER, TARGET);
        expect(after.images).toHaveLength(5);

        const dir = path.join(base, 'Sell', '.system', 'useractivity', 'srbooysen', 'notes');
        expect(await orphansIn(dir)).toEqual([]);
    });

    test('two notes created at once both reach the index', async () => {
        await Promise.all([
            noteStore.create(base, USER, { ...TARGET, title: 'Diagram.md', text: 'one' }),
            noteStore.create(base, USER, { ...TARGET, title: 'Diagram.md', text: 'two' })
        ]);

        const notes = await noteStore.listForTarget(base, USER, TARGET);
        expect(notes.map(n => n.text).sort()).toEqual(['one', 'two']);
    });

    test('a failing write does not wedge the queue behind it', async () => {
        // The lock chains on settle, not on success — otherwise one rejected
        // mutation would leave every later note operation waiting forever.
        const note = await noteStore.create(base, USER, { ...TARGET, title: 'Diagram.md', text: 'x' });

        await expect(noteStore.addImage(base, USER, TARGET, note.id, {
            buffer: Buffer.from([1]), mime: 'application/x-msdownload'
        })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });

        await expect(noteStore.update(base, USER, TARGET, note.id, 'still works'))
            .resolves.toMatchObject({ text: 'still works' });
    });
});
