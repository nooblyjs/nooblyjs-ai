'use strict';

const express = require('express');
const chatService = require('../services/chatService');
const projectService = require('../services/projectService');
const settingsService = require('../services/settingsService');
const registry = require('../providers/registry');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router({ mergeParams: true });

router.get('/', asyncHandler(async (req, res) => {
  res.json({ chats: await chatService.listSummaries(req.params.projectId) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const chat = await chatService.create(req.params.projectId, req.body || {});
  res.status(201).json({ chat });
}));

router.get('/:chatId', asyncHandler(async (req, res) => {
  const [project, chat, settings] = await Promise.all([
    projectService.get(req.params.projectId),
    chatService.get(req.params.projectId, req.params.chatId),
    settingsService.get()
  ]);

  // The model the next turn would use, so the picker can show it. With no key
  // configured resolution fails; the transcript must still load.
  let effective = null;
  try {
    const resolved = registry.resolve({
      requested: { provider: chat.provider, model: chat.model },
      projectDefaults: project.defaults,
      globalSettings: settings
    });
    effective = { provider: resolved.adapter.id, model: resolved.model.id };
  } catch {
    effective = null;
  }

  res.json({ chat, effective });
}));

router.patch('/:chatId', asyncHandler(async (req, res) => {
  res.json({ chat: await chatService.update(req.params.projectId, req.params.chatId, req.body || {}) });
}));

router.delete('/:chatId', asyncHandler(async (req, res) => {
  await chatService.remove(req.params.projectId, req.params.chatId);
  res.status(204).end();
}));

module.exports = router;
