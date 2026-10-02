'use strict';

const path = require('node:path');
const config = require('../config');
const paths = require('../storage/paths');
const repo = require('../storage/fsRepository');
const indexCache = require('../storage/index');
const { makeId } = require('../lib/ids');
const { ValidationError, NotFoundError } = require('../lib/errors');
const logger = require('../lib/logger');

const EXCERPT_LENGTH = 180;

function validateName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Project name is required', { name: 'required' });
  }
  const trimmed = name.trim();
  if (trimmed.length > config.limits.nameMaxLength) {
    throw new ValidationError(`Project name must be ${config.limits.nameMaxLength} characters or fewer`, {
      name: 'too long'
    });
  }
  return trimmed;
}

function validateDescription(description) {
  if (description === undefined || description === null) return '';
  if (typeof description !== 'string') {
    throw new ValidationError('Description must be text', { description: 'invalid type' });
  }
  if (description.length > config.limits.descriptionMaxLength) {
    throw new ValidationError(
      `Description must be ${config.limits.descriptionMaxLength} characters or fewer`,
      { description: 'too long' }
    );
  }
  return description;
}

function validateDefaults(input, existing = {}) {
  const next = { ...existing };
  if (input === undefined) return next;
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('defaults must be an object', { defaults: 'invalid type' });
  }
  if ('provider' in input) next.provider = input.provider || null;
  if ('model' in input) next.model = input.model || null;
  if ('temperature' in input) {
    const t = Number(input.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      throw new ValidationError('temperature must be between 0 and 2', { temperature: 'out of range' });
    }
    next.temperature = t;
  }
  if ('maxOutputTokens' in input) {
    const m = Number(input.maxOutputTokens);
    if (!Number.isInteger(m) || m < 1 || m > 200000) {
      throw new ValidationError('maxOutputTokens must be between 1 and 200000', {
        maxOutputTokens: 'out of range'
      });
    }
    next.maxOutputTokens = m;
  }
  return next;
}

// Tolerant read: a project written by an older version, or by hand, still loads.
function normalise(raw, id) {
  return {
    id: raw.id || id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    defaults: {
      provider: raw.defaults?.provider ?? null,
      model: raw.defaults?.model ?? null,
      temperature: raw.defaults?.temperature ?? null,
      maxOutputTokens: raw.defaults?.maxOutputTokens ?? null
    },
    createdAt: raw.createdAt || new Date(0).toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date(0).toISOString(),
    schemaVersion: raw.schemaVersion || 1
  };
}

function excerpt(description) {
  const flat = description.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…` : flat;
}

async function create({ name, description, defaults }) {
  const cleanName = validateName(name);
  const cleanDescription = validateDescription(description);
  const now = new Date().toISOString();
  const project = {
    id: makeId(cleanName, 'project'),
    name: cleanName,
    description: cleanDescription,
    defaults: validateDefaults(defaults, { provider: null, model: null, temperature: null, maxOutputTokens: null }),
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1
  };
  await repo.ensureDir(paths.chatsDir(project.id));
  await repo.ensureDir(paths.documentsDir(project.id));
  await repo.writeJsonAtomic(paths.projectFile(project.id), project);
  indexCache.invalidate();
  logger.info('Project created', { projectId: project.id });
  return project;
}

async function get(projectId) {
  const raw = await repo.readJson(paths.projectFile(projectId)).catch((err) => {
    if (err instanceof NotFoundError) throw new NotFoundError(`Project ${projectId} not found`);
    throw err;
  });
  return normalise(raw, projectId);
}

async function countChats(projectId) {
  const files = await repo.listFiles(paths.chatsDir(projectId));
  return files.length;
}

async function list() {
  const cached = indexCache.get();
  if (cached) return cached;

  const ids = await repo.listDirs(config.projectsDir);
  const summaries = [];
  for (const id of ids) {
    try {
      const project = await get(id);
      summaries.push({
        id: project.id,
        name: project.name,
        excerpt: excerpt(project.description),
        hasDescription: project.description.trim().length > 0,
        chatCount: await countChats(id),
        updatedAt: project.updatedAt
      });
    } catch (err) {
      // A malformed project must not take down the whole listing.
      logger.warn('Skipping unreadable project', { projectId: id, reason: err.message });
    }
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return indexCache.set(summaries);
}

async function update(projectId, patch) {
  const current = await get(projectId);
  const next = { ...current };
  if (patch.name !== undefined) next.name = validateName(patch.name);
  if (patch.description !== undefined) next.description = validateDescription(patch.description);
  if (patch.defaults !== undefined) next.defaults = validateDefaults(patch.defaults, current.defaults);
  next.updatedAt = new Date().toISOString();
  await repo.writeJsonAtomic(paths.projectFile(projectId), next);
  indexCache.invalidate();
  return next;
}

async function touch(projectId) {
  try {
    const current = await get(projectId);
    current.updatedAt = new Date().toISOString();
    await repo.writeJsonAtomic(paths.projectFile(projectId), current);
    indexCache.invalidate();
  } catch (err) {
    logger.warn('Could not touch project', { projectId, reason: err.message });
  }
}

async function remove(projectId) {
  const dir = paths.projectDir(projectId);
  // paths.projectDir already asserts containment; assert again before a recursive delete.
  paths.assertContained(dir, config.projectsDir);
  if (path.resolve(dir) === path.resolve(config.projectsDir)) {
    throw new ValidationError('Refusing to delete the projects root');
  }
  await get(projectId);
  await repo.remove(dir);
  indexCache.invalidate();
  logger.info('Project deleted', { projectId });
}

module.exports = { create, get, list, update, remove, touch, excerpt, _normalise: normalise };
