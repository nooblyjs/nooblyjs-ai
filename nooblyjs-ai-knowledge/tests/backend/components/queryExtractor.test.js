/**
 * @fileoverview Tests for the AI-chat search-query extractor: conversational
 * messages ("Tell me how N8N is used in our landscape") are distilled to
 * keyword queries ("N8N landscape") before the wiki search runs.
 *
 * The extractor must be failure-proof — no AI client, AI errors/timeouts, and
 * chatty/unusable model replies must all fall back to the original message so
 * the search behaves exactly as it did before extraction existed.
 */

'use strict';

const {
    extractSearchTerms,
    sanitizeExtractedQuery,
    stripFillerWords,
    extractQuotedQuery,
    MAX_QUERY_WORDS
} = require('../../../src/wiki/components/queryExtractor');

describe('sanitizeExtractedQuery', () => {
    test('returns empty for falsy / non-string input', () => {
        expect(sanitizeExtractedQuery('')).toBe('');
        expect(sanitizeExtractedQuery(null)).toBe('');
        expect(sanitizeExtractedQuery(undefined)).toBe('');
        expect(sanitizeExtractedQuery(42)).toBe('');
        expect(sanitizeExtractedQuery('   \n  ')).toBe('');
    });

    test('passes clean keyword replies through, preserving case', () => {
        expect(sanitizeExtractedQuery('N8N landscape')).toBe('N8N landscape');
        expect(sanitizeExtractedQuery('N8N')).toBe('N8N');
    });

    test('strips label prefixes, quotes, and list markers', () => {
        expect(sanitizeExtractedQuery('Keywords: N8N landscape')).toBe('N8N landscape');
        expect(sanitizeExtractedQuery('Search terms - workflow automation')).toBe('workflow automation');
        expect(sanitizeExtractedQuery('"N8N" `landscape`')).toBe('N8N landscape');
        expect(sanitizeExtractedQuery('- N8N integration')).toBe('N8N integration');
        expect(sanitizeExtractedQuery('1. N8N')).toBe('N8N');
    });

    test('turns comma/semicolon/pipe separators into spaces', () => {
        expect(sanitizeExtractedQuery('N8N, landscape, integration')).toBe('N8N landscape integration');
        expect(sanitizeExtractedQuery('N8N; automation | workflows')).toBe('N8N automation workflows');
    });

    test('drops trailing sentence punctuation but keeps identifiers intact', () => {
        expect(sanitizeExtractedQuery('N8N landscape.')).toBe('N8N landscape');
        expect(sanitizeExtractedQuery('node.js N8N')).toBe('node.js N8N');
    });

    test('uses only the first non-empty line of a multi-line reply', () => {
        expect(sanitizeExtractedQuery('\nN8N landscape\nThese are the terms I chose.')).toBe('N8N landscape');
    });

    test('caps at MAX_QUERY_WORDS words', () => {
        const reply = 'one two three four five six seven eight';
        expect(sanitizeExtractedQuery(reply).split(' ')).toHaveLength(MAX_QUERY_WORDS);
    });

    test('rejects sentence-shaped replies (refusals, restated questions)', () => {
        expect(sanitizeExtractedQuery(
            "I'm sorry, but I cannot extract keywords from this question without more context about it."
        )).toBe('');
        expect(sanitizeExtractedQuery(
            'The user wants to know how the N8N automation platform is used in the company landscape today.'
        )).toBe('');
    });
});

describe('stripFillerWords', () => {
    test('drops chat filler and keeps content terms verbatim', () => {
        expect(stripFillerWords('Where do we use N8N')).toBe('N8N');
        expect(stripFillerWords('Tell me how N8N is used in our landscape')).toBe('N8N landscape');
        expect(stripFillerWords('How does the workflow scheduler work?')).toBe('workflow scheduler');
    });

    test('trims edge punctuation but keeps inner dots', () => {
        expect(stripFillerWords('What is N8N?')).toBe('N8N');
        expect(stripFillerWords('Where do we run node.js apps')).toBe('node.js apps');
    });

    test('returns empty when nothing survives (caller keeps the raw message)', () => {
        expect(stripFillerWords('how does it work')).toBe('');
        expect(stripFillerWords('')).toBe('');
    });

    test('caps at MAX_QUERY_WORDS content words', () => {
        const msg = 'alpha bravo charlie delta echo foxtrot golf hotel';
        expect(stripFillerWords(msg).split(' ')).toHaveLength(MAX_QUERY_WORDS);
    });
});

describe('extractSearchTerms', () => {
    const logger = { info: jest.fn() };

    test('filler-strips short messages without calling the AI', async () => {
        const aiClient = { prompt: jest.fn() };
        expect(await extractSearchTerms(aiClient, 'N8N', logger)).toBe('N8N');
        expect(await extractSearchTerms(aiClient, 'N8N setup guide', logger)).toBe('N8N setup guide');
        expect(await extractSearchTerms(aiClient, 'Where is N8N', logger)).toBe('N8N');
        expect(aiClient.prompt).not.toHaveBeenCalled();
    });

    test('keeps a short all-filler message as-is (stripping would leave nothing)', async () => {
        const aiClient = { prompt: jest.fn() };
        expect(await extractSearchTerms(aiClient, 'how does it work', logger)).toBe('how does it work');
        expect(aiClient.prompt).not.toHaveBeenCalled();
    });

    test('filler-strips when no AI client is available', async () => {
        expect(await extractSearchTerms(null, 'Tell me how N8N is used in our landscape', logger))
            .toBe('N8N landscape');
    });

    test('distills a conversational message via the AI client', async () => {
        const aiClient = { prompt: jest.fn().mockResolvedValue('N8N landscape') };
        const result = await extractSearchTerms(aiClient, 'Tell me how N8N is used in our landscape', logger);
        expect(result).toBe('N8N landscape');
        expect(aiClient.prompt).toHaveBeenCalledTimes(1);
        // The full original message is what the AI sees.
        expect(aiClient.prompt.mock.calls[0][1]).toBe('Tell me how N8N is used in our landscape');
    });

    test('rejects an AI reply that just echoes the question, filler-stripping instead', async () => {
        const aiClient = { prompt: jest.fn().mockResolvedValue('"Where do we use N8N?"') };
        expect(await extractSearchTerms(aiClient, 'Where do we use N8N', logger)).toBe('N8N');
    });

    test('filler-strips when the AI errors', async () => {
        const aiClient = { prompt: jest.fn().mockRejectedValue(new Error('boom')) };
        expect(await extractSearchTerms(aiClient, 'Tell me how N8N is used in our landscape', logger))
            .toBe('N8N landscape');
    });

    test('filler-strips when the AI call times out', async () => {
        const aiClient = { prompt: jest.fn(() => new Promise(() => { /* never settles */ })) };
        expect(await extractSearchTerms(aiClient, 'Tell me how N8N is used in our landscape', logger, { timeoutMs: 20 }))
            .toBe('N8N landscape');
    });

    test('filler-strips when the reply is unusable', async () => {
        const aiClient = {
            prompt: jest.fn().mockResolvedValue(
                'I am sorry but I am unable to determine any useful keywords for this particular question right now.'
            )
        };
        expect(await extractSearchTerms(aiClient, 'Tell me how N8N is used in our landscape', logger))
            .toBe('N8N landscape');
    });

    test('returns empty input unchanged', async () => {
        const aiClient = { prompt: jest.fn() };
        expect(await extractSearchTerms(aiClient, '', logger)).toBe('');
        expect(await extractSearchTerms(aiClient, null, logger)).toBe('');
        expect(aiClient.prompt).not.toHaveBeenCalled();
    });
});

describe('quoted phrases', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    test('extractQuotedQuery returns empty when there are no quotes', () => {
        expect(extractQuotedQuery('Tell me how N8N is used')).toBe('');
    });

    test('keeps the phrase quoted and filler-strips only the remainder', () => {
        expect(extractQuotedQuery('Tell me how "Oracle MySQL" is used in our landscape'))
            .toBe('"Oracle MySQL" landscape');
    });

    test('keeps multiple phrases', () => {
        expect(extractQuotedQuery('Compare "Oracle MySQL" and "SQL Server" costs'))
            .toBe('"Oracle MySQL" "SQL Server" Compare costs');
    });

    test('never truncates a phrase to satisfy the word cap', () => {
        const long = 'one two three four five six seven eight';
        const out = extractQuotedQuery(`what about "${long}" in the estate`);
        expect(out).toContain(`"${long}"`);
    });

    test('never sends a quoted message to the AI', async () => {
        const aiClient = { prompt: jest.fn().mockResolvedValue('oracle database') };
        const result = await extractSearchTerms(
            aiClient, 'Tell me how "Oracle MySQL" is used in our landscape', logger
        );
        expect(result).toBe('"Oracle MySQL" landscape');
        expect(aiClient.prompt).not.toHaveBeenCalled();
    });

    test('passes a bare quoted phrase straight through', async () => {
        const aiClient = { prompt: jest.fn() };
        expect(await extractSearchTerms(aiClient, '"Oracle MySQL"', logger)).toBe('"Oracle MySQL"');
        expect(aiClient.prompt).not.toHaveBeenCalled();
    });

    test('leaves unquoted messages on the existing AI path', async () => {
        const aiClient = { prompt: jest.fn().mockResolvedValue('N8N landscape') };
        expect(await extractSearchTerms(aiClient, 'Tell me how N8N is used in our landscape', logger))
            .toBe('N8N landscape');
        expect(aiClient.prompt).toHaveBeenCalled();
    });
});
