'use strict';

const paths = require('../storage/paths');
const repo = require('../storage/fsRepository');
const indexCache = require('../storage/index');
const projectService = require('./projectService');
const { deriveTitle } = require('./titleService');
const { slugify, randomSuffix, messageId } = require('../lib/ids');
const { ValidationError, NotFoundError } = require('../lib/errors');
const config = require('../config');
const logger = require('../lib/logger');

function timestampPart(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+z$/i, '').replace('T', 't').toLowerCase();
}

function makeChatId(title) {
  return `${timestampPart()}-${slugify(title, 'chat')}-${randomSuffix()}`.slice(0, 64);
}

function normalise(raw, id, projectId) {
  return {
    id: raw.id || id,
    projectId: raw.projectId || projectId,
    title: raw.title || 'Untitled chat',
    titleGenerated: raw.titleGenerated !== false,
    provider: raw.provider ?? null,
    model: raw.model ?? null,
    createdAt: raw.createdAt || new Date(0).toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date(0).toISOString(),
    schemaVersion: raw.schemaVersion || 1,
    messages: Array.isArray(raw.messages) ? raw.messages : []
  };
}

// Filenames are `<id>.json`, so lookup is direct. A hand-renamed file still
// resolves via a directory scan on the `id` field.
async function locate(projectId, chatId) {
  paths.assertId(chatId, 'chat');
  const direct = paths.chatFile(projectId, `${chatId}.json`);
  if (await repo.exists(direct)) return direct;

  const files = await repo.listFiles(paths.chatsDir(projectId));
  for (const name of files) {
    const file = paths.chatFile(projectId, name);
    try {
      const raw = await repo.readJson(file);
      if (raw.id === chatId) return file;
    } catch {
      // ignore unreadable neighbours
    }
  }
  throw new NotFoundError(`Chat ${chatId} not found`);
}

async function create(projectId, { title, provider = null, model = null } = {}) {
  await projectService.get(projectId);
  const now = new Date().toISOString();
  const chatTitle = title?.trim() || 'New chat';
  const chat = {
    id: makeChatId(chatTitle),
    projectId,
    title: chatTitle,
    titleGenerated: !title,
    provider,
    model,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    messages: []
  };
  await repo.writeJsonAtomic(paths.chatFile(projectId, `${chat.id}.json`), chat);
  indexCache.invalidate();
  return chat;
}

async function get(projectId, chatId) {
  const file = await locate(projectId, chatId);
  return normalise(await repo.readJson(file), chatId, projectId);
}

async function save(chat) {
  const file = await locate(chat.projectId, chat.id);
  chat.updatedAt = new Date().toISOString();
  await repo.writeJsonAtomic(file, chat);
  indexCache.invalidate();
  return chat;
}

async function listSummaries(projectId) {
  await projectService.get(projectId);
  const files = await repo.listFiles(paths.chatsDir(projectId));
  const summaries = [];
  for (const name of files) {
    try {
      const raw = await repo.readJson(paths.chatFile(projectId, name));
      const chat = normalise(raw, name.replace(/\.json$/, ''), projectId);
      const lastMessage = chat.messages[chat.messages.length - 1];
      summaries.push({
        id: chat.id,
        title: chat.title,
        provider: chat.provider,
        model: chat.model,
        messageCount: chat.messages.length,
        preview: lastMessage ? lastMessage.content.replace(/\s+/g, ' ').slice(0, 120) : '',
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      });
    } catch (err) {
      logger.warn('Skipping unreadable chat', { projectId, file: name, reason: err.message });
    }
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

async function update(projectId, chatId, patch) {
  const chat = await get(projectId, chatId);
  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim();
    if (!title) throw new ValidationError('Chat title cannot be empty', { title: 'required' });
    if (title.length > config.limits.nameMaxLength) {
      throw new ValidationError('Chat title is too long', { title: 'too long' });
    }
    chat.title = title;
    chat.titleGenerated = false;
  }
  if (patch.provider !== undefined) chat.provider = patch.provider || null;
  if (patch.model !== undefined) chat.model = patch.model || null;
  return save(chat);
}

async function remove(projectId, chatId) {
  const file = await locate(projectId, chatId);
  await repo.remove(file);
  indexCache.invalidate();
  logger.info('Chat deleted', { projectId, chatId });
}

async function appendUserMessage(projectId, chatId, content) {
  const text = String(content ?? '').trim();
  if (!text) throw new ValidationError('Message cannot be empty', { content: 'required' });
  if (text.length > config.limits.messageMaxLength) {
    throw new ValidationError('Message is too long', { content: 'too long' });
  }

  const chat = await get(projectId, chatId);
  const message = { id: messageId(), role: 'user', content: text, createdAt: new Date().toISOString() };
  chat.messages.push(message);

  // First user turn names the chat, unless the user already renamed it.
  if (chat.titleGenerated && chat.messages.filter((m) => m.role === 'user').length === 1) {
    chat.title = deriveTitle(text);
  }

  await save(chat);
  return { chat, message };
}

async function appendAssistantMessage(projectId, chatId, content, meta) {
  const chat = await get(projectId, chatId);
  const message = {
    id: messageId(),
    role: 'assistant',
    content: content ?? '',
    createdAt: new Date().toISOString(),
    meta
  };
  chat.messages.push(message);
  if (meta?.provider) chat.provider = meta.provider;
  if (meta?.model) chat.model = meta.model;
  await save(chat);
  await projectService.touch(projectId);
  return { chat, message };
}

module.exports = {
  create,
  get,
  listSummaries,
  update,
  remove,
  appendUserMessage,
  appendAssistantMessage,
  save,
  _makeChatId: makeChatId
};
