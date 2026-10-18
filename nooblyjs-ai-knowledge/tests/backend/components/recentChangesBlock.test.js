'use strict';

/**
 * The ```recent-changes``` block — grammar, placeholder, and the two
 * implementations of it that must not drift.
 *
 * Like the landing blocks, this lives in the browser-side parser and block
 * editor, which are plain `<script>` files rather than modules, so both are
 * evaluated in a `vm` with the globals they expect.
 *
 * Three failure modes, all of them quiet:
 *
 *   1. Prefix detection — `isCustomBlockStart` matches any line merely STARTING
 *      with a block name, so without fence-only registration a paragraph
 *      opening "Recent-changes …" would be swallowed whole and vanish.
 *   2. Grammar drift — the parser (render side) and the editor block (edit
 *      side) each implement `key: value`. If they drift, a page renders one way
 *      and edits another, and a save quietly rewrites the author's settings.
 *      `days` is the sharp edge: 0 means ALL TIME, and a fallback that treats it
 *      as "unset" silently narrows the block to 30 days on the next save.
 *   3. The placeholder's data attributes are the entire contract with
 *      recentChangesController. Losing one turns a configured panel into a
 *      default one, which still renders and still looks fine.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { marked } = require('marked');

const REPO = path.resolve(__dirname, '../../..');
const PARSER = path.join(REPO, 'public/js/markdown/markdown-parser.js');
const EDITOR_BLOCKS = path.join(REPO, 'public/js/markdown/markdown-editor-blocks.js');

function loadParser() {
    const ctx = { marked, console, setTimeout, module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(PARSER, 'utf8'), ctx, { filename: 'markdown-parser.js' });
    // `markdownParser` and the class are top-level `const`/`class` bindings, so
    // they live in the context's lexical scope rather than on its global object.
    return {
        parseMarkdown: ctx.parseMarkdown,
        instance: vm.runInContext('markdownParser', ctx),
        MarkdownParser: vm.runInContext('MarkdownParser', ctx)
    };
}

function loadEditorBlocks() {
    const defs = [];
    const ctx = {
        window: { MarkdownEditor: { registerBlock: (d) => defs.push(d) } },
        console,
        document: {}
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(EDITOR_BLOCKS, 'utf8'), ctx, { filename: 'markdown-editor-blocks.js' });
    return Object.fromEntries(defs.map((d) => [d.type, d]));
}

const parser = loadParser();
const editorBlocks = loadEditorBlocks();
const block = editorBlocks['recent-changes'];
const pinnedBlock = editorBlocks['pinned-recent-changes'];
const render = (md) => parser.parseMarkdown(md);
const fence = (...lines) => ['```recent-changes', ...lines, '```'].join('\n');
const pinnedFence = (...lines) => ['```pinned-recent-changes', ...lines, '```'].join('\n');

/** Read a fence through the EDITOR's side of the grammar. */
function editorParse(...lines) {
    const all = fence(...lines).split('\n');
    const result = block.fromMarkdown(all[0], all, 0);
    return result && result.data;
}

/** Same, for the pinned variant. */
function pinnedEditorParse(...lines) {
    const all = pinnedFence(...lines).split('\n');
    const result = pinnedBlock.fromMarkdown(all[0], all, 0);
    return result && result.data;
}

describe('recent-changes — the block is fence-only', () => {
    test('a paragraph opening with the block name is not swallowed', () => {
        const html = render('Recent-changes to the policy are listed below.');
        expect(html).toContain('Recent-changes to the policy are listed below.');
        expect(html).not.toContain('kr-recent');
    });

    test('a fence IS recognised', () => {
        expect(render(fence('folder: Sell'))).toContain('class="kr-recent"');
    });
});

describe('recent-changes — the placeholder contract', () => {
    test('the source attribute is what tells the hydrator which block it holds', () => {
        expect(render(fence('folder: Sell'))).toContain('data-recent-source="folder"');
        expect(render(pinnedFence('limit: 6'))).toContain('data-recent-source="pins"');
    });

    test('every setting reaches the hydrator as a data attribute', () => {
        const html = render(fence(
            'title: Recently updated',
            'folder: Business Processes',
            'space: Engineering Space',
            'days: 14',
            'limit: 6',
            'across: 4'
        ));

        expect(html).toContain('data-recent-placeholder');
        expect(html).toContain('data-recent-folder="Business Processes"');
        expect(html).toContain('data-recent-space="Engineering Space"');
        expect(html).toContain('data-recent-days="14"');
        expect(html).toContain('data-recent-limit="6"');
        expect(html).toContain('data-recent-across="4"');
        // The parser stamps anchor ids onto headings after rendering, so match
        // the class and text rather than the whole tag.
        expect(html).toMatch(/<h2[^>]*class="kr-recent-title"[^>]*>Recently updated<\/h2>/);
        expect(html).toContain('--kr-recent-cols:4');
    });

    test('unset settings fall back to the shared defaults', () => {
        const html = render(fence('folder: Sell'));
        expect(html).toContain('data-recent-days="30"');
        expect(html).toContain('data-recent-limit="8"');
        // No `across:` means "fit as many as the width allows", which is the
        // absence of the variable, not a value for it.
        expect(html).not.toContain('data-recent-across');
        expect(html).toMatch(/<h2[^>]*class="kr-recent-title"[^>]*>Recent changes<\/h2>/);
    });

    test('the un-hydrated markup is a readable sentence, for hosts with no hydrator', () => {
        // The Chrome extension side panel and folder card previews render the
        // parser output as-is; an inert box would tell a reader nothing.
        const html = render(fence('folder: Sell', 'limit: 5', 'days: 7'));
        expect(html).toContain('The 5 most recently changed items in Sell, over the last 7 days.');
    });

    test('a block with no folder says so rather than defaulting to something', () => {
        const html = render(fence('title: Recently updated'));
        expect(html).toContain('No folder set');
        expect(html).toContain('data-recent-folder=""');
    });

    test('markup is escaped, not interpolated', () => {
        const html = render(fence('folder: <img src=x onerror=alert(1)>'));
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
    });
});

describe('pinned-recent-changes — the per-reader variant', () => {
    test('it is fence-only too', () => {
        const html = render('Pinned-recent-changes are listed on the home page.');
        expect(html).toContain('Pinned-recent-changes are listed on the home page.');
        expect(html).not.toContain('kr-recent');
    });

    test('it carries its own marker class and heading', () => {
        const html = render(pinnedFence('limit: 6'));
        expect(html).toContain('class="kr-recent kr-recent-pinned"');
        expect(html).toMatch(/<h2[^>]*class="kr-recent-title"[^>]*>Changes in your interests<\/h2>/);
    });

    test('it has NO folder — that is the whole difference', () => {
        const html = render(pinnedFence('days: 14', 'limit: 6'));
        expect(html).toContain('data-recent-folder=""');
        expect(html).toContain('data-recent-days="14"');
        expect(html).toContain('data-recent-limit="6"');
        // ...and it must never show the folder block's "no folder set" scolding,
        // which would read as a broken block rather than a working one.
        expect(html).not.toContain('No folder set');
        expect(html).toContain('in your pinned folders');
    });

    test('the editor does not write a folder line for it', () => {
        const written = pinnedBlock.toMarkdown(pinnedEditorParse('days: 14', 'limit: 6'));
        expect(written).toContain('```pinned-recent-changes');
        expect(written).not.toContain('folder:');
    });

    test('a stray folder: line survives a save rather than being deleted', () => {
        // It has no effect, but silently eating something an author typed is
        // the worse behaviour of the two.
        const data = pinnedEditorParse('folder: Sell', 'limit: 6');
        expect(data.folder).toBe('Sell');
    });

    test('the two blocks read every shared setting identically', () => {
        const lines = ['title: Mine', 'days: 4w', 'limit: 5', 'across: 3'];
        const fromParser = parser.instance.parseRecentChanges(
            lines.join('\n'), 'pinned-recent-changes');
        const fromEditor = pinnedEditorParse(...lines);

        ['title', 'space', 'days', 'limit', 'across'].forEach((key) => {
            expect(fromEditor[key]).toBe(fromParser[key]);
        });
    });

    test('an editor round trip does not change what the parser sees', () => {
        const lines = ['title: Mine', 'days: all', 'limit: 12', 'across: 4'];
        const before = parser.instance.parseRecentChanges(
            lines.join('\n'), 'pinned-recent-changes');
        const written = pinnedBlock.toMarkdown(pinnedEditorParse(...lines));
        const after = parser.instance.parseRecentChanges(
            written.split('\n').slice(1, -1).join('\n'), 'pinned-recent-changes');

        expect(after).toEqual(before);
    });

    test('its editor form has no folder field, and its preview says why', () => {
        const ctx = { _escapeHtml: (s) => String(s == null ? '' : s) };
        expect(pinnedBlock.render(pinnedBlock.defaultData(), ctx))
            .not.toContain('data-role="recent-folder"');
        expect(pinnedBlock.renderPreview(pinnedEditorParse('limit: 5'), ctx))
            .toContain('your pinned folders');
    });
});

describe('recent-changes — folder references', () => {
    test('a [Space]/path reference (what the picker writes) splits into both fields', () => {
        const cfg = parser.instance.parseRecentChanges('folder: [Engineering Space]/Sell/Promotions');
        expect(cfg).toMatchObject({ space: 'Engineering Space', folder: 'Sell/Promotions' });
    });

    test('backslashes and stray slashes are tolerated', () => {
        const cfg = parser.instance.parseRecentChanges('folder: /Sell\\Promotions/');
        expect(cfg.folder).toBe('Sell/Promotions');
    });

    test('an explicit space: line works too', () => {
        const cfg = parser.instance.parseRecentChanges('folder: Sell\nspace: Fintech');
        expect(cfg).toMatchObject({ space: 'Fintech', folder: 'Sell' });
    });
});

describe('recent-changes — the period', () => {
    const periodToDays = (v) => parser.MarkdownParser.periodToDays(v);

    test.each([
        ['14', 14],
        ['14d', 14],
        ['14 days', 14],
        ['4w', 28],
        ['4 weeks', 28],
        ['6m', 180],
        ['1y', 365],
        ['all', 0],
        ['0', 0]
    ])('%s -> %i days', (input, expected) => {
        expect(periodToDays(input)).toBe(expected);
    });

    test('an unparseable period falls back rather than breaking the page', () => {
        expect(periodToDays('whenever')).toBe(30);
        expect(periodToDays('')).toBe(30);
    });

    test('`period:` is an alias for `days:`', () => {
        expect(parser.instance.parseRecentChanges('period: 4w').days).toBe(28);
    });
});

describe('recent-changes — parser and editor agree', () => {
    const CASES = [
        ['folder: Sell'],
        ['title: Recently updated', 'folder: Business Processes', 'days: 14', 'limit: 6'],
        ['folder: [Engineering Space]/Sell/Promotions', 'across: 4'],
        ['folder: Sell', 'days: all'],
        ['folder: Sell', 'period: 6m', 'limit: 999']
    ];

    test.each(CASES.map((c) => [c.join(' | '), c]))(
        'the two sides read %s identically', (_label, lines) => {
            const fromParser = parser.instance.parseRecentChanges(lines.join('\n'));
            const fromEditor = editorParse(...lines);

            expect(fromEditor.title).toBe(fromParser.title);
            expect(fromEditor.folder).toBe(fromParser.folder);
            expect(fromEditor.space).toBe(fromParser.space);
            expect(fromEditor.days).toBe(fromParser.days);
            expect(fromEditor.limit).toBe(fromParser.limit);
            expect(fromEditor.across).toBe(fromParser.across);
        });

    test.each(CASES.map((c) => [c.join(' | '), c]))(
        'an editor round trip does not change what the parser sees: %s', (_label, lines) => {
            const before = parser.instance.parseRecentChanges(lines.join('\n'));
            const written = block.toMarkdown(editorParse(...lines));
            const after = parser.instance.parseRecentChanges(
                written.split('\n').slice(1, -1).join('\n'));

            expect(after).toEqual(before);
        });

    test('a limit over the ceiling is clamped on both sides, not refused', () => {
        expect(parser.instance.parseRecentChanges('limit: 999').limit).toBe(60);
        expect(editorParse('folder: Sell', 'limit: 999').limit).toBe(60);
    });

    test('"all time" survives a save — it is written, not left to a default', () => {
        // `days: 0` unwritten would be read back as the 30-day default, which
        // silently narrows a block the author deliberately opened up.
        const written = block.toMarkdown(editorParse('folder: Sell', 'days: all'));
        expect(written).toContain('days: all');
        expect(parser.instance.parseRecentChanges(
            written.split('\n').slice(1, -1).join('\n')).days).toBe(0);
    });

    test('a hand-authored line the grammar does not know survives a save', () => {
        const data = editorParse('folder: Sell', 'note: keep me');
        expect(block.toMarkdown(data)).toContain('note: keep me');
    });
});

describe('recent-changes — the editor surface', () => {
    // The editor's own markup has no other coverage, and a typo in a template
    // literal there is a blank block in Blocks mode rather than an error.
    const ctx = { _escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])) };

    test('a fresh block renders every control', () => {
        const html = block.render(block.defaultData(), ctx);
        ['recent-title', 'recent-folder', 'recent-space', 'recent-days', 'recent-limit', 'recent-across']
            .forEach((role) => expect(html).toContain(`data-role="${role}"`));
    });

    test('an authored block renders its own values back into the form', () => {
        const html = block.render(editorParse(
            'title: Recently updated', 'folder: Sell', 'days: 14', 'limit: 5', 'across: 3'), ctx);
        expect(html).toContain('value="Recently updated"');
        expect(html).toContain('value="Sell"');
        expect(html).toContain('value="14"');
        expect(html).toContain('value="5"');
        expect(html).toContain('value="3"');
    });

    test('the collapsed preview says what the block will show', () => {
        const html = block.renderPreview(editorParse('folder: Sell', 'limit: 5', 'days: 7'), ctx);
        expect(html).toContain('5 most recent in Sell');
        expect(html).toContain('last 7 days');
    });

    test('an all-time block reads as such rather than as a blank period', () => {
        expect(block.renderPreview(editorParse('folder: Sell', 'days: all'), ctx))
            .toContain('all time');
    });
});
