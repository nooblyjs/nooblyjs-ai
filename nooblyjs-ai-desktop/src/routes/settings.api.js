'use strict';

const express = require('express');
const registry = require('../providers/registry');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Reports configured/not-configured only. Key values never cross this boundary.
router.get('/providers', (req, res) => {
  res.json({ providers: registry.listAll() });
});

router.get('/settings', asyncHandler(async (req, res) => {
  res.json({ settings: await settingsService.get() });
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  res.json({ settings: await settingsService.update(req.body || {}) });
}));

module.exports = router;
