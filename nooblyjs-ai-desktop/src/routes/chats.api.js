'use strict';

const express = require('express');
const chatService = require('../services/chatService');
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
  res.json({ chat: await chatService.get(req.params.projectId, req.params.chatId) });
}));

router.patch('/:chatId', asyncHandler(async (req, res) => {
  res.json({ chat: await chatService.update(req.params.projectId, req.params.chatId, req.body || {}) });
}));

router.delete('/:chatId', asyncHandler(async (req, res) => {
  await chatService.remove(req.params.projectId, req.params.chatId);
  res.status(204).end();
}));

module.exports = router;
