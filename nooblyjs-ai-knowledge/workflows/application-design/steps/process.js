/**
 * @fileoverview Process: Run AI analysis only on directories that contain new
 * or changed files (identified by the upstream diff/fetch step). The AI work is
 * routed through a configured agent from the Agents registry (global.aiInstances)
 * rather than a hard-coded provider, so the model/provider is chosen in the
 * Agents screen — exactly like the wiki chat feature.
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';
const fs = require('fs');
const path = require('path');
const serviceRegistry = require('nooblyjs-core');

const CodeProcessorClass = require('../services/codeProcessor');
// Resolves/creates a configured AI agent from the Agents registry (global.aiInstances).
const { resolveExpert } = require('../../../src/shared/ai/expertResolver');
const { initializeAIInstances } = require('../../../src/datasources/lib/aiInstances');
const { libraryFor } = require('../../common/prompts/prompts');

/**
 * Mirror the main app's APP_BASE_DIR resolution. The worker inherits the
 * parent's env, so APP_BASE_DIR carries through; otherwise fall back to the
 * shared .application dir alongside the repos (…/work/.application). Both the
 * Agents file and the prompt library are resolved from here.
 * @returns {string} Absolute application base directory.
 */
function resolveAppBaseDir() {
    return process.env.APP_BASE_DIR
        ? path.resolve(process.env.APP_BASE_DIR)
        : path.resolve(__dirname, '../../../.application');
}

/**
 * Ensure the AI agent registry (global.aiInstances) exists in this context.
 *
 * Workflow steps run in a worker thread, which has its own global scope and
 * does NOT inherit the registry the main app built on startup. When it's
 * missing we build it here from settings-agents.json, so the step can resolve a
 * "Code Processing" agent exactly as the main app would. No-op when the registry
 * already exists (e.g. running in-process / from the test harness).
 *
 * @param {Object} logger - Logger for initializeAIInstances
 * @returns {Promise<void>}
 */
async function ensureAIInstances(logger) {
    if (global.aiInstances) return;

    const appBaseDir = resolveAppBaseDir();

    // initializeAIInstances builds each aiservice instance, and the aiservice's
    // route module registers HTTP routes on the app it's given — GET, POST, USE
    // and DELETE (aiservice/routes/index.js). The workflows repo has no express
    // dependency, so we pass a no-op stub instead of a real app; it must answer
    // to EVERY routing verb the aiservice registers, or instance creation throws
    // (e.g. a missing `delete` => "app.delete is not a function", which silently
    // drops the agent and yields "No AI agent declares ... usage" downstream).
    // A Proxy returns a no-op for any method, so new routes can't reintroduce the
    // gap. `app.set` is the only non-routing call and is a harmless no-op here
    // (the registry is resolved via global.aiInstances, not app.get).
    const noop = () => {};
    const appStub = new Proxy({}, { get: () => noop });
    await initializeAIInstances({
        serviceRegistry,
        app: appStub,
        log: logger,
        appBaseDir
    });
}

/**
 * Process step.
 *
 * @param {Object} data - Workflow context (enriched by the upstream step)
 * @returns {Promise<Object>} Result with processing outcome
 */
async function run(data) {
    const logger = serviceRegistry.logger();

    // The upstream step's output is at data.steps[0].data and also merged flat
    // onto data. Upstream is the manifest diff (4-step pipeline) or the git
    // fetch (git pipeline) — both supply workingDestination + affectedDirectories.
    const upstream = (data.steps && data.steps[0]) ? data.steps[0].data : {};

    const workingDestination = upstream.workingDestination || data.workingDestination;
    const markdownFolder = data.markdownFolder;
    // null = no filter (first clone / full rebuild); array = the dirs to do.
    const affectedDirectories = upstream.affectedDirectories || data.affectedDirectories || null;
    const changedFiles = upstream.changedFiles || data.changedFiles || null;
    const affectedCount = Array.isArray(affectedDirectories) ? affectedDirectories.length : 'all';

    logger.info('Process: Starting AI analysis', {
        workingDestination,
        markdownFolder,
        affectedCount
    });

    // Skip when the upstream step reported no changes: the git pipeline sets
    // hasChanges=false; the manifest pipeline yields an empty changedFiles list.
    const noChanges = data.hasChanges === false
        || (Array.isArray(changedFiles) && changedFiles.length === 0);
    if (noChanges) {
        logger.info('No changes to process — skipping AI analysis');
        return {
            message: 'No changes detected, processing skipped',
            processedDirectories: 0,
            skipped: true,
            processedAt: new Date().toISOString()
        };
    }

    // Configure the processor — the AI expert is attached below. aiTimeoutMs/
    // aiRetries bound each directory's AI call (default 120s x 3 attempts inside
    // CodeProcessorClass) so one stalled provider call can't hang the whole
    // bottom-up sweep; override per-run via workflow input if a repo needs longer.
    const settings = {
        sourceFolder: workingDestination,
        markdownFolder: markdownFolder,
        affectedDirectories: affectedDirectories,
        aiTimeoutMs: data.aiTimeoutMs,
        aiRetries: data.aiRetries
    };

    try {
        // Build the AI registry in this worker if it isn't already present, then
        // resolve a configured agent from it. Its provider and model are whatever
        // the agent was set up with in the Agents screen.
        await ensureAIInstances(logger);

        // gpt-5 / o-series are reasoning models: their max_completion_tokens
        // budget is shared between hidden reasoning tokens and visible output,
        // so the provider's small default (1000) is spent entirely on reasoning
        // and the response comes back with empty content ("Empty content
        // returned from AI instance", completionTokens pinned at the cap). The
        // four-section docs this step generates need a real budget regardless of
        // model family — give it one, overridable per-run or via env.
        const maxTokens = Number(data.maxTokens || process.env.application_design_max_tokens || 16000);

        const expert = resolveExpert({
            usage: 'Code Processing',
            agentName: data.agent,
            logger,
            label: 'Code Processing',
            maxTokens
        });
        settings.expert = expert;
        // The architect persona and renderer rules come from the prompt library
        // under the same appBaseDir as the Agents file.
        settings.prompts = libraryFor(resolveAppBaseDir());

        // Instantiate processor with affected directories filter
        const codeProcessor = new CodeProcessorClass(settings);

        // Execute processing (only affected directories)
        const result = await codeProcessor.process();

        // The processor is deliberately fault-tolerant — it catches its own
        // errors so one bad directory cannot abort a whole repository — which
        // means it reports problems by RETURN VALUE, not by throwing. This step
        // must therefore inspect that value and fail explicitly. It is the only
        // thing standing between a failed run and record-state advancing the
        // processed-commit marker past commits that were never documented; once
        // the marker moves, the next run diffs from it and those commits are
        // never revisited.
        if (result.success === false) {
            throw new Error(`Process: code documentation failed — ${result.error}`);
        }

        const failed = Array.isArray(result.failedDirectories) ? result.failedDirectories : [];

        // Fail the step when any directory could not be documented, so the
        // marker stays put and the run is retried. maxFailedDirectories is an
        // escape hatch for a directory that fails persistently (e.g. one too
        // large for the model's context) and would otherwise stall the repo's
        // marker forever: raise it to let the run be accepted despite N known
        // failures, which are still logged and returned either way.
        const tolerance = Number(data.maxFailedDirectories || 0);
        if (failed.length > tolerance) {
            const detail = failed.map(f => `${f.directory} (${f.reason})`).join('; ');
            throw new Error(
                `Process: ${failed.length} directory(ies) could not be documented — ${detail}. `
                + 'The processed-commit marker has NOT been advanced, so these commits are retried '
                + 'on the next run. Set maxFailedDirectories to accept a known-bad directory.'
            );
        }

        logger.info('Process: Complete', {
            success: result.success,
            processedDirs: affectedCount,
            failedDirectories: failed.length,
            prunedDocs: result.prunedDocs
        });

        return {
            message: `Processed ${affectedCount} affected directories`,
            processResult: result,
            processedDirectories: affectedCount,
            failedDirectories: failed,
            skipped: false,
            processedAt: new Date().toISOString()
        };
    } catch (error) {
        logger.error('Error during AI processing:', error.message);
        throw error;
    }
}

module.exports = { run };
