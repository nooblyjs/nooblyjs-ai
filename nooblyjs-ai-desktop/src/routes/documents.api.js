'use strict';

const express = require('express');
const documentService = require('../services/documentService');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../lib/errors');

const router = express.Router({ mergeParams: true });

// Document paths are nested and may contain spaces, so they travel as a `path`
// query parameter or body field rather than as URL path segments.
function pathOf(req) {
  const value = req.query.path ?? req.body?.path ?? '';
  if (typeof value !== 'string') throw new ValidationError('path must be a string');
  return value;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ tree: await documentService.tree(req.params.projectId) });
}));

router.get('/list', asyncHandler(async (req, res) => {
  res.json({ documents: await documentService.listDocuments(req.params.projectId) });
}));

router.get('/content', asyncHandler(async (req, res) => {
  res.json({ document: await documentService.readDocument(req.params.projectId, pathOf(req)) });
}));

router.post('/documents', asyncHandler(async (req, res) => {
  const { parent = '', name, content = '' } = req.body || {};
  const document = await documentService.createDocument(req.params.projectId, parent, name, content);
  res.status(201).json({ document });
}));

router.post('/folders', asyncHandler(async (req, res) => {
  const { parent = '', name } = req.body || {};
  const folder = await documentService.createFolder(req.params.projectId, parent, name);
  res.status(201).json({ folder });
}));

router.put('/content', asyncHandler(async (req, res) => {
  const { path, content } = req.body || {};
  const document = await documentService.writeDocument(req.params.projectId, path, content);
  res.json({ document });
}));

router.post('/move', asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  res.json({ moved: await documentService.move(req.params.projectId, from, to) });
}));

router.delete('/', asyncHandler(async (req, res) => {
  await documentService.remove(req.params.projectId, pathOf(req));
  res.status(204).end();
}));

module.exports = router;
