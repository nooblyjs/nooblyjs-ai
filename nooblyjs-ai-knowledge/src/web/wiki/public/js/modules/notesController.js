/**
 * Notes Controller
 *
 * Private, per-user notes about whatever content is on screen — a markdown
 * document, a folder, or a space home page. Notes are personal: nobody else
 * sees them, and they are never part of the document.
 *
 * Two surfaces:
 *
 *   1. THE CHIP. Any view can render `<button data-notes-toggle>` (with an
 *      optional `[data-notes-count]` badge inside) anywhere it likes — the doc
 *      toolbar, a folder's home card, the space home. One delegated click
 *      handler here drives every one of them and `renderChips()` keeps their
 *      counts in step, so views don't own ids, wiring or state. That is what
 *      lets the same control sit in three quite differently-built views.
 *
 *   2. THE PANEL (`#notesPanel`). A docked right sidebar — a grid child, so
 *      opening it reflows the page instead of covering it. It STAYS OPEN across
 *      navigation until the toggle is clicked again (persisted in
 *      localStorage), and re-targets itself as the user moves around.
 *
 * Editing is autosaving, with no Save button: a debounce per note, flushed on
 * blur, on close, on re-target and on pagehide. Saves are single-flight per
 * note with a queued coalesce, so a fast navigation during a slow save cannot
 * drop keystrokes. A brand-new note is a local DRAFT until it has text — the
 * server only ever hears about notes that say something.
 *
 * VOICE NOTES. A note can carry a recording as well as words, made in the
 * browser with MediaRecorder. A recording IS a note — it goes through the same
 * list, the same count and the same delete — so the panel gains one button and
 * one player row rather than a second kind of thing to reason about.
 *
 * PICTURES. Paste one into a note and it is uploaded as an attachment and shown
 * under the words. Two details worth knowing:
 *
 *   - THE PASTE IS ONLY INTERCEPTED INSIDE THE PANEL. A `paste` listener has to
 *     sit on the document to see the event at all, so it checks where the paste
 *     landed and ignores everything outside `#notesPanel` — otherwise copying
 *     an image into the search box or the document editor would silently file
 *     it as a note instead.
 *   - A PICTURE OVER THE SIZE LIMIT IS SCALED DOWN RATHER THAN REFUSED. A
 *     full-screen 4K screenshot goes past 8 MB often enough that refusing it
 *     would read as "pasting pictures doesn't work"; scaling to fit keeps the
 *     paste working and says so in the status line.
 *
 * Clicking a thumbnail opens it in a dialog that zooms, and the zoom is the
 * PARSER'S — the dialog holds a `.kr-image` canvas, so a picture in a note pans
 * and zooms with the same controls as a picture in a document. See
 * `openImageViewer`.
 *
 * Three constraints shape the code below:
 *
 *   - `getUserMedia` needs a SECURE CONTEXT. Over plain http, or inside an
 *     iframe whose `allow` list has no `microphone`, `navigator.mediaDevices`
 *     is undefined rather than throwing, so `canRecord()` gates every entry
 *     point and the buttons stay hidden where recording cannot work.
 *   - MediaRecorder's container is BROWSER-SPECIFIC (webm/opus on Chromium and
 *     Firefox, mp4/aac on Safari) and its header carries NO DURATION — an
 *     <audio> element reports `Infinity` for these files. So the type is probed
 *     rather than assumed, and the length is timed here and sent along.
 *   - The microphone stays live until its tracks are stopped. Every exit path
 *     goes through `releaseMic()`, or the browser leaves a recording indicator
 *     on the tab long after the note was saved.
 *
 * Backend: /applications/wiki/api/notes (see src/wiki/routes/
 * notesRoutes.js). Storage is one .txt per note under the content root's
 * `.system/useractivity/<prefix>/notes/`.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-04
 */

const API = '/applications/wiki/api/notes';

/** Idle time after the last keystroke before a note is written. */
const AUTOSAVE_MS = 900;

/** Panel open/closed survives reloads — it is a working preference. */
const OPEN_KEY = 'wiki:notesPanelOpen';

/**
 * How long a recording runs before the panel asks whether to keep going.
 *
 * NOT a hard stop: answering "Continue" buys another interval, as many times as
 * the user likes. The point is that a microphone left open in a meeting cannot
 * quietly fill the disk — going past this takes a person saying so. The real
 * ceiling is MAX_RECORD_BYTES below, which is enforced whatever they answer.
 */
const RECORD_PROMPT_MS = 30 * 60 * 1000;

/**
 * How long the prompt waits for an answer before stopping and SAVING.
 *
 * "Didn't answer" is the case this exists for — someone walked away, or the tab
 * is in the background. Stopping is the safe default: what was said so far is
 * kept, and a microphone is never left live on nobody's behalf.
 */
const RECORD_CONFIRM_MS = 60 * 1000;

/**
 * Ask MediaRecorder for a speech-grade bitrate instead of taking its default.
 *
 * This is load-bearing now that recordings can run for half an hour. Left to
 * itself Chrome encodes opus at around 128 kbps — near a megabyte a minute, so
 * thirty minutes would be roughly 29 MB. At 32 kbps, which is ample for a
 * voice note, the same half hour is about 7 MB. It also makes the size roughly
 * PREDICTABLE, which is what lets the limits below mean anything.
 */
const AUDIO_BITS_PER_SECOND = 32000;

/**
 * Emit a chunk every few seconds rather than one blob at the end.
 *
 * Without a timeslice `ondataavailable` fires ONCE, when recording stops — so
 * there is no way to know how large a recording has become until it is too late
 * to do anything about it. With one, `recordedBytes` can watch the real figure.
 */
const RECORD_CHUNK_MS = 5000;

/**
 * Stop recording once the file reaches this, whatever the user has answered.
 *
 * Sits below the server's MAX_AUDIO_BYTES so the stop always happens HERE,
 * where the recording can still be saved — rather than as a 413 after the
 * upload, which would throw away the whole thing. At 32 kbps this is about two
 * hours of speech.
 */
const MAX_RECORD_BYTES = 30 * 1024 * 1024;

/**
 * Containers to offer MediaRecorder, best first. Chromium and Firefox take the
 * first; Safari takes `audio/mp4`. If none is supported we let the browser pick
 * its own default rather than refusing to record.
 */
const RECORD_MIMES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
];

/**
 * Largest picture we will upload, matching noteStore.MAX_IMAGE_BYTES. Anything
 * bigger is scaled to fit rather than refused — see `shrinkImage`.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Longest edge to scale an over-sized picture down to. */
const MAX_IMAGE_EDGE = 2560;

/** Can this browser, in this context, record at all? */
function canRecord() {
    return !!(window.MediaRecorder
        && navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === 'function');
}

/** The best container this browser will actually produce, or '' for its default. */
function pickRecordingMime() {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return RECORD_MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

/**
 * "0:07" / "4:31" / "1:04:22". The hours field appears only when there is one —
 * a recording can now run past an hour, but most never will and "0:04:31" reads
 * as a stopwatch nobody asked for.
 */
function formatDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const seconds = String(total % 60).padStart(2, '0');
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${minutes}:${seconds}`;
}

/**
 * How much of the recording has actually been captured, in ms.
 *
 * Time spent PAUSED at the "keep going?" prompt does not count: the microphone
 * is stopped there, so counting it would report a length the audio does not
 * have — and that number is what the player shows, since the container carries
 * no duration of its own.
 */
function elapsedOf(rec) {
    const pausing = rec.pausedAt ? Date.now() - rec.pausedAt : 0;
    return Math.max(0, Date.now() - rec.startedAt - rec.pausedMs - pausing);
}

/** Bytes captured so far. Needs RECORD_CHUNK_MS to be in play; see above. */
function recordedBytes(rec) {
    return rec.chunks.reduce((total, chunk) => total + (chunk.size || 0), 0);
}

/**
 * Why the microphone was refused, in words a reader can act on. The DOMException
 * names are the same across browsers even though the messages are not.
 */
function micErrorMessage(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'Microphone blocked — allow access in your browser, then try again';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'No microphone found';
    }
    if (name === 'NotReadableError') {
        return 'The microphone is in use by another app';
    }
    return 'Could not start recording';
}

/** Identity of the content a note is about. Mirrors the backend's targetKey. */
function targetKey(target) {
    if (!target) return '';
    const type = target.type === 'folder' ? 'folder' : 'document';
    const path = String(target.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return `${type}::${path}`;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "just now" / "7m ago" / "3h ago" / a date once it stops being recent. */
function relativeTime(iso) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ms)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ms).toLocaleDateString();
}

/**
 * The first image on the clipboard, or null. Reads `items` rather than `files`
 * because a screenshot pasted from the system clipboard arrives as an item of
 * kind 'file' with no entry in `files` on some browsers.
 */
function imageFromClipboard(event) {
    const data = event.clipboardData;
    if (!data) return null;

    const items = Array.from(data.items || []);
    for (const item of items) {
        if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
            const file = item.getAsFile();
            if (file && file.size) return file;
        }
    }

    const files = Array.from(data.files || []);
    return files.find(file => String(file.type || '').startsWith('image/') && file.size) || null;
}

/** `canvas.toBlob` as a promise. Resolves null when the browser cannot encode. */
function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => {
        try {
            canvas.toBlob(resolve, type, quality);
        } catch (err) {
            resolve(null);
        }
    });
}

/** What the picture is, in pixels, or nulls when the browser will not say. */
async function measureImage(blob) {
    try {
        const bitmap = await createImageBitmap(blob);
        const size = { width: bitmap.width, height: bitmap.height };
        if (bitmap.close) bitmap.close();
        return size;
    } catch (err) {
        return { width: null, height: null };
    }
}

/**
 * Bring an over-sized picture under the upload limit, or hand back what came in
 * and let the server refuse it.
 *
 * PNG FIRST, JPEG ONLY IF THAT IS NOT ENOUGH. A pasted picture is usually a
 * screenshot, and re-encoding text as JPEG is exactly the case JPEG is worst
 * at; scaling a 4K screenshot to 2560px is normally sufficient on its own. A
 * photograph stays large however far it is scaled, and survives JPEG well — so
 * that is the second attempt, not the first.
 */
async function shrinkImage(blob) {
    if (blob.size <= MAX_IMAGE_BYTES) return { blob, resized: false };

    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch (err) {
        return { blob, resized: false };
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    let out = await canvasBlob(canvas, 'image/png');
    if (out && out.size > MAX_IMAGE_BYTES) {
        out = await canvasBlob(canvas, 'image/jpeg', 0.85);
    }

    // Only take the re-encode if it actually helped: scaling a small, heavily
    // compressed image can produce a LARGER file than it started as.
    return out && out.size < blob.size ? { blob: out, resized: true } : { blob, resized: false };
}

/**
 * "PNG" / "JPG" — the short format badge the `.kr-image` header shows.
 * Falls back to "IMG" rather than throwing: the mime rides in on a data
 * attribute, so a blank one is a rendering detail, not a reason to fail.
 */
function formatBadge(mime) {
    const subtype = String(mime || '').split('/')[1] || '';
    return subtype.toUpperCase().replace('JPEG', 'JPG').replace('X-', '') || 'IMG';
}

/**
 * What an empty note invites you to do. The picture half is here because a
 * paste-only feature is otherwise invisible — there is no button to notice.
 */
function placeholderFor(note) {
    return note && note.audio ? 'Add a caption…' : 'Write a note, or paste a picture…';
}

/** "512 KB" / "2.4 MB", for a status line. */
function formatBytes(bytes) {
    const kb = (Number(bytes) || 0) / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The identifying fields every request carries.
 *
 * Notes live in the folder they are about, so the server derives that folder
 * from `type` + `path` — an id alone does not say which folder's index holds
 * a note. Everything here is already in `target`; this just names the subset
 * the API wants, in one place, so no call site can forget half of it.
 */
function targetFields(target) {
    if (!target) return {};
    return {
        spaceName: target.spaceName || '',
        type: target.type,
        path: target.path
    };
}

export const notesController = {
    app: null,

    /** { type, path, title, spaceName } — the content the panel is about. */
    target: null,

    /** Notes for `target`, newest edit first. */
    notes: [],

    /** How many notes the current target has (kept even while the panel is shut). */
    count: 0,

    _open: false,
    /** Bumped per load/target change; a stale response drops itself. */
    _token: 0,
    /** noteId|draftId → debounce timer handle. */
    _timers: new Map(),
    /** noteId|draftId → in-flight save promise (single-flight). */
    _inflight: new Map(),
    /** noteId|draftId → text that arrived while a save was running. */
    _queued: new Map(),
    _draftSeq: 0,

    /**
     * The recording in progress, or null.
     * { recorder, stream, chunks, mime, startedAt, tick, card, target, keep }
     * `target` is captured at the start so an upload can never be filed under
     * content the user has since navigated to.
     */
    _rec: null,

    init(app) {
        this.app = app;
        this._open = localStorage.getItem(OPEN_KEY) === 'true';

        // One delegated handler for every chip in the app, present or future.
        document.addEventListener('click', (e) => {
            const toggle = e.target.closest('[data-notes-toggle]');
            if (!toggle) return;
            e.preventDefault();
            this.toggle();
        });

        document.getElementById('notesCloseBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        document.getElementById('notesNewBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.addDraft();
        });

        // Recording controls. The Record button is markup-hidden by default and
        // only revealed where recording can actually work, so an insecure
        // context or a locked-down iframe simply never shows it.
        const recordBtn = document.getElementById('notesRecordBtn');
        if (recordBtn && canRecord()) {
            recordBtn.hidden = false;
            recordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.startRecording(null);
            });
        }
        document.getElementById('notesRecorderStop')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.stopRecording(true);
        });
        document.getElementById('notesRecorderCancel')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.stopRecording(false);
            this.setStatus('Recording discarded');
        });

        document.getElementById('notesRecorderContinue')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.continueRecording();
        });
        document.getElementById('notesRecorderFinish')?.addEventListener('click', (e) => {
            e.preventDefault();
            // Stop and KEEP — this is the "I'm done" button, not the discard.
            this.stopRecording(true);
        });

        const list = document.getElementById('notesList');
        if (list) {
            list.addEventListener('input', (e) => {
                const input = e.target.closest('[data-note-input]');
                if (input) this.scheduleSave(input);
            });
            // `focusout` (not blur) so it bubbles out of the textarea.
            list.addEventListener('focusout', (e) => {
                const input = e.target.closest('[data-note-input]');
                if (input) this.flush(input);
            });
            list.addEventListener('click', (e) => {
                const del = e.target.closest('[data-note-delete]');
                if (del) {
                    e.preventDefault();
                    this.deleteNote(del.closest('[data-note-card]'));
                    return;
                }

                const mic = e.target.closest('[data-note-record]');
                if (mic) {
                    e.preventDefault();
                    this.startRecording(mic.closest('[data-note-card]'));
                    return;
                }

                const dropAudio = e.target.closest('[data-note-audio-delete]');
                if (dropAudio) {
                    e.preventDefault();
                    this.deleteAudio(dropAudio.closest('[data-note-card]'));
                    return;
                }

                const dropImage = e.target.closest('[data-note-image-delete]');
                if (dropImage) {
                    e.preventDefault();
                    const figure = dropImage.closest('[data-note-image]');
                    this.deleteImage(
                        dropImage.closest('[data-note-card]'),
                        figure && figure.dataset.imageId
                    );
                    return;
                }

                // A plain left click opens the viewer; a modified click is left
                // to the browser, so the anchor still opens in a new tab, and
                // the picture stays reachable if this never runs.
                const openImage = e.target.closest('[data-note-image] a');
                if (openImage && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    const figure = openImage.closest('[data-note-image]');
                    this.openImageViewer(
                        openImage.getAttribute('href'),
                        figure && figure.dataset.imageMime
                    );
                }
            });
        }

        // Pasting a picture. The listener must sit on the document to see the
        // event at all, so `handlePaste` scopes it by where the paste LANDED —
        // a paste into the search box or the document editor is none of our
        // business, and quietly turning one into a note would be a bug people
        // would struggle to even describe.
        document.addEventListener('paste', (e) => this.handlePaste(e));

        document.getElementById('noteImageViewerClose')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeImageViewer();
        });
        // Click the backdrop to dismiss, but not a click that lands on the
        // picture itself — dragging to pan ends in a pointerup on the canvas and
        // must not be read as "close".
        document.getElementById('noteImageViewer')?.addEventListener('click', (e) => {
            if (e.target.id === 'noteImageViewer') this.closeImageViewer();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeImageViewer();
        });

        // Last chance to save on a real page exit (keepalive survives unload).
        // A recording in progress cannot be uploaded from here — the blob is
        // not final until MediaRecorder stops — so it is dropped, but the
        // microphone is released either way.
        window.addEventListener('pagehide', () => {
            this.flushAll(true);
            this.stopRecording(false);
        });

        this.applyOpenState();
        this.renderChips();
        // A panel restored open at boot has no target yet — paint its empty
        // state rather than leaving a blank column until the first navigation.
        this.renderList();
    },

    // ---- Target ------------------------------------------------------------

    /**
     * Point the panel at a piece of content. Safe to call repeatedly with the
     * same target — the document header re-renders on every tab switch, and
     * re-loading there would fight whatever is being typed.
     *
     * @param {Object|null} target { type, path, title, spaceName }
     */
    setTarget(target) {
        const next = target && target.path != null
            ? {
                type: target.type === 'folder' ? 'folder' : 'document',
                path: String(target.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
                title: target.title || '',
                spaceName: target.spaceName || this.app?.currentSpace?.name || ''
            }
            : null;

        if (targetKey(next) === targetKey(this.target) &&
            (next?.spaceName || '') === (this.target?.spaceName || '')) {
            // Same content — keep the panel (and anything being typed) exactly
            // as it is. The chips still get re-stamped: a folder view rebuilds
            // its whole DOM on a view-mode switch, so the chip in it is a NEW
            // element that has never been told the count.
            if (next) this.target = next;
            this.renderChips();
            return;
        }

        // Moving on: anything still pending belongs to the OLD target.
        this.flushAll();

        // So does anything still RECORDING. It could be filed against the
        // target it started under — the blob is fine — but the note would then
        // appear in a list the user is no longer looking at, which reads as the
        // recording having gone missing. Discarding and saying so is honest.
        if (this._rec) {
            this.stopRecording(false);
            this.setStatus('Recording discarded — you moved to other content');
        }

        this.target = next;
        this.notes = [];
        this.count = 0;
        this.renderChips();
        this.renderTargetLabel();
        this.refresh();
    },

    /** Forget the current content (spaces list, profile, …). */
    clearTarget() {
        this.setTarget(null);
    },

    // ---- Open / close ------------------------------------------------------

    isOpen() {
        return this._open;
    },

    toggle() {
        this._open ? this.close() : this.open();
    },

    open() {
        this._open = true;
        localStorage.setItem(OPEN_KEY, 'true');
        this.applyOpenState();
        this.renderChips();
        this.refresh();
    },

    close() {
        this.flushAll();
        this.stopRecording(false);
        this._open = false;
        localStorage.setItem(OPEN_KEY, 'false');
        this.applyOpenState();
        this.renderChips();
    },

    applyOpenState() {
        document.getElementById('notesPanel')?.classList.toggle('hidden', !this._open);
        this.renderTargetLabel();
    },

    // ---- Load --------------------------------------------------------------

    /**
     * Re-read the current target. While the panel is shut only the COUNT is
     * fetched — that is all a chip badge needs, and it costs no note bodies.
     */
    async refresh() {
        const token = ++this._token;
        const target = this.target;

        if (!target) {
            this.notes = [];
            this.count = 0;
            this.renderChips();
            this.renderList();
            return;
        }

        const query = new URLSearchParams({
            type: target.type,
            path: target.path
        });
        if (target.spaceName) query.set('space', target.spaceName);

        // Captured, not re-read after the await: the panel can be closed (or
        // opened) while this is in the air, and reading `_open` again would
        // interpret a list payload as a count — or an empty count as "no notes".
        const wantList = this._open;

        try {
            const url = wantList ? `${API}?${query}` : `${API}/count?${query}`;
            const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (token !== this._token) return; // a newer load won

            if (wantList) {
                this.notes = Array.isArray(data.notes) ? data.notes : [];
                this.count = this.notes.length;
                if (this._open) this.renderList();
            } else {
                this.count = Number(data.count) || 0;
            }
            this.renderChips();

            // Toggled mid-flight: this answer is the wrong shape for what is on
            // screen now, so go round again for the right one.
            if (wantList !== this._open) this.refresh();
        } catch (err) {
            if (token !== this._token) return;
            console.warn('[NotesController] load failed:', err);
            if (this._open) this.setStatus('Could not load notes');
        }
    },

    // ---- Render ------------------------------------------------------------

    /** Update every notes chip in the page — count badge and pressed state. */
    renderChips() {
        const chips = document.querySelectorAll('[data-notes-toggle]');
        chips.forEach((chip) => {
            const badge = chip.querySelector('[data-notes-count]');
            if (badge) {
                badge.textContent = String(this.count);
                badge.hidden = this.count === 0;
            }
            chip.classList.toggle('has-notes', this.count > 0);
            chip.classList.toggle('active', this._open);
            chip.setAttribute('aria-pressed', this._open ? 'true' : 'false');
        });
    },

    renderTargetLabel() {
        const label = document.getElementById('notesTargetLabel');
        if (!label) return;
        const name = this.target
            ? (this.target.title || this.target.path.split('/').pop() || 'this space')
            : '';
        label.textContent = name ? `Private to you · ${name}` : 'Private to you';
    },

    renderList() {
        const list = document.getElementById('notesList');
        const newBtn = document.getElementById('notesNewBtn');
        if (!list) return;

        if (newBtn) newBtn.disabled = !this.target;

        if (!this.target) {
            list.innerHTML = `<div class="kr-notes-empty">
                    <i class="bi bi-journal-text"></i>
                    <p>Open a document or folder to keep notes about it.</p>
                </div>`;
            return;
        }

        if (!this.notes.length) {
            list.innerHTML = `<div class="kr-notes-empty">
                    <i class="bi bi-journal-text"></i>
                    <p>No notes yet. Add one — only you can see it.</p>
                </div>`;
            return;
        }

        list.innerHTML = this.notes.map((note) => this.noteHtml(note)).join('');
        list.querySelectorAll('[data-note-input]').forEach((el) => this.autoGrow(el));
    },

    noteHtml(note) {
        const edited = relativeTime(note.updatedAt);
        const hasAudio = !!note.audio;
        const mic = canRecord()
            ? `<button type="button" class="kr-note-mic" data-note-record
                        title="${hasAudio ? 'Record over this' : 'Record a voice note'}">
                    <i class="bi bi-mic"></i>
                </button>`
            : '';

        return `
            <article class="kr-note" data-note-card data-note-id="${escapeHtml(note.id)}">
                <header class="kr-note-head">
                    <span class="kr-note-time">${edited ? `Edited ${escapeHtml(edited)}` : 'New note'}</span>
                    <div class="kr-note-tools">
                        ${mic}
                        <button type="button" class="kr-note-del" data-note-delete title="Delete this note">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </header>
                ${this.audioHtml(note)}
                <textarea class="kr-note-text" data-note-input rows="3"
                          placeholder="${escapeHtml(placeholderFor(note))}">${escapeHtml(note.text || '')}</textarea>
                ${this.imagesHtml(note)}
            </article>`;
    },

    /**
     * The pictures attached to a note, or '' when there are none. They sit
     * BELOW the words: a note is text that may have attachments, not a document
     * with images laid out in it.
     *
     * `width`/`height` are stamped on the <img> whenever the server knows them,
     * so the browser reserves the right box from the aspect ratio and the panel
     * does not jump around as each picture arrives. Each one links to itself,
     * which is how a screenshot pasted into a narrow panel can still be read at
     * full size — a plain anchor, so it needs no script and honours a
     * middle-click like any other link.
     */
    imagesHtml(note) {
        const images = note.images || [];
        if (!images.length) return '';

        return `
            <div class="kr-note-images" data-note-images>
                ${images.map((image) => {
                    const box = image.width && image.height
                        ? ` width="${image.width}" height="${image.height}"`
                        : '';
                    // The tile is cropped to a fixed height, so the real size
                    // is worth saying somewhere before you decide to open it.
                    const hint = image.width && image.height
                        ? `${image.width} × ${image.height} · click to zoom`
                        : 'Click to zoom';
                    return `
                    <figure class="kr-note-image" data-note-image data-image-id="${escapeHtml(image.id)}"
                            data-image-mime="${escapeHtml(image.mime || '')}">
                        <a href="${escapeHtml(this.imageSrc(note, image))}" target="_blank" rel="noopener"
                           title="${escapeHtml(hint)}">
                            <img src="${escapeHtml(this.imageSrc(note, image))}"
                                 alt="Picture attached to this note" loading="lazy"${box}>
                        </a>
                        <button type="button" class="kr-note-image-del" data-note-image-delete
                                title="Remove this picture"><i class="bi bi-x-lg"></i></button>
                    </figure>`;
                }).join('')}
            </div>`;
    },

    /** Where to fetch one picture. See audioSrc — same reasoning, same shape. */
    imageSrc(note, image) {
        const query = new URLSearchParams(this.attachmentQuery());
        return `${API}/${encodeURIComponent(note.id)}/images/${encodeURIComponent(image.id)}?${query}`;
    },

    /**
     * The player row, or '' when the note has no recording.
     *
     * `preload="none"` matters: the panel can hold several voice notes and the
     * point of the row is to say one EXISTS, not to pull every recording down
     * on the chance somebody plays one. The length comes from the record rather
     * than the element because MediaRecorder's container has no duration in its
     * header — reading `audio.duration` here gives `Infinity`.
     */
    audioHtml(note) {
        if (!note.audio) return '';
        const length = note.audio.durationMs ? formatDuration(note.audio.durationMs) : '';
        return `
            <div class="kr-note-audio" data-note-audio>
                <audio controls preload="none" src="${escapeHtml(this.audioSrc(note))}"></audio>
                <div class="kr-note-audio-meta">
                    <span><i class="bi bi-mic-fill"></i> Voice note${length ? ` · ${escapeHtml(length)}` : ''}</span>
                    <button type="button" class="kr-note-audio-del" data-note-audio-delete
                            title="Remove the recording and keep the note">Remove</button>
                </div>
            </div>`;
    },

    /**
     * Where to fetch a note's recording. `v` is the recording's own timestamp,
     * not a cache-buster for its own sake: re-recording replaces the bytes
     * under a URL that otherwise never changes, and an <audio> element that has
     * already loaded the old take will happily keep playing it.
     */
    audioSrc(note) {
        const query = new URLSearchParams(this.attachmentQuery());
        if (note.audio?.recordedAt) query.set('v', note.audio.recordedAt);
        return `${API}/${encodeURIComponent(note.id)}/audio?${query}`;
    },

    /**
     * The query every attachment URL needs: which space, and which target — the
     * latter because the server derives the folder holding this note's index
     * from it. These go in the URL rather than a body because they are read by
     * <audio src> and <img src>, which cannot send one.
     */
    attachmentQuery() {
        const target = this.target || {};
        return {
            space: target.spaceName || '',
            type: target.type || 'document',
            path: target.path || ''
        };
    },

    /**
     * Add an unsaved note card and focus it. Nothing is written until it has
     * text. Only reachable from inside the open panel — deliberately does NOT
     * call open(), whose refresh would re-render the list and take the fresh
     * draft with it.
     */
    addDraft() {
        if (!this.target) return;

        const list = document.getElementById('notesList');
        if (!list) return;

        // Clear the empty state before appending the first card.
        list.querySelector('.kr-notes-empty')?.remove();

        const draftId = `draft-${++this._draftSeq}`;
        const wrap = document.createElement('div');
        wrap.innerHTML = this.noteHtml({ id: draftId, text: '', updatedAt: null });
        const card = wrap.firstElementChild;
        card.dataset.noteDraft = '1';
        list.prepend(card);
        card.querySelector('[data-note-input]')?.focus();
    },

    // ---- Saving ------------------------------------------------------------

    autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
    },

    scheduleSave(input) {
        this.autoGrow(input);
        const card = input.closest('[data-note-card]');
        if (!card) return;
        const key = card.dataset.noteId;

        clearTimeout(this._timers.get(key));
        this.setStatus('Saving…');
        this._timers.set(key, setTimeout(() => this.save(card), AUTOSAVE_MS));
    },

    /**
     * Write immediately (blur, close, navigation) rather than waiting out the
     * debounce. Only cards with edits still pending are written — blurring a
     * note nobody touched must not restamp its "Edited" time and shuffle it to
     * the top of the list on the next load.
     */
    flush(input, keepalive = false) {
        const card = input.closest('[data-note-card]');
        if (!card) return;
        const key = card.dataset.noteId;

        // An empty draft with an attachment in flight looks abandoned to the
        // branch below, which would remove the card out from under the upload
        // that is about to turn it into a real note.
        if (card.dataset.noteClaiming === '1') return;

        if (!this._timers.has(key)) {
            // A draft that was opened and abandoned is not a note.
            if (card.dataset.noteDraft === '1' && !input.value.trim()) {
                card.remove();
                if (!this.notes.length) this.renderList();
            }
            return;
        }

        clearTimeout(this._timers.get(key));
        this._timers.delete(key);
        this.save(card, keepalive);
    },

    /** Flush every card with pending edits. */
    flushAll(keepalive = false) {
        document.querySelectorAll('#notesList [data-note-input]').forEach((input) => {
            this.flush(input, keepalive);
        });
    },

    /**
     * Persist one card. Single-flight per note with a queued coalesce: while a
     * save is in the air, later text is remembered and written straight after,
     * so a burst of typing collapses to two requests instead of dropping the
     * tail.
     */
    async save(card, keepalive = false) {
        if (!card || !this.target) return;
        const input = card.querySelector('[data-note-input]');
        if (!input) return;

        const key = card.dataset.noteId;
        const text = input.value;
        const isDraft = card.dataset.noteDraft === '1';

        // A DRAFT WITH AN ATTACHMENT IN FLIGHT IS NOT SAVED FROM HERE. That
        // request will create the note, carrying this text with it — so letting
        // the debounce create it too produces TWO notes for one action: an
        // attachment-only one and a text-only one, in whichever order they
        // land. `claimCard` sets the flag; `releaseClaim` clears it.
        if (isDraft && card.dataset.noteClaiming === '1') return;

        // An untouched draft is not a note. Drop it silently on blur.
        if (isDraft && !text.trim()) {
            if (document.activeElement !== input) card.remove();
            this.setStatus('Autosaved');
            return;
        }

        if (this._inflight.has(key)) {
            this._queued.set(key, text);
            return;
        }

        const run = (async () => {
            try {
                const note = isDraft
                    ? await this.createNote(text, keepalive)
                    : await this.updateNote(key, text, keepalive);
                if (!note) return;

                // A draft has become a real note — re-key the card so the next
                // keystroke updates it instead of creating a second note.
                if (isDraft) {
                    delete card.dataset.noteDraft;
                    card.dataset.noteId = note.id;
                    this.notes.unshift(note);
                    this.count = this.notes.length;
                    this.renderChips();
                } else {
                    const existing = this.notes.find((n) => n.id === note.id);
                    if (existing) {
                        existing.text = note.text;
                        existing.updatedAt = note.updatedAt;
                    }
                }

                const time = card.querySelector('.kr-note-time');
                if (time) time.textContent = `Edited ${relativeTime(note.updatedAt)}`;
                this.setStatus(`Autosaved · Edited ${relativeTime(note.updatedAt)}`);
            } catch (err) {
                console.warn('[NotesController] save failed:', err);
                this.setStatus('Could not save — retry in a moment');
            }
        })();

        this._inflight.set(key, run);
        await run;
        this._inflight.delete(key);

        // Whatever arrived mid-flight, written under the card's CURRENT id.
        if (this._queued.has(key)) {
            this._queued.delete(key);
            this.save(card, keepalive);
        }
    },

    async createNote(text, keepalive) {
        const resp = await fetch(API, {
            method: 'POST',
            credentials: 'include',
            keepalive,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...targetFields(this.target),
                title: this.target.title,
                text
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || `HTTP ${resp.status}`);
        return data.note;
    },

    async updateNote(id, text, keepalive) {
        const resp = await fetch(`${API}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            credentials: 'include',
            keepalive,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...targetFields(this.target), text })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) throw new Error(data.error || `HTTP ${resp.status}`);
        return data.note;
    },

    async deleteNote(card) {
        if (!card) return;
        const id = card.dataset.noteId;
        const isDraft = card.dataset.noteDraft === '1';

        if (!isDraft && !window.confirm('Delete this note? This cannot be undone.')) return;

        clearTimeout(this._timers.get(id));
        this._timers.delete(id);

        if (isDraft) {
            card.remove();
            if (!this.notes.length) this.renderList();
            return;
        }

        try {
            const resp = await fetch(`${API}/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(targetFields(this.target))
            });
            // A note already gone elsewhere is a success as far as this card goes.
            if (!resp.ok && resp.status !== 404) throw new Error(`HTTP ${resp.status}`);

            this.notes = this.notes.filter((n) => n.id !== id);
            this.count = this.notes.length;
            card.remove();
            if (!this.notes.length) this.renderList();
            this.renderChips();
            this.setStatus('Note deleted');
        } catch (err) {
            console.warn('[NotesController] delete failed:', err);
            this.setStatus('Could not delete the note');
        }
    },

    // ---- Recording ---------------------------------------------------------

    /**
     * Start recording, either for a brand-new voice note (`card` null, from the
     * panel's Record button) or against an existing card's note (its mic
     * button). A draft card counts as neither yet — it becomes a real note when
     * the recording is uploaded, in one request.
     */
    async startRecording(card = null) {
        if (this._rec || !this.target || !canRecord()) return;

        // Captured BEFORE the await, and compared after. The permission prompt
        // is a dialog the user may sit on for a while, and re-reading
        // `this.target` on the far side of it would file the recording under
        // whatever they navigated to in the meantime.
        const target = this.target;

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.warn('[NotesController] microphone unavailable:', err);
            this.setStatus(micErrorMessage(err));
            return;
        }

        // Moved on, or closed the panel, while the prompt was up. Nothing to
        // record against — and the microphone must not be left hot.
        if (this.target !== target || !this._open) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }

        const mime = pickRecordingMime();
        const container = mime ? { mimeType: mime } : {};
        let recorder;
        try {
            recorder = new MediaRecorder(stream, {
                ...container,
                audioBitsPerSecond: AUDIO_BITS_PER_SECOND
            });
        } catch (err) {
            // The bitrate is an optimisation, not a requirement: a browser that
            // rejects the combination should still record at its own default
            // rather than refuse outright. The size guard covers what this
            // costs us — it watches real bytes, not an assumed rate.
            console.warn('[NotesController] retrying without a bitrate hint:', err);
            try {
                recorder = new MediaRecorder(stream, container);
            } catch (fatal) {
                console.warn('[NotesController] MediaRecorder refused the format:', fatal);
                stream.getTracks().forEach(track => track.stop());
                this.setStatus('Could not start recording');
                return;
            }
        }

        // Anything already queued for this card belongs to the request the
        // recording is about to make instead.
        this.claimCard(card);

        const rec = {
            recorder,
            stream,
            chunks: [],
            // What the recorder SAYS it produced beats what we asked for: a
            // browser may fall back to another container, and mislabelling the
            // blob is what turns a good recording into one nothing can play.
            mime: recorder.mimeType || mime || 'audio/webm',
            startedAt: Date.now(),
            /** Total ms spent paused at a "keep going?" prompt. */
            pausedMs: 0,
            /** When the current pause began, or null while recording. */
            pausedAt: null,
            /** Elapsed reading at which to ask again; moves on each Continue. */
            nextPromptAt: RECORD_PROMPT_MS,
            tick: null,
            card,
            target,
            keep: true
        };
        this._rec = rec;

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size) rec.chunks.push(e.data);
        };
        recorder.onerror = (e) => {
            console.warn('[NotesController] recorder error:', e.error || e);
            this.stopRecording(false);
            this.setStatus('Recording failed');
        };
        recorder.onstop = () => this.finishRecording(rec);

        // The timeslice is what makes `recordedBytes` possible — see the
        // RECORD_CHUNK_MS comment. It also means a crashed tab loses at most
        // one chunk's worth rather than the entire recording.
        recorder.start(RECORD_CHUNK_MS);
        rec.tick = setInterval(() => this.paintElapsed(rec), 250);
        this.paintElapsed(rec);
        this.renderRecorder('recording');
        this.setStatus('Recording…');
    },

    /**
     * The one timer behind both states: it paints the clock while recording and
     * the countdown while the "keep going?" prompt is up. Keeping it single
     * means there is no second timer to leak when a recording ends mid-prompt.
     */
    paintElapsed(rec) {
        if (rec.pausedAt) {
            const left = RECORD_CONFIRM_MS - (Date.now() - rec.pausedAt);
            const countdown = document.getElementById('notesRecorderCountdown');
            if (countdown) {
                countdown.textContent = `Stopping in ${Math.max(0, Math.ceil(left / 1000))}s`;
            }
            if (left <= 0) {
                // Nobody answered. Stop and KEEP it — what was said so far is
                // the whole point, and a live microphone nobody is watching is
                // exactly what the prompt exists to end.
                this.stopRecording(true);
                this.setStatus('No answer — recording stopped and saved');
            }
            return;
        }

        const elapsed = elapsedOf(rec);
        const el = document.getElementById('notesRecorderTime');
        if (el) el.textContent = formatDuration(elapsed);

        // The size ceiling is checked FIRST and is not negotiable: past it the
        // upload would be refused, and a 413 after half an hour of talking
        // means losing all of it.
        if (recordedBytes(rec) >= MAX_RECORD_BYTES) {
            this.stopRecording(true);
            this.setStatus('Recording stopped at the size limit — saved so far');
            return;
        }

        if (elapsed >= rec.nextPromptAt) this.promptContinue(rec);
    },

    /**
     * Pause and ask whether to keep recording.
     *
     * PAUSING MATTERS: without it the microphone would go on capturing the room
     * while the prompt sits there, so a recording nobody chose to extend would
     * still grow — and a minute of deliberation would land in the audio.
     */
    promptContinue(rec) {
        try {
            if (rec.recorder.state === 'recording') rec.recorder.pause();
        } catch (err) {
            console.warn('[NotesController] could not pause:', err);
        }

        rec.pausedAt = Date.now();
        const elapsed = document.getElementById('notesRecorderElapsed');
        if (elapsed) elapsed.textContent = formatDuration(elapsedOf(rec));
        this.renderRecorder('confirm');
        this.paintElapsed(rec);
        this.setStatus('Paused — still recording?');
    },

    /** "Continue" on the prompt: resume, and set the next prompt an interval on. */
    continueRecording() {
        const rec = this._rec;
        if (!rec || !rec.pausedAt) return;

        rec.pausedMs += Date.now() - rec.pausedAt;
        rec.pausedAt = null;
        rec.nextPromptAt += RECORD_PROMPT_MS;

        try {
            if (rec.recorder.state === 'paused') rec.recorder.resume();
        } catch (err) {
            console.warn('[NotesController] could not resume:', err);
            this.stopRecording(true);
            this.setStatus('Could not resume — the recording so far was saved');
            return;
        }

        this.renderRecorder('recording');
        this.paintElapsed(rec);
        this.setStatus('Recording…');
    },

    /**
     * Stop the recording, keeping it (`keep`) or throwing it away. Safe to call
     * when nothing is recording, which is what lets close(), setTarget() and
     * pagehide all call it unconditionally.
     *
     * The upload happens in `finishRecording`, off the recorder's `onstop`: the
     * blob is not complete until then, so uploading from here would post a
     * truncated file.
     */
    stopRecording(keep = true) {
        const rec = this._rec;
        if (!rec) return;

        rec.keep = keep;
        clearInterval(rec.tick);
        rec.tick = null;
        this.renderRecorder('off');

        try {
            if (rec.recorder.state !== 'inactive') {
                rec.recorder.stop();
                return; // onstop → finishRecording tidies up
            }
        } catch (err) {
            console.warn('[NotesController] stop failed:', err);
        }

        // Never actually started, or stop() threw: tidy up here instead, or the
        // microphone stays live with nothing left to turn it off.
        this._rec = null;
        this.releaseMic(rec);
    },

    /** Drop the microphone. The tab keeps its recording indicator until this runs. */
    releaseMic(rec) {
        try {
            rec.stream.getTracks().forEach(track => track.stop());
        } catch (err) {
            console.warn('[NotesController] could not release the microphone:', err);
        }
    },

    /** MediaRecorder has finished: assemble the blob and, if wanted, upload it. */
    async finishRecording(rec) {
        this._rec = null;
        this.releaseMic(rec);
        this.renderRecorder('off');

        try {
            if (!rec.keep) return;

            const blob = new Blob(rec.chunks, { type: rec.mime });
            if (!blob.size) {
                this.setStatus('Nothing was recorded');
                return;
            }

            this.setStatus('Saving recording…');
            // elapsedOf, NOT wall clock: time spent paused at a "keep going?"
            // prompt was never captured, and this number is what the player
            // shows — the container carries no duration of its own.
            await this.uploadRecording(blob, elapsedOf(rec), rec);
        } catch (err) {
            console.warn('[NotesController] recording upload failed:', err);
            this.setStatus(err.message || 'Could not save the recording');
        } finally {
            // Every exit, including a discarded take: leave the claim set and
            // a draft can never be saved again, so its text would be lost.
            this.releaseClaim(rec.card);
        }
    },

    /**
     * Send a finished recording to the server and fold the answer back into the
     * panel. Three cases, one request each:
     *
     *   no card        → a new voice note
     *   a draft card   → that draft becomes a real note, carrying whatever was
     *                    typed into it, in ONE request (see notesRoutes: a
     *                    create-then-attach pair can strand an empty note)
     *   a saved card   → the recording is attached to it, replacing any it had
     */
    async uploadRecording(blob, durationMs, rec) {
        const extension = (rec.mime.split(';')[0].split('/')[1] || 'webm').replace('x-', '');
        const result = await this.postAttachment({
            kind: 'audio',
            field: 'audio',
            blob,
            filename: `recording.${extension}`,
            extra: { durationMs: Math.round(durationMs) },
            target: rec.target,
            card: rec.card
        });

        this.adoptNote(result, rec.target);
        this.setStatus(`Recording saved · ${formatDuration(result.note.audio?.durationMs)}`);
        return result.note;
    },

    /**
     * Post one attachment and return what came back.
     *
     * Both attachment kinds face the same three cases and the same split — a
     * note that already exists is ATTACHED to, while a draft (or no card at
     * all) is CREATED with its attachment in one request, carrying whatever was
     * typed into it. Keeping that in one place is what stops the two kinds
     * drifting into subtly different behaviour.
     *
     * @return {Promise<{note: Object, isDraft: boolean, card: Element|null}>}
     */
    async postAttachment({ kind, field, blob, filename, extra = {}, target, card }) {
        const live = card && card.isConnected ? card : null;
        const isDraft = !live || live.dataset.noteDraft === '1';

        const form = new FormData();
        form.append(field, blob, filename);
        Object.entries(extra).forEach(([name, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                form.append(name, String(value));
            }
        });
        // type/path go on EVERY attachment request, not just the create: the
        // server derives the folder to write into from them.
        Object.entries(targetFields(target)).forEach(([name, value]) => {
            form.append(name, value == null ? '' : String(value));
        });

        let url;
        if (isDraft) {
            form.append('title', target.title || '');
            form.append('text', live?.querySelector('[data-note-input]')?.value || '');
            url = `${API}/${kind}`;
        } else {
            url = `${API}/${encodeURIComponent(live.dataset.noteId)}/${kind}`;
        }

        const resp = await fetch(url, { method: 'POST', credentials: 'include', body: form });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        return { note: data.note, isDraft, card: live };
    },

    /**
     * Fold a saved attachment back into the panel.
     *
     * Returns false, having changed nothing, when the panel has moved on while
     * the upload was in flight — the note is saved either way, only its
     * rendering is skipped.
     */
    adoptNote({ note, isDraft, card }, target) {
        if (targetKey(target) !== targetKey(this.target)) return false;

        if (isDraft) {
            if (card) {
                // Re-key the draft in place rather than re-rendering the list:
                // a neighbouring card may hold text that has not been written
                // yet, and a wholesale re-render would paint over it.
                delete card.dataset.noteDraft;
                card.dataset.noteId = note.id;
                this.refreshCard(card, note);
                this.notes.unshift(note);
            } else {
                this.notes.unshift(note);
                this.prependCard(note);
            }
            this.count = this.notes.length;
        } else {
            const existing = this.notes.find(n => n.id === note.id);
            if (existing) {
                existing.audio = note.audio;
                existing.images = note.images;
                existing.updatedAt = note.updatedAt;
            }
            this.refreshCard(card, note);
        }

        this.renderChips();
        return true;
    },

    /** Put a freshly created note's card at the top of the list. */
    prependCard(note) {
        const list = document.getElementById('notesList');
        if (!list) return;
        list.querySelector('.kr-notes-empty')?.remove();
        const wrap = document.createElement('div');
        wrap.innerHTML = this.noteHtml(note);
        const card = wrap.firstElementChild;
        list.prepend(card);
        this.autoGrow(card.querySelector('[data-note-input]'));
    },

    /**
     * Bring a card's attachments into line with the note the server just
     * returned — the player row above the text, the pictures below it.
     *
     * Deliberately surgical rather than re-rendering the card: the textarea may
     * hold unsaved text, and replacing it would discard the caption somebody is
     * halfway through typing beside the picture they just pasted.
     */
    refreshCard(card, note) {
        if (!card) return;

        card.querySelector('[data-note-audio]')?.remove();
        if (note.audio) {
            const wrap = document.createElement('div');
            wrap.innerHTML = this.audioHtml(note);
            card.querySelector('.kr-note-head')?.after(wrap.firstElementChild);
        }

        card.querySelector('[data-note-images]')?.remove();
        const gallery = this.imagesHtml(note);
        if (gallery) {
            const wrap = document.createElement('div');
            wrap.innerHTML = gallery;
            card.appendChild(wrap.firstElementChild);
        }

        const input = card.querySelector('[data-note-input]');
        if (input) input.placeholder = placeholderFor(note);

        const mic = card.querySelector('[data-note-record]');
        if (mic) mic.title = note.audio ? 'Record over this' : 'Record a voice note';

        const time = card.querySelector('.kr-note-time');
        if (time) time.textContent = `Edited ${relativeTime(note.updatedAt)}`;
    },

    /**
     * Swap the top of the panel between its three states: the New note / Record
     * buttons, the live recorder, and the "keep going?" prompt. Exactly one of
     * the three is ever visible.
     *
     * @param {'off'|'recording'|'confirm'} state
     */
    renderRecorder(state) {
        const showing = {
            actions: state === 'off',
            recorder: state === 'recording',
            confirm: state === 'confirm'
        };

        const actions = document.querySelector('.kr-notes-actions');
        if (actions) actions.hidden = !showing.actions;

        const bar = document.getElementById('notesRecorder');
        if (bar) bar.hidden = !showing.recorder;

        const confirm = document.getElementById('notesRecorderConfirm');
        if (confirm) confirm.hidden = !showing.confirm;
    },

    /** Remove a note's recording, keeping the note and whatever it says. */
    async deleteAudio(card) {
        if (!card || card.dataset.noteDraft === '1') return;
        if (!window.confirm('Remove this recording? The note itself is kept.')) return;

        const id = card.dataset.noteId;
        try {
            const resp = await fetch(`${API}/${encodeURIComponent(id)}/audio`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(targetFields(this.target))
            });
            if (!resp.ok && resp.status !== 404) throw new Error(`HTTP ${resp.status}`);

            const note = this.notes.find(n => n.id === id);
            if (note) note.audio = null;
            this.applyAudioToCard(card, note || { id, audio: null, updatedAt: new Date().toISOString() });
            this.setStatus('Recording removed');
        } catch (err) {
            console.warn('[NotesController] audio delete failed:', err);
            this.setStatus('Could not remove the recording');
        }
    },

    // ---- Pictures ----------------------------------------------------------

    /**
     * Mark a draft card as "about to become a note", so the autosave debounce
     * stands aside while the request that will create it is in flight. Also
     * drops any timer already ticking on it — that text is being carried by the
     * upload instead.
     */
    claimCard(card) {
        if (!card) return;
        clearTimeout(this._timers.get(card.dataset.noteId));
        this._timers.delete(card.dataset.noteId);
        if (card.dataset.noteDraft === '1') card.dataset.noteClaiming = '1';
    },

    /** Release a claim. Safe on a card that never had one. */
    releaseClaim(card) {
        if (card && card.dataset) delete card.dataset.noteClaiming;
    },

    /**
     * A paste landed somewhere in the page. Take it ONLY if it carries a
     * picture and it landed inside the notes panel; a plain-text paste, and any
     * paste anywhere else, is left completely alone.
     */
    handlePaste(event) {
        if (!this._open || !this.target) return;

        const panel = document.getElementById('notesPanel');
        const node = event.target;
        if (!panel || !(node instanceof Node) || !panel.contains(node)) return;

        const picture = imageFromClipboard(event);
        if (!picture) return;

        // Only now: a text paste into a note must keep its default behaviour.
        event.preventDefault();
        const card = node.closest ? node.closest('[data-note-card]') : null;
        this.pasteImage(picture, card);
    },

    /**
     * Upload a pasted picture, either onto the card it was pasted into or as a
     * new note when it landed on the panel itself.
     */
    async pasteImage(file, card) {
        const target = this.target;
        this.claimCard(card);
        this.setStatus('Adding picture…');

        try {
            const { blob, resized } = await shrinkImage(file);
            const { width, height } = await measureImage(blob);
            const extension = (String(blob.type).split('/')[1] || 'png').split('+')[0];

            const result = await this.postAttachment({
                kind: 'images',
                field: 'image',
                blob,
                filename: `pasted.${extension}`,
                extra: { width, height },
                target,
                card
            });

            if (this.adoptNote(result, target)) {
                this.setStatus(resized
                    ? `Picture added · scaled to fit, ${formatBytes(blob.size)}`
                    : `Picture added · ${formatBytes(blob.size)}`);
            } else {
                this.setStatus('Picture added');
            }
        } catch (err) {
            console.warn('[NotesController] picture upload failed:', err);
            this.setStatus(err.message || 'Could not add the picture');
        } finally {
            this.releaseClaim(card);
        }
    },

    /**
     * Open one picture in a dialog that zooms.
     *
     * The dialog is shown FIRST and the figure built into it second, because
     * the parser's pan/zoom runtime measures the canvas to choose an opening
     * zoom (fit-to-width for anything wider than the canvas) — built while the
     * dialog was still hidden, every picture would open at a measured width of
     * zero. For the same reason the figure is discarded on close rather than
     * reused: the runtime stamps an image as hydrated and would skip it.
     *
     * `data-no-lightbox` keeps the app-wide lightbox in app.js off this image;
     * without it, a tap to pan would stack a second overlay on top of this one.
     */
    openImageViewer(src, mime) {
        const viewer = document.getElementById('noteImageViewer');
        const panel = document.getElementById('noteImageViewerPanel');
        if (!viewer || !panel || !src) return;

        panel.innerHTML = `
            <figure class="kr-image">
                <div class="ki-head">
                    <span class="lab">
                        <i class="bi bi-image" aria-hidden="true"></i>
                        Picture <span class="badge">${escapeHtml(formatBadge(mime))}</span>
                    </span>
                </div>
                <div class="ki-canvas">
                    <img class="ki-img" data-no-lightbox draggable="false"
                         src="${escapeHtml(src)}" alt="Picture attached to this note">
                </div>
            </figure>`;

        viewer.hidden = false;
        // The panel behind it must not scroll while this is up.
        document.body.style.overflow = 'hidden';

        // Hand it to the parser's runtime, which adds the -/%/+/fit toolbar and
        // the pan/zoom handlers. It also watches the DOM for `.kr-image`, so
        // this is belt and braces — but it makes the hydration deterministic
        // rather than dependent on a MutationObserver landing first.
        if (typeof MarkdownParser !== 'undefined'
            && typeof MarkdownParser.enhancePendingImages === 'function') {
            MarkdownParser.enhancePendingImages();
        }

        document.getElementById('noteImageViewerClose')?.focus();
    },

    /** Close the picture viewer. Safe to call when it is already closed. */
    closeImageViewer() {
        const viewer = document.getElementById('noteImageViewer');
        if (!viewer || viewer.hidden) return;

        viewer.hidden = true;
        // Dropping the figure releases the image and, more importantly, means
        // the next open hydrates a fresh one — see openImageViewer.
        const panel = document.getElementById('noteImageViewerPanel');
        if (panel) panel.innerHTML = '';
        document.body.style.overflow = '';
    },

    /** Remove one picture, keeping the note, its words and its other pictures. */
    async deleteImage(card, imageId) {
        if (!card || !imageId || card.dataset.noteDraft === '1') return;
        if (!window.confirm('Remove this picture? The note itself is kept.')) return;

        const id = card.dataset.noteId;
        try {
            const resp = await fetch(
                `${API}/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
                {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(targetFields(this.target))
                }
            );
            // A picture already gone elsewhere is a success as far as this card goes.
            if (!resp.ok && resp.status !== 404) throw new Error(`HTTP ${resp.status}`);

            const note = this.notes.find(n => n.id === id);
            if (note) note.images = (note.images || []).filter(image => image.id !== imageId);

            const figure = Array.from(card.querySelectorAll('[data-note-image]'))
                .find(el => el.dataset.imageId === imageId);
            figure?.remove();
            if (!card.querySelector('[data-note-image]')) {
                card.querySelector('[data-note-images]')?.remove();
            }
            this.setStatus('Picture removed');
        } catch (err) {
            console.warn('[NotesController] picture delete failed:', err);
            this.setStatus('Could not remove the picture');
        }
    },

    setStatus(text) {
        const el = document.getElementById('notesFootStatus');
        if (el) el.textContent = text;
    }
};
