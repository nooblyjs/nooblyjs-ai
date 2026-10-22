// The product strategy as the drafting agents read it (NooblyJS Phase 25b): the vision, positioning, personas and
// competitors on the Portfolios page, each with the sections people have filled in. Empty sections are left out, and
// a document with nothing written is left out altogether.
import { splitSections } from '../util/sections.js';
import { STRATEGY_KINDS, TEMPLATE_KINDS } from './templates.js';

/** [{ kind, kindLabel, name, sections: [{ heading, text }] }], vision first. */
export async function strategyDocs(repos) {
  const docs = (await repos.strategyDocs?.list().catch(() => [])) ?? [];
  return docs
    .filter((d) => STRATEGY_KINDS.includes(d.kind))
    .map((d) => ({ kind: d.kind, kindLabel: TEMPLATE_KINDS[d.kind].label, name: d.name, sections: splitSections(d.body ?? '').filter((s) => s.text?.trim()).map((s) => ({ heading: s.heading, text: s.text.trim() })) }))
    .filter((d) => d.sections.length)
    .sort((a, b) => STRATEGY_KINDS.indexOf(a.kind) - STRATEGY_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** The same as text for a prompt, or '' when nothing is written. */
export async function strategyText(repos, max = 6000) {
  const docs = await strategyDocs(repos);
  if (!docs.length) return '';
  return docs.map((d) => `### ${d.kindLabel}: ${d.name}\n${d.sections.map((s) => `${s.heading}: ${s.text}`).join('\n')}`).join('\n\n').slice(0, max);
}
