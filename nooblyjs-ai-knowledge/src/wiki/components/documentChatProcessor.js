/**
 * @fileoverview Whole-document chat processor for the wiki AI assistant.
 *
 * The single-document chat used to truncate the open document to ~2000 tokens
 * and send one prompt, so anything past the first few thousand characters was
 * silently dropped. This processor instead reads the ENTIRE document by walking
 * it section by section ("sequential refine"): the question is answered from the
 * first section, then each subsequent section is folded into a running answer.
 *
 * The map/refine controls (chunking, per-call timeout, overall budget) mirror
 * searchSummarizer.js so the two AI flows behave consistently.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-07
 */

'use strict';

// Approx chars per section. ~6000 chars ≈ 1500 tokens of source, leaving room
// for the running answer + instructions inside a single completion.
const CHUNK_CHARS = 6000;
// A document at or below this size is answered in one call — no refine loop —
// so small docs keep today's latency.
const SINGLE_CALL_CHARS = 8000;
// Hard cap on sections. With CHUNK_CHARS this bounds how much of a very large
// document we read (MAX_CHUNKS * CHUNK_CHARS). Content past this is dropped and
// the answer is flagged partial, rather than fanning out into dozens of calls.
const MAX_CHUNKS = 20;
const MAX_TOTAL_CHARS = CHUNK_CHARS * MAX_CHUNKS;
// Per-call ceiling so one stalled completion can't drag the whole refine over
// the proxy's request timeout.
const REFINE_CALL_TIMEOUT_MS = 25000;
// Overall budget for the refine loop. Once exceeded we stop folding in more
// sections and return the best answer so far, marked partial.
const REFINE_PHASE_BUDGET_MS = 90000;

const FIRST_SYSTEM_PROMPT =
    'You are a helpful AI assistant for a knowledge management wiki. You are answering a ' +
    'question about a document that is being read in sequential sections. This is the first ' +
    'section. Using ONLY this section, write the best answer you can to the question. If this ' +
    'section does not yet address the question, say what (if anything) here is relevant and note ' +
    'the answer may be completed by later sections. Format your answer in Markdown.';

const REFINE_SYSTEM_PROMPT =
    'You are a helpful AI assistant for a knowledge management wiki, refining an answer to a ' +
    'question as you read a document section by section. You are given the current answer-so-far ' +
    'and the next section of the document. Update the answer to incorporate any new relevant ' +
    'information from the new section: keep what is still correct, and add, correct, or extend it. ' +
    'If the new section adds nothing relevant, return the current answer unchanged. Do NOT mention ' +
    'the section-by-section reading process or section numbers in your answer. Format your answer ' +
    'in Markdown.';

const SINGLE_SYSTEM_PROMPT =
    'You are a helpful AI assistant for a knowledge management wiki platform. Help users ' +
    'understand, create, and improve their documents. Use the provided document content to give a ' +
    'relevant answer to the question. Format your answer in Markdown.';

/**
 * Reject `promise` if it has not settled within `ms` milliseconds.
 */
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
 * Split text into sections of at most CHUNK_CHARS, preferring paragraph
 * boundaries (blank lines) so a section rarely cuts mid-sentence. A single
 * paragraph longer than CHUNK_CHARS is hard-split.
 *
 * @param {string} text - Cleaned document content.
 * @returns {string[]} Ordered, non-empty sections.
 */
function splitIntoChunks(text) {
    const paragraphs = text.split(/\n{2,}/);
    const chunks = [];
    let current = '';

    const pushCurrent = () => {
        const trimmed = current.trim();
        if (trimmed) chunks.push(trimmed);
        current = '';
    };

    for (const para of paragraphs) {
        // A paragraph that is itself too big gets hard-split into CHUNK_CHARS slices.
        if (para.length > CHUNK_CHARS) {
            pushCurrent();
            for (let i = 0; i < para.length; i += CHUNK_CHARS) {
                chunks.push(para.slice(i, i + CHUNK_CHARS));
            }
            continue;
        }

        if (current.length + para.length + 2 > CHUNK_CHARS) {
            pushCurrent();
        }
        current += (current ? '\n\n' : '') + para;
    }
    pushCurrent();

    return chunks;
}

/**
 * Answer a question over the full text of one document using sequential refine.
 *
 * @param {Object} params
 * @param {Object} params.aiClient - Expert exposing prompt(system, user) -> string.
 * @param {string} params.question - The user's question.
 * @param {string} params.content - Full (cleaned) document content.
 * @param {string} [params.documentLabel] - Title/path for prompt context.
 * @param {Object} [params.logger] - Logger for info/warn.
 * @returns {Promise<{answer: string, chunks: number, partial: boolean}>}
 */
async function answerOverDocument({ aiClient, question, content, documentLabel = 'the document', logger }) {
    if (!aiClient) throw new Error('answerOverDocument requires an aiClient');
    if (!question || !question.trim()) throw new Error('answerOverDocument requires a question');

    let text = (content || '').trim();
    let truncated = false;
    if (text.length > MAX_TOTAL_CHARS) {
        text = text.slice(0, MAX_TOTAL_CHARS);
        truncated = true;
        logger?.info(`[DocChat] Document exceeds ${MAX_TOTAL_CHARS} chars — reading the first ${MAX_TOTAL_CHARS}`);
    }

    // Fast path: small enough for one call — keeps latency low for normal docs.
    if (text.length <= SINGLE_CALL_CHARS) {
        const userPrompt = `Document: ${documentLabel}\n\nDocument content:\n${text}\n\nQuestion:\n${question.trim()}`;
        const answer = await aiClient.prompt(SINGLE_SYSTEM_PROMPT, userPrompt);
        return { answer: (answer || '').trim(), chunks: 1, partial: false };
    }

    const chunks = splitIntoChunks(text);
    logger?.info(`[DocChat] Refining over ${chunks.length} sections of "${documentLabel}" (${text.length} chars)`);

    const t0 = Date.now();
    const budgetExceeded = () => Date.now() - t0 > REFINE_PHASE_BUDGET_MS;

    let answer = '';
    let partial = truncated;
    let processed = 0;

    for (let i = 0; i < chunks.length; i++) {
        // Stop folding in more sections once the overall budget is spent — but
        // always do at least the first section so we return something useful.
        if (i > 0 && budgetExceeded()) {
            logger?.info(`[DocChat] Refine budget exceeded after ${processed}/${chunks.length} sections`);
            partial = true;
            break;
        }

        const isFirst = i === 0;
        const system = isFirst ? FIRST_SYSTEM_PROMPT : REFINE_SYSTEM_PROMPT;
        const userPrompt = isFirst
            ? `Question:\n${question.trim()}\n\nSection 1 of ${chunks.length} of "${documentLabel}":\n${chunks[i]}`
            : `Question:\n${question.trim()}\n\nAnswer so far:\n${answer}\n\nNext section (${i + 1} of ${chunks.length}) of "${documentLabel}":\n${chunks[i]}`;

        try {
            const t1 = Date.now();
            const result = await withTimeout(
                aiClient.prompt(system, userPrompt),
                REFINE_CALL_TIMEOUT_MS,
                `Refine(section ${i + 1})`
            );
            const trimmed = (result || '').trim();
            // Keep the previous answer if a fold returns nothing.
            if (trimmed) answer = trimmed;
            processed++;
            logger?.info(`[DocChat] Section ${i + 1}/${chunks.length} folded in ${Date.now() - t1}ms`);
        } catch (err) {
            // A failed/timed-out fold loses that section but not the work so far.
            logger?.warn(`[DocChat] Section ${i + 1}/${chunks.length} failed: ${err.message}`);
            partial = true;
        }
    }

    if (!answer) {
        throw new Error('The AI returned no answer for any section of the document');
    }

    return { answer, chunks: chunks.length, partial };
}

module.exports = {
    answerOverDocument,
    splitIntoChunks, // exported for tests
    CHUNK_CHARS,
    SINGLE_CALL_CHARS,
    MAX_CHUNKS,
    MAX_TOTAL_CHARS
};
