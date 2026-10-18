/**
 * @fileoverview Per-user activity store.
 *
 * Every per-user artefact (activity, preferences, chat history, pins, the
 * comments/likes/annotations/reviews content index, notification subscriptions
 * and the personal dashboard) lives under a single folder named by the user's
 * email local-part:
 *
 *   <appBaseDir>/.system/useractivity/<prefix>/<file>
 *     activity.json  preferences.json  chathistory.json  pins.json
 *     content.json   subscriptions.json  dashboard.md
 *
 * `prefix` is the email local-part, lowercased and filesystem-sanitised — the
 * same convention the dashboards loader uses (`email.split('@')[0]`). Logged-out
 * activity is keyed under the literal folder `anonymous`.
 *
 * This module is the single source of truth for that layout; route handlers and
 * components should go through it rather than building paths themselves.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

/** Root folder (under appBaseDir) that holds every user's activity folder. */
const ROOT = '.system/useractivity';

/**
 * Map an identity (email, or the literal 'anonymous') to a filesystem-safe
 * folder name: the email local-part, lowercased. Anything without an '@' is
 * used as-is (so 'anonymous' stays 'anonymous'). Empty input falls back to
 * 'anonymous' so a path is always produced.
 */
function userDir(identity) {
    const s = String(identity == null ? '' : identity).trim().toLowerCase();
    const local = s.includes('@') ? s.split('@')[0] : s;
    return local.replace(/[^a-z0-9._-]/g, '_') || 'anonymous';
}

/** Absolute path to a file inside a user's activity folder. */
function userPath(appBaseDir, identity, fileName) {
    return path.join(appBaseDir, ROOT, userDir(identity), fileName);
}

/**
 * Read and parse a JSON file from a user's folder.
 *
 * Missing file → `fallback`. **An empty or unparseable file is also `fallback`**,
 * with one warning naming the path. That is deliberate: every caller passes a
 * fallback and reads it as "nothing stored yet", and a zero-byte file is
 * indistinguishable from that as far as recoverable data goes — the content is
 * already gone. Throwing instead put a single corrupt file in a position to take
 * down whatever read it. It did: one zero-byte `notifications.json` aborted
 * `NotificationManager.initialize` for EVERY space and user (subscriptions
 * discarded, core callbacks unregistered, the 30s disk sync never started), and
 * the only symptom was "starting fresh: Unexpected end of JSON input". The same
 * file shape would have 500'd AI chat, pins and profile reads.
 *
 * Genuine I/O errors (EACCES, EISDIR, …) still propagate — those are conditions
 * a caller must not paper over.
 *
 * The next writeJson replaces the bad file, so this self-heals.
 */
async function readJson(appBaseDir, identity, fileName, fallback = null) {
    const file = userPath(appBaseDir, identity, fileName);
    let raw;
    try {
        raw = await fs.readFile(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
    }

    try {
        return JSON.parse(raw);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            `[userStore] ${file} is not valid JSON (${raw.length} bytes): ${err.message}. ` +
            'Using the default; the next write will replace it.'
        );
        return fallback;
    }
}

/**
 * Write a JSON file to a user's folder, creating the folder as needed.
 *
 * ATOMIC: serialise, write a sibling temp file, then rename over the target.
 * `fs.rename` within a directory is atomic on NTFS and POSIX alike, so a reader
 * sees either the old file or the new one — never a half-written one. A plain
 * writeFile truncates first, which is what leaves a zero-byte file behind when
 * the process is killed (or the disk fills) mid-write. That is the file readJson
 * above now has to tolerate; this is why it stops being created.
 */
async function writeJson(appBaseDir, identity, fileName, data) {
    const file = userPath(appBaseDir, identity, fileName);
    // Serialise BEFORE touching disk — a circular structure or a throwing
    // toJSON() must not leave a temp file behind, or worse, a truncated target.
    const payload = JSON.stringify(data, null, 2);

    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temp, payload, 'utf8');
        await fs.rename(temp, file);
    } catch (err) {
        await fs.unlink(temp).catch(() => {});
        throw err;
    }
}

/** Read a text file from a user's folder. Missing file → `fallback`. */
async function readText(appBaseDir, identity, fileName, fallback = null) {
    try {
        return await fs.readFile(userPath(appBaseDir, identity, fileName), 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
    }
}

/**
 * Write a text file to a user's folder, creating the folder as needed.
 * Atomic, for the same reason as writeJson — a half-written personal dashboard
 * is not something the reader can detect the way malformed JSON can be.
 */
async function writeText(appBaseDir, identity, fileName, text) {
    const file = userPath(appBaseDir, identity, fileName);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temp, String(text), 'utf8');
        await fs.rename(temp, file);
    } catch (err) {
        await fs.unlink(temp).catch(() => {});
        throw err;
    }
}

/**
 * Read a binary file from a user's folder. Missing file -> `fallback`.
 *
 * Separate from readText because that one hardcodes 'utf8': handed a voice
 * note it returns mojibake that re-encodes to a different byte string, so the
 * recording comes back corrupt rather than missing. Buffers in, buffers out.
 */
async function readBinary(appBaseDir, identity, fileName, fallback = null) {
    try {
        return await fs.readFile(userPath(appBaseDir, identity, fileName));
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
    }
}

/**
 * Write a binary file to a user's folder, creating the folder as needed.
 * Atomic, for the same reason as writeJson and writeText — and more so here:
 * a truncated media file is not merely incomplete, it usually will not decode
 * at all, and the browser reports that as a blank player with no error.
 */
async function writeBinary(appBaseDir, identity, fileName, buffer) {
    const file = userPath(appBaseDir, identity, fileName);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temp, buffer);
        await fs.rename(temp, file);
    } catch (err) {
        await fs.unlink(temp).catch(() => {});
        throw err;
    }
}

module.exports = {
    ROOT,
    userDir,
    userPath,
    readJson,
    writeJson,
    readText,
    writeText,
    readBinary,
    writeBinary
};
