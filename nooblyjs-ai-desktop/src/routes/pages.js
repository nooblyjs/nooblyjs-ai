'use strict';

const express = require('express');
const projectService = require('../services/projectService');
const chatService = require('../services/chatService');
const settingsService = require('../services/settingsService');
const registry = require('../providers/registry');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const [projects, providers] = await Promise.all([projectService.list(), registry.listAll()]);
  res.render('projects', {
    title: 'Projects',
    projects,
    anyProviderConfigured: providers.some((p) => p.configured),
    providers
  });
}));

router.get('/settings', asyncHandler(async (req, res) => {
  const [settings, providers] = await Promise.all([settingsService.get(), registry.listAll()]);
  res.render('settings', { title: 'Settings', settings, providers });
}));

router.get('/projects/:projectId', asyncHandler(async (req, res) => {
  const project = await projectService.get(req.params.projectId);
  const [chats, providers, settings] = await Promise.all([
    chatService.listSummaries(project.id),
    registry.listAll(),
    settingsService.get()
  ]);
  res.render('project', {
    title: project.name,
    project,
    chats,
    providers,
    settings,
    anyProviderConfigured: providers.some((p) => p.configured)
  });
}));

router.get('/projects/:projectId/documents', asyncHandler(async (req, res) => {
  const project = await projectService.get(req.params.projectId);
  res.render('documents', { title: `${project.name} · Documents`, project });
}));

// Chats open inline on the project page; keep old links working.
router.get('/projects/:projectId/chats/:chatId', (req, res) => {
  const { projectId, chatId } = req.params;
  res.redirect(`/projects/${encodeURIComponent(projectId)}?chat=${encodeURIComponent(chatId)}`);
});

module.exports = router;
