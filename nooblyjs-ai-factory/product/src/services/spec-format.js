// A spec's body is Markdown that people can read and edit in the file: one `## ` section per part. This reads it
// into the parts the Spec screen shows, and writes them back (P2). Sections it doesn't know are kept as they are.
import { toTable, parseTable } from '../util/md-table.js';

export const GOAL_COLUMNS = [
  { key: 'measure', label: 'Measure' },
  { key: 'today', label: 'Today' },
  { key: 'target', label: 'Target' },
];

const KNOWN = {
  problem: 'Problem',
  goals: 'Goals',
  stories: 'User stories',
  acceptanceCriteria: 'Acceptance criteria',
  outOfScope: 'Out of scope',
  rolloutPlan: 'Rollout plan',
};
const KEY_FOR = new Map(Object.entries(KNOWN).map(([key, heading]) => [heading.toLowerCase(), key]));
const CRITERION = /^\*\*given\*\*\s+(.+?),?\s+\*\*when\*\*\s+(.+?),?\s+\*\*then\*\*\s+(.+?)$/i;

const listItems = (text) => text.split(/\r?\n/).filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());

/** Splits a body into its `## ` sections, in order. Text before the first heading is the section ''. */
function sections(body) {
  const out = [];
  let current = { heading: '', lines: [] };
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      out.push(current);
      current = { heading: match[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  out.push(current);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() })).filter((s) => s.heading || s.text);
}

/**
 * @returns {{ problem: string, goals: object[], stories: string[], acceptanceCriteria: object[], outOfScope: string,
 *   rolloutPlan: string, other: { heading: string, text: string }[] }}
 *   Each criterion is { given, when, then }, or { text } when it isn't written as given/when/then.
 */
export function parseSpec(body) {
  const spec = { problem: '', goals: [], stories: [], acceptanceCriteria: [], outOfScope: '', rolloutPlan: '', other: [] };
  for (const { heading, text } of sections(body)) {
    const key = KEY_FOR.get(heading.toLowerCase());
    if (key === 'goals') spec.goals = parseTable(text, GOAL_COLUMNS);
    else if (key === 'stories') spec.stories = listItems(text);
    else if (key === 'acceptanceCriteria') {
      spec.acceptanceCriteria = listItems(text).map((item) => {
        const match = CRITERION.exec(item);
        return match ? { given: match[1], when: match[2], then: match[3] } : { text: item };
      });
    } else if (key) spec[key] = text;
    else spec.other.push({ heading, text });
  }
  return spec;
}

/** Writes the parts back as Markdown, in the order of the Spec screen. Empty parts are left out. */
export function renderSpec(spec) {
  const parts = [];
  const add = (heading, text) => text && parts.push(`## ${heading}\n\n${text}`);
  add(KNOWN.problem, spec.problem?.trim());
  if (spec.goals?.length) add(KNOWN.goals, toTable(GOAL_COLUMNS, spec.goals));
  if (spec.stories?.length) add(KNOWN.stories, spec.stories.map((s) => `- ${s}`).join('\n'));
  if (spec.acceptanceCriteria?.length) {
    add(KNOWN.acceptanceCriteria, spec.acceptanceCriteria
      .map((c) => (c.given ? `- **Given** ${c.given}, **when** ${c.when}, **then** ${c.then}` : `- ${c.text}`))
      .join('\n'));
  }
  add(KNOWN.outOfScope, spec.outOfScope?.trim());
  add(KNOWN.rolloutPlan, spec.rolloutPlan?.trim());
  for (const s of spec.other ?? []) add(s.heading, s.text);
  return parts.join('\n\n');
}
