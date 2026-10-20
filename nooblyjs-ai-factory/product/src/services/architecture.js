// Stage 2 · Architecture (docs/roadmap-history.md P4, product.md §5.3): the container view as code, architecture decisions
// (ADRs, accepted only by a person with accept-decisions), the standards check, and the quality attributes that
// become Factory gates on every PR. Files: data/product/architecture/<PRD>/diagram.md, adrs/ADR-nnn.md,
// quality-attributes.md, and the check rules in data/product/standards.yaml (D6).
import { validator, invalid } from '../util/validate.js';
import { checkIfMatch, etagOf, isAgent } from '../util/http.js';
import { newId, nextNumbered, isId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';
import { toTable, parseTable } from '../util/md-table.js';
import { readSections, writeSections } from '../util/sections.js';
import { parseC4, codeFromBody, bodyFromCode, isDependency } from './c4.js';

/** The Architecture stage's default drafting agent (product.md §2) `[CONFIRM: not in nooblyjs-ai-teammate' roster yet]`. */
export const ARCHITECT_AGENT = { id: 'rhea-voss', name: 'Rhea Voss', kind: 'agent' };

const ADR_PARTS = [{ key: 'context', heading: 'Context' }, { key: 'decision', heading: 'Decision' }, { key: 'consequences', heading: 'Consequences' }];
export const QA_COLUMNS = [
  { key: 'attribute', label: 'Attribute' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'target', label: 'Target' },
  { key: 'verifiedBy', label: 'Verified by' },
];
const ADR_STATUS = { proposed: 'Proposed', accepted: 'Accepted', superseded: 'Superseded' };
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = (n, one, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;
const ref = (actor) => (isAgent(actor) ? { id: actor.id, name: actor.name, kind: 'agent' } : { id: actor.id, kind: 'person' });

export function createArchitectureService({ repos, host, log }) {
  const A = repos.artefacts;
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });
  const paths = {
    diagram: (id) => ['architecture', id, 'diagram.md'],
    adrs: (id) => ['architecture', id, 'adrs'],
    adr: (itemId, adrId) => ['architecture', itemId, 'adrs', `${adrId}.md`],
    qa: (id) => ['architecture', id, 'quality-attributes.md'],
    knowledge: (id) => ['architecture', id, 'knowledge.md'],
  };

  async function specOr404(itemId) {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  }

  // ---------- the repositories it is built in (NooblyJS Phase 11) ----------

  /**
   * Where the item will be built: the spec's repositories, which start as its product's (or its idea's) and
   * are confirmed or narrowed here, by a person. Each is described from Platform's list (NooblyJS's catalogue).
   */
  async function repositories(itemId) {
    const spec = await specOr404(itemId);
    const platform = host.service('platform');
    const list = await Promise.all((spec.repositories ?? []).map(async (name) => {
      const found = typeof platform?.repository === 'function' ? await platform.repository(name) : null;
      return { name, shortName: name.split('/').pop(), known: Boolean(found), source: found?.source ?? null, gone: found?.gone === true, access: found?.access ?? null, url: found?.url ?? null };
    }));
    const confirmed = spec.repositoriesConfirmed ?? null;
    return {
      itemId,
      repositories: list,
      jiraProject: spec.jiraProject ?? null,
      confirmed,
      text: !list.length ? 'No repositories yet. Choose where this is built; the handoff can only send work there.'
        : confirmed ? `${list.length} repositor${list.length === 1 ? 'y' : 'ies'}, confirmed by ${confirmed.byName ?? confirmed.by}`
          : `${list.length} repositor${list.length === 1 ? 'y' : 'ies'} from ${spec.product ?? 'its idea'}; not confirmed yet`,
    };
  }

  /** A person confirms or narrows the repositories. Each must be one Platform lists and not gone from Bitbucket. */
  async function setRepositories(itemId, body, actor) {
    await specOr404(itemId);
    const f = validator(body ?? {}).only(['repositories']).list('repositories', (r) => String(r).slice(0, 160), { max: 20 }).result();
    if (!f.repositories) throw new HttpError(400, 'invalid', 'Send the list of repositories.', { repositories: 'required' });
    const platform = host.service('platform');
    const names = [];
    for (const ref of f.repositories) {
      const found = typeof platform?.repository === 'function' ? await platform.repository(ref) : null;
      if (!found) throw new HttpError(422, 'unknown_repository', `${ref} is not a repository NooblyJS knows. Platform · Repositories lists them.`, { repositories: ref });
      if (found.gone) throw new HttpError(422, 'repository_gone', `${found.name} is no longer in Bitbucket.`, { repositories: found.name });
      if (!names.includes(found.name)) names.push(found.name);
    }
    let before = [];
    await repos.specs.update(itemId, (current) => {
      if (!current) throw notFound(`There is no spec ${itemId}.`);
      before = current.repositories ?? [];
      return { ...current, repositories: names, repositoriesConfirmed: { by: actor.id, byName: actor.name ?? null, at: now() }, updatedAt: now() };
    });
    const short = (list) => list.map((r) => r.split('/').pop());
    await emit('architecture.repositories_set', {
      itemId, system: 'product', repositories: names, before,
      summary: names.length ? `confirmed ${itemId} is built in ${short(names).join(', ')}` : `cleared the repositories of ${itemId}`,
    }, actor);
    return repositories(itemId);
  }

  // ---------- knowledge the item is built with (NooblyJS: Architecture · Knowledge) ----------
  //
  // Files and folders from the Knowledge Repository (NooblyJS's wiki, host.service('knowledge')), each with a person's
  // note on what it is for ("Data relating to application standard"). The Software Factory reads them as context for
  // the item's work items. Stored as architecture/<id>/knowledge.md: { links: [{ id, kind, space, path, title, href,
  // note, addedBy, addedAt }] }.

  const knowledgeService = () => {
    const k = host.service('knowledge');
    if (typeof k?.find !== 'function' || typeof k?.locate !== 'function') throw new HttpError(503, 'knowledge_unavailable', 'The Knowledge Repository is not running here, so knowledge cannot be searched or linked.');
    return k;
  };
  const linkKey = (kind, space, p) => `${kind}:${space}:${p}`.toLowerCase();
  const noteOf = (value) => {
    if (value == null) return '';
    if (typeof value !== 'string' || value.length > 300) throw new HttpError(422, 'invalid', 'A note is text, up to 300 characters.', { note: 'max 300 characters' });
    return value.replace(/\s+/g, ' ').trim();
  };

  async function knowledgeLinks(itemId) {
    await specOr404(itemId);
    const doc = await A.get(paths.knowledge(itemId));
    const links = doc?.links ?? [];
    return { itemId, links, text: links.length ? `${links.length} link${links.length === 1 ? '' : 's'} the Software Factory reads as context` : 'No knowledge linked yet.' };
  }

  /** Files and folders in Knowledge that match, each marked when the item already links it. */
  async function searchKnowledge(itemId, query) {
    const { links } = await knowledgeLinks(itemId);
    const q = String(query ?? '').trim().slice(0, 200);
    if (q.length < 2) return { query: q, files: [], folders: [] };
    const found = await knowledgeService().find(q, { limit: 20 });
    const have = new Set(links.map((l) => linkKey(l.kind, l.space, l.path)));
    const mark = (x) => ({ ...x, linked: have.has(linkKey(x.kind, x.space, x.path)) });
    return { query: q, files: (found.files ?? []).map(mark), folders: (found.folders ?? []).map(mark) };
  }

  /** Links a file or folder with a person's note. It must be one Knowledge can find and a person could open. */
  async function addKnowledge(itemId, body, actor) {
    await specOr404(itemId);
    const f = validator(body ?? {}).only(['kind', 'space', 'path', 'note']).string('kind', { required: true, max: 10 }).string('space', { required: true, max: 200 }).string('path', { required: true, max: 1000 }).result();
    if (!['file', 'folder'].includes(f.kind)) throw new HttpError(422, 'invalid', 'A link is to a file or a folder.', { kind: 'file or folder' });
    const note = noteOf(body?.note);
    const found = await knowledgeService().locate({ kind: f.kind, space: f.space, path: f.path });
    if (!found) throw new HttpError(404, 'knowledge_not_found', `There is no ${f.kind} ${f.path} in ${f.space} that you can open.`);
    let link = null;
    await A.update(paths.knowledge(itemId), (current) => {
      const links = [...(current?.links ?? [])];
      if (links.some((l) => linkKey(l.kind, l.space, l.path) === linkKey(found.kind, found.space, found.path))) {
        throw new HttpError(409, 'already_linked', `${found.title} is already linked to ${itemId}.`);
      }
      link = { id: newId('kl'), kind: found.kind, space: found.space, path: found.path, title: found.title, href: found.href, note, addedBy: actor.id, addedAt: now() };
      return { ...(current ?? {}), itemId, links: [...links, link], updatedAt: now() };
    });
    await emit('architecture.knowledge_linked', { itemId, system: 'product', link: { kind: link.kind, space: link.space, path: link.path }, summary: `linked ${link.kind === 'folder' ? 'the folder ' : ''}${link.title} to ${itemId}${note ? ` (${note})` : ''}` }, actor);
    return { link, ...(await knowledgeLinks(itemId)) };
  }

  /** Changes a link's note. */
  async function noteKnowledge(itemId, linkId, body, actor) {
    await specOr404(itemId);
    const note = noteOf(body?.note);
    let changed = null;
    await A.update(paths.knowledge(itemId), (current) => {
      const links = (current?.links ?? []).map((l) => {
        if (l.id !== linkId) return l;
        changed = { ...l, note, notedBy: actor.id, notedAt: now() };
        return changed;
      });
      if (!changed) throw notFound(`${itemId} has no knowledge link ${linkId}.`);
      return { ...current, links, updatedAt: now() };
    });
    await emit('architecture.knowledge_noted', { itemId, system: 'product', linkId, summary: `noted on ${changed.title} for ${itemId}: ${note || 'no note'}` }, actor);
    return { link: changed, ...(await knowledgeLinks(itemId)) };
  }

  async function removeKnowledge(itemId, linkId, actor) {
    await specOr404(itemId);
    let removed = null;
    await A.update(paths.knowledge(itemId), (current) => {
      removed = (current?.links ?? []).find((l) => l.id === linkId) ?? null;
      if (!removed) throw notFound(`${itemId} has no knowledge link ${linkId}.`);
      return { ...current, links: current.links.filter((l) => l.id !== linkId), updatedAt: now() };
    });
    await emit('architecture.knowledge_unlinked', { itemId, system: 'product', link: { kind: removed.kind, space: removed.space, path: removed.path }, summary: `unlinked ${removed.title} from ${itemId}` }, actor);
    return { removed: removed.id, ...(await knowledgeLinks(itemId)) };
  }

  // ---------- the container view ----------

  /** The diagram, parsed, or an empty one awaiting a brief. */
  async function diagram(itemId) {
    await specOr404(itemId);
    const doc = await A.get(paths.diagram(itemId));
    const code = doc ? codeFromBody(doc.body) : '';
    const model = code ? parseC4(code) : { title: null, nodes: [], edges: [], errors: [] };
    const version = doc?.version ?? 0;
    return {
      id: `${itemId}.diagram`,
      itemId,
      format: 'mermaid-c4',
      version,
      status: version ? 'drafted' : 'awaiting-brief',
      statusText: version ? `v${version}` : 'Awaiting your brief',
      code,
      title: model.title,
      nodes: model.nodes,
      edges: model.edges,
      errors: model.errors,
      provenance: doc?.provenance ?? null,
      contracts: doc?.contracts ?? [],
      dataRegion: doc?.dataRegion ?? null,
      draftedBy: doc?.draftedBy ?? null,
      editedBy: doc?.editedBy ?? null,
      versionBy: doc?.versionBy ?? null,
      changeNote: doc?.changeNote ?? null,
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  /** "Edit as code": saves the code as a new version when it parses. If-Match on the diagram's ETag. */
  async function saveDiagram(itemId, body, actor, { ifMatch, provenance } = {}) {
    await specOr404(itemId);
    const fields = validator(body).only(['code', 'changeNote']).string('code', { required: true, max: 20000 }).string('changeNote', { max: 300 }).result();
    const model = parseC4(fields.code);
    if (model.errors.length) {
      throw new HttpError(422, 'invalid', 'The diagram has mistakes. Fix the lines listed and save again.',
        Object.fromEntries(model.errors.map((e) => [`line ${e.line}`, e.message])));
    }
    let changed = null;
    await A.update(paths.diagram(itemId), (current) => {
      const version = current?.version ?? 0;
      checkIfMatch(ifMatch, { id: `${itemId}.diagram`, version });
      if (current && codeFromBody(current.body) === fields.code.trim()) return null; // nothing changed: no new version
      const by = ref(actor);
      changed = {
        ...(current ?? {}),
        itemId,
        format: 'mermaid-c4',
        ...(isAgent(actor) ? { draftedBy: by } : { editedBy: by }),
        version: version + 1,
        versionBy: by,
        changeNote: fields.changeNote ?? null,
        provenance: provenance ?? current?.provenance ?? null,
        updatedAt: now(),
        body: bodyFromCode(fields.code),
      };
      return changed;
    });
    if (changed) await emit('architecture.diagram_updated', { itemId, version: changed.version, containers: model.nodes.length }, actor);
    return diagram(itemId);
  }

  // ---------- decisions (ADRs) ----------

  function adrView(adr) {
    const parts = readSections(adr.body, ADR_PARTS);
    return {
      id: adr.id,
      itemId: adr.itemId,
      title: adr.title,
      status: adr.status,
      statusText: ADR_STATUS[adr.status] ?? adr.status,
      addsDependency: Boolean(adr.addsDependency),
      dependency: adr.dependency ?? null,
      alternative: adr.alternative ?? null,
      needs: adr.status === 'proposed' && adr.addsDependency ? 'Adds a dependency · an Architect signs it off' : null,
      ...parts,
      proposedBy: adr.proposedBy ?? null,
      proposedAt: adr.proposedAt ?? null,
      acceptedBy: adr.acceptedBy ?? null,
      acceptedAt: adr.acceptedAt ?? null,
      supersedes: adr.supersedes ?? null,
      supersededBy: adr.supersededBy ?? null,
      discussion: adr.discussion ?? [],
      version: adr.version ?? 1,
    };
  }

  /** Every ADR across all items (ADR numbers are global). */
  async function allAdrs() {
    const out = [];
    for (const itemId of await A.folders(['architecture'])) {
      if (!isId(itemId)) continue;
      for (const adr of await A.list(paths.adrs(itemId))) if (isId(adr.id)) out.push({ ...adr, itemId: adr.itemId ?? itemId });
    }
    return out;
  }

  async function findAdr(adrId) {
    if (!isId(adrId) || !adrId.startsWith('ADR-')) return null;
    return (await allAdrs()).find((a) => a.id === adrId) ?? null;
  }

  async function adrs(itemId) {
    await specOr404(itemId);
    return (await A.list(paths.adrs(itemId)))
      .filter((a) => isId(a.id))
      .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }))
      .map(adrView);
  }

  async function proposeAdr(itemId, body, actor) {
    await specOr404(itemId);
    const f = validator(body)
      .only(['title', 'context', 'decision', 'consequences', 'addsDependency', 'dependency', 'alternative', 'supersedes'])
      .string('title', { required: true, max: 160 })
      .string('context', { max: 10000 })
      .string('decision', { max: 10000 })
      .string('consequences', { max: 10000 })
      .custom('addsDependency', (v) => (typeof v === 'boolean' ? { value: v } : { errors: { value: 'must be true or false' } }))
      .string('dependency', { max: 64 })
      .string('alternative', { max: 500 })
      .string('supersedes', { max: 12 })
      .result();
    if (f.supersedes && !(await findAdr(f.supersedes))) throw notFound(`There is no ${f.supersedes} to supersede.`);
    const adr = await A.withLock(['architecture'], async () => {
      const id = nextNumbered('ADR', (await allAdrs()).map((a) => a.id));
      const record = {
        id, itemId, title: f.title, status: 'proposed',
        addsDependency: f.addsDependency ?? Boolean(f.dependency),
        dependency: f.dependency ?? null,
        alternative: f.alternative ?? null,
        supersedes: f.supersedes ?? null,
        proposedBy: ref(actor), proposedAt: now(), version: 1, discussion: [],
        body: writeSections(f, ADR_PARTS),
      };
      await A.write(paths.adr(itemId, id), record);
      return record;
    });
    await emit('adr.proposed', { adrId: adr.id, itemId, title: adr.title, addsDependency: adr.addsDependency }, actor);
    return adrView(adr);
  }

  async function updateAdr(adrId, fn) {
    const found = await findAdr(adrId);
    if (!found) throw notFound(`There is no ${adrId}.`);
    let result;
    await A.update(paths.adr(found.itemId, adrId), (current) => {
      if (!current) throw notFound(`There is no ${adrId}.`);
      result = fn({ ...current, itemId: current.itemId ?? found.itemId });
      return result;
    });
    return result;
  }

  /** People only (the route checks accept-decisions and refuses agents): the ADR becomes the decision of record. */
  async function acceptAdr(adrId, actor) {
    const at = now();
    const accepted = await updateAdr(adrId, (adr) => {
      if (adr.status !== 'proposed') throw new HttpError(409, 'not_proposed', `${adrId} is ${ADR_STATUS[adr.status]?.toLowerCase() ?? adr.status}, so there is nothing to accept.`);
      return { ...adr, status: 'accepted', acceptedBy: ref(actor), acceptedAt: at, version: (adr.version ?? 1) + 1 };
    });
    if (accepted.supersedes) {
      await updateAdr(accepted.supersedes, (old) => ({ ...old, status: 'superseded', supersededBy: adrId, version: (old.version ?? 1) + 1 })).catch((err) => log.warn(`superseding ${accepted.supersedes}: ${err.message}`));
    }
    await emit('adr.accepted', { adrId, itemId: accepted.itemId, title: accepted.title, addsDependency: Boolean(accepted.addsDependency) }, actor);
    return adrView(accepted);
  }

  async function discussAdr(adrId, body, actor) {
    const { text } = validator(body).only(['text']).string('text', { required: true, max: 2000 }).result();
    const updated = await updateAdr(adrId, (adr) => ({ ...adr, discussion: [...(adr.discussion ?? []), { by: ref(actor), at: now(), text }] }));
    await emit('adr.discussed', { adrId, itemId: updated.itemId }, actor);
    return adrView(updated);
  }

  // ---------- standards check ----------

  async function standardsCheck(itemId) {
    const [d, decisions, rules] = await Promise.all([diagram(itemId), adrs(itemId), A.readYaml(['standards.yaml'])]);
    const stack = rules?.approvedStack ?? [];
    const regions = rules?.customerDataRegions ?? [];
    if (!d.version) {
      const checks = ['approved-stack', 'data-in-region', 'api-contract', 'dependency-adr'].map((key) => ({ key, passed: null, text: 'No container view yet' }));
      return { passed: 0, total: checks.length, text: 'Not checked yet', checks };
    }
    const newNodes = d.nodes.filter((n) => n.isNew);
    const offStack = newNodes.filter((n) => n.tech && !stack.some((s) => n.tech.toLowerCase().startsWith(s.toLowerCase())));
    const apis = newNodes.filter((n) => n.kind === 'container' && /\bapi\b|service/i.test(`${n.label} ${n.tech} ${n.description}`));
    const noContract = apis.filter((n) => !d.contracts.some((c) => c.container === n.id));
    const deps = d.nodes.filter(isDependency);
    const depProblems = deps.map((n) => {
      const decision = decisions.find((a) => a.dependency === n.id && a.status !== 'superseded');
      if (!decision) return `${n.label}: no ADR`;
      if (decision.status !== 'accepted') return `${n.label}: ${decision.id} is proposed, not accepted yet`;
      return null;
    }).filter(Boolean);
    const inRegion = d.dataRegion && regions.includes(d.dataRegion);
    const checks = [
      { key: 'approved-stack', label: 'Approved stack only', passed: offStack.length === 0, text: offStack.length ? `Not on the approved stack: ${offStack.map((n) => `${n.label} (${n.tech})`).join(', ')}` : 'Approved stack only' },
      { key: 'data-in-region', label: 'Customer data stays in-region', passed: Boolean(inRegion), text: inRegion ? 'Customer data stays in-region' : d.dataRegion ? `Customer data in ${d.dataRegion}, outside ${regions.join(', ') || 'the approved regions'}` : 'The data region isn\'t stated yet' },
      { key: 'api-contract', label: 'Every API has a contract', passed: noContract.length === 0, text: noContract.length ? `No contract yet: ${noContract.map((n) => n.label).join(', ')}` : 'Every API has a contract' },
      { key: 'dependency-adr', label: 'New dependency needs an ADR', passed: depProblems.length === 0, text: depProblems.length ? depProblems.join('; ') : 'Every new dependency has an accepted ADR' },
    ];
    const passed = checks.filter((c) => c.passed).length;
    return { passed, total: checks.length, text: `${passed} of ${checks.length}`, checks };
  }

  // ---------- quality attributes (Factory gates) ----------

  async function qualityAttributes(itemId) {
    await specOr404(itemId);
    const doc = await A.get(paths.qa(itemId));
    return {
      id: `${itemId}.quality-attributes`,
      itemId,
      version: doc?.version ?? 0,
      attributes: doc ? parseTable(doc.body, QA_COLUMNS) : [],
      gates: 'Become Factory gates on every PR',
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  const qaRow = (r) => (r && typeof r === 'object' && QA_COLUMNS.every((c) => typeof r[c.key] === 'string' && r[c.key].trim() && r[c.key].length <= 200)
    ? Object.fromEntries(QA_COLUMNS.map((c) => [c.key, r[c.key].trim()]))
    : invalid('each row needs attribute, scenario, target and verifiedBy (text)'));

  async function saveQualityAttributes(itemId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    const { attributes } = validator(body).only(['attributes']).list('attributes', qaRow, { max: 30 }).result();
    if (!attributes) throw new HttpError(422, 'invalid', 'Send the full list as attributes.', { attributes: 'attributes is required' });
    let version;
    await A.update(paths.qa(itemId), (current) => {
      version = current?.version ?? 0;
      checkIfMatch(ifMatch, { id: `${itemId}.quality-attributes`, version });
      version += 1;
      return { itemId, version, updatedAt: now(), [isAgent(actor) ? 'draftedBy' : 'editedBy']: ref(actor), body: toTable(QA_COLUMNS, attributes) };
    });
    await emit('architecture.updated', { itemId, part: 'quality-attributes', version, gates: attributes.length }, actor);
    return qualityAttributes(itemId);
  }

  // ---------- the stage ----------

  /** The specs in or heading for Architecture: approved ones, and any that already have architecture work. */
  async function items() {
    const specs = await repos.specs.list();
    const withWork = new Set(await A.folders(['architecture']));
    const out = [];
    for (const spec of specs.filter((s) => s.status === 'approved' || withWork.has(s.id)).sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }))) {
      const [d, decisions] = await Promise.all([diagram(spec.id), adrs(spec.id)]);
      const newContainers = d.nodes.filter((n) => n.isNew).length;
      const proposed = decisions.filter((a) => a.status === 'proposed').length;
      out.push({
        itemId: spec.id, title: spec.title, product: spec.product ?? null, specStatus: spec.status,
        newContainers, proposedAdrs: proposed,
        text: d.version ? `${count(newContainers, 'new container')}, ${count(proposed, 'decision').toLowerCase()} to sign off.` : 'Awaiting your brief for the container view.',
      });
    }
    return out;
  }

  /**
   * item.stage_changed into Architecture (the lifecycle's Design stage since Phase 16b): nothing drafts by itself (D3);
   * the item now shows on the Architecture list.
   */
  async function onStageChanged(event) {
    const p = event?.payload ?? {};
    const to = String(p.to ?? p.stage ?? '').toLowerCase();
    if (!p.itemId || !['architecture', 'design', 'architect', '3'].includes(to)) return;
    try {
      if (!(await repos.specs.get(p.itemId))) return;
      await A.update(['architecture', p.itemId, 'stage.md'], (current) => (current ? null : { itemId: p.itemId, enteredAt: event.at ?? now(), body: '' }));
    } catch (err) {
      log.error(`item.stage_changed for ${p.itemId}: ${err.message}`);
    }
  }

  /**
   * approval.decided from the NooblyJS lifecycle engine for an ADR (Accept on NooblyJS's Approvals screen): the decision is accepted
   * here too. Workflows has already checked that a person with the accept-decisions permission took it.
   */
  async function onApprovalDecided(event) {
    const p = event?.payload ?? {};
    if (p.type !== 'adr' || p.outcome !== 'approved' || !p.subject || !event.actor) return;
    try {
      const adr = await findAdr(p.subject);
      if (adr?.status === 'proposed') await acceptAdr(p.subject, { id: event.actor, kind: 'person' });
    } catch (err) {
      log.error(`approval.decided for ${p.subject}: ${err.message}`);
    }
  }

  /** For artefactsFor() and the NooblyJS lifecycle engine / the Software Factory: the gates and what is still open. */
  async function summaryFor(itemId) {
    const [qa, decisions, standards] = await Promise.all([qualityAttributes(itemId), adrs(itemId), standardsCheck(itemId)]);
    const knowledge = (await A.get(paths.knowledge(itemId)).catch(() => null))?.links ?? [];
    return {
      gates: qa.attributes,
      proposedAdrs: decisions.filter((a) => a.status === 'proposed').map((a) => a.id),
      standards: standards.text,
      // What the Software Factory reads as context (Architecture · Knowledge).
      knowledge: knowledge.map(({ kind, space, path: p, title, href, note }) => ({ kind, space, path: p, title, href, note })),
    };
  }

  return {
    repositories, setRepositories, knowledgeLinks, searchKnowledge, addKnowledge, noteKnowledge, removeKnowledge, diagram, saveDiagram, adrs, findAdr, adrView, proposeAdr, acceptAdr, discussAdr, standardsCheck,
    qualityAttributes, saveQualityAttributes, items, onStageChanged, onApprovalDecided, summaryFor,
    etags: { diagram: (d) => etagOf(d), qa: (q) => etagOf(q) },
  };
}

/** Rhea Voss's drafts: the container view and a proposed ADR (mock content is marked [PLACEHOLDER]). */
export function architectureKinds({ repos, architecture }) {
  const P = (what) => `[PLACEHOLDER: ${what}]`;
  const stale = (itemId, err) => (err?.status === 409 && err.code === 'conflict'
    ? new HttpError(409, 'stale_draft', `${itemId}'s container view changed while the agent was drafting, so the draft was not saved. Nothing you wrote was lost; ask again.`)
    : err);
  const specFor = async (itemId) => {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  };
  return {
    'container-view': {
      stage: 'architecture', label: 'the container view', workType: 'architecture-drafting', agent: ARCHITECT_AGENT, estimateUsd: 1.95, doneEvent: 'architecture.diagram_updated',
      async check(itemId) {
        const spec = await specFor(itemId);
        return { baseVersion: (await architecture.diagram(itemId)).version, title: spec.title };
      },
      async mock(draft) {
        const spec = await specFor(draft.itemId);
        const current = await architecture.diagram(draft.itemId);
        const code = current.code
          ? `${current.code}\n%% Reviewed by ${ARCHITECT_AGENT.name}: ${P('suggested changes')}`
          : [
            'C4Container',
            `title Container view · ${spec.title}`,
            'Container(customerApp, "Customer app", "React", "Web + mobile")',
            'Container(gateway, "API gateway", "", "Auth · rate limits")',
            `Container(service, "${spec.title.replace(/"/g, "'")} API", "Node 22", "${P('responsibilities from the spec')}", $tags="new")`,
            `ContainerDb(store, "${spec.title.replace(/"/g, "'")} store", "Postgres", "${P('what it keeps')}", $tags="new")`,
            'Rel(customerApp, gateway, "HTTPS · JSON")',
            'Rel(gateway, service, "HTTPS · JSON")',
            'Rel(service, store, "SQL")',
          ].join('\n');
        return { costUsd: 1.95, output: { code } };
      },
      async apply(draft, output) {
        try {
          const saved = await architecture.saveDiagram(draft.itemId, { code: output.code, changeNote: 'Drafted the container view' }, draft.teammate, {
            ifMatch: `"${draft.itemId}.diagram@${draft.baseVersion}"`,
            provenance: { agent: draft.teammate, text: `Generated by ${draft.teammate.name} (Architect agent) from ${draft.itemId} and the existing services in Knowledge.` },
          });
          return { version: saved.version, text: 'Drafted the container view', ref: { itemId: draft.itemId } };
        } catch (err) {
          throw stale(draft.itemId, err);
        }
      },
    },
    adr: {
      stage: 'architecture', label: 'a decision (ADR)', workType: 'architecture-drafting', agent: ARCHITECT_AGENT, estimateUsd: 1.95, doneEvent: 'adr.drafted',
      async check(itemId) {
        const spec = await specFor(itemId);
        return { baseVersion: null, title: spec.title };
      },
      async mock(draft) {
        const d = await architecture.diagram(draft.itemId);
        const decisions = await architecture.adrs(draft.itemId);
        const open = d.nodes.filter(isDependency).find((n) => !decisions.some((a) => a.dependency === n.id));
        return {
          costUsd: 1.95,
          output: open
            ? { title: `Use ${open.label} (${open.tech || open.kind})`, addsDependency: true, dependency: open.id, context: P(`why ${draft.itemId} needs ${open.label}`), decision: `Add ${open.label}${open.tech ? ` on ${open.tech}` : ''}.`, consequences: P('operating cost, failure modes, who runs it'), alternative: P('the alternative considered') }
            : { title: draft.brief ?? P('the decision'), addsDependency: false, context: P('context'), decision: P('decision'), consequences: P('consequences') },
        };
      },
      async apply(draft, output) {
        const adr = await architecture.proposeAdr(draft.itemId, output, draft.teammate);
        return { version: null, text: `Proposed ${adr.id}: ${adr.title}`, ref: { adrId: adr.id } };
      },
    },
  };
}

