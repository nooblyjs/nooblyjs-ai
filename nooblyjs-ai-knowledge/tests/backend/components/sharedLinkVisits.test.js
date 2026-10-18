'use strict';

/**
 * Shared link visits — ```SharedLinkVisits```.
 *
 * The block is a rolling deep-link audit trail that is SUPPOSED to be a single
 * fence per document. It isn't, reliably: a wholesale rewrite by a content
 * workflow (or a hand edit, or a merge of two checkouts) leaves extras behind,
 * and the reader gets a stack of identical collapsed "Shared link visits"
 * strips instead of one trail — observed live on the space landing pages, with
 * `Engineering.md` carrying two blocks holding byte-identical entries.
 *
 * Two independent implementations have to agree that N blocks are ONE trail:
 *
 *   1. The writer — components/sharedLinkVisitBlocks.js — folds them together
 *      on the next visit so the duplicates stop accumulating on disk.
 *   2. The browser parser — `coalesceSharedLinkVisits` — folds them at render
 *      time, so a page reads correctly while the duplicates are still there
 *      and for documents nothing writes to.
 *
 * The parser is a plain `<script>` file rather than a module, so it is
 * evaluated in a `vm` with the globals it expects — the same harness as
 * landingBlocks/navChainCollapse.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { marked } = require('marked');

const blocks = require('../../../src/wiki/components/sharedLinkVisitBlocks');

const REPO = path.resolve(__dirname, '../../..');
const PARSER = path.join(REPO, 'public/js/markdown/markdown-parser.js');
const CHROME_PARSER = path.join(REPO, 'applications/chrome/wiki/js/markdown-parser.js');

function loadParser(file) {
    const ctx = { marked, console, setTimeout, module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.basename(file) });
    return vm.runInContext('markdownParser', ctx);
}

const A = '2026-07-22T17:43:51.769Z  a@example.com  (sharedBy: (direct))';
const B = '2026-07-22T17:45:15.712Z  b@example.com  (sharedBy: teams)';
const NEW = '2026-08-24T09:00:00.000Z  new@example.com  (sharedBy: (direct))';

const fence = (...lines) => '```SharedLinkVisits\n' + lines.join('\n') + '\n```\n';

/** How many visit blocks a document holds. */
const fenceCount = (md) => (md.match(/```SharedLinkVisits/gi) || []).length;
/** How many rendered "Shared link visits" sections a page holds. */
const sectionCount = (html) => (html.match(/kr-shared-visits"/g) || []).length;
/** How many visit rows a rendered page holds. */
const rowCount = (html) => (html.match(/class="kr-shared-visit"/g) || []).length;

describe('sharedLinkVisitBlocks (writer)', () => {
    describe('readVisits', () => {
        it('reads entries from a single block', () => {
            const { entries, blocks: n, firstAt } = blocks.readVisits('# Doc\n\n' + fence(A, B));
            expect(entries).toEqual([A, B]);
            expect(n).toBe(1);
            expect(firstAt).toBeGreaterThan(-1);
        });

        it('reports no block for a document without one', () => {
            const { entries, blocks: n, firstAt } = blocks.readVisits('# Doc\n\nBody.\n');
            expect(entries).toEqual([]);
            expect(n).toBe(0);
            expect(firstAt).toBe(-1);
        });

        it('merges across blocks and de-duplicates identical entries', () => {
            // The observed shape: the same two visits copied into two blocks.
            const md = '# Doc\n\n' + fence(A, B) + '\n' + fence(A, B);
            const { entries, blocks: n } = blocks.readVisits(md);
            expect(n).toBe(2);
            expect(entries).toEqual([A, B]);
        });

        it('is stateless across calls (the module regex is /g)', () => {
            const md = '# Doc\n\n' + fence(A);
            expect(blocks.readVisits(md).entries).toEqual([A]);
            expect(blocks.readVisits(md).entries).toEqual([A]);
        });
    });

    describe('recordVisit', () => {
        it('creates the block when absent', () => {
            const { content, added, merged } = blocks.recordVisit('# Doc\n\nBody.\n', NEW);
            expect(added).toBe(true);
            expect(merged).toBe(0);
            expect(fenceCount(content)).toBe(1);
            expect(content).toContain(NEW);
            expect(content).toMatch(/Body\.\n\n```SharedLinkVisits\n/);
        });

        it('creates the block for an empty document without leading blank lines', () => {
            const { content } = blocks.recordVisit('', NEW);
            expect(content.startsWith('```SharedLinkVisits\n')).toBe(true);
        });

        it('appends to an existing block, keeping one fence', () => {
            const { content, added, merged } = blocks.recordVisit('# Doc\n\n' + fence(A), NEW);
            expect(added).toBe(true);
            expect(merged).toBe(0);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([A, NEW]);
        });

        it('folds duplicate blocks into one at the position of the first', () => {
            const md = '# Doc\n\nBody.\n\n' + fence(A, B) + '\n' + fence(A, B);
            const { content, merged } = blocks.recordVisit(md, NEW);
            expect(merged).toBe(1);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([A, B, NEW]);
            expect(content).toContain('# Doc');
            expect(content).toContain('Body.');
        });

        it('folds eight duplicate blocks into one', () => {
            const md = '# Doc\n\n' + (fence(A, B) + '\n').repeat(8);
            const { content, merged } = blocks.recordVisit(md, NEW);
            expect(merged).toBe(7);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([A, B, NEW]);
        });

        it('does not accumulate blank lines at EOF across repeated visits', () => {
            let md = '# Doc\n\n' + fence(A) + '\n' + fence(B);
            for (let i = 0; i < 5; i++) {
                md = blocks.recordVisit(md, `2026-08-24T09:0${i}:00.000Z  x@example.com  (sharedBy: (direct))`).content;
            }
            expect(fenceCount(md)).toBe(1);
            expect(md).not.toMatch(/\n{3,}/);
            expect(md.endsWith('```\n')).toBe(true);
        });

        it('matches a lower-cased fence label', () => {
            const md = '# Doc\n\n```sharedlinkvisits\n' + A + '\n```\n';
            const { content } = blocks.recordVisit(md, NEW);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([A, NEW]);
        });

        it('matches a CRLF block — a miss would duplicate rather than update', () => {
            const md = '# Doc\r\n\r\n```SharedLinkVisits\r\n' + A + '\r\n```\r\n';
            const { content } = blocks.recordVisit(md, NEW);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([A, NEW]);
        });

        it('handles an empty block', () => {
            const { content } = blocks.recordVisit('# Doc\n\n```SharedLinkVisits\n```\n', NEW);
            expect(fenceCount(content)).toBe(1);
            expect(blocks.readVisits(content).entries).toEqual([NEW]);
        });

        it('leaves other fenced code alone', () => {
            const md = '# Doc\n\n```js\nconst x = 1;\n```\n\n' + fence(A);
            const { content } = blocks.recordVisit(md, NEW);
            expect(content).toContain('```js\nconst x = 1;\n```');
            expect(fenceCount(content)).toBe(1);
        });

        it('ignores a repeat of an entry already recorded', () => {
            const { content, added } = blocks.recordVisit('# Doc\n\n' + fence(A), A);
            expect(added).toBe(false);
            expect(blocks.readVisits(content).entries).toEqual([A]);
        });

        it('repairs duplicates with no visit line — the heal-only path', () => {
            const md = '# Doc\n\n' + fence(A, B) + '\n' + fence(A, B);
            const { content, merged, added } = blocks.recordVisit(md);
            expect(added).toBe(false);
            expect(merged).toBe(1);
            expect(fenceCount(content)).toBe(1);
        });

        it('returns the original bytes when there is nothing to record or repair', () => {
            const md = '# Doc\n\n' + fence(A);
            expect(blocks.recordVisit(md).content).toBe(md);
        });
    });
});

describe.each([
    ['web parser', PARSER],
    ['chrome vendored parser', CHROME_PARSER]
])('%s — coalesceSharedLinkVisits (render)', (_label, file) => {
    let parser;
    beforeAll(() => { parser = loadParser(file); });

    it('renders a single block as one collapsed section', () => {
        const html = parser.parse('# Doc\n\n' + fence(A, B));
        expect(sectionCount(html)).toBe(1);
        expect(rowCount(html)).toBe(2);
        // Collapsed by default: <details> with no `open`.
        expect(html).toContain('<details class="kr-shared-visits-details">');
        expect(html).not.toMatch(/<details[^>]*\sopen/);
    });

    it('renders EIGHT duplicate blocks as ONE collapsed section', () => {
        const html = parser.parse('# Doc\n\n' + (fence(A, B) + '\n').repeat(8));
        expect(sectionCount(html)).toBe(1);
        // ...and the repeated entries collapse to two rows, not sixteen.
        expect(rowCount(html)).toBe(2);
    });

    it('merges distinct entries from separate blocks', () => {
        const html = parser.parse('# Doc\n\n' + fence(A) + '\n' + fence(B));
        expect(sectionCount(html)).toBe(1);
        expect(rowCount(html)).toBe(2);
        expect(html).toContain('a@example.com');
        expect(html).toContain('b@example.com');
        expect(html).toContain('>2<'); // count badge
    });

    it('keeps the rest of the document intact', () => {
        const html = parser.parse('# Title\n\nBody text.\n\n' + fence(A) + '\n' + fence(B));
        expect(html).toContain('Body text.');
        expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
        expect(sectionCount(html)).toBe(1);
    });

    it('leaves a document with no visits block alone', () => {
        const html = parser.parse('# Doc\n\nBody text.\n');
        expect(sectionCount(html)).toBe(0);
    });

    it('agrees with the writer on what the merged trail contains', () => {
        const md = '# Doc\n\n' + fence(A, B) + '\n' + fence(A) + '\n' + fence(B);
        const written = blocks.readVisits(blocks.recordVisit(md).content).entries;
        const html = parser.parse(md);
        expect(written).toEqual([A, B]);
        expect(rowCount(html)).toBe(written.length);
    });
});
