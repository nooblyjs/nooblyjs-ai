/**
 * @fileoverview Knowledge on top of the wiki (NooblyJS Phase 8): one object the
 * routes, AI chat and the hosted entry (index.mjs) all use.
 *
 *   importer        export folder → spaces, redacted files, the index, a source record
 *   findSources     the wiki's own search, minus what the reader may not open
 *   answerOffline   the answer when no AI agent is configured (answers.js)
 *   keep            every answer from search is kept, with an id, so it can be
 *                   added to an item, saved as a page or reported as wrong
 *   link/save/wrong the three answer actions
 *   model           the process model around a page (processModel.js)
 *   service         what other NooblyJS apps call (contextFor, search, find, locate, contextOf, flagged, status)
 *
 * Search itself is not touched: this only asks the indexer and filters hits.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const path = require('node:path');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const { isSpaceMember } = require('../components/spacePermissions');
const { createKnowledgeStore } = require('./store');
const { createImporter } = require('./importer');
const { passageAnswer, bestPassage, titleOf, kindOf, linkFor, MAX_SOURCES } = require('./answers');
const { modelFor, parseBlock } = require('./processModel');

const MODEL_SCAN_LIMIT = 2000;
const FOLDER_SCAN = 500;
// Text a reader matches on: lower case, words only ("Standards/Queueing" → "standards queueing").
const flatten = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isMarkdown = (p) => /\.(md|markdown)$/i.test(String(p || ''));
const fileSafe = (text) => String(text).replace(/[\\/:*?"<>|#%\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * @param {Object} deps
 * @param {string} deps.appBaseDir
 * @param {Object} deps.spaceManager
 * @param {Object} deps.spaceFilingManager
 * @param {Object} deps.filingServiceWrapper
 * @param {Object} deps.searchIndexer
 * @param {Object} deps.logger
 * @param {Object|null} [deps.host] - the NooblyJS host when hosted
 * @param {string} [deps.mountPath] - where the wiki's pages are, for links other apps show
 * @return {Object}
 */
function createKnowledge({ appBaseDir, spaceManager, spaceFilingManager, filingServiceWrapper, searchIndexer, logger, host = null, mountPath = '/applications/wiki' }) {
  const store = createKnowledgeStore(appBaseDir);
  const now = () => new Date(Number(host?.clock?.now?.() ?? Date.now()));
  // NooblyJS Platform's guardrail decides whether an import is redacted (Platform · Settings · Guardrails). Standalone,
  // or with no answer from Platform, it is.
  const redactOnIngest = async () => {
    const guardrail = await Promise.resolve(host?.service?.('platform')?.guardrail?.('redact-on-ingest')).catch(() => null);
    return guardrail ? guardrail.on !== false : true;
  };
  const importer = createImporter({ store, spaceManager, spaceFilingManager, filingServiceWrapper, searchIndexer, appBaseDir, logger, now, redactOnIngest });

  const spaceNamed = (name) => spaceManager.getAllSpaces().find((s) => s.name === name) || null;
  /** A page's address in the browser. Hosted, the wiki's own navigation lives in the hash (see CLAUDE.md). */
  const hrefFor = (spaceName, filePath) => `${mountPath}/${host ? '#/' : ''}${[spaceName, ...String(filePath).split('/')].map(encodeURIComponent).join('/')}`;

  /**
   * May this reader open this page? `user` null is an agent or another app:
   * it sees what anyone signed in sees (team and public spaces), never a private one.
   */
  function canOpen(user, spaceName, filePath) {
    const space = spaceNamed(spaceName);
    if (!space || space.metadata?.archived) return false;
    if (!isSpaceMember(user, space)) return false;
    const visibility = compileVisibility(space);
    return !visibility?.restricted || visibility.isFileVisible(filePath);
  }

  async function read(spaceName, filePath) {
    try {
      const data = await filingServiceWrapper.readDocument(spaceName, filePath);
      if (data == null) return null;
      return Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    } catch {
      return null;
    }
  }

  /**
   * Search hits the reader may open, best first, one per page. `primary` leaves out pages saved from
   * answers (Answers/…): an answer must rest on the documents, never on an earlier answer about them.
   */
  async function findSources(query, { user = null, limit = 12, primary = false } = {}) {
    const hits = await searchIndexer.search(String(query || ''), { maxResults: Math.max(limit * 3, 30) });
    const seen = new Set();
    const out = [];
    for (const hit of hits || []) {
      const filePath = hit.relativePath || hit.path;
      const key = `${hit.spaceName}\n${filePath}`.toLowerCase();
      if (!filePath || seen.has(key) || /(^|\/)\./.test(filePath)) continue;
      seen.add(key);
      if (primary && /^Answers\//i.test(filePath)) continue;
      if (!canOpen(user, hit.spaceName, filePath)) continue;
      out.push({ spaceName: hit.spaceName, path: filePath, relativePath: filePath, title: hit.title, score: hit.score });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** The answer with no model: the top sources' own sentences, cited by number. */
  async function answerOffline(question, { user = null } = {}) {
    const hits = await findSources(question, { user, limit: 12, primary: true });
    return passageAnswer(question, hits, read);
  }

  /** Keep an answer so it can be acted on. Returns it with its id. */
  function keep({ question, response, sources, model = null, searchQuery = null, by }) {
    return store.addAnswer({
      question: String(question).slice(0, 2000), response: String(response).slice(0, 20000), model, searchQuery,
      sources: (sources || []).map((s, i) => ({ index: s.index ?? i + 1, spaceName: s.spaceName, path: s.path, title: s.title || titleOf('', s.path) })),
      by, at: now().toISOString(),
    });
  }

  /** Add to item: the answer's sources become links on the item's spec. */
  async function link(answerId, itemId, actor) {
    const answer = await store.answer(answerId);
    if (!answer) return { status: 404, error: 'There is no such answer.' };
    if (!answer.sources.length) return { status: 422, error: 'This answer has no sources to link.' };
    const product = host?.service?.('product');
    if (typeof product?.linkKnowledge !== 'function') return { status: 409, error: 'The Product Factory is not running here, so there is no item to add this to.' };
    const links = answer.sources.map(linkFor);
    const result = await product.linkKnowledge({ itemId, links, actor: { id: actor.id, name: actor.name } });
    await store.updateAnswer(answerId, (a) => ({ linkedTo: [...new Set([...(a.linkedTo || []), itemId])] }));
    return { status: 200, itemId, added: result.added, links: result.links };
  }

  /** Save as page: Answers/<title>.md in a space, with the question, the answer and its sources. */
  async function save(answerId, { spaceName, title }, actor) {
    const answer = await store.answer(answerId);
    if (!answer) return { status: 404, error: 'There is no such answer.' };
    const space = spaceNamed(spaceName);
    if (!space) return { status: 404, error: `There is no space "${spaceName}".` };
    if (space.permissions === 'read-only') return { status: 403, error: `${space.name} is read-only.` };
    const name = fileSafe(title || answer.question);
    if (!name) return { status: 422, error: 'The page needs a title.' };
    const filePath = `Answers/${name}.md`;
    const lines = [
      `# ${name}`, '',
      `> Saved from an answer by ${actor.name} on ${now().toISOString().slice(0, 10)}. Check the sources before relying on it.`, '',
      '## Question', '', answer.question, '',
      '## Answer', '', answer.response, '',
      '## Sources', '',
      ...answer.sources.map((s) => `${s.index}. ${s.title} (${s.spaceName} · ${s.path})`),
      '',
    ];
    await filingServiceWrapper.writeDocument(space.name, filePath, lines.join('\n'));
    await searchIndexer.updateFileInSpace(space.name, filePath);
    await store.updateAnswer(answerId, (a) => ({ savedAs: [...(a.savedAs || []), { spaceName: space.name, path: filePath }] }));
    return { status: 200, spaceName: space.name, path: filePath, href: hrefFor(space.name, filePath) };
  }

  /** This is wrong: recorded on the answer; every cited page is flagged for review; NooblyJS is told. */
  async function wrong(answerId, reason, actor) {
    const answer = await store.answer(answerId);
    if (!answer) return { status: 404, error: 'There is no such answer.' };
    const why = String(reason || '').trim().slice(0, 500) || 'An answer from this page was reported as wrong';
    const at = now().toISOString();
    await store.updateAnswer(answerId, (a) => ({ reports: [...(a.reports || []), { by: actor.id, name: actor.name, reason: why, at }] }));
    const flags = [];
    for (const s of answer.sources) flags.push(await store.flag({ spaceName: s.spaceName, path: s.path, title: s.title, reason: why, answerId, by: actor.name, at }));
    const links = answer.sources.map(linkFor);
    if (host?.events?.emit) {
      await host.events.emit('knowledge.answer_flagged', {
        system: 'knowledge', answerId, question: answer.question, reason: why,
        sourceIds: links.map((l) => l.id), summary: `reported an answer as wrong: "${answer.question.slice(0, 80)}"`,
      }, { actor: actor.id });
    }
    return { status: 200, flags };
  }

  const openFlags = async () => (await store.flags()).filter((f) => f.status === 'open').sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((f) => ({ ...f, href: hrefFor(f.spaceName, f.path) }));

  /** The process model around a page, or null when the page is not part of one. */
  async function model(spaceName, pagePath) {
    const own = await read(spaceName, pagePath);
    let block = own && parseBlock(own);
    if (!block) return null;
    // Walk up to the top of the model: its folder bounds the search for children.
    let top = pagePath;
    const seen = new Set([String(pagePath).toLowerCase()]);
    while (block?.parent && !seen.has(block.parent.toLowerCase())) {
      seen.add(block.parent.toLowerCase());
      const parentText = await read(spaceName, block.parent);
      const parentBlock = parentText && parseBlock(parentText);
      if (!parentBlock) break;
      top = block.parent;
      block = parentBlock;
    }
    const folder = path.posix.dirname(String(top).replace(/\\/g, '/'));
    const files = (await filingServiceWrapper.getAllFilesRecursive(spaceName, folder === '.' ? '' : folder)).filter(isMarkdown).slice(0, MODEL_SCAN_LIMIT);
    const pages = [];
    for (const file of files) {
      const markdown = await read(spaceName, file);
      if (markdown && markdown.includes('```process-model')) pages.push({ path: file, markdown });
    }
    const built = modelFor(pages, pagePath);
    if (!built) return null;
    const withHref = (p) => ({ ...p, href: hrefFor(spaceName, p.path) });
    return {
      spaceName,
      page: withHref(built.page),
      parents: built.parents.map(withHref),
      children: built.children.map(withHref),
      bands: built.bands && built.bands.map((b) => ({ name: b.name, processes: b.processes.map(withHref) })),
    };
  }

  /** "Used across NooblyJS": an item id as a title and a link, where NooblyJS knows it. */
  async function resolveItems(ids) {
    const out = [];
    for (const id of ids || []) {
      let title = null;
      let href = null;
      try {
        if (/^ADR-/i.test(id)) {
          const adr = await host?.service?.('product')?.adrFor?.(id);
          if (adr) { title = adr.title; href = adr.href; }
        } else {
          const item = await host?.service?.('workflows')?.item?.({ itemId: id });
          if (item) { title = item.title ?? item.item?.title ?? null; href = `/home/lifecycle/${encodeURIComponent(id)}`; }
        }
      } catch { /* an app that is not running: the id is still shown */ }
      out.push({ id, title, href });
    }
    return out;
  }

  // What other NooblyJS apps call through host.service('knowledge'). No session: `user` is null throughout.
  const service = {
    /**
     * Knowledge for an agent about to draft: the pages that match, each with a passage and a link.
     * @param {{ itemId?: string, query?: string, limit?: number }} o
     * @return {Promise<Array<{ id, title, kind, space, path, href, passage }>>}
     */
    async contextFor({ itemId, query, limit = MAX_SOURCES } = {}) {
      let question = String(query || '').trim();
      if (!question && itemId) {
        try {
          const artefacts = await host?.service?.('product')?.artefactsFor?.(itemId);
          question = String(artefacts?.title || artefacts?.spec?.title || '').trim();
        } catch { /* the Product Factory is not running */ }
      }
      if (!question) return [];
      const hits = await findSources(question, { user: null, limit: Math.min(Math.max(limit, 1), 10), primary: true });
      const out = [];
      for (const hit of hits) {
        if (!isMarkdown(hit.path)) continue;
        const content = await read(hit.spaceName, hit.path);
        if (!content) continue;
        const source = { spaceName: hit.spaceName, path: hit.path, title: titleOf(content, hit.path) };
        out.push({ ...linkFor(source), space: hit.spaceName, path: hit.path, href: hrefFor(hit.spaceName, hit.path), passage: bestPassage(question, content) });
      }
      return out;
    },
    /** Search for another app: titles and links, nothing a signed-in person could not open. */
    async search(query, { limit = 10 } = {}) {
      const hits = await findSources(query, { user: null, limit: Math.min(Math.max(limit, 1), 50) });
      return hits.map((h) => ({ title: String(h.title || '').replace(/\.[^.]+$/, ''), kind: kindOf(h.path), space: h.spaceName, path: h.path, href: hrefFor(h.spaceName, h.path) }));
    },
    /**
     * Files and folders that match, for an app that links knowledge to its work (NooblyJS Architecture · Knowledge).
     * Files are the wiki's own search; folders are those whose path holds every word of the query, found from the
     * documents in them. Nothing a signed-in person could not open.
     * @return {Promise<{ files: Array<{ kind, title, docKind, space, path, href }>, folders: Array<{ kind, title, space, path, href, documents }> }>}
     */
    async find(query, { limit = 20 } = {}) {
      const q = String(query || '').trim();
      if (q.length < 2) return { files: [], folders: [] };
      const max = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const hits = await findSources(q, { user: null, limit: max });
      const files = hits.map((h) => ({ kind: 'file', title: String(h.title || path.posix.basename(h.path)).replace(/\.[^.]+$/, ''), docKind: kindOf(h.path), space: h.spaceName, path: h.path, href: hrefFor(h.spaceName, h.path) }));
      const words = flatten(q).split(' ').filter(Boolean);
      const docs = [...(searchIndexer.getSuggestions?.(q, { documentsOnly: true, matchPaths: true, maxSuggestions: FOLDER_SCAN }) || []), ...hits.map((h) => ({ path: h.path, spaceName: h.spaceName }))];
      const folders = new Map();
      for (const doc of docs) {
        if (!doc || typeof doc !== 'object' || !doc.path || !doc.spaceName || /(^|\/)\./.test(doc.path)) continue;
        if (!canOpen(null, doc.spaceName, doc.path)) continue;
        const parts = String(doc.path).split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          const folder = parts.slice(0, i).join('/');
          if (!words.every((w) => flatten(folder).includes(w))) continue;
          const key = `${doc.spaceName}\n${folder}`;
          const seen = folders.get(key) ?? { kind: 'folder', title: parts[i - 1], space: doc.spaceName, path: folder, href: hrefFor(doc.spaceName, folder), documents: new Set() };
          seen.documents.add(doc.path);
          folders.set(key, seen);
        }
      }
      // A folder whose own name matches first, then the shallower ones.
      const ownName = (f) => words.every((w) => flatten(f.title).includes(w));
      const list = [...folders.values()]
        .map((f) => ({ ...f, documents: f.documents.size }))
        .sort((a, b) => Number(ownName(b)) - Number(ownName(a)) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
        .slice(0, max);
      return { files, folders: list };
    },
    /**
     * A file or folder another app links to, if it is there and may be opened: { kind, title, space, path, href }, else
     * null. A folder is there when the index has a document in it.
     */
    async locate({ kind, space, path: where } = {}) {
      const p = String(where || '').replace(/^\/+|\/+$/g, '');
      if (!p || !space || p.split('/').includes('..') || !['file', 'folder'].includes(kind)) return null;
      if (kind === 'file') {
        if (!canOpen(null, space, p)) return null;
        const content = await read(space, p);
        if (content == null) return null;
        return { kind, title: isMarkdown(p) ? titleOf(content, p) : path.posix.basename(p), space, path: p, href: hrefFor(space, p) };
      }
      const inside = searchIndexer.getSuggestions?.(path.posix.basename(p), { documentsOnly: true, matchPaths: true, pathPrefix: p, spaceNames: [space], maxSuggestions: 1 }) || [];
      const doc = inside.find((d) => d && typeof d === 'object' && d.path);
      if (!doc || !canOpen(null, space, doc.path)) return null;
      return { kind, title: path.posix.basename(p), space, path: p, href: hrefFor(space, p) };
    },
    /**
     * What linked knowledge says, for an agent's context (the Software Factory's work items): a file's text, and a
     * folder's documents with the text of its first few. Clipped to `maxChars` in all. Links it cannot read are said so.
     * @param {Array<{ kind, space, path, note? }>} links
     */
    async contextOf(links = [], { maxChars = 16000, folderDocuments = 3 } = {}) {
      let left = Math.max(Number(maxChars) || 0, 1000);
      const clip = (text) => {
        const t = String(text || '').trim();
        const out = t.length > left ? `${t.slice(0, Math.max(left - 1, 0))}…` : t;
        left -= out.length;
        return out;
      };
      const out = [];
      for (const link of Array.isArray(links) ? links : []) {
        const found = await service.locate(link);
        if (!found) { out.push({ ...link, readable: false, text: '' }); continue; }
        if (found.kind === 'file') {
          const content = isMarkdown(found.path) || /\.(txt|ya?ml|json|csv)$/i.test(found.path) ? await read(found.space, found.path) : null;
          out.push({ ...link, ...found, readable: true, text: content == null ? '(not a text file: open it in Knowledge)' : clip(content) });
          continue;
        }
        const docs = (searchIndexer.getSuggestions?.(path.posix.basename(found.path), { documentsOnly: true, matchPaths: true, pathPrefix: found.path, spaceNames: [found.space], maxSuggestions: 50 }) || [])
          .filter((d) => d && typeof d === 'object' && d.path && canOpen(null, found.space, d.path));
        const parts = [`Documents in this folder: ${docs.map((d) => d.path).join(', ') || 'none indexed'}`];
        for (const d of docs.filter((x) => isMarkdown(x.path)).slice(0, folderDocuments)) {
          if (left <= 0) break;
          const content = await read(found.space, d.path);
          if (content) parts.push(`--- ${d.path}\n${clip(content)}`);
        }
        out.push({ ...link, ...found, readable: true, documents: docs.length, text: parts.join('\n\n') });
      }
      return out;
    },
    flagged: () => openFlags(),
    /**
     * NooblyJS Phase 23: another app writes a page a person accepted (Operations' post-incident review) into a space
     * that can be written (the one named, else the first that isn't read-only), under a folder: { spaceName, path, href }.
     */
    async writePage({ spaceName = null, folder = 'Reviews', title, body, by = null } = {}) {
      const name = fileSafe(title || '');
      if (!name) return null;
      const writable = (s) => s && s.permissions !== 'read-only' && !s.metadata?.archived;
      const space = [spaceNamed(spaceName), ...spaceManager.getAllSpaces()].find(writable);
      if (!space) return null;
      const filePath = `${fileSafe(folder) || 'Reviews'}/${name}.md`;
      await filingServiceWrapper.writeDocument(space.name, filePath, String(body ?? ''));
      await searchIndexer.updateFileInSpace(space.name, filePath);
      if (host?.events?.emit) {
        await host.events.emit('knowledge.page_written', { system: 'knowledge', spaceName: space.name, path: filePath, summary: `wrote ${space.name} · ${filePath}` }, { actor: by?.id ?? null });
      }
      return { spaceName: space.name, path: filePath, href: hrefFor(space.name, filePath) };
    },
    async status() {
      const [sources, flags] = await Promise.all([store.sources(), openFlags()]);
      return { spaces: spaceManager.getAllSpaces().filter((s) => !s.metadata?.archived).length, sources: sources.length, documents: sources.reduce((n, s) => n + (s.documents || 0), 0), needsReview: flags.length };
    },
  };

  return { store, importer, canOpen, findSources, answerOffline, keep, link, save, wrong, openFlags, model, resolveItems, hrefFor, service, now };
}

module.exports = { createKnowledge };
