/**
 * @fileoverview Which file changes may trigger an AI context rebuild.
 *
 * Regression cover for a feedback loop found in production logs: the chat's
 * retrieval cache writes `<folder>/.aicontext/<Source>-summary.md`, whose BASENAME
 * has no leading dot. The old gate checked only `path.basename`, so every chat
 * turn scheduled a context build for the `.aicontext` folder itself and the
 * workflow wrote `.aicontext/.system/context/_folder.md` and seeded
 * `.aicontext/.home.md` — an AI run per chat message, littering a folder that is
 * meant to be disposable.
 *
 * `.aicontext` deliberately stays OUT of the watcher's IGNORED_SEGMENT (its
 * summaries are search-indexed and the watcher is the only thing that feeds the
 * incremental index), so this gate is what has to hold.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * `isContextEligible` is module-private. Lift it out of the source rather than
 * exporting it purely for tests, so production surface stays unchanged.
 */
function loadIsContextEligible() {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../src/wiki/activities/fileWatcher.js'), 'utf8');
  const body = src.match(/function isContextEligible[\s\S]*?\n}/);
  if (!body) throw new Error('isContextEligible not found — did fileWatcher.js change shape?');
  const CONVERTIBLE_EXT = new Set(['.docx', '.pdf', '.xlsx', '.xls']);
  return new Function('path', 'CONVERTIBLE_EXT', `${body[0]}; return isContextEligible;`)(
    path, CONVERTIBLE_EXT);
}

const isContextEligible = loadIsContextEligible();

describe('isContextEligible', () => {
  test('accepts markdown and the binaries that yield derived text', () => {
    expect(isContextEligible('Standards/Notes.md')).toBe(true);
    expect(isContextEligible('Standards/Report.pdf')).toBe(true);
    expect(isContextEligible('Standards/Deck.docx')).toBe(true);
    expect(isContextEligible('Standards/Data.xlsx')).toBe(true);
    expect(isContextEligible('home.md')).toBe(true);
  });

  test('rejects files with no derivable text', () => {
    expect(isContextEligible('Standards/photo.png')).toBe(false);
    expect(isContextEligible('Standards/clip.mp4')).toBe(false);
    expect(isContextEligible('Standards/Deck.pptx')).toBe(false); // no Node converter
  });

  test('rejects anything inside the chat retrieval cache', () => {
    // The exact shape that caused the loop: ordinary basename, hidden folder.
    expect(isContextEligible('Sub/.aicontext/Features-summary.md')).toBe(false);
    expect(isContextEligible('Sub/.aicontext/.home-summary.md')).toBe(false);
    expect(isContextEligible('A/B/C/.aicontext/Deep-summary.md')).toBe(false);
  });

  test('rejects anything inside the folder-local .system namespace', () => {
    expect(isContextEligible('Sub/.system/context/_folder.md')).toBe(false);
    expect(isContextEligible('Sub/.system/context/Report.pdf.md')).toBe(false);
    expect(isContextEligible('Sub/.system/derived/Report.pdf.md')).toBe(false);
    expect(isContextEligible('.system/context/home.md')).toBe(false);
  });

  test('rejects dot-prefixed files, so the build\'s own seeding cannot re-trigger it', () => {
    expect(isContextEligible('Sub/.home.md')).toBe(false);
    expect(isContextEligible('.home.md')).toBe(false);
  });

  test('rejects a hidden segment at ANY depth, not just the file name', () => {
    expect(isContextEligible('.hidden/Notes.md')).toBe(false);
    expect(isContextEligible('A/.hidden/B/Notes.md')).toBe(false);
    expect(isContextEligible('A/B/.git/config.md')).toBe(false);
  });

  test('handles windows separators', () => {
    expect(isContextEligible('Sub\\.aicontext\\Features-summary.md')).toBe(false);
    expect(isContextEligible('Standards\\Notes.md')).toBe(true);
  });

  test('rejects empty input', () => {
    expect(isContextEligible('')).toBe(false);
    expect(isContextEligible(null)).toBe(false);
    expect(isContextEligible(undefined)).toBe(false);
  });

  test('takes a SPACE-RELATIVE path — an absolute one would self-reject', () => {
    // The default space lives under `.application/`, so passing an absolute path
    // would make every file ineligible. Documents why callers pass relativePath.
    expect(isContextEligible('C:/work/.application/spaces/1/files/Notes.md')).toBe(false);
    expect(isContextEligible('Notes.md')).toBe(true);
  });
});
