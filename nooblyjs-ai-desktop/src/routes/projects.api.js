'use strict';

const express = require('express');
const projectService = require('../services/projectService');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ projects: await projectService.list() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const project = await projectService.create(req.body || {});
  res.status(201).json({ project });
}));

router.get('/:projectId', asyncHandler(async (req, res) => {
  res.json({ project: await projectService.get(req.params.projectId) });
}));

router.patch('/:projectId', asyncHandler(async (req, res) => {
  res.json({ project: await projectService.update(req.params.projectId, req.body || {}) });
}));

router.delete('/:projectId', asyncHandler(async (req, res) => {
  await projectService.remove(req.params.projectId);
  res.status(204).end();
}));

module.exports = router;
