/**
 * @fileoverview Search-driven summarizer for AI chat.
 * Runs a wiki search, then for each top result either reuses a cached
 * AI-generated summary (under <folder>/.aicontext/<name>-summary.md) or
 * generates and persists a fresh one. Returns summaries packaged with
 * source metadata for the chat route to assemble into a final prompt.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

'use strict';

const path = require('node:path');
const { toContextRelPath } = require('../../shared/utils/filePolicy');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');

/**
 * Drop index hits whose owning space does not expose them
 * (allowedPaths / excludedPaths). A hit for an unknown space is kept — the
 * space list is advisory here, and dropping on a lookup miss would silently
 * blank chat grounding if the records could not be loaded.
 *
 * @param {Array} results - raw search hits
 * @param {Array} spaces - space records
 * @return {Array}
 */
function filterHiddenResults(results, spaces) {
    if (!Array.isArray(results) || !Array.isArray(spaces) || spaces.length === 0) {
        return results || [];
    }
    const cache = new Map();
    return results.filter(result => {
        const spaceName = result.spaceName;
        if (!cache.has(spaceName)) {
            const space = spaces.find(s => s.name === spaceName);
            cache.set(spaceName, space ? compileVisibility(space) : null);
        }
        const visibility = cache.get(spaceName);
        if (!visibility || !visibility.restricted) return true;
        return visibility.isFileVisible(result.relativePath || result.path);
    });
}

const SUMMARY_FOLDER = '.aicontext';
const SUMMARY_SUFFIX = '-summary.md';
// The build-context workflow writes its curated context sidecars under the
// space-root `.system/context/` namespace, mirroring the source tree and keeping
// each source file's own name (e.g. `Foo/Bar.md` -> `.system/context/Foo/Bar.md`),
// plus a `_folder.md` roll-up per folder. Chat PREFERS these over its own
// on-the-fly summaries so answers are grounded in the same context the AI Context
// Manager shows. Path built via filePolicy.toContextRelPath (single source of truth).
const MAX_RESULTS = 12;
const CONCURRENCY = 5;
const MAX_SOURCE_CHARS = 12000;
// Per-call ceiling; Azure OpenAI occasionally stalls and we don't want one
// slow call to drag the whole search over the proxy's 120s timeout.
const SUMMARY_CALL_TIMEOUT_MS = 25000;
// Overall time budget for the fan-out phase. After this, any remaining
// uncached results fall back to their search excerpt instead of waiting.
const SUMMARY_PHASE_BUDGET_MS = 60000;
const SUMMARY_SYSTEM_PROMPT =
    'You summarize markdown documents for retrieval. Be brief: 2-3 short paragraphs, ' +
    'roughly 150 words total. Capture the main topics, key concepts, and any actionable ' +
    'steps. When the document names people and their roles (owners, executives, ' +
    'architects, contacts), include those names. Use plain prose. Do not invent ' +
    'content. Do not include preamble like "This document...".';

function isMarkdown(p) {
    return typeof p === 'string' && /\.(md|markdown)$/i.test(p);
}

/**
 * Flatten a search snippet for use in an AI prompt: the core engine wraps
 * query hits in <mark> tags — strip all markup and collapse whitespace.
 */
function stripHtmlTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function stripExt(name) {
    return name.replace(/\.[^./\\]+$/, '');
}

function summaryPathFor(sourcePath) {
    const dir = path.posix.dirname(sourcePath.replace(/\\/g, '/'));
    const base = path.posix.basename(sourcePath.replace(/\\/g, '/'));
    const summaryName = `${stripExt(base)}${SUMMARY_SUFFIX}`;
    return dir === '.' || dir === ''
        ? `${SUMMARY_FOLDER}/${summaryName}`
        : `${dir}/${SUMMARY_FOLDER}/${summaryName}`;
}

/**
 * Path of the build-context workflow's sidecar for a source file — folder-local,
 * in the source's OWN folder (e.g. `Foo/Bar.md` -> `Foo/.system/context/Bar.md`,
 * `Foo/Deck.pdf` -> `Foo/.system/context/Deck.pdf.md`). filePolicy owns the naming
 * rule; see toContextRelPath.
 */
function workflowContextPathFor(sourcePath) {
    return toContextRelPath(sourcePath.replace(/\\/g, '/'));
}

function readMtime(meta) {
    if (!meta) return 0;
    const raw = meta.mtime || meta.modifiedTime || meta.modified || meta.modifiedAt;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
}

async function getMtime(filingServiceWrapper, spaceName, p) {
    try {
        const meta = await filingServiceWrapper.getFileMetadata(spaceName, p);
        return readMtime(meta);
    } catch {
        return 0;
    }
}

async function readIfExists(filingServiceWrapper, spaceName, p) {
    try {
        const data = await filingServiceWrapper.readDocument(spaceName, p);
        if (data == null) return null;
        return Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    } catch {
        return null;
    }
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

async function generateSummary(aiClient, sourceText, sourceLabel) {
    const trimmed = sourceText.length > MAX_SOURCE_CHARS
        ? sourceText.slice(0, MAX_SOURCE_CHARS) + '\n\n[...truncated...]'
        : sourceText;
    const userMsg = `Source: ${sourceLabel}\n\n${trimmed}`;
    const result = await withTimeout(
        aiClient.prompt(SUMMARY_SYSTEM_PROMPT, userMsg),
        SUMMARY_CALL_TIMEOUT_MS,
        `Summarize(${sourceLabel})`
    );
    return (result || '').trim();
}

async function processResult(result, deps, phase) {
    const { filingServiceWrapper, aiClient, logger } = deps;
    const spaceName = result.spaceName;
    const sourcePath = (result.path || result.relativePath || '').replace(/\\/g, '/');

    if (!spaceName || !sourcePath) {
        return null;
    }

    const title = result.title || result.name || path.posix.basename(sourcePath);
    // Match-centered snippet from the search engine — the exact passage the
    // query hit (e.g. "…Technology Executive Debbie Cunningham DR Level…").
    // Carried on EVERY path: topical summaries are lossy and routinely drop
    // the one detail a lookup question ("who is X") is actually about.
    const matched = stripHtmlTags(result.snippet || '');
    const base = {
        path: sourcePath,
        title,
        spaceName,
        score: result.score || 0,
        matched
    };
    const fallbackToExcerpt = (reason) => {
        // Prefer the match-centered snippet — result.excerpt is just the first
        // ~200 chars of the document and may not contain the hit at all.
        const excerpt = (matched || result.excerpt || '').trim();
        if (reason && logger) logger.info(`[SearchSummarizer] Falling back to excerpt for ${spaceName}/${sourcePath}: ${reason}`);
        return excerpt ? { ...base, summary: excerpt, cached: false, skipped: true } : null;
    };

    if (!isMarkdown(sourcePath)) {
        return fallbackToExcerpt(null);
    }

    const sourceMtime = await getMtime(filingServiceWrapper, spaceName, sourcePath);

    // 1. Prefer the build-context workflow's curated sidecar (<dir>/.context/<file>)
    //    — the same context shown in the AI Context Manager. Use it whenever it
    //    exists and is at least as new as the source document.
    const workflowCtxPath = workflowContextPathFor(sourcePath);
    const workflowMtime = await getMtime(filingServiceWrapper, spaceName, workflowCtxPath);
    if (workflowMtime > 0 && workflowMtime >= sourceMtime) {
        const wf = await readIfExists(filingServiceWrapper, spaceName, workflowCtxPath);
        if (wf && wf.trim()) {
            if (logger) logger.info(`[SearchSummarizer] Using workflow context ${spaceName}/${workflowCtxPath}`);
            return { ...base, summary: wf.trim(), cached: true };
        }
    }

    // 2. No usable workflow sidecar — fall back to this module's own cached summary.
    const summaryPath = summaryPathFor(sourcePath);
    const summaryMtime = await getMtime(filingServiceWrapper, spaceName, summaryPath);

    if (summaryMtime > 0 && summaryMtime >= sourceMtime) {
        const cached = await readIfExists(filingServiceWrapper, spaceName, summaryPath);
        if (cached && cached.length > 0) {
            return { ...base, summary: cached, cached: true };
        }
    }

    // Past the global phase budget? Don't start a new AI call — use the
    // excerpt instead so the user gets *something* back fast.
    if (phase && phase.budgetExceeded()) {
        return fallbackToExcerpt('phase budget exceeded');
    }

    const sourceText = await readIfExists(filingServiceWrapper, spaceName, sourcePath);
    if (!sourceText) {
        return fallbackToExcerpt('source not readable');
    }

    let summary;
    try {
        const t0 = Date.now();
        summary = await generateSummary(aiClient, sourceText, `${spaceName}/${sourcePath}`);
        if (logger) logger.info(`[SearchSummarizer] Summarized ${spaceName}/${sourcePath} in ${Date.now() - t0}ms`);
    } catch (err) {
        return fallbackToExcerpt(err.message);
    }

    if (!summary) {
        return null;
    }

    try {
        await filingServiceWrapper.writeDocument(spaceName, summaryPath, summary);
    } catch (err) {
        logger.warn(`[SearchSummarizer] Could not cache summary at ${spaceName}/${summaryPath}: ${err.message}`);
    }

    return { ...base, summary, cached: false };
}

async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            try {
                results[i] = await worker(items[i], i);
            } catch {
                results[i] = null;
            }
        }
    });
    await Promise.all(runners);
    return results;
}

/**
 * Run search → fetch/generate summaries for top results.
 * @param {string} query - User question.
 * @param {Object} deps - { searchIndexer, filingServiceWrapper, aiClient, logger,
 *   pathPrefix?, spaceNames?, spaces? }. pathPrefix/spaceNames scope the underlying
 *   search to a folder subtree and/or space (empty = whole wiki). `spaces` is the
 *   space records, used to apply per-space path visibility.
 * @returns {Promise<Array>} Summaries: [{ path, title, spaceName, summary, cached, score }]
 */
async function summarizeFromSearch(query, deps) {
    const { searchIndexer, filingServiceWrapper, aiClient, logger, pathPrefix = '', spaceNames = [], spaces = [] } = deps;
    if (!searchIndexer || !filingServiceWrapper || !aiClient) {
        throw new Error('searchSummarizer requires searchIndexer, filingServiceWrapper, and aiClient');
    }

    let results = await searchIndexer.search(query, { maxResults: MAX_RESULTS, pathPrefix, spaceNames });

    // Chat grounding reaches the index DIRECTLY, so the search route's filter
    // never sees these hits. Without this, a curated space's chat would read,
    // summarise and quote back a document the same space refuses to serve over
    // /documents/content — the most damaging possible leak, because the answer
    // arrives as prose with the hidden path cited as its source.
    results = filterHiddenResults(results, spaces);

    // Diagnostic trail: the raw index hits for this exact query string, before
    // any are dropped during summarization — vet irrelevant chat sources here.
    console.log(`[SearchSummarizer] search("${query}")${pathPrefix ? ` scoped to "${pathPrefix}"` : ''} → ${(results || []).length} hits`);
    (results || []).forEach((r, i) => {
        const p = (r.relativePath || r.path || '').replace(/\\/g, '/');
        console.log(`  #${i + 1} score=${Number(r.score || 0).toFixed(3)} ${r.spaceName}/${p}`);
    });

    if (!results || results.length === 0) {
        return [];
    }

    logger.info(`[SearchSummarizer] ${results.length} hits for "${query.slice(0, 60)}"`);

    const t0 = Date.now();
    const phase = {
        startedAt: t0,
        budgetExceeded() { return Date.now() - t0 > SUMMARY_PHASE_BUDGET_MS; }
    };

    const summaries = await runWithConcurrency(results, CONCURRENCY, (r) => processResult(r, deps, phase));
    const ok = summaries.filter(Boolean);
    const generated = ok.filter(s => !s.cached && !s.skipped).length;
    const cached = ok.filter(s => s.cached).length;
    const skipped = ok.filter(s => s.skipped).length;
    logger.info(`[SearchSummarizer] Done in ${Date.now() - t0}ms — ${cached} cached, ${generated} generated, ${skipped} excerpt-fallback`);
    return ok;
}

module.exports = {
    summarizeFromSearch,
    summaryPathFor, // exported for tests
    SUMMARY_FOLDER,
    SUMMARY_SUFFIX,
    MAX_RESULTS
};
