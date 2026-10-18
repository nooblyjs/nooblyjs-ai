/**
 * @fileoverview Continuous Exploration API routes (wiki module)
 *
 * AI-assisted architecture & design generation, ported from the retired
 * standalone app into the wiki. Storage:
 *
 *   <spaceContentDir>/.system/continuous-explorations/.templates/<id>.json — templates
 *   <spaceContentDir>/<folder>/.system/continuous-explorations/.templates/<id>.json
 *     — folder-scoped templates, resolved as a cascade (see templateManager.js)
 *   <spaceContentDir>/<parent>/<Name>/ — projects: visible folders holding
 *     .continuous-exploration.json, .chat.json and generated *.md documents
 *
 * Mounted at /applications/wiki/api/continuous-explorations:
 *
 *   Templates (the org playbook — prompt + document-list bundles):
 *     GET     /templates?spaceId=          list (per space, or all spaces; a
 *                                          space is seeded with the defaults on
 *                                          first listing)
 *                       &folderPath=       resolve the folder CASCADE for that
 *                                          folder instead of the space tier alone
 *     POST    /templates                   create { spaceId, name, scope?, folderPath?, ... }
 *     GET     /templates/:id               ?folderPath= to reach a folder template
 *     PUT     /templates/:id               patch { name?, description?, systemPrompt?,
 *                                          documents?, folderPath? }
 *     DELETE  /templates/:id               ?folderPath= to reach a folder template
 *
 *   Projects:
 *     GET     /projects?spaceId=           list (owned by current user)
 *     POST    /projects                    create { name, spaceId, templateId?, wikiContext?, ... }
 *     GET     /projects/:id
 *     PUT     /projects/:id                patch { name?, description?, templateId?, requirement?, wikiContext? }
 *     DELETE  /projects/:id
 *     GET     /projects/:id/documents
 *     GET     /projects/:id/documents/:name
 *     DELETE  /projects/:id/documents/:name
 *     POST    /projects/:id/generate       { requirement, templateId? } → AI drafts every doc
 *     GET     /projects/:id/chat
 *     POST    /projects/:id/chat           { message } → AI reply, appended to history
 *     POST    /projects/:id/export-to-wiki
 *     GET     /health
 */

'use strict';

const path = require('node:path');

const ProjectManager = require('../continuousExploration/projectManager');
const TemplateManager = require('../continuousExploration/templateManager');
const AIOrchestrator = require('../continuousExploration/aiOrchestrator');
const WikiExporter = require('../continuousExploration/wikiExporter');
const WikiContextLoader = require('../continuousExploration/wikiContextLoader');
const DEFAULT_TEMPLATES = require('../continuousExploration/defaultTemplates');
const { isSpaceAdmin, isSpaceMember, userDir: toUserDir } = require('../components/spacePermissions');
const { isPathVisible } = require('../../shared/spaces/spacePaths');

const BASE = '/applications/wiki/api/continuous-explorations';

function requireAuth(req, res) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return false;
  }
  return true;
}

function userId(req) {
  return (req.user && (req.user.id || req.user.email || req.user.username)) || null;
}

/** The current user's per-space folder name (email local-part), for personal templates. */
function userDirOf(req) {
  return toUserDir((req.user && req.user.email) || userId(req));
}

module.exports = (options, eventEmitter, services) => {
  const { app } = options;
  const log = services.log || console;
  const { appBaseDir } = services;
  const dataDirectory = appBaseDir || path.join(process.cwd(), '.application');

  const projectManager = new ProjectManager(dataDirectory, log);
  const templateManager = new TemplateManager(dataDirectory, log);
  // The CORE AI service (Ollama) — always configured from .env, unlike the
  // wiki's per-user `aiService` settings wrapper which throws until a user
  // saves AI settings.
  const aiOrchestrator = new AIOrchestrator(services.aiservice, log);
  const wikiExporter = new WikiExporter({ app, appBaseDir: dataDirectory, log });
  const wikiContextLoader = new WikiContextLoader({ app, log });

  app.set('continuousExplorationProjectManager', projectManager);
  app.set('continuousExplorationTemplateManager', templateManager);

  // ─── Templates ───────────────────────────────────────────────────────────

  // Stamp each template with `canEdit` for the current user: space-level →
  // space admin; folder → anyone who may write the folder (a folder template is
  // folder content); personal → always (the owner is the only one who sees them).
  async function stampCanEdit(req, templates) {
    const spaceCache = new Map();
    const resolve = async (id) => {
      const key = String(id);
      if (!spaceCache.has(key)) spaceCache.set(key, await templateManager.resolveSpace(id));
      return spaceCache.get(key);
    };
    const out = [];
    for (const t of templates) {
      let canEdit;
      if (t.scope === 'personal') {
        canEdit = true;
      } else if (t.scope === 'folder') {
        const space = await resolve(t.spaceId);
        canEdit = !!space && space.permissions !== 'read-only' && isSpaceMember(req.user, space);
      } else {
        const space = await resolve(t.spaceId);
        canEdit = isSpaceAdmin(req.user, space);
      }
      out.push({ ...t, canEdit });
    }
    return out;
  }

  app.get(`${BASE}/templates`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { spaceId } = req.query;
      // A folderPath switches listing to the folder CASCADE for that folder —
      // its own templates, then each ancestor's, ending at the space tier.
      const folderPath = typeof req.query.folderPath === 'string' ? req.query.folderPath : null;
      if (spaceId !== undefined && spaceId !== '') {
        // First touch of a space's continuous exploration templates seeds the org defaults.
        await templateManager.seedIfMissing(spaceId, DEFAULT_TEMPLATES);
      }
      const templates = await templateManager.list(spaceId, { userDir: userDirOf(req), folderPath });
      res.json({ success: true, templates: await stampCanEdit(req, templates) });
    } catch (err) {
      log.error('[continuous-exploration] list templates failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post(`${BASE}/templates`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { spaceId, name, description, systemPrompt, documents, folderPath } = req.body || {};
      const requested = req.body && req.body.scope;
      const scope = ['personal', 'folder'].includes(requested) ? requested : 'space';

      const space = await templateManager.resolveSpace(spaceId);
      if (!space) {
        return res.status(400).json({ success: false, error: 'A valid spaceId is required — templates live in a space' });
      }
      // Space-level templates reach the whole space, so they require a space
      // admin. Folder and personal templates only require membership — a folder
      // template is folder content, and a personal one goes in the user's own
      // folder. See spacePermissions.js for the same three-tier rule.
      if (scope === 'space' && !isSpaceAdmin(req.user, space)) {
        return res.status(403).json({ success: false, error: 'Only a space administrator can create space-level templates.' });
      }
      if (scope !== 'space' && !isSpaceMember(req.user, space)) {
        return res.status(403).json({ success: false, error: 'You must be a member of this space to create a template here.' });
      }
      if (scope !== 'space' && space.permissions === 'read-only') {
        return res.status(403).json({ success: false, error: 'This space is read-only.' });
      }
      if (scope === 'folder' && !String(folderPath || '').trim()) {
        return res.status(400).json({ success: false, error: 'A folderPath is required for a folder template.' });
      }
      // Being inside the content root is not enough when several spaces share
      // one — the space must actually expose this folder. 404, not 403, so the
      // refusal does not confirm the folder exists.
      if (scope === 'folder' && !isPathVisible(space, folderPath, 'container')) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }

      const template = await templateManager.create({
        spaceId, scope, userDir: userDirOf(req), folderPath, name, description, systemPrompt, documents
      });
      res.status(201).json({ success: true, template });
    } catch (err) {
      log.error('[continuous-exploration] create template failed:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // A folder template's directory is not derivable from its id, so every id-only
  // route accepts the `folderPath` the client listed it from (query on GET/DELETE,
  // body on PUT). Omitted, the lookup still finds space and personal templates —
  // it just cannot see folder ones. See templateManager._locate.
  const folderHintOf = (req) => {
    const fromQuery = typeof req.query.folderPath === 'string' ? req.query.folderPath : null;
    const fromBody = req.body && typeof req.body.folderPath === 'string' ? req.body.folderPath : null;
    return fromBody !== null ? fromBody : fromQuery;
  };

  // Which space the caller is working in. Forwarded to _locate so a template on a
  // SHARED content root resolves under the space the request is about, not
  // whichever space sits first in spaces.json — the located space is what the
  // RBAC check below is evaluated against.
  const spaceHintOf = (req) => {
    const fromQuery = req.query.spaceId;
    const fromBody = req.body && req.body.spaceId;
    const value = fromBody !== undefined && fromBody !== null ? fromBody : fromQuery;
    return value === undefined || value === null || value === '' ? null : value;
  };

  app.get(`${BASE}/templates/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const template = await templateManager.get(req.params.id, {
        userDir: userDirOf(req), folderPath: folderHintOf(req), spaceId: spaceHintOf(req)
      });
      if (!template) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, template });
    } catch (err) {
      log.error('[continuous-exploration] get template failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put(`${BASE}/templates/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userDir = userDirOf(req);
      const folderPath = folderHintOf(req);
      const spaceId = spaceHintOf(req);
      const found = await templateManager._locate(req.params.id, { userDir, folderPath, spaceId });
      if (!found) return res.status(404).json({ success: false, error: 'Not found' });
      const denial = templateRbacDenial(req, found, userDir);
      if (denial) return res.status(403).json({ success: false, error: denial });

      const updated = await templateManager.update(req.params.id, req.body || {}, { userDir, folderPath, spaceId });
      if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, template: updated });
    } catch (err) {
      log.error('[continuous-exploration] update template failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete(`${BASE}/templates/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userDir = userDirOf(req);
      const folderPath = folderHintOf(req);
      const spaceId = spaceHintOf(req);
      const found = await templateManager._locate(req.params.id, { userDir, folderPath, spaceId });
      if (!found) return res.status(404).json({ success: false, error: 'Not found' });
      const denial = templateRbacDenial(req, found, userDir);
      if (denial) return res.status(403).json({ success: false, error: denial });

      const ok = await templateManager.remove(req.params.id, { userDir, folderPath, spaceId });
      if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true });
    } catch (err) {
      log.error('[continuous-exploration] delete template failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Returns a denial message string if the user may not edit/delete the located
  // template, or null when allowed. Space-level → space admin; folder → anyone who
  // may write the folder; personal → owner.
  function templateRbacDenial(req, found, userDir) {
    if (found.scope === 'personal') {
      return found.template.owner === userDir ? null : 'You can only modify your own personal templates.';
    }
    if (found.scope === 'folder') {
      if (found.space && found.space.permissions === 'read-only') return 'This space is read-only.';
      return isSpaceMember(req.user, found.space) ? null : 'You must be a member of this space to modify its folder templates.';
    }
    return isSpaceAdmin(req.user, found.space) ? null : 'Only a space administrator can modify space-level templates.';
  }

  // ─── Project CRUD ──────────────────────────────────────────────────────

  app.get(`${BASE}/projects`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      // Optional ?spaceId= scopes the list to a single space's continuous explorations.
      const projects = await projectManager.list(userId(req), req.query.spaceId);
      res.json({ success: true, projects });
    } catch (err) {
      log.error('[continuous-exploration] list projects failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post(`${BASE}/projects`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { name, description, templateId, wikiContext, requirement, spaceId, spaceName, parentPath } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      if (spaceId === undefined || spaceId === null || spaceId === '') {
        return res.status(400).json({ success: false, error: 'spaceId is required — a continuous exploration must live in a space' });
      }
      const project = await projectManager.create({
        name, description, templateId, wikiContext, requirement, spaceId, spaceName, parentPath, ownerId: userId(req)
      });
      res.status(201).json({ success: true, project });
    } catch (err) {
      log.error('[continuous-exploration] create project failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Resolve a continuous exploration by its visible folder path — used when a folder with
  // the 'continuous-exploration' type is clicked in the navigation. 404 lets the frontend
  // fall back to the normal folder view.
  app.get(`${BASE}/projects/by-path`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { spaceId, path: folderPath } = req.query;
      if (!spaceId || !folderPath) {
        return res.status(400).json({ success: false, error: 'spaceId and path are required' });
      }
      const project = await projectManager.getByPath(spaceId, folderPath, userId(req));
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, project });
    } catch (err) {
      log.error('[continuous-exploration] get project by path failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get(`${BASE}/projects/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const project = await projectManager.get(req.params.id, userId(req));
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, project });
    } catch (err) {
      log.error('[continuous-exploration] get project failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put(`${BASE}/projects/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const updated = await projectManager.update(req.params.id, req.body || {}, userId(req));
      if (!updated) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, project: updated });
    } catch (err) {
      log.error('[continuous-exploration] update project failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete(`${BASE}/projects/:id`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const ok = await projectManager.remove(req.params.id, userId(req));
      if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true });
    } catch (err) {
      log.error('[continuous-exploration] delete project failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Documents ─────────────────────────────────────────────────────────

  app.get(`${BASE}/projects/:id/documents`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const project = await projectManager.get(req.params.id, userId(req));
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, documents: project.documents || [] });
    } catch (err) {
      log.error('[continuous-exploration] list documents failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get(`${BASE}/projects/:id/documents/:name`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const doc = await projectManager.readDocument(req.params.id, req.params.name, userId(req));
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, document: doc });
    } catch (err) {
      log.error('[continuous-exploration] read document failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete(`${BASE}/projects/:id/documents/:name`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const ok = await projectManager.deleteDocument(req.params.id, req.params.name, userId(req));
      if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true });
    } catch (err) {
      log.error('[continuous-exploration] delete document failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Generation ────────────────────────────────────────────────────────

  app.post(`${BASE}/projects/:id/generate`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const uid = userId(req);
      const project = await projectManager.get(req.params.id, uid);
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });

      const { requirement, templateId } = req.body || {};
      const reqText = (requirement || project.requirement || '').trim();
      if (!reqText) {
        return res.status(400).json({ success: false, error: 'requirement is required' });
      }

      // Resolve template (body overrides project setting).
      const effectiveTemplateId = templateId || project.templateId || null;
      const template = effectiveTemplateId
        ? await templateManager.get(effectiveTemplateId, { userDir: userDirOf(req) })
        : null;

      // Persist requirement + template selection before kicking off AI.
      await projectManager.update(
        req.params.id,
        { requirement: reqText, templateId: effectiveTemplateId },
        uid
      );

      if (!aiOrchestrator.available()) {
        return res.status(503).json({
          success: false,
          error: 'AI service not configured. Set AI_MODEL/OLLAMA_URL in .env and ensure Ollama is reachable.'
        });
      }

      const ctx = await wikiContextLoader.load(project.wikiContext);

      const drafts = await aiOrchestrator.generate({
        project: { ...project, requirement: reqText },
        template,
        requirement: reqText,
        contextDigest: ctx.digest
      });

      const written = [];
      for (const d of drafts) {
        const entry = await projectManager.writeDocument(
          req.params.id,
          { name: d.name, content: d.content, model: d.model },
          uid
        );
        written.push({ ...entry, error: d.error });
      }

      const fresh = await projectManager.get(req.params.id, uid);
      res.json({ success: true, project: fresh, documents: written });
    } catch (err) {
      log.error('[continuous-exploration] generate failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Chat ──────────────────────────────────────────────────────────────

  app.get(`${BASE}/projects/:id/chat`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const history = await projectManager.readChat(req.params.id, userId(req));
      if (history === null) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, messages: history });
    } catch (err) {
      log.error('[continuous-exploration] read chat failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post(`${BASE}/projects/:id/chat`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const uid = userId(req);
      const project = await projectManager.get(req.params.id, uid);
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });

      const { message } = req.body || {};
      const text = (message || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'message is required' });

      if (!aiOrchestrator.available()) {
        return res.status(503).json({ success: false, error: 'AI service not configured.' });
      }

      const history = (await projectManager.readChat(req.params.id, uid)) || [];
      const template = project.templateId ? await templateManager.get(project.templateId, { userDir: userDirOf(req) }) : null;
      const ctx = await wikiContextLoader.load(project.wikiContext);

      const reply = await aiOrchestrator.chat({
        project,
        template,
        history,
        userMessage: text,
        knownDocs: project.documents || [],
        contextDigest: ctx.digest
      });

      const updated = await projectManager.appendChat(req.params.id, [
        { role: 'user', content: text },
        { role: 'assistant', content: reply.content }
      ], uid);

      res.json({ success: true, reply: reply.content, model: reply.model, messages: updated });
    } catch (err) {
      log.error('[continuous-exploration] chat failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Export ─────────────────────────────────────────────────────────────

  app.post(`${BASE}/projects/:id/export-to-wiki`, async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const uid = userId(req);
      const project = await projectManager.get(req.params.id, uid);
      if (!project) return res.status(404).json({ success: false, error: 'Not found' });
      if (!project.documents || !project.documents.length) {
        return res.status(400).json({ success: false, error: 'No documents to export. Run generate first.' });
      }
      if (!wikiExporter.available()) {
        return res.status(503).json({ success: false, error: 'Wiki module not initialized — cannot export.' });
      }

      // Default the export target to the continuous exploration's own space; the request
      // body can still override it.
      const { spaceId } = req.body || {};
      const targetSpaceId = spaceId || project.spaceId;
      const sourceDocsDir = await projectManager.documentsDir(project.id, uid);
      if (!sourceDocsDir) {
        return res.status(404).json({ success: false, error: 'Project documents not found' });
      }

      const result = await wikiExporter.exportProject({
        project,
        sourceDocsDir,
        userId: uid,
        spaceId: targetSpaceId ? Number(targetSpaceId) : undefined
      });

      res.json({
        success: true,
        exported: true,
        spaceId: result.spaceId,
        spaceName: result.spaceName,
        folderPath: result.folderPath,
        documents: result.documents,
        message: `Exported ${result.documents.length} document(s) to space "${result.spaceName}"/${result.folderPath}`
      });
    } catch (err) {
      log.error('[continuous-exploration] export failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Health ────────────────────────────────────────────────────────────

  app.get(`${BASE}/health`, (req, res) => {
    res.json({
      status: 'ok',
      module: 'wiki/continuous-explorations',
      timestamp: new Date().toISOString(),
      components: {
        projectManager: true,
        templateManager: true,
        aiOrchestrator: aiOrchestrator.available()
      }
    });
  });

  log.info('✓ Wiki continuous exploration routes registered (templates in <space>/.system/continuous-explorations/; projects are visible folders)');
};
