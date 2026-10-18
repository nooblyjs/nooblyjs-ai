/**
 * @fileoverview Turn a user-typed file name into the name that lands on disk —
 * VERBATIM wherever the filesystem allows it.
 *
 * WHY THIS EXISTS. `POST /applications/wiki/api/documents` used to derive the
 * file name from the document title with a URL slug:
 *
 *     title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
 *
 * That is the right transform for a slug and the wrong one for a file name. It
 * lowercased the name, collapsed spaces to hyphens, and — because a dot is not
 * `[a-z0-9]` — ate the LEADING DOT, so `.Engineering.md` was created as
 * `engineering.md`. A leading dot is load-bearing here: a hidden root-level
 * `.<space>.md` is exactly how the several spaces sharing one content root each
 * keep their own landing page side by side (see `spaceHomeCandidates`), so the
 * slug did not just rename the file, it silently produced a DIFFERENT file that
 * no space resolves as its home.
 *
 * The rule is therefore: honour what the user typed, and reject — loudly — only
 * what a filesystem genuinely cannot store. Never silently rewrite. Anything
 * this module changes without complaint (trimming outer whitespace, appending a
 * missing extension) is either invisible or additive, and the caller gets the
 * final name back so the UI can show it.
 *
 * Note the deliberate asymmetry with slugs: `promptStore.js`, `noteStore.js`
 * and friends still slugify, and should — those names are machine-chosen keys
 * that nobody types or reads back. This module is only for names a person
 * authored.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-18
 */

'use strict';

const path = require('node:path');
const { isTextFile } = require('./fileTypeUtils');

/** Default extension for an extension-less document name. */
const DEFAULT_EXTENSION = '.md';

/**
 * Longest name we will write. Most filesystems cap a single path SEGMENT at 255
 * bytes; 200 characters leaves room for multi-byte characters and for the
 * `.system/derived/<name>.md` sidecars that are built by appending to it.
 */
const MAX_NAME_LENGTH = 200;

/** Characters no Windows path may contain (and that break URLs elsewhere). */
const ILLEGAL_CHARS = /[<>:"|?*]/;

/** C0 control characters, including the NUL byte used for path truncation. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Windows reserved device names — unusable with or without an extension. */
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/**
 * Build a 400-able error.
 *
 * @param {string} message - shown to the user as typed-in-context guidance
 * @returns {Error}
 */
function invalidName(message) {
  const error = new Error(message);
  error.code = 'INVALID_FILE_NAME';
  return error;
}

/**
 * Validate a single user-typed path SEGMENT and return it unchanged apart from
 * surrounding whitespace.
 *
 * The directory is never part of this: callers pass the folder separately, so a
 * separator in the name means the caller and the user disagree about what was
 * typed. Rejecting is safer than taking the basename, which would quietly file
 * the document somewhere other than where the user asked.
 *
 * @param {string} raw - the name exactly as the user typed it
 * @returns {string} the same name, trimmed
 * @throws {Error} with `code: 'INVALID_FILE_NAME'`
 */
function sanitizeFileName(raw) {
  const name = String(raw == null ? '' : raw).trim();

  if (!name) {
    throw invalidName('Name cannot be empty');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw invalidName('Name cannot contain a path separator (/ or \\)');
  }
  if (ILLEGAL_CHARS.test(name)) {
    throw invalidName('Name cannot contain: < > : " | ? *');
  }
  if (CONTROL_CHARS.test(name)) {
    throw invalidName('Name cannot contain control characters');
  }
  // `.` and `..` traverse; a name of nothing but dots has no stem at all.
  if (/^\.+$/.test(name)) {
    throw invalidName('Name must contain more than dots');
  }
  if (RESERVED_DEVICE_NAMES.test(name)) {
    throw invalidName(`"${name.split('.')[0]}" is a reserved device name on Windows`);
  }
  // Windows silently drops a trailing dot, so the name on disk would not be the
  // name that was asked for — which is the whole failure this module exists to
  // stop. Trailing SPACES are dropped the same way but never reach here: `trim`
  // above already removed them, and removing outer whitespace is invisible
  // rather than a rewrite of the name.
  if (/\.$/.test(name)) {
    throw invalidName('Name cannot end with a dot');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw invalidName(`Name cannot be longer than ${MAX_NAME_LENGTH} characters`);
  }

  return name;
}

/**
 * Whether a name already carries an extension we would author content into.
 *
 * Deliberately an ALLOW-LIST rather than "has a dot": document names carry
 * version numbers (`Q3 Plan v1.2`), and `path.extname` reads `.2` as an
 * extension, so a dot test would leave that file with no extension at all.
 *
 * `path.extname` returns '' for a dot-file with no second dot (`.Engineering`),
 * which is what we want — that name gets `.md` appended.
 *
 * @param {string} name
 * @returns {boolean}
 */
function hasKnownTextExtension(name) {
  return path.extname(name) !== '' && isTextFile(name);
}

/**
 * Validate a user-typed document name and give it an extension if it has none.
 *
 * `.md` is appended only when the name carries no recognised text extension, so
 * `notes.txt` and `config.json` are created as typed while `Meeting Notes` and
 * `.Engineering` become `Meeting Notes.md` and `.Engineering.md`. A binary
 * extension (`Report.pdf`) also picks up `.md`, because this route writes text
 * content — an empty file with a binary extension is a broken document.
 *
 * @param {string} raw - the name exactly as the user typed it
 * @returns {string} the file name to create
 * @throws {Error} with `code: 'INVALID_FILE_NAME'`
 */
function toDocumentFileName(raw) {
  const name = sanitizeFileName(raw);
  if (hasKnownTextExtension(name)) return name;

  const withExtension = name + DEFAULT_EXTENSION;
  if (withExtension.length > MAX_NAME_LENGTH) {
    throw invalidName(`Name cannot be longer than ${MAX_NAME_LENGTH - DEFAULT_EXTENSION.length} characters`);
  }
  return withExtension;
}

/**
 * Human-readable title for a file name — the stem, with the leading dot of a
 * hidden file kept off the title but the rest of the name untouched.
 *
 * Used to seed `# <title>` content, never to derive a path.
 *
 * @param {string} fileName
 * @returns {string}
 */
function titleFromFileName(fileName) {
  const name = String(fileName == null ? '' : fileName).trim();
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return stem.replace(/^\.+/, '') || name;
}

module.exports = {
  DEFAULT_EXTENSION,
  MAX_NAME_LENGTH,
  sanitizeFileName,
  hasKnownTextExtension,
  toDocumentFileName,
  titleFromFileName
};
