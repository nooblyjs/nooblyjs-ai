/**
 * @fileoverview Path-traversal containment is enforced at the source.
 *
 * Locks down the fix for `datadog/javascript-pathtraversal`:
 *
 *   • `shared/utils/pathSafety.containedPath` rejects any client sub-path that
 *     resolves outside its base directory, replacing the weak
 *     `resolved.startsWith(baseDir)` guard that several routes hand-rolled.
 *   • `wiki/components/noteStore.normalisePath` drops '', '.', and '..'
 *     segments so a note's FOLDER — derived from a client `target.path` and fed
 *     to `path.join` — can never climb out of the content root.
 */

'use strict';

const path = require('node:path');

const {
  PATH_ESCAPE,
  isInside,
  containedPath
} = require('../../../src/shared/utils/pathSafety');

// normalisePath is not exported directly; exercise it through folderFor/baseFor,
// which is exactly the traversal sink the analyzer flagged.
const noteStore = require('../../../src/wiki/components/noteStore');

describe('pathSafety.containedPath', () => {
  const base = path.resolve('/srv/app/json');

  test('returns the resolved path for a legitimate sub-path', () => {
    expect(containedPath(base, 'reports/q3.json')).toBe(path.join(base, 'reports', 'q3.json'));
  });

  test('allows the base directory itself (empty sub-path)', () => {
    expect(containedPath(base, '')).toBe(base);
  });

  test('rejects a parent-directory traversal', () => {
    expect(() => containedPath(base, '../secrets.json')).toThrow();
    try {
      containedPath(base, '../../etc/passwd');
    } catch (err) {
      expect(err.code).toBe(PATH_ESCAPE);
    }
  });

  test('rejects a traversal buried mid-path', () => {
    expect(() => containedPath(base, 'reports/../../escape.json')).toThrow();
  });

  test('rejects an absolute path (would discard the base)', () => {
    expect(() => containedPath(base, '/etc/passwd')).toThrow();
  });

  test('rejects a Windows drive-letter absolute path', () => {
    expect(() => containedPath(base, 'C:\\Windows\\win.ini')).toThrow();
  });

  test('rejects a sibling directory that shares the base as a string prefix', () => {
    // The classic startsWith() weakness: "/srv/app/json-secret" starts with
    // "/srv/app/json" as a string but is a different directory.
    expect(isInside(base, `${base}-secret/x`)).toBe(false);
  });

  test('isInside accepts the base and true descendants', () => {
    expect(isInside(base, base)).toBe(true);
    expect(isInside(base, path.join(base, 'a', 'b.txt'))).toBe(true);
  });
});

describe('noteStore.normalisePath (via folderFor/baseFor)', () => {
  const root = path.resolve('/srv/content');

  test('a document target files beside the document, inside the root', () => {
    const target = { type: 'document', path: 'a/b/Doc.md' };
    expect(noteStore.folderFor(target)).toBe('a/b');
    expect(noteStore.baseFor(root, target)).toBe(path.join(root, 'a', 'b'));
  });

  test('a folder target files inside the folder', () => {
    const target = { type: 'folder', path: 'a/b' };
    expect(noteStore.folderFor(target)).toBe('a/b');
  });

  test('the space root collapses to the root regardless of separator noise', () => {
    for (const raw of ['', '/', '\\', '///']) {
      const target = { type: 'folder', path: raw };
      expect(noteStore.folderFor(target)).toBe('');
      expect(noteStore.baseFor(root, target)).toBe(root);
    }
  });

  test('parent-directory segments are stripped, so the folder stays in the root', () => {
    const target = { type: 'document', path: '../../../etc/passwd' };
    const base = noteStore.baseFor(root, target);
    // Whatever the client sent, the derived base must remain inside the root.
    expect(isInside(root, base)).toBe(true);
    expect(base.includes('..')).toBe(false);
  });

  test('a mixed legitimate + traversal path keeps only the legitimate segments', () => {
    const target = { type: 'folder', path: 'a/../../b/./c' };
    // '..' and '.' dropped -> 'a/b/c'
    expect(noteStore.folderFor(target)).toBe('a/b/c');
    expect(isInside(root, noteStore.baseFor(root, target))).toBe(true);
  });

  test('backslash separators are normalised, then traversal segments dropped', () => {
    // '\' -> '/', giving 'a/../../b'; the '..' segments are DROPPED (not applied
    // as directory-up moves), leaving 'a/b'. Dropping rather than applying is
    // the safer choice: a legitimate leading segment can never be cancelled out.
    const target = { type: 'folder', path: 'a\\..\\..\\b' };
    expect(noteStore.folderFor(target)).toBe('a/b');
    expect(isInside(root, noteStore.baseFor(root, target))).toBe(true);
  });
});
