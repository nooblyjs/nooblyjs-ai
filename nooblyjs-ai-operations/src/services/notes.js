// RELEASE NOTES (root product.md §3.7), drafted by the release agent as a teammate task (Digital Teammates: every agent
// action is one). With no model configured the task plays the scripted draft below: what the feature does, from its
// stories, what the evidence says, and the risks accepted. A person reads them with the evidence before approving.
import { HttpError } from '../util/errors.js';

const STANDIN = { id: 'pip-okafor', name: 'Pip Okafor' };

/** The scripted draft: plain words from the feature, its stories and the evidence pack. */
export function scriptedNotes({ name, version, feature, pack }) {
  const lines = [
    `${name} (${version}) releases ${feature.title}.`,
    '',
    'What changes:',
    ...feature.stories.filter((st) => st.status === 'active').map((st) => `- ${st.title} (${st.ref})`),
    '',
    `Evidence: ${pack.text}.`,
  ];
  if (pack.findings.accepted.length) lines.push('', 'Accepted risks:', ...pack.findings.accepted.map((f) => `- ${f.id} (${f.severityLabel}): ${f.title}${f.acceptedUntil ? `, accepted until ${String(f.acceptedUntil).slice(0, 10)}` : ''}`));
  return lines.join('\n');
}

export function createNotes({ host, policies }) {
  async function agentFor() {
    const t = host.service?.('teammates');
    const wanted = (await policies.read()).agent?.teammates ?? [STANDIN.id];
    if (typeof t?.runTask !== 'function') {
      if (process.env.NODE_ENV === 'production') throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft release notes.');
      return { agent: { ...STANDIN, kind: 'agent' }, t: null };
    }
    const roster = (await Promise.resolve(t.roster?.()).catch(() => [])) ?? [];
    for (const slug of wanted) {
      const who = roster.find((a) => a.id === slug);
      const can = typeof t.availability === 'function' ? await t.availability(slug).catch(() => ({ ok: false })) : { ok: Boolean(who) };
      if (can.ok) return { agent: { id: slug, name: who?.name ?? slug, kind: 'agent' }, t };
    }
    return { agent: { ...STANDIN, kind: 'agent' }, t: null, why: 'no release agent could take work, so the scripted draft is used' };
  }

  /** The release agent's draft of the notes. */
  async function draft({ itemId, name, version, feature, pack, person }) {
    const scripted = scriptedNotes({ name, version, feature, pack });
    const { agent, t, why } = await agentFor();
    let text = scripted;
    if (t) {
      const result = await t.runTask({
        slug: agent.id, workType: 'release-notes', itemId, system: 'operations',
        caller: person?.id ? { type: 'user', id: person.id, name: person.name ?? person.id } : null,
        input: { task: `Write the release notes of ${name} (${version}): what changes for customers and staff, from the feature and its stories, in plain words, then the evidence and any accepted risk.`, context: JSON.stringify({ feature, evidence: pack.text, accepted: pack.findings.accepted }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      if (!result.scripted && typeof result.output === 'string' && result.output.trim()) text = result.output.trim().slice(0, 8000);
    }
    return { text, draftedBy: agent, at: new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString(), ...(why ? { why } : {}) };
  }

  return { draft };
}
