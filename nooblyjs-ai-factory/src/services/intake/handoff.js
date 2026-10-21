// @ts-check
// NooblyJS Phase 7: THE HANDOFF INTAKE. In NooblyJS, a person approves the UI → Software Factory
// handoff, and the lifecycle engine creates the work items ({ id, repo, title }). This is
// where each work item becomes the factory's own things: an issue, and a queued run.
//
//   handoff.created { handoffId, itemId, workItemIds }
//     for each work item:
//       its repo is in repos.yaml?            no  → intake.waiting (nothing starts; the factory never guesses a repository)
//       NooblyJS Platform allows it?              no  → intake.waiting (agents may not open PRs there, or the budget is reached)
//       a script for it, or a model?          no  → intake.waiting (there is nobody to do the work)
//       submitJob(…, { key })                 the key makes a second delivery of the same handoff a no-op
//
// A run started here carries what it is for in NooblyJS (request.noobly): the lifecycle item, the
// work item, the handoff, the item's quality attributes and (Phase 16e) the test cases it must automate, which its
// pull request's evidence looks for (src/services/pull-requests/evidence.js). Hosted runs never merge
// (stations/merge.js), and unsandboxed commands are allowed only when the host says this
// is development.
//
// NooblyJS Phase 19: startWork() takes in one work item from another app the same way (Security's "Draft a fix as a
// PR"); its run carries the finding it fixes (request.noobly.findingId), so Security can close it on a passing scan.
import fs from 'node:fs';
import path from 'node:path';
import { loadFactoryConfig } from '../../config/factory-config.js';
import { loadReposMap } from '../../config/repos-map.js';
import { factoryHome } from '../../utils/paths.js';
import { slugify } from '../../utils/ids.js';
import { submitJob } from '../job/run-job.js';

const clip = (text, max) => { const s = String(text ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/** Is a model there to do the work when a work item has no script? (The mock is not a worker.) */
export function modelConfigured(env = process.env) {
  if (String(env.AI_PROVIDER ?? '').toLowerCase() === 'mock') return false;
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

/** Where the scripted agent for a work item would be: <home>/scripts/<slug of its title>.json */
export const scriptFor = (env, title) => path.join(factoryHome(env), 'scripts', `${slugify(title)}.json`);

/**
 * @param {{ store: import('../../models/store/events.js').Store, env: NodeJS.ProcessEnv, host: any, development?: boolean, log?: any, workContext?: ((itemId: string, repo: string) => Promise<string[]>) | null, testCases?: ((itemId: string, repo: string) => Promise<Array<{ id: string, title: string, level: string, automate: boolean }>>) | null }} options
 *   workContext: what a work item carries besides its spec (Phase 16d: its architecture and test cases), as lines
 *   testCases: the test cases that run against the work item's repository (Phase 16e), carried by the run
 */
export function createIntake({ store, env, host, development = false, log = console, workContext = null, testCases = null }) {
  const home = factoryHome(env);

  function wait(handoff, workItem, reason) {
    const e = store.append('system', 'intake.waiting', {
      handoffId: handoff.id, nooblyItemId: handoff.itemId, workItemId: workItem.id, title: workItem.title, repoName: workItem.repo, reason,
    }, { key: `handoff:${handoff.id}:${workItem.id}:waiting` });
    if (e) log.info?.(`factory intake: ${workItem.id} waits (${reason})`);
    return { workItemId: workItem.id, waiting: reason };
  }

  /** The work item as an issue file the factory's local forge files, with where it came from. */
  function issueFile(handoff, workItem, spec, knowledge = [], context = []) {
    const file = path.join(home, 'intake', handoff.id, `${workItem.id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [
      '---', `title: ${JSON.stringify(workItem.title)}`, 'labels: [noobly]', '---',
      `Work item ${workItem.id} for ${handoff.itemId}${spec?.title ? ` · ${spec.title}` : ''}, handed over from UI design in NooblyJS.`,
      '',
      `Repository: ${workItem.repo}`,
    ];
    if (spec?.summary) lines.push('', 'From the spec:', '', clip(spec.summary, 4000));
    // Knowledge the architect linked (NooblyJS Architecture · Knowledge): what each is for, where it is, and its text.
    if (knowledge.length) {
      lines.push('', 'Knowledge to use (linked in NooblyJS Architecture):');
      for (const k of knowledge) {
        lines.push('', `## ${k.title ?? k.path}${k.note ? ` — ${k.note}` : ''}`, `Where: [${k.space}]\\${String(k.path).split('/').join('\\')} (${k.kind})`);
        if (k.readable === false) lines.push('(Could not be read when this work item was made: it may have moved.)');
        else if (k.text) lines.push('', clip(k.text, 8000));
      }
    }
    // Phase 16d: the story's application architecture of this repository's system, and the test cases to automate.
    if (context.length) lines.push('', ...context);
    // Phase 19: what a work item from another app (a finding to fix) asks for, in its words.
    if (workItem.brief) lines.push('', 'What to do:', '', clip(workItem.brief, 8000));
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  }

  /**
   * Turn a handoff's work items into runs. Safe to call again for the same handoff.
   * @param {{ handoffId: string }} payload  the handoff.created event's payload
   * @returns {Promise<Array<{ workItemId: string, runId?: string | null, waiting?: string }>>}
   */
  async function onHandoff({ handoffId } = /** @type {any} */ ({})) {
    const handoff = await host.service?.('workflows')?.handoffOf?.({ handoffId });
    return takeIn(handoff);
  }

  /**
   * NooblyJS Phase 19: one work item that isn't from a handoff (Security's "Draft a fix as a PR"), taken in the same way:
   * the same repository map, the same Platform check, a script by its title or a model. Once per work item id.
   * @param {{ itemId?: string|null, workItemId: string, title: string, repo: string, brief?: string, findingId?: string|null }} input
   */
  async function startWork({ itemId = null, workItemId, title, repo, brief = '', findingId = null } = /** @type {any} */ ({})) {
    if (!workItemId || !title || !repo) throw new Error('startWork needs a work item id, a title and a repository');
    const [out] = await takeIn({ id: `work-${slugify(workItemId, 40)}`, itemId, workItems: [{ id: workItemId, title, repo, brief, findingId }], repositories: [] });
    return out ?? { workItemId, waiting: 'nothing was started' };
  }

  async function takeIn(handoff) {
    if (!handoff?.workItems?.length) return [];
    const repos = loadReposMap(env);
    // The operator's config may ask for agent merges (autonomy L3). Hosted in NooblyJS that is refused, and said so.
    const asked = String(/** @type {any} */ (loadFactoryConfig(env)).autonomy ?? '').toUpperCase();
    const product = host.service?.('product');
    const attributes = (await Promise.resolve(product?.gatesFor?.(handoff.itemId)).catch(() => [])) ?? [];
    const artefacts = await Promise.resolve(product?.artefactsFor?.(handoff.itemId)).catch(() => null);
    const spec = artefacts?.spec ? { title: artefacts.spec.title ?? artefacts.title, summary: artefacts.spec.problem ?? artefacts.spec.summary ?? null } : null;
    // The knowledge the architect linked, read from the Knowledge Repository once for all the handoff's work items.
    const links = artefacts?.architecture?.knowledge ?? [];
    const knowledge = links.length ? await Promise.resolve(host.service?.('knowledge')?.contextOf?.(links, { maxChars: 24000 })).catch(() => null) ?? links.map((l) => ({ ...l, readable: false })) : [];
    const out = [];
    for (const workItem of handoff.workItems) {
      const key = `handoff:${handoff.id}:${workItem.id}`;
      if (store.hasKey(key)) { out.push({ workItemId: workItem.id, runId: null }); continue; } // already a run
      // A work item names its repository in full ("acme/nooblyjs-ai-harness") when the item has a list of them
      // (NooblyJS Phase 11), or by its short name. repos.yaml is keyed by the short name.
      const short = String(workItem.repo).split('/').pop();
      const where = handoff.repositories ?? [];
      if (where.length && !where.some((r) => r === workItem.repo || r.split('/').pop() === short)) {
        out.push(wait(handoff, workItem, `"${workItem.repo}" is not one of the item's repositories (${where.join(', ')})`));
        continue;
      }
      const repo = repos[short];
      if (!repo) { out.push(wait(handoff, workItem, `no repository is set up for "${short}"`)); continue; }
      // NooblyJS Platform decides whether agents may open pull requests on this repository, and whether the Software
      // Factory's budget allows new work (NooblyJS Phase 9). It records its own refusal in the audit log.
      const platform = host.service?.('platform');
      let fromBitbucket = false;
      if (platform?.checkAgentWork) {
        const check = await platform.checkAgentWork({ system: 'factory', workType: 'implementation', repo: workItem.repo, needs: 'openPrs', itemId: handoff.itemId, teammateId: 'factory' });
        if (!check.ok) { out.push(wait(handoff, workItem, check.message)); continue; }
        // A repository NooblyJS imported from Bitbucket (NooblyJS Phase 13): its branch and pull request go to Bitbucket,
        // through NooblyJS's write gate. Any other repository keeps the local forge.
        fromBitbucket = check.repository?.source === 'bitbucket' && typeof host.service?.('devtools')?.forge?.pushBranch === 'function';
      }
      const script = scriptFor(env, workItem.title);
      const hasScript = fs.existsSync(script);
      if (!hasScript && !modelConfigured(env)) { out.push(wait(handoff, workItem, 'no model is configured, and there is no script for this work item')); continue; }
      const context = workContext ? await workContext(handoff.itemId, workItem.repo).catch(() => []) : [];
      const cases = testCases ? await testCases(handoff.itemId, workItem.repo).catch(() => []) : [];
      const runId = submitJob(store, {
        issueFile: issueFile(handoff, workItem, spec, knowledge, context),
        repo,
        line: 'default',
        autonomy: 'L2', // no plan approval for a small item; never L3: hosted runs don't merge
        driver: 'in-process',
        allowUnsandboxed: development === true,
        agent: hasScript ? { script } : {},
        ...(fromBitbucket ? { forge: { kind: 'bitbucket', name: short } } : {}),
        noobly: { itemId: handoff.itemId, workItemId: workItem.id, handoffId: handoff.id, repoName: workItem.repo, attributes, ...(cases.length ? { testCases: cases } : {}), ...(workItem.findingId ? { findingId: workItem.findingId } : {}) },
      }, { key });
      if (runId) log.info?.(`factory intake: ${workItem.id} "${workItem.title}" → run ${runId} on ${workItem.repo}`);
      if (runId && asked === 'L3') {
        store.append(`run:${runId}`, 'merge.refused', { runId, autonomy: 'L3', reason: 'autonomy L3 (agent merges) is configured, but hosted in NooblyJS an agent never merges: the run stops at a ready PR and a person merges' }, { key: `${key}:merge-refused` });
      }
      out.push({ workItemId: workItem.id, runId });
    }
    return out;
  }

  /**
   * Work items that started nothing, and why. One NooblyJS item's, or all of them.
   * @param {string} [nooblyItemId]
   */
  function waiting(nooblyItemId) {
    return store.read({ types: ['intake.waiting'] })
      .map((e) => e.data)
      .filter((w) => (!nooblyItemId || w.nooblyItemId === nooblyItemId) && !store.hasKey(`handoff:${w.handoffId}:${w.workItemId}`))
      .map((w) => ({ workItemId: w.workItemId, handoffId: w.handoffId, itemId: w.nooblyItemId, title: w.title, repo: w.repoName, reason: w.reason }));
  }

  /** Try the waiting work items again (at start: a repository may have been set up since). */
  async function retryWaiting() {
    for (const handoffId of new Set(waiting().map((w) => w.handoffId))) await onHandoff({ handoffId });
  }

  return { onHandoff, startWork, waiting, retryWaiting };
}
