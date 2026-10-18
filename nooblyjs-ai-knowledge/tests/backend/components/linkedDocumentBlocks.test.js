'use strict';

/**
 * Linked documents — the ```linked-documents``` relationship band.
 *
 * There are THREE implementations of one grammar and they must not drift:
 *
 *   1. `src/wiki/components/linkedDocumentBlocks.js` — the server, which
 *      is what the "Link documents" dialog reads and writes.
 *   2. `MarkdownParser.parseLinkedDocuments` — the browser parser, which decides
 *      what a reader sees.
 *   3. The block editor's `linked-documents` definition, which decides what a
 *      Blocks-mode edit writes back.
 *
 * Drift between any two of them means a page renders one way, edits another, and
 * a save quietly rewrites the source — the exact failure the landing-block suite
 * exists to catch for its own five blocks. The browser files are plain
 * `<script>`s, so they are evaluated in a `vm` with the globals they expect.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { marked } = require('marked');

const L = require('../../../src/wiki/components/linkedDocumentBlocks');

const REPO = path.resolve(__dirname, '../../..');
const PARSER = path.join(REPO, 'public/js/markdown/markdown-parser.js');
const EDITOR_BLOCKS = path.join(REPO, 'public/js/markdown/markdown-editor-blocks.js');

function loadParser() {
    const ctx = { marked, console, setTimeout, module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(PARSER, 'utf8'), ctx, { filename: 'markdown-parser.js' });
    return {
        parseMarkdown: ctx.parseMarkdown,
        instance: vm.runInContext('markdownParser', ctx)
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

const FENCE = [
    '```linked-documents',
    'title: Related landscapes',
    'across: 4',
    ' - [Engineering Space]/Solution Design/Application Landscapes',
    ' - Sell/Promotions/overview.md | Promotions overview',
    '```'
].join('\n');

// ---------------------------------------------------------------------------

describe('linkedDocumentBlocks — parsing', () => {
    test('reads block-level keys and every item', () => {
        const parsed = L.parseLinkedDocuments(`# Page\n\n${FENCE}\n`);
        expect(parsed.title).toBe('Related landscapes');
        expect(parsed.across).toBe(4);
        expect(parsed.items).toEqual([
            { ref: '[Engineering Space]/Solution Design/Application Landscapes', label: '' },
            { ref: 'Sell/Promotions/overview.md', label: 'Promotions overview' }
        ]);
    });

    test('returns null when the document has no block', () => {
        expect(L.parseLinkedDocuments('# Page\n\nJust prose.\n')).toBeNull();
    });

    test('an empty block body parses as an empty item list', () => {
        const parsed = L.parseLinkedDocuments('```linked-documents\n```\n');
        expect(parsed).not.toBeNull();
        expect(parsed.items).toEqual([]);
    });

    test('normalises Windows separators, leading slashes and space spacing', () => {
        const parsed = L.parseLinkedDocuments(
            '```linked-documents\n- [Engineering Space] \\Solution Design\\Landscapes\n```');
        expect(parsed.items[0].ref).toBe('[Engineering Space]/Solution Design/Landscapes');
    });

    test('keeps lines it does not understand so a round trip cannot eat them', () => {
        const parsed = L.parseLinkedDocuments('```linked-documents\nsome hand-written note\n- a/b\n```');
        expect(parsed.extras).toEqual(['some hand-written note']);
        const rebuilt = L.buildLinkedDocumentsBlock(parsed);
        expect(rebuilt).toContain('some hand-written note');
    });
});

describe('linkedDocumentBlocks — writing', () => {
    test('setLinkedDocuments replaces an existing block in place', () => {
        const before = `# Page\n\n${FENCE}\n\nAfter.\n`;
        const after = L.setLinkedDocuments(before, [{ ref: '[S]/x/y', label: '' }]);
        expect(after).toContain('- [S]/x/y');
        expect(after).not.toContain('Application Landscapes');
        expect(after).toContain('After.');
        // Block-level settings survive a link-only edit.
        expect(after).toContain('title: Related landscapes');
        expect(after).toContain('across: 4');
        expect((after.match(/```linked-documents/g) || []).length).toBe(1);
    });

    test('appends a block to a document that has none', () => {
        const after = L.setLinkedDocuments('# Page\n\nProse.\n', ['[S]/a/b']);
        expect(after).toContain('Prose.');
        expect(after).toMatch(/```linked-documents\n- \[S\]\/a\/b\n```/);
    });

    test('a new block goes ABOVE trailing page furniture, not under it', () => {
        const before = '# Page\n\nProse.\n\n```comments\n\nComment: hi\n\n```\n';
        const after = L.setLinkedDocuments(before, ['[S]/a/b']);
        expect(after.indexOf('```linked-documents')).toBeLessThan(after.indexOf('```comments'));
        expect(after).toContain('Comment: hi');
    });

    test('duplicate references collapse, keeping the authored position', () => {
        const after = L.setLinkedDocuments('# Page\n', [
            '[S]/a/b', '[s]/a/b', '[S]/c/d'
        ]);
        expect((after.match(/^- /gm) || []).length).toBe(2);
        expect(after.indexOf('[S]/a/b')).toBeLessThan(after.indexOf('[S]/c/d'));
    });

    test('an empty list removes the block rather than leaving an empty band', () => {
        const after = L.setLinkedDocuments(`# Page\n\n${FENCE}\n`, []);
        expect(after).not.toContain('```linked-documents');
        expect(after).toContain('# Page');
    });

    test('order is preserved exactly as given — it is the reading order', () => {
        const after = L.setLinkedDocuments('# Page\n', ['[S]/c', '[S]/a', '[S]/b']);
        const order = (L.parseLinkedDocuments(after).items).map((i) => i.ref);
        expect(order).toEqual(['[S]/c', '[S]/a', '[S]/b']);
    });
});

describe('linkedDocumentBlocks — durability across a wholesale rewrite', () => {
    test('carries the block into regenerated content that has none', () => {
        const { content, carried } = L.preserveLinkedDocuments(
            `# Old\n\n${FENCE}\n`, '# Regenerated by a workflow\n');
        expect(carried).toBe(2);
        expect(content).toContain('Application Landscapes');
        expect(content).toContain('# Regenerated by a workflow');
    });

    test('an explicit edit in the new content wins', () => {
        const { content, carried } = L.preserveLinkedDocuments(
            `# Old\n\n${FENCE}\n`, '# New\n\n```linked-documents\n- [S]/only/this\n```\n');
        expect(carried).toBe(0);
        expect(content).toContain('[S]/only/this');
        expect(content).not.toContain('Application Landscapes');
    });

    test('a document that never had links is left untouched', () => {
        const { content, carried } = L.preserveLinkedDocuments('# Old\n', '# New\n');
        expect(carried).toBe(0);
        expect(content).toBe('# New\n');
    });
});

describe('linkedDocumentBlocks — reference helpers', () => {
    test.each([
        ['[Engineering Space]/a/b', 'Engineering Space', 'a/b'],
        ['a/b', '', 'a/b'],
        ['[S] /a/b', 'S', 'a/b']
    ])('splitRef(%s)', (ref, spaceName, p) => {
        expect(L.splitRef(ref)).toEqual({ spaceName, path: p });
    });

    test('refKey is case-insensitive, so the same target cannot be linked twice', () => {
        expect(L.refKey('[Space]/A/B')).toBe(L.refKey('[space]/a/b'));
    });
});

// ---------------------------------------------------------------------------

describe('linked-documents — parser', () => {
    test('is fence-only, so a paragraph opening "Linked documents…" survives', () => {
        // isCustomBlockStart matches any line merely STARTING with a block name,
        // so without the fence-only guard this prose would be swallowed whole
        // and silently vanish from the rendered page.
        const html = parser.parseMarkdown('Linked documents are how we show relationships.');
        expect(html).toContain('Linked documents are how we show relationships.');
    });

    test('renders a titled band with one placeholder per reference', () => {
        const html = parser.parseMarkdown(FENCE);
        expect(html).toContain('class="kr-linked-docs"');
        expect(html).toContain('data-linked-docs-placeholder');
        expect(html).toContain('Related landscapes');
        expect((html.match(/data-linked-ref=/g) || []).length).toBe(2);
        expect(html).toContain('--kr-linked-cols:4');
    });

    test('the un-hydrated markup names each target, for hosts with no hydrator', () => {
        // The Chrome extension side panel and folder card previews render the
        // parser output as-is; an inert box there would show nothing at all.
        const html = parser.parseMarkdown(FENCE);
        expect(html).toContain('Application Landscapes');
        expect(html).toContain('Promotions overview');
    });

    test('an authored label overrides the derived name', () => {
        const html = parser.parseMarkdown('```linked-documents\n- [S]/a/b.md | Custom name\n```');
        expect(html).toContain('Custom name');
        expect(html).toContain('data-linked-label="Custom name"');
    });

    test('a block with no references renders an explicit empty state', () => {
        const html = parser.parseMarkdown('```linked-documents\n```');
        expect(html).toContain('is-empty');
        expect(html).toContain('Nothing linked yet.');
    });

    test('escapes a reference so markup in a path cannot reach the page', () => {
        const html = parser.parseMarkdown('```linked-documents\n- [S]/<img src=x onerror=alert(1)>\n```');
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img');
    });

    test('extractLinkedDocuments reads the block without rendering', () => {
        const meta = parser.instance.extractLinkedDocuments(`# Page\n\n${FENCE}\n`);
        expect(meta.title).toBe('Related landscapes');
        expect(meta.items.map((i) => i.ref)).toEqual([
            '[Engineering Space]/Solution Design/Application Landscapes',
            'Sell/Promotions/overview.md'
        ]);
        expect(parser.instance.extractLinkedDocuments('# Page\n')).toBeNull();
    });
});

// ---------------------------------------------------------------------------

describe('linked-documents — grammar parity across the three implementations', () => {
    const editor = () => editorBlocks['linked-documents'];

    test('the block editor registers the type', () => {
        expect(editor()).toBeDefined();
    });

    test('server, parser and editor read the same fence identically', () => {
        const lines = FENCE.split('\n');
        const fromEditor = editor().fromMarkdown(lines[0], lines, 0);
        const fromParser = parser.instance.parseLinkedDocuments(lines.slice(1, -1).join('\n'));
        const fromServer = L.parseLinkedDocuments(FENCE);

        const refs = (d) => d.items.filter((i) => i.ref).map((i) => `${i.ref}|${i.label}`);
        expect(refs(fromEditor.data)).toEqual(refs(fromServer));
        expect(refs(fromParser)).toEqual(refs(fromServer));
        expect([fromEditor.data.title, fromParser.title, fromServer.title])
            .toEqual(['Related landscapes', 'Related landscapes', 'Related landscapes']);
        expect([fromEditor.data.across, fromParser.across, fromServer.across]).toEqual([4, 4, 4]);
    });

    test('an editor round trip is byte-stable against the server writer', () => {
        // What the Blocks editor writes must be what the dialog would write,
        // or opening a page in one and saving in the other silently reshuffles
        // the source on every switch.
        const lines = FENCE.split('\n');
        const { data } = editor().fromMarkdown(lines[0], lines, 0);
        const fromEditor = editor().toMarkdown(data);
        const fromServer = L.buildLinkedDocumentsBlock(L.parseLinkedDocuments(FENCE));
        expect(fromEditor).toBe(fromServer);
    });

    test('the editor keeps unknown lines too', () => {
        const md = '```linked-documents\nmystery: value\n- a/b\n```';
        const lines = md.split('\n');
        const { data } = editor().fromMarkdown(lines[0], lines, 0);
        expect(data.extras).toEqual(['mystery: value']);
        expect(editor().toMarkdown(data)).toContain('mystery: value');
    });
});
