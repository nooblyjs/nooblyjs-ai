/**
 * @fileoverview filePolicy path layout — the single source of truth for where a
 * document's derived / originals / context artifacts live.
 *
 * The contract under test: every per-document artifact is FOLDER-LOCAL, in a
 * `.system/` directory inside the document's own folder. Nothing mirrors the
 * space tree from a root namespace. The space root is itself a folder holding
 * documents, so `<space>/.system/` legitimately carries BOTH the root's own
 * artifacts and the two space-scoped dirs (`templates`, `useractivity`) — these
 * tests pin that dual role so a future change can't silently conflate them.
 *
 * `contextProcessor.js` in the sibling noobly-app-wiki-workflows
 * repo must resolve identical paths; see the cross-repo notes in filePolicy.js.
 */

'use strict';

const {
  SYSTEM_DIR,
  DERIVED_DIR,
  ORIGINALS_DIR,
  CONTEXT_DIR,
  FOLDER_CONTEXT_FILE,
  SPACE_SCOPED_SYSTEM_DIRS,
  toDerivedRelPath,
  fromDerivedRelPath,
  isDerivedRelPath,
  toOriginalsRelPath,
  fromOriginalsRelPath,
  isOriginalsRelPath,
  originalCandidatesForMarkdown,
  toContextRelPath,
  fromContextRelPath,
  isContextRelPath,
  isSpaceScopedSystemPath,
} = require('../../../src/shared/utils/filePolicy');

describe('filePolicy — folder-local artifact layout', () => {
  test('all artifact dirs hang off the folder-local .system namespace', () => {
    expect(SYSTEM_DIR).toBe('.system');
    expect(DERIVED_DIR).toBe('.system/derived');
    expect(ORIGINALS_DIR).toBe('.system/originals');
    expect(CONTEXT_DIR).toBe('.system/context');
  });

  describe('derived', () => {
    test('sits beside its source, keeping the full name + .md', () => {
      expect(toDerivedRelPath('Standards/Report.pdf'))
        .toBe('Standards/.system/derived/Report.pdf.md');
      expect(toDerivedRelPath('A/B/C/Deep.docx'))
        .toBe('A/B/C/.system/derived/Deep.docx.md');
    });

    test('a space-root document uses the root folder\'s own .system', () => {
      expect(toDerivedRelPath('RootDoc.pdf')).toBe('.system/derived/RootDoc.pdf.md');
    });

    test('keeping the full name stops same-stem documents colliding', () => {
      expect(toDerivedRelPath('Sub/report.pdf'))
        .not.toBe(toDerivedRelPath('Sub/report.docx'));
    });

    test('round-trips back to the source', () => {
      for (const rel of ['Standards/Report.pdf', 'A/B/C/Deep.docx', 'RootDoc.pdf']) {
        expect(fromDerivedRelPath(toDerivedRelPath(rel))).toBe(rel);
      }
    });

    test('windows separators are normalised', () => {
      expect(toDerivedRelPath('Standards\\Report.pdf'))
        .toBe('Standards/.system/derived/Report.pdf.md');
    });
  });

  describe('originals', () => {
    test('keeps the source name and extension, folder-local', () => {
      expect(toOriginalsRelPath('Standards/Report.docx'))
        .toBe('Standards/.system/originals/Report.docx');
      expect(toOriginalsRelPath('Report.docx')).toBe('.system/originals/Report.docx');
    });

    test('round-trips back to the source', () => {
      expect(fromOriginalsRelPath(toOriginalsRelPath('A/B/Deck.pptx'))).toBe('A/B/Deck.pptx');
    });

    test('candidates for a markdown page probe the page\'s own folder', () => {
      const candidates = originalCandidatesForMarkdown('Standards/Report.md');
      expect(candidates).toContain('Standards/.system/originals/Report.docx');
      expect(candidates).toContain('Standards/.system/originals/Report.xlsx');
      expect(candidates.every(c => c.startsWith('Standards/.system/originals/'))).toBe(true);
    });

    test('candidates are empty for a non-markdown path', () => {
      expect(originalCandidatesForMarkdown('Standards/Report.pdf')).toEqual([]);
    });
  });

  describe('context', () => {
    test('a markdown source keeps its own name', () => {
      expect(toContextRelPath('Standards/Report.md'))
        .toBe('Standards/.system/context/Report.md');
    });

    test('a binary source keeps its full name + .md (matching the workflow)', () => {
      expect(toContextRelPath('Standards/Report.pdf'))
        .toBe('Standards/.system/context/Report.pdf.md');
      expect(toContextRelPath('Standards/Deck.docx'))
        .toBe('Standards/.system/context/Deck.docx.md');
    });

    test('a space-root document uses the root folder\'s own .system', () => {
      expect(toContextRelPath('home.md')).toBe('.system/context/home.md');
    });

    test('round-trips for both markdown and binary sources', () => {
      for (const rel of ['Standards/Report.md', 'Standards/Report.pdf', 'A/B/Deck.docx']) {
        expect(fromContextRelPath(toContextRelPath(rel))).toBe(rel);
      }
    });

    test('the folder roll-up belongs to the folder, not a document', () => {
      expect(fromContextRelPath(`Standards/${CONTEXT_DIR}/${FOLDER_CONTEXT_FILE}`)).toBeNull();
    });
  });

  describe('predicates', () => {
    test('recognise artifacts at any depth, including the space root', () => {
      expect(isDerivedRelPath('Standards/.system/derived/R.pdf.md')).toBe(true);
      expect(isDerivedRelPath('.system/derived/R.pdf.md')).toBe(true);
      expect(isOriginalsRelPath('A/B/.system/originals/R.docx')).toBe(true);
      expect(isContextRelPath('.system/context/home.md')).toBe(true);
    });

    test('do not match ordinary documents', () => {
      expect(isDerivedRelPath('Standards/R.pdf')).toBe(false);
      expect(isContextRelPath('Standards/R.md')).toBe(false);
    });

    test('anchor on segment boundaries', () => {
      // A folder literally named `x.system` must not be mistaken for the namespace.
      expect(isDerivedRelPath('x.system/derived/a.md')).toBe(false);
      expect(fromDerivedRelPath('x.system/derived/a.md')).toBeNull();
    });
  });

  describe('space root serves two roles at once', () => {
    test('templates and useractivity are space-scoped', () => {
      expect(SPACE_SCOPED_SYSTEM_DIRS).toEqual(['templates', 'useractivity']);
      expect(isSpaceScopedSystemPath('.system/templates/default.json')).toBe(true);
      expect(isSpaceScopedSystemPath('.system/useractivity/someone/visits.json')).toBe(true);
    });

    test('the root\'s own artifacts are NOT space-scoped', () => {
      expect(isSpaceScopedSystemPath(toDerivedRelPath('home.md'))).toBe(false);
      expect(isSpaceScopedSystemPath(toContextRelPath('home.md'))).toBe(false);
      expect(isSpaceScopedSystemPath('.system/file-order.json')).toBe(false);
    });

    test('a subfolder merely named "templates" is not space-scoped', () => {
      expect(isSpaceScopedSystemPath('templates/.system/derived/x.pdf.md')).toBe(false);
    });

    test('space-scoped dirs never collide with artifact dirs', () => {
      for (const scoped of SPACE_SCOPED_SYSTEM_DIRS) {
        expect([DERIVED_DIR, ORIGINALS_DIR, CONTEXT_DIR])
          .not.toContain(`${SYSTEM_DIR}/${scoped}`);
      }
    });
  });
});
