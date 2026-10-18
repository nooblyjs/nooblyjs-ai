/**
 * @fileoverview AIPrompt — prompt adapter over a shared aiservice instance.
 *
 * Previously this class constructed its own Azure OpenAI client. It now routes
 * prompts through a named aiservice instance created at datasources startup
 * from the Agents configuration (see datasources/lib/aiInstances.js).
 *
 * The public API is deliberately unchanged so existing callers keep working:
 *   - new AIPrompt(options)
 *   - instance.prompt(systemContent, userContent) -> Promise<string>
 *   - AIPrompt.sanitizePrompt(text) -> string
 *   - instance.modelName / instance.max_completion_tokens fields
 *
 * @author noobly Team
 * @version 2.0.0
 */
'use strict';

/**
 * This class exposes a prompt() method backed by a shared AI service instance.
 *
 * @constructor - Receives optional instance-selection settings
 * @method prompt - Send a system + user prompt and return the text response
 */
class AIPrompt {

    /**
     * Constructor.
     * @param {object} [options] - Optional settings.
     * @param {string} [options.instanceName] - Agent name/slug of the AI
     *   instance to use. Falls back to the first instance of `provider`.
     * @param {string} [options.provider='openai'] - Provider to fall back to
     *   when no `instanceName` match is found.
     */
    constructor(options = {}) {
        // Which shared instance to route through. Resolved lazily on first
        // prompt() call so this works regardless of construction order vs.
        // datasources AI instance initialization.
        this.instanceName = options.instanceName || null;
        this.provider = options.provider || 'openai';

        // Set by callers (e.g. aiChatRoutes) — used for logging and as the
        // maxTokens passed through to the underlying instance.
        this.modelName = options.model || options.deployment || null;
        this.max_completion_tokens = options.maxTokens || null;

        // The instance is resolved once and cached, so a job that started with
        // a given agent keeps using it even if the configuration changes.
        this._resolvedInstance = null;
    }

    /**
     * Sanitize a prompt string for safe transmission to the AI provider.
     *
     * What this strips and why:
     *  - Null bytes (\x00) — explicitly rejected by the OpenAI API and
     *    break JSON serialization in some HTTP clients.
     *  - Other C0 control chars (\x01-\x08, \x0B, \x0C, \x0E-\x1F, \x7F) —
     *    invisible characters that confuse models and may corrupt JSON.
     *    Tab (\x09), newline (\x0A), and carriage return (\x0D) are kept.
     *  - C1 control chars (\x80-\x9F) — legacy invisible characters often
     *    pasted in from Word/Excel/RTF. Safe to drop.
     *  - Zero-width / BOM characters (​-‍, ⁠, ﻿) —
     *    invisible to humans, but they shift tokenization and are the
     *    classic prompt-injection vector. Legitimate uses in prompt text
     *    are vanishingly rare.
     *  - Lone surrogates — invalid UTF-16 sequences that make
     *    JSON.stringify throw in strict environments.
     *  - Carriage returns inside line endings normalized to \n.
     *
     * What this deliberately preserves:
     *  - Semicolons, quotes, brackets, backticks, slashes — these are
     *    normal punctuation found in prose and code samples and are not
     *    the cause of OpenAI errors.
     *  - Markdown syntax — the model is fed markdown intentionally.
     *  - Tabs and newlines — preserve author formatting and code blocks.
     *
     * @param {string} text - Prompt text to clean
     * @returns {string} - Cleaned prompt text (always a string)
     */
    static sanitizePrompt(text) {
        if (text == null) return '';
        let s = String(text);
        // Normalize line endings to \n.
        s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        // Drop C0 controls except \t and \n.
        s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        // Drop C1 controls.
        s = s.replace(/[\x80-\x9F]/g, '');
        // Drop zero-width / BOM marks (prompt-injection vectors).
        s = s.replace(/[​-‍⁠﻿]/g, '');
        // Replace lone surrogates with U+FFFD so JSON.stringify can encode them.
        s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
        return s;
    }

    /**
     * Resolve the shared aiservice instance to route prompts through.
     * @returns {Object} The aiservice instance.
     * @throws {Error} When the AI instance registry or a matching instance is
     *   not available.
     */
    resolveInstance() {
        // Resolved once per AIPrompt — subsequent prompt() calls in the same
        // job reuse it, unaffected by later agent configuration changes.
        if (this._resolvedInstance) {
            return this._resolvedInstance;
        }

        const registry = global.aiInstances;
        if (!registry) {
            throw new Error('AI instances are not initialized — datasources startup has not run');
        }

        const instance = (this.instanceName && registry.get(this.instanceName))
            || registry.getByProvider(this.provider);

        if (!instance) {
            throw new Error(
                `No AI instance available for ${this.instanceName
                    ? `"${this.instanceName}"`
                    : `provider "${this.provider}"`} — check the Agents configuration`
            );
        }

        this._resolvedInstance = instance;
        return instance;
    }

    /**
     * Create a prompt by sending system + user content to the shared instance.
     * @param {string} systemContent - System / instruction text.
     * @param {string} userContent - User text.
     * @returns {Promise<string>} The model's text response.
     */
    async prompt(systemContent, userContent) {
        const safeSystem = AIPrompt.sanitizePrompt(systemContent);
        const safeUser = AIPrompt.sanitizePrompt(userContent);
        const removedSystem = (systemContent ? String(systemContent).length : 0) - safeSystem.length;
        const removedUser = (userContent ? String(userContent).length : 0) - safeUser.length;
        if (removedSystem > 0 || removedUser > 0) {
            console.log(`[AIPrompt] Sanitized prompt: removed ${removedSystem} chars from system, ${removedUser} chars from user`);
        }

        const instance = this.resolveInstance();

        // The core provider's prompt() takes a single combined prompt, so the
        // system instructions are prepended as a preamble to the user content.
        const combined = safeSystem ? `${safeSystem}\n\n${safeUser}` : safeUser;

        const options = {};
        if (this.max_completion_tokens) options.maxTokens = this.max_completion_tokens;

        if (process.env.DEBUG_AI) {
            console.log(`[AIPrompt] Calling AI instance - provider: ${this.provider}, model: ${this.modelName}, max_tokens: ${this.max_completion_tokens}`);
        }
        const response = await instance.prompt(combined, options);

        // Core providers return { content, usage, model, provider }; some may
        // return a plain string. Normalize to the response text.
        const content = (response && typeof response === 'object') ? response.content : response;

        if (!content) {
            console.warn('[AIPrompt] Empty content returned from AI instance.', JSON.stringify({
                provider: this.provider,
                usage: response && response.usage
            }));
        }

        return content;
    }
}

module.exports = AIPrompt;
