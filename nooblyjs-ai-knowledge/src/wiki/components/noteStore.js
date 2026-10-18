/**
 * @fileoverview Per-user notes about a piece of content.
 *
 * A note is a free-text jotting a user keeps against a document or a folder.
 * NOTES ARE CONTENT: they are stored in the SAME FOLDER as the thing they are
 * about, so they are versioned, cloned and reviewed with it.
 *
 *   <content root>/<folder of the noted thing>/.system/useractivity/<prefix>/notes/
 *       <content-title>.txt      the note BODY, and nothing else
 *       <content-title>-2.txt    second note about the same content
 *       <content-title>.webm     the VOICE recording, when the note has one
 *       <content-title>.png      a PICTURE pasted into the note (and -2, -3…)
 *       notes.json               the index for THIS folder's notes
 *
 * FOLDER-LOCAL, NOT SPACE-ROOT. This matches every other per-document artifact
 * (`.system/derived`, `.system/context`, `file-order.json`) and for the same
 * reason: the content roots are directories of symlinked git repositories, so
 * an artifact kept inside the folder it describes is committed and cloned with
 * that repository, while one kept in a space-root namespace is stranded outside
 * it. A note about a document is a note about that repository's content, and
 * travels with it. Note the consequence, which is deliberate: notes reach
 * everyone who clones the repository.
 *
 * THE FOLDER IS DERIVED FROM THE TARGET, never sent by a client — `folderFor`
 * is the single place that decides. A note about a DOCUMENT lands in the
 * document's own folder; a note about a FOLDER lands inside that folder, the
 * same way its `_folder.md` context roll-up does. A note about the space root
 * lands at the root, which is where every note used to live.
 *
 * A CONSEQUENCE FOR CALLERS: an index is per folder, so a note id ALONE no
 * longer says which index holds it, and scanning for one would be the
 * exhaustive tree walk the lazy folder tree exists to avoid. Every function
 * below therefore takes the `target` ({ type, path }) the caller already had in
 * hand — the same rule the Continuous Exploration routes follow for templates.
 *
 * WHY A SEPARATE .txt PER NOTE PLUS AN INDEX. The body lives in a plain text
 * file so it stays readable, greppable and editable outside the app — which is
 * the whole point of keeping notes as files rather than rows. But a file name
 * cannot carry the association reliably: two documents in different folders
 * share a title, a note has no title of its own, and a title can be re-slugged
 * differently tomorrow. `notes.json` therefore owns the mapping (id → file,
 * target type/path, timestamps) and the .txt owns the words. The index is the
 * only thing that names a file; a client never does, which is also what keeps a
 * crafted id from escaping the notes folder.
 *
 * A VOICE NOTE IS A NOTE WITH A RECORDING ATTACHED, not a second kind of note.
 * The audio sits beside the body under the same stem, so the pair travels
 * together and the folder stays browsable - a recording is a file you can
 * double-click. The `.txt` keeps its job of holding words: a caption typed
 * beside the recording today, a transcript later. Everything else - counting,
 * listing, visibility, deletion - is untouched by the attachment, which is the
 * point of modelling it this way rather than as a parallel artefact.
 *
 * PICTURES WORK THE SAME WAY, with one difference: a note has at most one
 * recording (re-recording replaces it) but any number of pictures, so they are
 * an ARRAY and each carries its own id. What they do NOT do is go into the
 * `.txt` as markdown. The body is plain text on purpose - no markup to parse,
 * nothing to corrupt, editable in Notepad - and turning it into a document
 * format so an image could be referenced from inside it would trade that away
 * for an inline position nobody asked for. Pictures are attachments, listed
 * under the words, in the order they were pasted.
 *
 * LIKE PINS, A NOTE BELONGS TO A PATH — NOT TO A SPACE. Several spaces are
 * views of one content root (see components/userArtifacts.js for the full
 * story), so records carry no `spaceName` stamp: a note follows the user into
 * every view that can see the target, and renaming a space breaks nothing.
 * Scoping is the real visibility matcher, applied by the route.
 *
 * Everything here lives under `.system`, which the file watcher ignores — so
 * writing a note never triggers a re-index or an AI context rebuild.
 *
 * EVERY WRITER TAKES A LOCK ON ITS INDEX (`withIndexLock`). Each mutation is a
 * read-modify-write of the whole index, and two of them interleaving silently
 * drops one side's change: the second reads before the first writes, then
 * overwrites it. That is not hypothetical — it stranded a pasted picture on
 * disk with nothing in the index pointing at it, because a text autosave and an
 * image upload overlapped. Atomic file writes do not help; they prevent a TORN
 * file, not a lost update.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-04
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const userStore = require('./userStore');

/** Sub-folder of the user's activity folder holding the note files. */
const NOTES_DIR = 'notes';

/** Index file, stored alongside the notes it describes. */
const INDEX_FILE = 'notes.json';

/** Longest slug taken from a content title, before any numeric suffix. */
const MAX_SLUG_LENGTH = 60;

/** Upper bound on a single note's body. Generous; stops a runaway paste. */
const MAX_TEXT_LENGTH = 20000;

/** A note file name we are willing to touch: a bare `*.txt`, no separators. */
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*\.txt$/i;

/**
 * Container to use for each recording MIME type a browser can produce.
 *
 * This is an ALLOW-LIST, and deliberately not "whatever extension the client
 * sent": the file name it produces is the one thing here that reaches the
 * filesystem, so the set of names we can ever write is fixed in this table.
 * MediaRecorder emits webm/opus on Chromium and Firefox and mp4/aac on Safari,
 * hence both; the rest are here so a file dropped into the notes folder by
 * hand can still be adopted by the index.
 */
const AUDIO_TYPES = {
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav'
};

/** The extensions AUDIO_TYPES can produce, de-duplicated. */
const AUDIO_EXTENSIONS = Array.from(new Set(Object.values(AUDIO_TYPES)));

/**
 * An audio file name we are willing to touch. SAFE_FILE above is what stops a
 * hand-edited index pointing us at `../../../etc/passwd`; widening it to "any
 * extension" for the sake of recordings would have thrown that away, so
 * recordings get their own, equally narrow, rule instead.
 */
const SAFE_AUDIO_FILE = new RegExp(
    '^[a-z0-9][a-z0-9._-]*(' + AUDIO_EXTENSIONS.map(e => '\\' + e).join('|') + ')$', 'i'
);

/**
 * Upper bound on one recording: about two hours of speech.
 *
 * The client records opus at 32 kbps (`AUDIO_BITS_PER_SECOND` in
 * notesController.js), so a recording grows at roughly 0.24 MB per minute and
 * this is reached at around 130 minutes. It is deliberately ABOVE the client's
 * own `MAX_RECORD_BYTES` (30 MB): the recorder stops itself first, where what
 * has been captured can still be saved, so this limit should only ever be hit
 * by something that did not come from the panel. Reaching it as a 413 after
 * two hours of talking would mean losing all of it.
 *
 * THIS is the ceiling an upload has to clear — not the 10 MB in app.js. That
 * limit belongs to `bodyParser.json`/`urlencoded`, which never see a multipart
 * request: multer parses those and enforces its own limit, set from here in
 * notesRoutes. Note that multer buffers the upload in MEMORY, so this number is
 * also the most one request can hold.
 */
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/**
 * Picture formats we will store, and what to call them on disk. Same allow-list
 * reasoning as AUDIO_TYPES: this table is the complete set of names that can
 * ever be written.
 *
 * SVG IS DELIBERATELY ABSENT. It is the one image format that is really a
 * document — it can carry script, and while an <img> tag will not run it, a
 * reader who opens the attachment URL in its own tab is on a page served from
 * this origin. A clipboard paste is a screenshot or a photo in practice, so
 * excluding SVG costs nothing anybody will miss.
 */
const IMAGE_TYPES = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/bmp': '.bmp'
};

/** The extensions IMAGE_TYPES can produce, de-duplicated. */
const IMAGE_EXTENSIONS = Array.from(new Set(Object.values(IMAGE_TYPES)));

/** A picture file name we are willing to touch. See SAFE_AUDIO_FILE. */
const SAFE_IMAGE_FILE = new RegExp(
    '^[a-z0-9][a-z0-9._-]*(' + IMAGE_EXTENSIONS.map(e => '\\' + e).join('|') + ')$', 'i'
);

/** Upper bound on one picture. A full-screen 4K PNG screenshot fits. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * How many pictures one note may hold. A note is a jotting, not an album, and
 * the panel renders every picture it is given — an unbounded list is a way to
 * make the notes panel unusable by accident.
 */
const MAX_IMAGES_PER_NOTE = 12;

/** Relative path (inside the user's activity folder) of the index. */
function indexRelPath() {
    return `${NOTES_DIR}/${INDEX_FILE}`;
}

/** Relative path (inside the user's activity folder) of one note file. */
function noteRelPath(file) {
    return `${NOTES_DIR}/${file}`;
}

/** Absolute path of the user's notes folder inside `baseDir`. */
function notesDir(baseDir, identity) {
    return userStore.userPath(baseDir, identity, NOTES_DIR);
}

/**
 * The folder whose notes directory holds notes about `target`.
 *
 *   document  a/b/X.md  ->  a/b        (beside the document)
 *   folder    a/b       ->  a/b        (inside the folder, like its _folder.md)
 *   root      ''        ->  ''         (the content root itself)
 *
 * The single place that decision is made. A client never supplies it: it is
 * derived from the target, so a note cannot be filed anywhere the target is
 * not, whatever a request body claims.
 */
function folderFor(target) {
    const targetPath = normalisePath(target && target.path);
    if (normaliseType(target && target.type) === 'folder') return targetPath;
    const cut = targetPath.lastIndexOf('/');
    return cut === -1 ? '' : targetPath.slice(0, cut);
}

/**
 * The base directory to hang `.system/useractivity/…` off for `target`.
 *
 * userStore joins ROOT onto whatever base it is given, so scoping notes to a
 * folder is simply giving it a deeper base — no change to userStore, and the
 * per-user layout stays defined in exactly one place.
 */
function baseFor(baseDir, target) {
    const folder = folderFor(target);
    return folder ? path.join(baseDir, folder) : baseDir;
}

/**
 * Index mutations still in flight, keyed by the index's absolute path. One
 * entry per FOLDER per user, so notes in different folders never wait on each
 * other — the lock is as narrow as the file it protects.
 */
const indexQueues = new Map();

/**
 * Run `fn` with exclusive access to one folder's index.
 *
 * Serialises read-modify-write cycles so a concurrent writer cannot read a
 * stale index and then overwrite the other's change — the lost update
 * described at the top of this file. In-process only, which is the right scope:
 * one Node process owns this directory, and a second one editing the same
 * user's notes concurrently is not a situation this app creates.
 *
 * The chain continues whether `fn` settles or throws (a failed write must not
 * wedge every later one), and the key is dropped once the queue drains so the
 * map does not grow with every folder ever touched.
 */
function withIndexLock(base, identity, fn) {
    const key = userStore.userPath(base, identity, indexRelPath());
    const previous = indexQueues.get(key) || Promise.resolve();

    const run = previous.then(fn, fn);
    const settled = run.catch(() => {});
    indexQueues.set(key, settled);
    settled.then(() => {
        if (indexQueues.get(key) === settled) indexQueues.delete(key);
    });

    return run;
}

/**
 * Canonical form of a target path: POSIX separators, no leading or trailing
 * slash. The space root arrives as '', '/' or '\' depending on the caller and
 * must collapse to one key, or the same content ends up with two note lists.
 *
 * SECURITY: this is the single choke point that turns a client-supplied target
 * path into the FOLDER a note is filed in (`folderFor` -> `baseFor` ->
 * `path.join`). A raw value can therefore contain `..` segments that would walk
 * the join out of the content root and let a note be written or read anywhere
 * the process can reach — a path traversal. Segments are split and any that are
 * empty, `.` or `..` are dropped, so the result is always a path RELATIVE to and
 * CONTAINED WITHIN the content root, whatever the request body claims. Drive
 * letters and UNC prefixes cannot survive this either: their separators are
 * normalised and the `:`-bearing or empty segments do not join into an absolute
 * path once `..`/`.` are gone.
 */
function normalisePath(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '/')
        .split('/')
        .filter(segment => segment && segment !== '.' && segment !== '..')
        .join('/');
}

/** Only two kinds of thing carry notes; anything else is treated as a document. */
function normaliseType(value) {
    return String(value || '').toLowerCase() === 'folder' ? 'folder' : 'document';
}

/** Identity of the content a note is about. Mirrors userArtifacts.recordKey. */
function targetKey(type, targetPath) {
    return `${normaliseType(type)}::${normalisePath(targetPath)}`;
}

/**
 * Filesystem-safe stem for a note file, taken from the content's title (or the
 * last segment of its path). Empty input — a note on the space root, say —
 * falls back to 'note' so a name is always produced.
 */
function slugify(value) {
    const slug = String(value == null ? '' : value)
        .toLowerCase()
        .replace(/\.[a-z0-9]{1,8}$/i, '')     // drop a file extension
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/, '');
    return slug || 'note';
}

/**
 * Short, sortable, collision-resistant id. Notes get `n`, attachments `i` —
 * the prefix is cosmetic, but it makes a mis-routed id obvious in a log line.
 */
function newId(prefix = 'n') {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip any codec parameters: `audio/webm;codecs=opus` -> `audio/webm`. */
function baseMime(value) {
    return String(value == null ? '' : value).split(';')[0].trim().toLowerCase();
}

/** The extension we store a given recording MIME under, or null if unsupported. */
function audioExtensionFor(mime) {
    return AUDIO_TYPES[baseMime(mime)] || null;
}

/**
 * Coerce an index record's `audio` block, or return null when there isn't a
 * usable one. A record whose file name fails SAFE_AUDIO_FILE loses its audio
 * rather than the whole note: the words are still worth showing.
 *
 * `durationMs` is carried rather than derived because MediaRecorder writes a
 * streaming webm header with no duration in it - an `<audio>` element reports
 * `Infinity` for exactly these files. The browser times its own recording and
 * tells us; that number is the only reliable one anybody has.
 */
function normaliseAudio(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const file = path.basename(String(raw.file || '').trim());
    if (!SAFE_AUDIO_FILE.test(file)) return null;

    const mime = baseMime(raw.mime);
    const duration = Number(raw.durationMs);
    const size = Number(raw.size);
    return {
        file,
        mime: AUDIO_TYPES[mime] ? mime : 'application/octet-stream',
        durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        size: Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
        recordedAt: raw.recordedAt || null
    };
}

/** The extension we store a given picture MIME under, or null if unsupported. */
function imageExtensionFor(mime) {
    return IMAGE_TYPES[baseMime(mime)] || null;
}

/** A positive integer, or null. Used for pixel dimensions the client measured. */
function positiveInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Coerce one picture entry, or null when it is not usable. As with audio, a
 * bad entry costs the note that picture and nothing else.
 *
 * `width`/`height` are what the browser measured before uploading. They are
 * carried so the panel can reserve the right space before the bytes arrive —
 * without them every pasted picture snaps the list around as it loads.
 */
function normaliseImage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const file = path.basename(String(raw.file || '').trim());
    if (!SAFE_IMAGE_FILE.test(file)) return null;

    const id = String(raw.id || '').trim();
    if (!id) return null;

    const mime = baseMime(raw.mime);
    const size = Number(raw.size);
    return {
        id,
        file,
        mime: IMAGE_TYPES[mime] ? mime : 'application/octet-stream',
        width: positiveInt(raw.width),
        height: positiveInt(raw.height),
        size: Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
        addedAt: raw.addedAt || null
    };
}

/** Every usable picture on a record, in the order they were added. */
function normaliseImages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normaliseImage)
        .filter(Boolean)
        .slice(0, MAX_IMAGES_PER_NOTE);
}

/**
 * Coerce whatever is in notes.json into records we are prepared to act on.
 * A hand-edited or partly-corrupt index must not be able to point us at a file
 * outside the notes folder, so the file name is validated here — the one place
 * every read passes through.
 */
function normaliseIndex(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(record => record && typeof record === 'object')
        .map(record => ({
            id: String(record.id || '').trim(),
            file: path.basename(String(record.file || '').trim()),
            type: normaliseType(record.type),
            path: normalisePath(record.path),
            title: String(record.title || ''),
            createdAt: record.createdAt || record.updatedAt || null,
            updatedAt: record.updatedAt || record.createdAt || null,
            audio: normaliseAudio(record.audio),
            images: normaliseImages(record.images)
        }))
        .filter(record => record.id && SAFE_FILE.test(record.file));
}

/**
 * The shape the API hands back. The on-disk file name stays server-side - for
 * the recording as much as for the body, so a client can only ever ask for
 * "this note's audio" by id and never name a file. Everything a player needs
 * in order to render before it has fetched a byte (how long, how big, what
 * kind) comes across; the bytes come from GET /notes/:id/audio.
 */
function publicShape(record, text) {
    return {
        id: record.id,
        type: record.type,
        path: record.path,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        text: text == null ? '' : text,
        audio: record.audio
            ? {
                mime: record.audio.mime,
                durationMs: record.audio.durationMs,
                size: record.audio.size,
                recordedAt: record.audio.recordedAt
            }
            : null,
        images: (record.images || []).map(image => ({
            id: image.id,
            mime: image.mime,
            width: image.width,
            height: image.height,
            size: image.size,
            addedAt: image.addedAt
        }))
    };
}

async function readIndex(baseDir, identity) {
    return normaliseIndex(await userStore.readJson(baseDir, identity, indexRelPath(), []));
}

async function writeIndex(baseDir, identity, records) {
    await userStore.writeJson(baseDir, identity, indexRelPath(), records);
}

async function readNoteText(baseDir, identity, file) {
    return userStore.readText(baseDir, identity, noteRelPath(file), '');
}

/**
 * A note file name not already taken — by the index or by anything sitting in
 * the notes folder. Disk is consulted too because the folder is meant to be
 * hand-editable: a file dropped in there by a user must not be overwritten
 * just because the index has never heard of it.
 *
 * @param {Set<string>} taken lower-cased names already in use
 * @param {string} stem slugified content title
 * @param {string} [ext='.txt'] extension to give the file, dot included
 * @return {string} e.g. `distribution.txt`, `distribution-2.txt`
 */
function uniqueFileName(taken, stem, ext = '.txt') {
    let candidate = `${stem}${ext}`;
    let counter = 2;
    while (taken.has(candidate.toLowerCase())) {
        candidate = `${stem}-${counter}${ext}`;
        counter += 1;
    }
    return candidate;
}

/** The stem of a note's body file: `distribution-2.txt` -> `...-2`. */
function stemOf(file) {
    return String(file || '').replace(/\.[^.]+$/, '') || 'note';
}

/** Every name already in use in the notes folder, lower-cased. */
async function takenNames(baseDir, identity, index) {
    const names = new Set(index.map(record => record.file.toLowerCase()));
    index.forEach(record => {
        if (record.audio) names.add(record.audio.file.toLowerCase());
        (record.images || []).forEach(image => names.add(image.file.toLowerCase()));
    });
    names.add(INDEX_FILE.toLowerCase());
    try {
        const entries = await fs.readdir(notesDir(baseDir, identity));
        entries.forEach(entry => names.add(String(entry).toLowerCase()));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    return names;
}

/** Clamp a body to MAX_TEXT_LENGTH. Callers validate length before saving. */
function clampText(text) {
    return String(text == null ? '' : text).slice(0, MAX_TEXT_LENGTH);
}

/**
 * The index for the folder that holds notes about `target` — records only, no
 * bodies read. Use this for counts; use `listForTarget` to show them.
 *
 * Scoped to one folder rather than a whole content root, which is what makes a
 * per-document count one small read instead of a tree walk.
 */
async function listIndex(baseDir, identity, target) {
    return readIndex(baseFor(baseDir, target), identity);
}

/**
 * The user's notes about one piece of content, bodies included, newest edit
 * first. Sorting server-side keeps the panel's order stable while a note is
 * being typed into — the client renders once and does not re-sort on save.
 */
async function listForTarget(baseDir, identity, target) {
    const base = baseFor(baseDir, target);
    const index = await readIndex(base, identity);
    const key = targetKey(target && target.type, target && target.path);
    const matches = index
        .filter(record => targetKey(record.type, record.path) === key)
        .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));

    return Promise.all(matches.map(async record => (
        publicShape(record, await readNoteText(base, identity, record.file))
    )));
}

/**
 * Create a note about a piece of content.
 *
 * A recording may be supplied at creation time, which is what a voice note
 * does: recording then attaching as two requests can leave a wordless, audio-
 * less note behind when the second one fails, and that is indistinguishable
 * from an empty note the user made by accident.
 *
 * @param {string} baseDir content root
 * @param {string} identity user email (or 'anonymous')
 * @param {Object} target { type, path, title, text, audio, images }
 * @param {Object} [target.audio] { buffer, mime, durationMs }
 * @param {Array}  [target.images] [{ buffer, mime, width, height }]
 * @return {Promise<Object>} the created note, in public shape
 */
async function create(baseDir, identity, target) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => createLocked(base, identity, target));
}

async function createLocked(baseDir, identity, target) {
    const index = await readIndex(baseDir, identity);
    const type = normaliseType(target.type);
    const targetPath = normalisePath(target.path);
    const title = String(target.title || targetPath.split('/').pop() || '').trim();
    const text = clampText(target.text);

    const taken = await takenNames(baseDir, identity, index);
    const stem = slugify(title || targetPath.split('/').pop());
    const file = uniqueFileName(taken, stem);
    taken.add(file.toLowerCase());

    const now = new Date().toISOString();
    const record = {
        id: newId(),
        file,
        type,
        path: targetPath,
        title,
        createdAt: now,
        updatedAt: now,
        audio: null,
        images: []
    };

    // Body first: an index entry pointing at a file that was never written
    // reads as a note whose text silently vanished.
    await userStore.writeText(baseDir, identity, noteRelPath(file), text);

    // Then the recording, under the SAME stem, so the pair is obvious in a
    // directory listing. Written before the index for the same reason as the
    // body: nothing is indexed until it exists on disk.
    if (target.audio && target.audio.buffer) {
        record.audio = await writeAudioFile(baseDir, identity, taken, stem, target.audio);
    }

    // Pictures, in the order given. Written one at a time rather than in
    // parallel because each one claims its name from `taken`, and two writers
    // racing for the same stem would both be told it was free.
    for (const image of (target.images || []).slice(0, MAX_IMAGES_PER_NOTE)) {
        if (!image || !image.buffer) continue;
        record.images.push(await writeImageFile(baseDir, identity, taken, stem, image));
    }

    index.push(record);
    await writeIndex(baseDir, identity, index);

    return publicShape(record, text);
}

/**
 * Write one recording into the notes folder and describe it for the index.
 * Shared by `create` and `attachAudio` so there is a single place that decides
 * what a recording is called and what we record about it.
 *
 * @param {Set<string>} taken lower-cased names already in use
 * @param {string} stem the stem of the note's body file
 * @param {Object} audio { buffer, mime, durationMs }
 * @return {Promise<Object>} the record's `audio` block
 */
async function writeAudioFile(baseDir, identity, taken, stem, audio) {
    const ext = audioExtensionFor(audio.mime);
    if (!ext) {
        throw Object.assign(new Error(`Unsupported recording type: ${audio.mime}`), {
            code: 'UNSUPPORTED_AUDIO_TYPE'
        });
    }

    const file = await storeAttachmentFile(baseDir, identity, taken, stem, ext, audio.buffer);

    return normaliseAudio({
        file,
        mime: audio.mime,
        durationMs: audio.durationMs,
        size: audio.buffer.length,
        recordedAt: new Date().toISOString()
    });
}

/**
 * Claim a name and write one attachment under it. The single place that
 * decides what a recording or a picture is called, so both end up beside the
 * note's body under its own stem — which is what makes the notes folder
 * readable without the index in front of you.
 *
 * `taken` is updated in place: a caller writing several attachments in a row
 * relies on that to stop the second one claiming the first one's name.
 */
async function storeAttachmentFile(baseDir, identity, taken, stem, ext, buffer) {
    const file = uniqueFileName(taken, stem, ext);
    taken.add(file.toLowerCase());
    await userStore.writeBinary(baseDir, identity, noteRelPath(file), buffer);
    return file;
}

/** Write one picture and describe it for the index. */
async function writeImageFile(baseDir, identity, taken, stem, image) {
    const ext = imageExtensionFor(image.mime);
    if (!ext) {
        throw Object.assign(new Error(`Unsupported picture type: ${image.mime}`), {
            code: 'UNSUPPORTED_IMAGE_TYPE'
        });
    }

    const file = await storeAttachmentFile(baseDir, identity, taken, stem, ext, image.buffer);

    return normaliseImage({
        id: newId('i'),
        file,
        mime: image.mime,
        width: image.width,
        height: image.height,
        size: image.buffer.length,
        addedAt: new Date().toISOString()
    });
}

/** Delete one attachment from disk. A missing file is not an error. */
async function unlinkAttachment(baseDir, identity, file) {
    if (!file) return;
    try {
        await fs.unlink(path.join(notesDir(baseDir, identity), file));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

/** Delete a note's recording from disk. A missing file is not an error. */
async function unlinkAudio(baseDir, identity, record) {
    if (!record || !record.audio) return;
    await unlinkAttachment(baseDir, identity, record.audio.file);
}

/**
 * Attach a recording to an existing note, replacing any recording it already
 * has. Returns null when the id is unknown, which the route turns into a 404.
 *
 * The old file is removed BEFORE the new one is written, so re-recording does
 * not accumulate `-2`, `-3` names for the same note; and the note's own stem
 * is reused, so the recording stays beside its body in a directory listing
 * even when the two were created minutes apart.
 *
 * @param {Object} audio { buffer, mime, durationMs }
 */
async function attachAudio(baseDir, identity, target, id, audio) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => attachAudioLocked(base, identity, id, audio));
}

async function attachAudioLocked(baseDir, identity, id, audio) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    await unlinkAudio(baseDir, identity, record);
    record.audio = null;

    const taken = await takenNames(baseDir, identity, index);
    record.audio = await writeAudioFile(baseDir, identity, taken, stemOf(record.file), audio);
    record.updatedAt = new Date().toISOString();
    await writeIndex(baseDir, identity, index);

    return publicShape(record, await readNoteText(baseDir, identity, record.file));
}

/**
 * The bytes of a note's recording, plus what it is, or null when the note has
 * none (or is unknown). The file name never leaves this module: a caller asks
 * for a note's audio by id, exactly as it asks for its text.
 *
 * @return {Promise<{buffer: Buffer, mime: string, file: string, audio: Object}|null>}
 */
async function readAudio(baseDir, identity, target, id) {
    baseDir = baseFor(baseDir, target);
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record || !record.audio) return null;

    const buffer = await userStore.readBinary(baseDir, identity, noteRelPath(record.audio.file));
    if (!buffer) return null;

    return { buffer, mime: record.audio.mime, file: record.audio.file, audio: record.audio };
}

/**
 * Remove a note's recording, keeping the note and its words. Returns the note
 * in public shape, or null when the id is unknown.
 */
async function removeAudio(baseDir, identity, target, id) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => removeAudioLocked(base, identity, id));
}

async function removeAudioLocked(baseDir, identity, id) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    await unlinkAudio(baseDir, identity, record);
    record.audio = null;
    record.updatedAt = new Date().toISOString();
    await writeIndex(baseDir, identity, index);

    return publicShape(record, await readNoteText(baseDir, identity, record.file));
}

/**
 * Add a picture to an existing note. Returns null when the id is unknown, and
 * throws TOO_MANY_IMAGES once the note is full — a refusal the user can act on
 * beats silently dropping the picture they just pasted.
 *
 * @param {Object} image { buffer, mime, width, height }
 */
async function addImage(baseDir, identity, target, id, image) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => addImageLocked(base, identity, id, image));
}

async function addImageLocked(baseDir, identity, id, image) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    if (record.images.length >= MAX_IMAGES_PER_NOTE) {
        throw Object.assign(
            new Error(`A note can hold ${MAX_IMAGES_PER_NOTE} pictures`),
            { code: 'TOO_MANY_IMAGES' }
        );
    }

    const taken = await takenNames(baseDir, identity, index);
    record.images.push(
        await writeImageFile(baseDir, identity, taken, stemOf(record.file), image)
    );
    record.updatedAt = new Date().toISOString();
    await writeIndex(baseDir, identity, index);

    return publicShape(record, await readNoteText(baseDir, identity, record.file));
}

/**
 * The bytes of one picture. Addressed by NOTE id plus PICTURE id — the file
 * name stays here, exactly as it does for the body and the recording.
 *
 * @return {Promise<{buffer: Buffer, mime: string, file: string, image: Object}|null>}
 */
async function readImage(baseDir, identity, target, id, imageId) {
    baseDir = baseFor(baseDir, target);
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    const image = record.images.find(entry => entry.id === imageId);
    if (!image) return null;

    const buffer = await userStore.readBinary(baseDir, identity, noteRelPath(image.file));
    if (!buffer) return null;

    return { buffer, mime: image.mime, file: image.file, image };
}

/**
 * Remove one picture, keeping the note, its words and its other pictures.
 * Returns the note in public shape, or null when either id is unknown.
 */
async function removeImage(baseDir, identity, target, id, imageId) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => removeImageLocked(base, identity, id, imageId));
}

async function removeImageLocked(baseDir, identity, id, imageId) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    const image = record.images.find(entry => entry.id === imageId);
    if (!image) return null;

    await unlinkAttachment(baseDir, identity, image.file);
    record.images = record.images.filter(entry => entry.id !== imageId);
    record.updatedAt = new Date().toISOString();
    await writeIndex(baseDir, identity, index);

    return publicShape(record, await readNoteText(baseDir, identity, record.file));
}

/**
 * Replace a note's body. Returns null when the id is unknown, which the route
 * turns into a 404 — a note deleted in another tab must not resurrect itself.
 */
async function update(baseDir, identity, target, id, text) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => updateLocked(base, identity, id, text));
}

async function updateLocked(baseDir, identity, id, text) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    const body = clampText(text);
    await userStore.writeText(baseDir, identity, noteRelPath(record.file), body);
    record.updatedAt = new Date().toISOString();
    await writeIndex(baseDir, identity, index);

    return publicShape(record, body);
}

/**
 * Delete a note and its files. Returns the removed record, or null when the id
 * is unknown. A missing file is not an error — the index entry still goes.
 *
 * EVERY file goes — body, recording and pictures. The index is the only record
 * that an attachment belongs to this note, so dropping the entry while leaving
 * a .webm or a .png behind orphans it beyond recovery: nothing else in the
 * folder says what it was of.
 */
async function remove(baseDir, identity, target, id) {
    const base = baseFor(baseDir, target);
    return withIndexLock(base, identity, () => removeLocked(base, identity, id));
}

async function removeLocked(baseDir, identity, id) {
    const index = await readIndex(baseDir, identity);
    const record = index.find(entry => entry.id === id);
    if (!record) return null;

    try {
        await fs.unlink(path.join(notesDir(baseDir, identity), record.file));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    await unlinkAudio(baseDir, identity, record);
    for (const image of record.images) {
        await unlinkAttachment(baseDir, identity, image.file);
    }

    await writeIndex(baseDir, identity, index.filter(entry => entry.id !== id));
    return publicShape(record);
}

module.exports = {
    NOTES_DIR,
    INDEX_FILE,
    MAX_TEXT_LENGTH,
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_NOTE,
    AUDIO_TYPES,
    IMAGE_TYPES,
    notesDir,
    normalisePath,
    normaliseType,
    targetKey,
    folderFor,
    baseFor,
    slugify,
    audioExtensionFor,
    imageExtensionFor,
    listIndex,
    listForTarget,
    create,
    update,
    remove,
    attachAudio,
    readAudio,
    removeAudio,
    addImage,
    readImage,
    removeImage
};
