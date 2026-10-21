/**
 * @fileoverview AI Chat API routes for Wiki application
 * Handles AI-powered chat interactions using the configured AI provider.
 *
 * @author noobly Team
 * @version 2.0.0
 * @since 2025-10-03
 */

'use strict';

const { resolveExpert } = require('../../shared/ai/expertResolver');
const { answersOffline } = require('../../shared/ai/agentTasks');
const { summarizeFromSearch } = require('../components/searchSummarizer');
const { extractSearchTerms } = require('../components/queryExtractor');
const { answerOverDocument } = require('../components/documentChatProcessor');
const spaceUserStore = require('../components/spaceUserStore');

// The usage tag that marks an AI agent as the one to serve wiki chat. Pick
// which agent handles chat by checking "Chat Processing" on it in the Agents screen.
const CHAT_USAGE = 'Chat Processing';

// Default cap on completion tokens for chat responses.
const MAX_COMPLETION_TOKENS = 16000;

/**
 * Resolve the AI client for wiki chat — a fresh client on every call.
 *
 * Delegates to the shared resolveExpert(), picking the agent that declares the
 * "Chat Processing" usage. The Agents registry is rebuilt on every agent change (see
 * aiInstances.js), so resolving fresh means the next request always uses the
 * current configuration; an in-flight request keeps the client it already holds.
 *
 * Returns null (rather than throwing) when no agent is configured, so the chat
 * routes can report "not configured" gracefully.
 *
 * @param {Object} [logger] - Logger used for info/warn messages.
 * @returns {Object|null} The AI client, or null if no agent is configured
 */
function getAIClient(logger) {
  try {
    return resolveExpert({
      usage: CHAT_USAGE,
      logger,
      label: '[AI Chat]',
      maxTokens: MAX_COMPLETION_TOKENS
    });
  } catch (error) {
    logger?.info(`[AI Chat] AI client not available: ${error.message}`);
    return null;
  }
}

/**
 * Configures and registers AI chat routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { cache, searchIndexer, filingServiceWrapper, appBaseDir, dataManager, knowledge } = services;
  const logger = services.logger || services.log;

  /**
   * Get AI chat status (whether configured and available)
   * GET /applications/wiki/api/ai/chat/status
   */
  app.get('/applications/wiki/api/ai/chat/status', async (req, res) => {
    try {
      const client = getAIClient(logger);
      const isConfigured = client !== null;

      res.json({
        success: true,
        configured: isConfigured,
        enabled: isConfigured,
        // NooblyJS Phase 8: asking the wiki works without a model too (the sources' own passages, cited).
        searchWithoutModel: Boolean(knowledge),
        provider: isConfigured ? client.provider : null,
        model: client ? client.modelName : null
      });
    } catch (error) {
      logger.error('Error checking AI status:', error);
      res.status(500).json({ error: 'Failed to check AI status' });
    }
  });

  /**
   * Send a chat message to AI and get response
   * POST /applications/wiki/api/ai/chat
   */
  app.post('/applications/wiki/api/ai/chat', async (req, res) => {
    try {
      // Check authentication
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;
      const { message, context } = req.body;

      if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Rate limiting: 20 requests per hour per user
      const rateLimitKey = `ai:ratelimit:${userId}`;
      const requestCount = (await cache.get(rateLimitKey)) || 0;

      if (requestCount >= 20) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        });
      }

      // Get the AI client
      const client = getAIClient(logger);
      if (!client) {
        return res.status(400).json({
          error: 'AI service not configured — add an AI agent in the Agents configuration.',
          needsConfiguration: true
        });
      }

      // Build system prompt for wiki assistant
      const systemPrompt = 'You are a helpful AI assistant for a knowledge management wiki platform. ' +
        'Help users understand, create, and improve their documents. ' +
        'When context is provided about the current document or folder, use it to give more relevant answers. ' +
        'Format your responses in Markdown when appropriate.';

      // Send prompt to the AI provider
      logger.info(`[AI Chat] Sending to AI - prompt length: ${message.length} chars`);
      logger.info(`[AI Chat] User message preview: ${message.substring(0, 200)}...`);
      const aiResponseContent = await client.prompt(systemPrompt, message);
      logger.info(`[AI Chat] AI response: type=${typeof aiResponseContent}, length=${aiResponseContent ? aiResponseContent.length : 'null'}, preview=${aiResponseContent ? aiResponseContent.substring(0, 200) : 'NULL/EMPTY'}`);

      // Increment rate limit
      await cache.put(rateLimitKey, requestCount + 1, 3600);

      // Load existing chat history
      let chatHistory = [];
      try {
        chatHistory = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
      } catch (error) {
        chatHistory = [];
      }

      // Add to chat history
      const messageId = Date.now().toString();
      const chatEntry = {
        id: messageId,
        userMessage: message,
        aiResponse: aiResponseContent,
        context: context || {},
        timestamp: new Date().toISOString(),
        model: client.modelName,
        provider: client.provider
      };

      chatHistory.push(chatEntry);

      // Keep only last 100 messages to prevent file bloat
      if (chatHistory.length > 100) {
        chatHistory = chatHistory.slice(-100);
      }

      // Save updated chat history
      await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', chatHistory);

      // Clear cache for chat history
      await cache.delete(`chat:history:${userId}`);

      logger.info(`AI chat message processed for user ${userId}`);

      res.json({
        success: true,
        messageId: messageId,
        response: aiResponseContent,
        usage: {},
        model: client.modelName,
        provider: client.provider,
        timestamp: chatEntry.timestamp
      });
    } catch (error) {
      logger.error('Error processing AI chat:', error);

      // Provide useful error details based on common AI provider failures
      let userMessage = error.message || 'Failed to process chat message';
      if (error.status === 401 || error.code === 'AuthenticationError') {
        userMessage = 'AI authentication failed — check the API key in the Agents configuration.';
      } else if (error.status === 404) {
        userMessage = 'AI deployment not found — check the deployment and endpoint in the Agents configuration.';
      } else if (error.status === 429) {
        userMessage = 'AI rate limit exceeded. Please try again in a moment.';
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        userMessage = 'Cannot reach the AI endpoint — check the endpoint in the Agents configuration.';
      }

      res.status(500).json({
        error: 'Failed to process chat message',
        message: userMessage
      });
    }
  });

  /**
   * Search-then-answer: when no document is open, the chat runs a wiki search,
   * fetches/builds AI summaries for the top 20 hits (cached as
   * <folder>/.aicontext/<name>-summary.md), and asks the AI to answer using only
   * those summaries. Sources are returned for the UI to render as clickable links.
   * POST /applications/wiki/api/ai/chat/search
   */
  app.post('/applications/wiki/api/ai/chat/search', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;
      const { message, folderPath, spaceName } = req.body;

      if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Optional folder/space scope. When the user enables "search within this
      // folder", the frontend sends the current folder path (and its space) so the
      // wiki search is constrained to that subtree instead of the whole index.
      const scopePrefix = (typeof folderPath === 'string' && folderPath.trim() && folderPath.trim() !== '/')
        ? folderPath.trim()
        : '';
      const scopeSpaces = (scopePrefix && typeof spaceName === 'string' && spaceName.trim())
        ? [spaceName.trim()]
        : [];

      const rateLimitKey = `ai:ratelimit:${userId}`;
      const requestCount = (await cache.get(rateLimitKey)) || 0;
      if (requestCount >= 20) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        });
      }

      // Hosted with no model configured in Teammates, an agent would only answer "no model": answer as without one.
      let client = getAIClient(logger);
      if (client && await answersOffline()) client = null;
      if (!client && knowledge) {
        // NooblyJS Phase 8: with no AI agent configured the answer is the top sources' own
        // passages, cited by number like a model's answer, and it says that no model
        // wrote it. It is kept, so it can be added to an item, saved or reported.
        const question = message.trim();
        const offline = await knowledge.answerOffline(question, { user: req.user });
        const kept = offline.sources.length
          ? await knowledge.keep({ question, response: offline.response, sources: offline.sources, by: userId })
          : null;
        const timestamp = new Date().toISOString();
        const messageId = Date.now().toString();
        let history = [];
        try {
          history = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
        } catch {
          history = [];
        }
        history.push({
          id: messageId,
          userMessage: message,
          aiResponse: offline.response,
          context: { mode: 'search', sources: offline.sources, scope: null, searchQuery: null, answerId: kept ? kept.id : null },
          timestamp,
          model: null,
          provider: null
        });
        if (history.length > 100) history = history.slice(-100);
        await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', history);
        await cache.delete(`chat:history:${userId}`);
        return res.json({
          success: true,
          messageId,
          answerId: kept ? kept.id : null,
          response: offline.response,
          sources: offline.sources,
          searchQuery: null,
          usage: {},
          model: null,
          provider: null,
          timestamp
        });
      }
      if (!client) {
        return res.status(400).json({
          error: 'AI service not configured — add an AI agent in the Agents configuration.',
          needsConfiguration: true
        });
      }

      if (!searchIndexer || !filingServiceWrapper) {
        return res.status(503).json({
          error: 'Search service not available'
        });
      }

      // Conversational messages make poor keyword queries ("Tell me how N8N is
      // used in our landscape" — the filler drowns out "N8N"). Distill the
      // message to its key terms for the SEARCH only; the AI still answers
      // from the full original question below. Falls back to the raw message
      // on any extraction failure.
      const rawMessage = message.trim();
      const searchQuery = await extractSearchTerms(client, rawMessage, logger);

      // Diagnostic trail (console, not just the app log) so irrelevant answers
      // can be traced: was it the extraction, the search, or the AI?
      console.log(`[AI Chat Search] question:     "${rawMessage}"`);
      console.log(`[AI Chat Search] search query: "${searchQuery}"${searchQuery === rawMessage ? ' (raw message — extraction skipped or fell back)' : ' (extracted)'}`);
      console.log(`[AI Chat Search] scope:        ${scopePrefix ? `"${scopePrefix}" in space [${scopeSpaces.join(', ')}]` : 'whole wiki'}`);

      // Space records let the summarizer drop hits the owning space hides
      // (allowedPaths / excludedPaths) before any of them is read, summarised
      // or cited — chat reaches the index directly and never passes through
      // the search route's own filter.
      let spaceRecords = [];
      try {
        const spacesData = await dataManager.read('spaces');
        spaceRecords = Array.isArray(spacesData) ? spacesData : (spacesData?.data || []);
      } catch (error) {
        logger.warn(`[AI Chat Search] Could not read spaces for path filtering: ${error.message}`);
      }

      const searchDeps = {
        searchIndexer,
        filingServiceWrapper,
        aiClient: client,
        logger,
        pathPrefix: scopePrefix,
        spaceNames: scopeSpaces,
        spaces: spaceRecords
      };
      let summaries = await summarizeFromSearch(searchQuery, searchDeps);

      // Safety net: an over-aggressive extraction can lose recall — retry once
      // with the user's own words before reporting nothing found.
      if (summaries.length === 0 && searchQuery !== rawMessage) {
        logger.info(`[AI Chat Search] No hits for extracted query "${searchQuery}" — retrying with the raw message`);
        console.log(`[AI Chat Search] 0 hits for "${searchQuery}" — retrying with the raw message`);
        summaries = await summarizeFromSearch(rawMessage, searchDeps);
      }

      console.log(`[AI Chat Search] ${summaries.length} sources handed to the AI:`);
      summaries.forEach((s, i) => {
        const kind = s.cached ? 'cached/workflow summary' : (s.skipped ? 'excerpt fallback' : 'fresh AI summary');
        const hit = s.matched ? `, matched: "${s.matched.slice(0, 80)}"` : ', no matched passage';
        console.log(`  [${i + 1}] ${s.spaceName}/${s.path}  (score=${Number(s.score || 0).toFixed(3)}, ${kind}${hit})`);
      });

      let aiResponseContent;
      const sources = summaries.map(s => ({
        path: s.path,
        title: s.title,
        spaceName: s.spaceName
      }));

      if (summaries.length === 0) {
        // When extraction ran we searched twice (extracted terms, then the raw
        // message) — say what was tried so the user can adjust their wording.
        const searchedNote = searchQuery !== rawMessage ? ` (searched for “${searchQuery}”)` : '';
        aiResponseContent = scopePrefix
          ? `I couldn't find anything matching your question${searchedNote} within **${scopePrefix}**. Try rephrasing, or untick "within this folder" to search the whole wiki.`
          : `I couldn't find anything in the wiki that matches your question${searchedNote}. Try rephrasing, or check whether the relevant pages exist.`;
      } else {
        const sourcesBlock = summaries
          .map((s, i) => {
            // The match-centered passage where the search query actually hit —
            // topical summaries routinely drop the specific name/value a lookup
            // question is about, so hand the AI the passage as direct evidence.
            // (Omitted when it would duplicate an excerpt-fallback summary.)
            const matchedLine = (s.matched && s.matched !== s.summary)
              ? `\nMatched passage: "…${s.matched}…"`
              : '';
            return `### Source [${i + 1}]: ${s.title}\nSpace: ${s.spaceName}\nPath: ${s.path}${matchedLine}\n\n${s.summary}`;
          })
          .join('\n\n---\n\n');

        const systemPrompt =
          'You are a helpful AI assistant for a knowledge management wiki. ' +
          'Answer the user\'s question using ONLY the provided sources. ' +
          'Each source is a document summary; some also include a "Matched passage" — the exact text from the document where the search query hit. ' +
          'Matched passages are the strongest evidence, especially for questions about specific people, roles, names, or values — use them even when the summary does not mention the topic. ' +
          'When you reference information from a source, cite it inline using its number in square brackets, e.g. [1] or [2] or [1][3]. ' +
          'Do NOT write out file paths, URLs, or markdown links — just the bracketed number. ' +
          'If the sources do not contain enough information, say so plainly. ' +
          'Format your answer in Markdown.';

        const userPrompt = `Question: ${rawMessage}\n\nAvailable source summaries (cite by number, e.g. [1]):\n\n${sourcesBlock}`;

        logger.info(`[AI Chat Search] Asking AI with ${summaries.length} sources, prompt ${userPrompt.length} chars`);
        aiResponseContent = await client.prompt(systemPrompt, userPrompt);
      }

      await cache.put(rateLimitKey, requestCount + 1, 3600);

      // NooblyJS Phase 8: an answer with sources is kept, so it can be added to an item,
      // saved as a page or reported as wrong (knowledgeRoutes). Keeping it must never
      // cost the user their answer.
      let answerId = null;
      if (knowledge && sources.length) {
        try {
          const kept = await knowledge.keep({ question: rawMessage, response: aiResponseContent, sources, model: client.modelName, searchQuery, by: userId });
          answerId = kept.id;
        } catch (error) {
          logger.warn(`[AI Chat Search] Could not keep the answer: ${error.message}`);
        }
      }

      let chatHistory = [];
      try {
        chatHistory = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
      } catch {
        chatHistory = [];
      }

      const messageId = Date.now().toString();
      const chatEntry = {
        id: messageId,
        userMessage: message,
        aiResponse: aiResponseContent,
        context: {
          mode: 'search',
          sources,
          answerId,
          scope: scopePrefix || null,
          // The distilled query the search actually ran with (null = raw message).
          searchQuery: searchQuery !== rawMessage ? searchQuery : null
        },
        timestamp: new Date().toISOString(),
        model: client.modelName,
        provider: client.provider
      };
      chatHistory.push(chatEntry);
      if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
      await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', chatHistory);
      await cache.delete(`chat:history:${userId}`);

      res.json({
        success: true,
        messageId,
        answerId,
        response: aiResponseContent,
        sources,
        // What the search actually ran with — lets the UI show "Searched for
        // 'N8N'" instead of the generic label. Null when the raw message was used.
        searchQuery: searchQuery !== rawMessage ? searchQuery : null,
        usage: {},
        model: client.modelName,
        provider: client.provider,
        timestamp: chatEntry.timestamp
      });
    } catch (error) {
      logger.error('Error processing AI chat search:', error);
      res.status(500).json({
        error: 'Failed to process search chat',
        message: error.message || 'Unknown error'
      });
    }
  });

  /**
   * Whole-document chat: answer a question over the ENTIRE open document by
   * reading it section by section (sequential refine) instead of truncating it
   * to the first few thousand characters. The frontend posts the full cleaned
   * content; this route walks it and returns a single synthesized answer.
   * POST /applications/wiki/api/ai/chat/document
   */
  app.post('/applications/wiki/api/ai/chat/document', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;
      const { question, content, documentTitle, documentPath } = req.body;

      if (!question || question.trim().length === 0) {
        return res.status(400).json({ error: 'Question is required' });
      }
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Document content is required' });
      }

      // Rate limit by user request (one chat = one increment), not per internal
      // AI call — a refine over N sections still counts as a single request.
      const rateLimitKey = `ai:ratelimit:${userId}`;
      const requestCount = (await cache.get(rateLimitKey)) || 0;
      if (requestCount >= 20) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        });
      }

      const client = getAIClient(logger);
      if (!client) {
        return res.status(400).json({
          error: 'AI service not configured — add an AI agent in the Agents configuration.',
          needsConfiguration: true
        });
      }

      const documentLabel = documentTitle || documentPath || 'the document';
      logger.info(`[AI Chat Document] Answering over "${documentLabel}" (${content.length} chars)`);

      const { answer, chunks, partial } = await answerOverDocument({
        aiClient: client,
        question: question.trim(),
        content,
        documentLabel,
        logger
      });

      await cache.put(rateLimitKey, requestCount + 1, 3600);

      let chatHistory = [];
      try {
        chatHistory = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
      } catch {
        chatHistory = [];
      }

      // Store in the same "Context:\n...\n\nQuestion:\n<q>" shape the other chat
      // routes use, so history reload renders the context bubble + question.
      const messageId = Date.now().toString();
      const chatEntry = {
        id: messageId,
        userMessage: `Context:\nThe user is viewing the document: ${documentLabel}\n\nQuestion:\n${question.trim()}`,
        aiResponse: answer,
        context: { mode: 'document', documentTitle, documentPath, chunks, partial },
        timestamp: new Date().toISOString(),
        model: client.modelName,
        provider: client.provider
      };
      chatHistory.push(chatEntry);
      if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
      await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', chatHistory);
      await cache.delete(`chat:history:${userId}`);

      res.json({
        success: true,
        messageId,
        response: answer,
        chunks,
        partial,
        usage: {},
        model: client.modelName,
        provider: client.provider,
        timestamp: chatEntry.timestamp
      });
    } catch (error) {
      logger.error('Error processing AI document chat:', error);
      res.status(500).json({
        error: 'Failed to process document chat',
        message: error.message || 'Unknown error'
      });
    }
  });

  /**
   * Get chat history for the current user
   * GET /applications/wiki/api/ai/chat/history
   */
  app.get('/applications/wiki/api/ai/chat/history', async (req, res) => {
    try {
      // Check authentication
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;
      const cacheKey = `chat:history:${userId}`;

      // Try cache first
      let chatHistory = await cache.get(cacheKey);

      if (!chatHistory) {
        try {
          chatHistory = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
          // Cache for 5 minutes
          await cache.put(cacheKey, chatHistory, 300);
        } catch (error) {
          chatHistory = [];
        }
      }

      // Return last 50 messages (most recent)
      const limit = parseInt(req.query.limit) || 50;
      const recentHistory = chatHistory.slice(-limit);

      res.json({
        success: true,
        history: recentHistory,
        total: chatHistory.length
      });
    } catch (error) {
      logger.error('Error fetching chat history:', error);
      res.status(500).json({ error: 'Failed to fetch chat history' });
    }
  });

  /**
   * Clear chat history for the current user
   * POST /applications/wiki/api/ai/chat/clear
   */
  app.post('/applications/wiki/api/ai/chat/clear', async (req, res) => {
    try {
      // Check authentication
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;

      // Clear chat history
      await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);

      // Clear cache
      await cache.delete(`chat:history:${userId}`);

      logger.info(`Chat history cleared for user ${userId}`);

      res.json({
        success: true,
        message: 'Chat history cleared successfully'
      });
    } catch (error) {
      logger.error('Error clearing chat history:', error);
      res.status(500).json({ error: 'Failed to clear chat history' });
    }
  });

  /**
   * Delete a specific message from chat history
   * DELETE /applications/wiki/api/ai/chat/:messageId
   */
  app.delete('/applications/wiki/api/ai/chat/:messageId', async (req, res) => {
    try {
      // Check authentication
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.email;
      const { messageId } = req.params;

      // Load chat history
      let chatHistory = [];
      try {
        chatHistory = await spaceUserStore.readJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', []);
      } catch (error) {
        return res.status(404).json({ error: 'Chat history not found' });
      }

      // Filter out the message
      const updatedHistory = chatHistory.filter(entry => entry.id !== messageId);

      if (updatedHistory.length === chatHistory.length) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Save updated history
      await spaceUserStore.writeJson(appBaseDir, spaceUserStore.spaceOf(req), userId, 'chathistory.json', updatedHistory);

      // Clear cache
      await cache.delete(`chat:history:${userId}`);

      logger.info(`Chat message ${messageId} deleted for user ${userId}`);

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting chat message:', error);
      res.status(500).json({ error: 'Failed to delete message' });
    }
  });
};
