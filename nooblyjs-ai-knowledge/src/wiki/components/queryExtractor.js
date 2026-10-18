/**
 * @fileoverview Search-query extraction for AI chat.
 * Conversational chat messages make poor keyword queries — "Tell me how N8N
 * is used in our landscape" hits the BM25 index with mostly noise words that
 * drown out the one term that matters. This module asks the chat's AI client
 * to distill the message to its key search terms before the wiki search runs.
 *
 * Extraction is strictly an optimization: on any failure (no client, timeout,
 * AI error, unusable/chatty output) the caller gets the original message back
 * and the search behaves exactly as it did before this module existed.
 *
 * Quoted text is sacred. A user who types `"Oracle MySQL"` has told us exactly
 * what to search for, so no rewriting — AI or deterministic — may touch what is
 * inside the quotes, and the quotes themselves survive into the query the
 * search engine sees (the core engine enforces them as exact phrases).
 *
 * @author noobly Team
 * @version 1.1.0
 * @since 2026-07-16
 */

'use strict';

const { parseQuotedPhrases } = require('nooblyjs-core/src/searching/modules/queryParser');

// Messages at or below this many words are already keyword-shaped ("N8N",
// "N8N setup guide") — extraction would cost a round trip for nothing.
const MIN_WORDS_FOR_EXTRACTION = 4;
// Per-call ceiling; extraction must never stall the chat. On timeout the
// search simply runs with the raw message.
const EXTRACT_CALL_TIMEOUT_MS = 8000;
// Caps on the sanitized query handed to search.
const MAX_QUERY_WORDS = 6;
const MAX_QUERY_CHARS = 100;
// A raw model reply longer than this many words is sentence-shaped (chatty
// preamble, refusal, restated question) — unusable as a keyword query.
const MAX_RAW_REPLY_WORDS = 12;

const EXTRACT_SYSTEM_PROMPT =
    'You extract search keywords from a user question so it can be run against a keyword search index. ' +
    'Return ONLY the essential search terms — product names, acronyms, technologies, and topic nouns — separated by single spaces. ' +
    'Keep names, acronyms and identifiers exactly as written (e.g. "N8N" stays "N8N"). ' +
    'NEVER repeat the whole question. Drop every filler word such as "tell", "me", "how", "where", "do", "we", "use", "our". ' +
    'At most 6 terms. No punctuation, no quotes, no explanation, no preamble.\n' +
    'Examples:\n' +
    'Question: Where do we use N8N → N8N\n' +
    'Question: Tell me how N8N is used in our landscape → N8N landscape\n' +
    'Question: What is the process for onboarding a new supplier? → supplier onboarding process';

// Chat-question filler stripped by the deterministic fallback whenever AI
// extraction is skipped, fails, or just parrots the question back. Lowercase.
const FILLER_WORDS = new Set([
    // question words / auxiliaries
    'who', 'what', 'when', 'where', 'why', 'how', 'which', 'whose',
    'do', 'does', 'did', 'done', 'doing', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had',
    // pronouns / determiners
    'i', 'we', 'you', 'they', 'he', 'she', 'it', 'me', 'us', 'them', 'him', 'her',
    'my', 'our', 'your', 'their', 'his', 'its', 'mine', 'ours', 'yours',
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'there', 'here',
    'any', 'some', 'all', 'every', 'each', 'no', 'none', 'such',
    // connectors / prepositions
    'and', 'or', 'but', 'if', 'then', 'than', 'so', 'as', 'of', 'in', 'on', 'at', 'to', 'for', 'from',
    'with', 'without', 'about', 'into', 'onto', 'over', 'under', 'between', 'within', 'across', 'around',
    'by', 'via', 'per', 'through', 'during', 'before', 'after', 'up', 'down', 'out', 'off',
    // conversational verbs / filler
    'tell', 'show', 'explain', 'describe', 'list', 'give', 'find', 'get', 'know', 'need', 'want',
    'use', 'used', 'using', 'uses', 'work', 'works', 'working', 'run', 'runs', 'running',
    'please', 'thanks', 'thank', 'hey', 'hi', 'hello', 'ok', 'okay',
    'currently', 'today', 'now', 'also', 'just', 'really', 'actually', 'basically',
    'way', 'ways', 'thing', 'things', 'stuff', 'etc'
]);

/**
 * Word-level comparison key: lowercased, punctuation flattened. Used to detect
 * an AI reply that merely echoes the question (possibly requoted/repunctuated).
 */
function normalizeForCompare(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Deterministic extraction fallback: drop chat filler words, keep content
 * terms verbatim ("Where do we use N8N" → "N8N"). Returns '' when nothing
 * survives — callers should then keep the original message.
 *
 * @param {string} message - The user's chat message.
 * @returns {string} Space-separated content words, capped at MAX_QUERY_WORDS.
 */
function stripFillerWords(message) {
    const raw = String(message || '').trim();
    if (!raw) return '';
    const kept = [];
    for (const token of raw.split(/\s+/)) {
        // Trim edge punctuation ("N8N?" → "N8N") but keep inner dots (node.js).
        const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!word) continue;
        if (FILLER_WORDS.has(word.toLowerCase())) continue;
        kept.push(word);
        if (kept.length >= MAX_QUERY_WORDS) break;
    }
    return kept.join(' ');
}

/**
 * Build the search query for a message that contains quoted phrases: every
 * phrase re-quoted verbatim, followed by whatever content words survive filler
 * stripping in the unquoted remainder.
 *
 * Phrases are never truncated by the word cap — the user asked for them by
 * name — so the cap only limits how many loose terms ride along.
 *
 * @param {string} message - The user's chat message.
 * @returns {string} The query to search with, or '' when there are no quotes.
 */
function extractQuotedQuery(message) {
    const { phrases, remainder } = parseQuotedPhrases(message);
    if (phrases.length === 0) return '';

    const quotedTerms = phrases.map(p => `"${p}"`);
    // `remainder` still carries the phrase words; drop them so the loose terms
    // are genuinely the rest of the sentence.
    const phraseWords = new Set(
        phrases.join(' ').toLowerCase().split(/\s+/).filter(Boolean)
    );
    const looseSource = remainder
        .split(/\s+/)
        .filter(w => !phraseWords.has(w.toLowerCase()))
        .join(' ');

    const budget = Math.max(0, MAX_QUERY_WORDS - phraseWords.size);
    const loose = budget > 0
        ? stripFillerWords(looseSource).split(/\s+/).filter(Boolean).slice(0, budget)
        : [];

    return [...quotedTerms, ...loose].join(' ');
}

function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (v) => { clearTimeout(t); resolve(v); },
            (e) => { clearTimeout(t); reject(e); }
        );
    });
}

/**
 * Clean a raw model reply into a usable keyword query, or '' when the reply
 * is unusable (empty, or sentence-shaped despite the prompt's instructions).
 *
 * @param {string} raw - Raw text returned by the AI.
 * @returns {string} Space-separated keywords, or '' to signal "fall back".
 */
function sanitizeExtractedQuery(raw) {
    if (!raw || typeof raw !== 'string') return '';

    // First non-empty line — chatty models sometimes add trailing commentary.
    const line = raw.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) || '';
    if (!line) return '';

    // Sentence-shaped replies (refusals, restated questions) are unusable —
    // judge the reply as delivered, before sanitization shrinks it.
    if (line.split(/\s+/).length > MAX_RAW_REPLY_WORDS) return '';

    let query = line
        .replace(/^(keywords?|search terms?|terms|query|answer)\s*[:\-]\s*/i, '') // label prefixes
        .replace(/^[-*→\d.)\s]+/, '')         // list bullets / numbering / example arrow
        .replace(/[`"'“”‘’]/g, '')            // quotes and backticks
        .replace(/[,;|/]+/g, ' ')             // separators → spaces
        .replace(/[.!?]+$/g, '')              // trailing sentence punctuation
        .replace(/\s+/g, ' ')
        .trim();

    if (!query) return '';

    const words = query.split(' ').slice(0, MAX_QUERY_WORDS);
    query = words.join(' ');
    if (query.length > MAX_QUERY_CHARS) query = query.slice(0, MAX_QUERY_CHARS).trim();

    return query;
}

/**
 * Distill a conversational chat message into keyword search terms.
 * Never throws and never returns an empty string for a non-empty message —
 * every failure path falls back to the original message so the caller can
 * pass the result straight to search.
 *
 * @param {Object|null} aiClient - Chat AI client exposing prompt(system, user).
 * @param {string} message - The user's chat message.
 * @param {Object} [logger] - Logger for info messages.
 * @param {Object} [opts] - { timeoutMs } override, used by tests.
 * @returns {Promise<string>} Keyword query, or the original message on fallback.
 */
async function extractSearchTerms(aiClient, message, logger, opts = {}) {
    const raw = String(message || '').trim();
    if (!raw) return raw;

    // Quoted phrases are an explicit instruction — hand them to search verbatim
    // and never let the AI near them (it strips quotes, reorders and "corrects"
    // spelling, all of which defeat an exact-phrase search). The unquoted
    // remainder still gets filler-stripped so the rest of the sentence doesn't
    // dilute the query: `Tell me how "Oracle MySQL" is used here` searches as
    // `"Oracle MySQL"`.
    const quoted = extractQuotedQuery(raw);
    if (quoted) {
        console.log(`[QueryExtractor] quoted phrase preserved: "${raw.slice(0, 80)}" → "${quoted}"`);
        logger?.info(`[QueryExtractor] quoted phrase preserved "${raw.slice(0, 80)}" → "${quoted}"`);
        return quoted;
    }

    // Deterministic fallback used by every non-AI path: strip chat filler so
    // even without a usable AI reply, "Where do we use N8N" searches as "N8N".
    const fallback = (reason) => {
        const stripped = stripFillerWords(raw);
        if (stripped && normalizeForCompare(stripped) !== normalizeForCompare(raw)) {
            console.log(`[QueryExtractor] ${reason} — stripped filler words: "${raw.slice(0, 80)}" → "${stripped}"`);
            logger?.info(`[QueryExtractor] ${reason} — filler-stripped "${raw.slice(0, 80)}" → "${stripped}"`);
            return stripped;
        }
        return raw;
    };

    // Already keyword-shaped — don't burn an AI round trip, but still drop
    // any filler ("Where is N8N" → "N8N").
    if (raw.split(/\s+/).length <= MIN_WORDS_FOR_EXTRACTION) return fallback('short message, AI skipped');
    if (!aiClient) return fallback('no AI client');

    const timeoutMs = opts.timeoutMs || EXTRACT_CALL_TIMEOUT_MS;
    try {
        const reply = await withTimeout(
            aiClient.prompt(EXTRACT_SYSTEM_PROMPT, raw),
            timeoutMs,
            'ExtractSearchTerms'
        );
        const query = sanitizeExtractedQuery(reply);
        if (!query) {
            // Console too (not just the app log) — first thing to check when
            // chat sources look irrelevant is whether extraction worked.
            return fallback(`AI reply unusable (was: "${String(reply || '').slice(0, 120)}")`);
        }
        // Some models parrot the question back; a verbatim echo is worthless
        // as a keyword query, so treat it like any other unusable reply.
        if (normalizeForCompare(query) === normalizeForCompare(raw)) {
            return fallback('AI echoed the question back');
        }
        console.log(`[QueryExtractor] extracted "${query}" from "${raw.slice(0, 80)}"`);
        logger?.info(`[QueryExtractor] "${raw.slice(0, 80)}" → "${query}"`);
        return query;
    } catch (err) {
        return fallback(`extraction failed (${err.message})`);
    }
}

module.exports = {
    extractSearchTerms,
    sanitizeExtractedQuery, // exported for tests
    stripFillerWords,       // exported for tests
    extractQuotedQuery,     // exported for tests
    MIN_WORDS_FOR_EXTRACTION,
    MAX_QUERY_WORDS
};
