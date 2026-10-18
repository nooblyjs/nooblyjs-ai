/**
 * @fileoverview Tests that the search summarizer carries the match-centered
 * search snippet ("matched passage") through to the chat sources on every
 * path. Topical summaries are lossy — a ~150-word summary of a metadata-heavy
 * document drops details like "Responsible Technology Executive Debbie
 * Cunningham" — so the exact passage the query hit must reach the AI too.
 */

'use strict';

const { summarizeFromSearch } = require('../../../src/wiki/components/searchSummarizer');

const SNIPPET = 'Technology Executive <mark>Debbie</mark> <mark>Cunningham</mark> DR Level Hot';
const SNIPPET_CLEAN = 'Technology Executive Debbie Cunningham DR Level Hot';

function makeDeps({ results, promptImpl }) {
    return {
        searchIndexer: { search: jest.fn().mockResolvedValue(results) },
        filingServiceWrapper: {
            // mtime 0 everywhere → no workflow sidecar, no cached summary.
            getFileMetadata: jest.fn().mockResolvedValue(null),
            readDocument: jest.fn(async (space, p) => (/\.(md|markdown)$/i.test(p) && !p.includes('.aicontext') && !p.includes('.context'))
                ? '# Doc\n\nSome content.'
                : null),
            writeDocument: jest.fn().mockResolvedValue(undefined)
        },
        aiClient: { prompt: promptImpl || jest.fn().mockResolvedValue('a topical summary') },
        logger: { info: jest.fn(), warn: jest.fn() }
    };
}

describe('summarizeFromSearch — matched passage propagation', () => {
    test('fresh AI summary carries the stripped match snippet alongside it', async () => {
        const deps = makeDeps({
            results: [{ path: 'x/To Be.md', spaceName: 'S', title: 'To Be.md', score: 2, snippet: SNIPPET, excerpt: 'doc start' }]
        });
        const out = await summarizeFromSearch('Debbie Cunningham', deps);
        expect(out).toHaveLength(1);
        expect(out[0].summary).toBe('a topical summary');
        expect(out[0].matched).toBe(SNIPPET_CLEAN); // <mark> stripped
        expect(out[0].cached).toBe(false);
    });

    test('non-markdown fallback uses the match snippet, not the doc-start excerpt', async () => {
        const deps = makeDeps({
            results: [{ path: 'x/report.pdf', spaceName: 'S', title: 'report.pdf', score: 1, snippet: SNIPPET, excerpt: 'first 200 chars of doc' }]
        });
        const out = await summarizeFromSearch('Debbie Cunningham', deps);
        expect(out).toHaveLength(1);
        expect(out[0].summary).toBe(SNIPPET_CLEAN);
        expect(out[0].skipped).toBe(true);
    });

    test('non-markdown fallback still uses the excerpt when there is no snippet', async () => {
        const deps = makeDeps({
            results: [{ path: 'x/report.pdf', spaceName: 'S', title: 'report.pdf', score: 1, excerpt: 'first 200 chars of doc' }]
        });
        const out = await summarizeFromSearch('anything', deps);
        expect(out).toHaveLength(1);
        expect(out[0].summary).toBe('first 200 chars of doc');
        expect(out[0].matched).toBe('');
    });

    test('AI-failure fallback keeps the match snippet as the summary', async () => {
        const deps = makeDeps({
            results: [{ path: 'x/To Be.md', spaceName: 'S', title: 'To Be.md', score: 2, snippet: SNIPPET, excerpt: 'doc start' }],
            promptImpl: jest.fn().mockRejectedValue(new Error('AI down'))
        });
        const out = await summarizeFromSearch('Debbie Cunningham', deps);
        expect(out).toHaveLength(1);
        expect(out[0].summary).toBe(SNIPPET_CLEAN);
        expect(out[0].matched).toBe(SNIPPET_CLEAN);
        expect(out[0].skipped).toBe(true);
    });

    test('missing snippet yields matched: "" (no Matched-passage line in the prompt)', async () => {
        const deps = makeDeps({
            results: [{ path: 'x/To Be.md', spaceName: 'S', title: 'To Be.md', score: 2, excerpt: 'doc start' }]
        });
        const out = await summarizeFromSearch('anything', deps);
        expect(out).toHaveLength(1);
        expect(out[0].matched).toBe('');
        expect(out[0].summary).toBe('a topical summary');
    });
});
