/**
 * @fileoverview Knowledge routes (NooblyJS Phase 8): sources and import, the three
 * answer actions, documents that need review, and the process model.
 *
 *   GET  /applications/wiki/api/knowledge/sources                 where content came from
 *   POST /applications/wiki/api/knowledge/import                  { name? } run an import (Owner)
 *   POST /applications/wiki/api/knowledge/answers/:id/link        { itemId }            add to a NooblyJS item
 *   POST /applications/wiki/api/knowledge/answers/:id/save        { spaceName, title? } save as a page
 *   POST /applications/wiki/api/knowledge/answers/:id/wrong       { reason? }           this is wrong
 *   GET  /applications/wiki/api/knowledge/needs-review            documents flagged for review
 *   POST /applications/wiki/api/knowledge/needs-review/resolve    { id }                reviewed (approve)
 *   GET  /applications/wiki/api/knowledge/process-model           ?spaceName=&path=
 *
 * IMPORT reads only from two places: the bundled sample (no `name`), or a
 * folder an operator put under <appBaseDir>/imports/<name>. A path is never
 * taken from the request: an import publishes what it reads to everyone who
 * can open the space.
 *
 * ACCESS is decided in knowledge/access.js (NooblyJS's permissions when hosted),
 * and every write is recorded in NooblyJS's audit log. The answers themselves are
 * made in aiChatRoutes (/ai/chat/search), which keeps each one and returns
 * its `answerId`.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const path = require('node:path');
const { createAccess } = require('../knowledge/access');

const ITEM_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const IMPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const API = '/applications/wiki/api/knowledge';

/**
 * @param {Object} options - { app }
 * @param {Object} eventEmitter
 * @param {Object} services - the wiki's services; `services.knowledge` is knowledge/index.js
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app || options['express-app'];
  const { knowledge, log: logger } = services;
  if (!knowledge) {
    logger?.warn?.('[Knowledge] not available: the space managers are missing, so its routes are not registered');
    return;
  }
  const access = createAccess(app.get('nooblyHost') || null);
  const appBaseDir = path.dirname(knowledge.store.dir);

  const fail = (res, error) => {
    logger?.error?.(`[Knowledge] ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  };

  app.get(`${API}/sources`, async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Not authenticated' });
      const [sources, canImport, status] = await Promise.all([knowledge.store.sources(), access.check(req, 'change-repo-access'), knowledge.service.status()]);
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        // `from` is a path on the server: only its last part is shown.
        sources: sources.map(({ from, ...s }) => ({ ...s, from: path.basename(from || '') })).sort((a, b) => String(b.lastRunAt).localeCompare(String(a.lastRunAt))),
        status,
        canImport: canImport.ok,
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(`${API}/import`, async (req, res) => {
    try {
      const allowed = await access.check(req, 'change-repo-access');
      if (!allowed.ok) return access.refuse(req, res, allowed, 'change-repo-access', `POST ${API}/import`);
      const name = req.body?.name;
      if (name !== undefined && name !== null && name !== '' && !IMPORT_NAME.test(String(name))) {
        return res.status(400).json({ success: false, error: 'name must be the name of a folder under imports/ (letters, digits, spaces, . _ -).' });
      }
      const by = access.actor(req).id;
      let source;
      try {
        source = name
          ? await knowledge.importer.importExport({ folder: path.join(appBaseDir, 'imports', String(name)), by })
          : await knowledge.importer.importSample({ by });
      } catch (error) {
        return res.status(422).json({ success: false, error: error.message });
      }
      await access.record(req, 'knowledge.imported', `source:${source.id}`, { documents: source.documents, redacted: source.redacted });
      const { from, ...shown } = source;
      res.json({ success: true, source: { ...shown, from: path.basename(from) } });
    } catch (error) {
      fail(res, error);
    }
  });

  /** The gate every answer action shares: signed in, a person, with `draft`. */
  async function answerGate(req, res, action) {
    const allowed = await access.check(req, 'draft');
    if (!allowed.ok) {
      await access.refuse(req, res, allowed, 'draft', `POST ${API}/answers/${req.params.id}/${action}`);
      return false;
    }
    return true;
  }
  const send = (res, result) => (result.status === 200
    ? res.json({ success: true, ...result, status: undefined })
    : res.status(result.status).json({ success: false, error: result.error }));

  app.post(`${API}/answers/:id/link`, async (req, res) => {
    try {
      if (!(await answerGate(req, res, 'link'))) return;
      const itemId = String(req.body?.itemId || '').trim().toUpperCase();
      if (!ITEM_ID.test(itemId)) return res.status(400).json({ success: false, error: 'itemId must look like PRD-031.' });
      let result;
      try {
        result = await knowledge.link(req.params.id, itemId, access.actor(req));
      } catch (error) {
        // The Product Factory's own refusals (no such spec, an approved spec) come back as they are.
        return res.status(Number(error.status) >= 400 && Number(error.status) < 500 ? error.status : 422).json({ success: false, error: error.message });
      }
      if (result.status === 200) await access.record(req, 'knowledge.answer_linked', `answer:${req.params.id}`, { itemId, links: result.links.length, added: result.added });
      send(res, result);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(`${API}/answers/:id/save`, async (req, res) => {
    try {
      if (!(await answerGate(req, res, 'save'))) return;
      const spaceName = String(req.body?.spaceName || '').trim();
      if (!spaceName) return res.status(400).json({ success: false, error: 'spaceName is required.' });
      // The wiki's own rule for a space: the person must be able to open it.
      if (!knowledge.canOpen(req.user, spaceName, 'Answers/x.md')) return res.status(403).json({ success: false, error: `You cannot write to ${spaceName}.` });
      const result = await knowledge.save(req.params.id, { spaceName, title: req.body?.title }, access.actor(req));
      if (result.status === 200) await access.record(req, 'knowledge.answer_saved', `answer:${req.params.id}`, { spaceName: result.spaceName, path: result.path });
      send(res, result);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(`${API}/answers/:id/wrong`, async (req, res) => {
    try {
      if (!(await answerGate(req, res, 'wrong'))) return;
      const result = await knowledge.wrong(req.params.id, req.body?.reason, access.actor(req));
      if (result.status === 200) await access.record(req, 'knowledge.answer_flagged', `answer:${req.params.id}`, { documents: result.flags.length });
      send(res, result);
    } catch (error) {
      fail(res, error);
    }
  });

  app.get(`${API}/needs-review`, async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Not authenticated' });
      const [flags, canResolve] = await Promise.all([knowledge.openFlags(), access.check(req, 'approve')]);
      res.set('Cache-Control', 'no-store');
      // Only what this person could open: a flag on a page in a space they cannot see is not theirs to read.
      res.json({ success: true, flags: flags.filter((f) => knowledge.canOpen(req.user, f.spaceName, f.path)), canResolve: canResolve.ok });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post(`${API}/needs-review/resolve`, async (req, res) => {
    try {
      const allowed = await access.check(req, 'approve');
      if (!allowed.ok) return access.refuse(req, res, allowed, 'approve', `POST ${API}/needs-review/resolve`);
      const id = String(req.body?.id || '');
      const actor = access.actor(req);
      const flag = await knowledge.store.resolveFlag(id, { by: actor.name, at: knowledge.now().toISOString() });
      if (!flag) return res.status(404).json({ success: false, error: 'There is no open flag with that id.' });
      await access.record(req, 'knowledge.flag_reviewed', `flag:${id}`, { spaceName: flag.spaceName, path: flag.path });
      res.json({ success: true, flag });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get(`${API}/process-model`, async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Not authenticated' });
      const spaceName = String(req.query.spaceName || '').trim();
      const pagePath = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
      if (!spaceName || !pagePath || pagePath.split('/').includes('..')) return res.status(400).json({ success: false, error: 'spaceName and path are required.' });
      if (!knowledge.canOpen(req.user, spaceName, pagePath)) return res.status(404).json({ success: false, error: 'Not found' });
      const model = await knowledge.model(spaceName, pagePath);
      if (!model) return res.status(404).json({ success: false, error: 'This page is not part of a process model.' });
      // Pages of the model the reader may not open are left out, not linked.
      const open = (p) => knowledge.canOpen(req.user, spaceName, p.path);
      res.json({
        success: true,
        model: {
          ...model,
          parents: model.parents.filter(open),
          children: model.children.filter(open),
          bands: model.bands && model.bands.map((b) => ({ ...b, processes: b.processes.filter(open) })),
          usedIn: await knowledge.resolveItems(model.page.linkedItems),
        },
      });
    } catch (error) {
      fail(res, error);
    }
  });
};
