/**
 * @fileoverview The Knowledge records (NooblyJS Phase 8): where content came from,
 * the answers given, and the documents flagged for review.
 *
 *   <appBaseDir>/knowledge/sources.json   [{ id, name, kind, from, state, lastRunAt, by, spaces, documents, redacted }]
 *   <appBaseDir>/knowledge/answers.json   the newest MAX_ANSWERS answers from search: question, text, sources, reports
 *   <appBaseDir>/knowledge/flags.json     [{ id, spaceName, path, title, reason, answerId, by, at, status, reviewedBy, reviewedAt }]
 *
 * JSON, like the rest of the wiki's records. Each write is a temp file renamed
 * over the old one, and writes to one file queue behind each other, so a crash
 * or two requests at once never leave half a file.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_ANSWERS = 500;

/**
 * @param {string} appBaseDir - where the wiki keeps its files
 * @return {Object} the store
 */
function createKnowledgeStore(appBaseDir) {
  const dir = path.join(appBaseDir, 'knowledge');
  const queues = new Map(); // file name → the last write's promise

  async function read(name) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /** Read, change and write one file, one caller at a time. `change(list)` returns the new list. */
  function update(name, change) {
    const run = async () => {
      const next = await change(await read(name));
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${name}.json`);
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await fs.rename(tmp, file);
      return next;
    };
    const queued = (queues.get(name) || Promise.resolve()).then(run, run);
    queues.set(name, queued.catch(() => {}));
    return queued;
  }

  const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

  return {
    dir,
    newId,

    sources: () => read('sources'),
    source: async (id) => (await read('sources')).find((s) => s.id === id) || null,
    /** Add or replace a source by id. */
    saveSource: async (source) => {
      await update('sources', (list) => [...list.filter((s) => s.id !== source.id), source]);
      return source;
    },

    answer: async (id) => (await read('answers')).find((a) => a.id === id) || null,
    /** Keep an answer; the oldest fall off after MAX_ANSWERS. */
    addAnswer: async (answer) => {
      const kept = { id: newId('ans'), reports: [], ...answer };
      await update('answers', (list) => [...list, kept].slice(-MAX_ANSWERS));
      return kept;
    },
    /** Change one answer in place. Returns it, or null when it is gone. */
    updateAnswer: async (id, change) => {
      let found = null;
      await update('answers', (list) => list.map((a) => {
        if (a.id !== id) return a;
        found = { ...a, ...change(a) };
        return found;
      }));
      return found;
    },

    flags: () => read('flags'),
    /**
     * Flag a document for review. One open flag per document: a second report
     * adds to its count and keeps the newest reason.
     */
    flag: async ({ spaceName, path: docPath, title, reason, answerId, by, at }) => {
      let result = null;
      await update('flags', (list) => {
        const open = list.find((f) => f.status === 'open' && f.spaceName === spaceName && f.path === docPath);
        if (open) {
          result = { ...open, reason, answerId, by, at, reports: (open.reports || 1) + 1 };
          return list.map((f) => (f === open ? result : f));
        }
        result = { id: newId('flag'), spaceName, path: docPath, title, reason, answerId, by, at, reports: 1, status: 'open', reviewedBy: null, reviewedAt: null };
        return [...list, result];
      });
      return result;
    },
    resolveFlag: async (id, { by, at }) => {
      let found = null;
      await update('flags', (list) => list.map((f) => {
        if (f.id !== id || f.status !== 'open') return f;
        found = { ...f, status: 'reviewed', reviewedBy: by, reviewedAt: at };
        return found;
      }));
      return found;
    },
  };
}

module.exports = { createKnowledgeStore, MAX_ANSWERS };
