'use strict';

const express = require('express');
const projectService = require('../services/projectService');
const chatService = require('../services/chatService');
const settingsService = require('../services/settingsService');
const contextBuilder = require('../services/contextBuilder');
const retrievalService = require('../services/retrievalService');
const registry = require('../providers/registry');
const config = require('../config');
const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { tokenBucket } = require('../middleware/rateLimit');

const router = express.Router({ mergeParams: true });
const HEARTBEAT_MS = 15000;

function sseWriter(res) {
  return function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders?.();
}

router.post(
  '/',
  // Generous for a person (the composer is disabled while a turn streams) but
  // still caps a runaway client loop, which would spend real money.
  tokenBucket({ capacity: 30, refillPerSecond: 1 }),
  asyncHandler(async (req, res) => {
    const { projectId, chatId } = req.params;
    const { content, provider: requestedProvider, model: requestedModel } = req.body || {};

    // Persist the user's message before anything can fail. A provider outage or
    // a crash mid-stream must never lose what they typed.
    const { chat } = await chatService.appendUserMessage(projectId, chatId, content);
    const project = await projectService.get(projectId);
    const settings = await settingsService.get();

    // Resolution and context building happen before the stream opens, so their
    // failures surface as ordinary HTTP errors rather than mid-stream events.
    const { adapter, model, fellBack } = registry.resolve({
      requested: { provider: requestedProvider, model: requestedModel },
      projectDefaults: project.defaults,
      globalSettings: settings
    });
    const temperature = project.defaults.temperature ?? settings.temperature ?? config.defaults.temperature;
    const maxOutputTokens =
      project.defaults.maxOutputTokens ?? settings.maxOutputTokens ?? config.defaults.maxOutputTokens;

    // Retrieval: documents the user named with @path are included whole and take
    // priority; the rest of the document budget is filled with the best-matching
    // chunks for this message.
    const mentions = retrievalService.parseMentions(content);
    let documents = null;
    try {
      documents = await retrievalService.buildDocumentContext(projectId, {
        query: content,
        mentions,
        tokenBudget: contextBuilder.documentBudget({ model, maxOutputTokens, project })
      });
    } catch (err) {
      // Retrieval is an enhancement; never let it block a turn.
      logger.warn('Document retrieval failed', { projectId, reason: err.message });
    }

    const request = contextBuilder.build({
      project,
      messages: chat.messages,
      model,
      temperature,
      maxOutputTokens,
      documentsBlock: documents?.text
    });

    openStream(res);
    const send = sseWriter(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    send('meta', {
      provider: adapter.id,
      providerLabel: adapter.label,
      model: model.id,
      modelLabel: model.label,
      truncatedHistory: request.truncatedHistory,
      droppedCount: request.droppedCount,
      modelFellBack: fellBack,
      sources: documents?.sources ?? [],
      documentTokens: documents?.tokens ?? 0
    });

    const controller = new AbortController();
    let clientGone = false;
    // A close before we have finished writing means the browser went away —
    // stop paying for tokens nobody will read.
    res.on('close', () => {
      if (res.writableEnded) return;
      clientGone = true;
      controller.abort();
    });

    const startedAt = Date.now();
    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason = 'end_turn';
    let streamError = null;

    try {
      for await (const event of adapter.streamCompletion({ ...request, signal: controller.signal })) {
        if (event.type === 'delta') {
          text += event.text;
          send('delta', { text: event.text });
        } else if (event.type === 'done') {
          usage = event.usage;
          finishReason = event.finishReason;
        } else if (event.type === 'error') {
          streamError = event.error;
        }
      }
    } catch (err) {
      logger.error('Provider stream threw', { provider: adapter.id, message: err.message });
      streamError = {
        code: 'PROVIDER_FAILED',
        message: err instanceof AppError ? err.message : 'The provider stream failed unexpectedly.',
        retryable: false
      };
    } finally {
      clearInterval(heartbeat);
    }

    if (clientGone) finishReason = 'aborted';

    const meta = {
      provider: adapter.id,
      model: model.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      finishReason,
      truncatedHistory: request.truncatedHistory,
      ...(documents?.sources.length ? { sources: documents.sources } : {}),
      ...(streamError ? { error: streamError } : {})
    };

    // Persist whatever we got — partial text on abort, the error text on failure —
    // so the stored transcript matches what the user actually saw.
    const persistedContent = streamError && !text ? streamError.message : text;
    let saved = null;
    if (persistedContent) {
      saved = await chatService
        .appendAssistantMessage(projectId, chatId, persistedContent, meta)
        .catch((err) => {
          logger.error('Could not persist assistant message', { projectId, chatId, message: err.message });
          return null;
        });
    }

    logger.info('Turn complete', {
      projectId,
      chatId,
      provider: adapter.id,
      model: model.id,
      latencyMs: meta.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      finishReason
    });

    if (clientGone) return res.end();

    if (streamError) send('error', streamError);
    send('done', { messageId: saved?.message.id ?? null, usage, finishReason, meta });
    res.end();
  })
);

module.exports = router;
