'use strict';

/**
 * Landing blocks — ```landing-hero``` / ```news``` / ```tiles``` / ```stories```
 * / ```cta```.
 *
 * These live in the browser-side parser and block editor, which are plain
 * `<script>` files rather than modules, so both are evaluated in a `vm` with the
 * globals they expect (`marked` for the parser, a `window.MarkdownEditor` stub
 * for the editor). That is enough to cover the two failure modes that actually
 * bite:
 *
 *   1. Prefix detection — `isCustomBlockStart` matches any line STARTING with a
 *      block name, so an ordinary paragraph beginning "News …" or "Stories …"
 *      would be swallowed whole and silently vanish from the page unless the
 *      block is fence-only.
 *   2. Grammar drift — the parser and the block editor each implement the
 *      "props then `- key: value` items" grammar. If they drift, a page renders
 *      one way and edits another, and a save quietly rewrites the source.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { marked } = require('marked');

const REPO = path.resolve(__dirname, '../../..');
const PARSER = path.join(REPO, 'public/js/markdown/markdown-parser.js');
const EDITOR_BLOCKS = path.join(REPO, 'public/js/markdown/markdown-editor-blocks.js');

const LANDING_TYPES = ['landing-hero', 'news', 'tiles', 'stories', 'cta'];

function loadParser() {
    const ctx = { marked, console, setTimeout, module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(PARSER, 'utf8'), ctx, { filename: 'markdown-parser.js' });
    // `markdownParser` and the class are top-level `const`/`class` bindings, so
    // they live in the context's lexical scope, not on its global object (same
    // as a classic browser <script>: reachable as a bare identifier, absent
    // from `window`). Evaluate an expression in the same context to reach them.
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
const render = (md) => parser.parseMarkdown(md);

describe('landing blocks — rendering', () => {
    test('landing-hero renders eyebrow, title, lead, search and stats', () => {
        const html = render([
            '```landing-hero',
            'eyebrow: noobly Wiki',
            'title: One home for how we build.',
            'subtitle: What this space holds.',
            'search: Ask anything…',
            'action: Search',
            '- value: 14,587',
            '  label: Documents',
            '- value: 6',
            '  label: Disciplines',
            '```'
        ].join('\n'));

        expect(html).toContain('class="kr-landing kr-landing-hero"');
        expect(html).toContain('noobly Wiki');
        expect(html).toContain('One home for how we build.');
        expect(html).toContain('14,587');
        expect((html.match(/kr-landing-stat"/g) || []).length).toBe(2);
    });

    test.each([
        ['landing-hero', 'eyebrow: X'],
        ['news', '- title: X'],
        ['tiles', '- title: X'],
        ['stories', '- quote: X'],
        ['cta', '- title: X']
    ])('%s carries the shared .kr-landing marker class', (type, body) => {
        // Every landing rule in kr-base.css is scoped under `.kr-landing` so it
        // outranks the `.md-doc p` / `strong` / `a` / `h2` element rules these
        // sections render inside. Losing the marker loses the styling.
        expect(render(['```' + type, body, '```'].join('\n')))
            .toContain(`class="kr-landing kr-${type}"`);
    });

    test('the hero search is a real form, so Enter submits it', () => {
        const html = render('```landing-hero\nsearch: Ask anything…\naction: Go\n```');

        expect(html).toContain('<form class="kr-landing-hero-search" data-landing-search');
        expect(html).toContain('<input type="search"');
        expect(html).toContain('placeholder="Ask anything…"');
        expect(html).toContain('<button type="submit"');
        expect(html).toContain('>Go</button>');
    });

    test('no search: prop means no form at all', () => {
        const html = render('```landing-hero\ntitle: Just a banner\n```');
        expect(html).not.toContain('data-landing-search');
    });

    test('a value wrapped across source lines is joined, not truncated', () => {
        const html = render([
            '```landing-hero',
            'subtitle: Product management, the processes we have modelled,',
            'and the standards that shape them.',
            '```'
        ].join('\n'));

        expect(html).toContain('Product management, the processes we have modelled, and the standards that shape them.');
    });

    test('news derives a stable tag tone when none is given', () => {
        const md = (tag) => `\`\`\`news\n- tag: ${tag}\n  title: T\n\`\`\``;
        const first = render(md('Standards'));
        const second = render(md('Standards'));
        const toneOf = (h) => (h.match(/kr-tone-(\w+)/) || [])[1];

        expect(toneOf(first)).toBeTruthy();
        expect(toneOf(first)).toBe(toneOf(second));
        expect(['teal', 'orange', 'sand']).toContain(toneOf(first));
    });

    test('news honours an explicit tone over the derived one', () => {
        const html = render('```news\n- tag: Standards\n  tone: orange\n  title: T\n```');
        expect(html).toContain('kr-tone-orange');
    });

    test('tiles link out three ways: folder, url, and not at all', () => {
        const html = render([
            '```tiles',
            '- title: Business Processes',
            '  folder: Business Processes',
            '- title: External',
            '  link: https://example.com/x',
            '- title: Inert',
            '```'
        ].join('\n'));

        expect(html).toContain('data-doc-rel="Business Processes"');
        expect(html).toContain('href="https://example.com/x"');
        expect(html).toContain('target="_blank"');
        // No link at all must stay a span, never a dead anchor.
        expect(html).toContain('<span class="kr-tile">');
    });

    test('tiles derive the initial chip from the title', () => {
        const html = render('```tiles\n- title: standards\n```');
        expect(html).toContain('<span class="kr-tile-initial">S</span>');
    });

    test('across: drives the grid column count, capped at 6', () => {
        expect(render('```news\nacross: 4\n- title: A\n```')).toContain('--kr-grid-cols:4;');
        expect(render('```news\nacross: 99\n- title: A\n```')).toContain('--kr-grid-cols:6;');
        // 0 is not a meaningful column count, so it falls back to the default
        // rather than collapsing the grid to nothing.
        expect(render('```news\nacross: 0\n- title: A\n```')).toContain('--kr-grid-cols:3;');
    });

    test('block content is HTML-escaped', () => {
        const html = render('```tiles\n- title: <script>alert(1)</script>\n```');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    test('cta marks the primary button and leaves the rest ghost', () => {
        const html = render([
            '```cta',
            'title: Get started',
            '- title: Tour',
            '  action: Start',
            '  style: primary',
            '  link: /tour',
            '- title: Chat',
            '  action: Open',
            '```'
        ].join('\n'));

        expect(html).toContain('kr-cta-btn-primary');
        expect(html).toContain('kr-cta-btn-ghost');
    });

    test('stories render a quote with an attributed author', () => {
        const html = render('```stories\n- quote: It helped.\n  name: Priya N.\n  role: Engineer\n```');
        expect(html).toContain('class="kr-story-quote"');
        expect(html).toContain('<span class="kr-story-avatar">P</span>');
        expect(html).toContain('Priya N.');
    });
});

describe('landing blocks — fence-only detection', () => {
    test.each(LANDING_TYPES)('%s is registered as a custom block type', (type) => {
        expect(parser.instance.customBlockTypes).toContain(type);
    });

    test.each([
        ['News', 'News travels fast around here.'],
        ['Stories', 'Stories about the migration are on the intranet.'],
        ['Tiles', 'Tiles were the wrong metaphor for this page.'],
        ['Cta', 'Cta is an abbreviation nobody should use in prose.']
    ])('a paragraph starting with "%s" survives', (_word, paragraph) => {
        const html = render(paragraph);
        expect(html).toContain(paragraph);
    });

    test('indentation-based blocks still work for the types that allow it', () => {
        // hero-banner is NOT fence-only — guard against the exclusion set
        // accidentally growing to cover it.
        const html = render('hero-banner\n  title: Still supported');
        expect(html).toContain('hero-banner-section');
    });
});

describe('landing blocks — parser/editor grammar agreement', () => {
    const SOURCES = {
        'landing-hero': [
            '```landing-hero',
            'eyebrow: noobly Wiki',
            'title: One home for how we build.',
            'search: Ask anything…',
            '- value: 14,587',
            '  label: Documents',
            '```'
        ].join('\n'),
        news: [
            '```news',
            'title: Recently published',
            'across: 4',
            '- tag: Standards',
            '  tone: orange',
            '  title: A new policy',
            '  date: 21 July 2026',
            '  excerpt: What changed and why.',
            '  folder: Standards',
            '```'
        ].join('\n'),
        tiles: [
            '```tiles',
            'title: Explore by discipline',
            'across: 3',
            'accent: teal',
            '- title: Business Processes',
            '  blurb: How the work flows.',
            '  meta: 2,739 documents →',
            '  folder: Business Processes',
            '```'
        ].join('\n'),
        stories: [
            '```stories',
            'title: What each discipline answers',
            '- quote: What did we decide, and why?',
            '  name: Solution Design',
            '  role: Designs and decisions',
            '```'
        ].join('\n'),
        cta: [
            '```cta',
            'title: Get started',
            'subtitle: Three ways in.',
            '- title: Read the framework',
            '  text: Start with the North Star.',
            '  action: Open Standards',
            '  style: primary',
            '  folder: Standards',
            '```'
        ].join('\n')
    };

    test.each(LANDING_TYPES)('%s survives an editor load/save round-trip byte for byte', (type) => {
        const source = SOURCES[type];
        const lines = source.split('\n');
        const parsed = editorBlocks[type].fromMarkdown(lines[0], lines, 0);

        expect(parsed).not.toBeNull();
        expect(parsed.consumed).toBe(lines.length);
        expect(editorBlocks[type].toMarkdown(parsed.data)).toBe(source);
    });

    test.each(LANDING_TYPES)('%s parses to the same props/items in both implementations', (type) => {
        const lines = SOURCES[type].split('\n');
        const fromEditor = editorBlocks[type].fromMarkdown(lines[0], lines, 0).data;
        // The fence body, minus the opening/closing fence lines.
        const body = lines.slice(1, -1).join('\n');
        const fromParser = parser.instance.parseBlockItems(body, type);

        expect(fromEditor.props).toEqual(fromParser.props);
        expect(fromEditor.items).toEqual(fromParser.items);
    });

    test.each(LANDING_TYPES)('%s each block registers its own handler roles', (type) => {
        // _handleBlockClick resolves a role against every registered block and
        // takes the first match, so shared role names would route a click to
        // the wrong landing block's spec.
        const roles = Object.keys(editorBlocks[type].handlers);
        expect(roles).toEqual(
            expect.arrayContaining([`${type}-edit`, `${type}-save`, `${type}-add`, `${type}-remove`])
        );
    });
});
