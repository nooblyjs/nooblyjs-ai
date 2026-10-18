// What a model may put in a chat reply (tech.md §7.2). A teammate answers in text and may add one card: a list of
// facts, a draft plan or a comparison. The card arrives as a fenced `noobly-card` YAML block and is rebuilt here
// field by field, so nothing the model wrote reaches the thread except text in known places.
//
// A model can't produce an approval card or an "Apply to spec" action: those come only from scripts.yaml, and
// answering them is a person's action either way (services/chat.js).
import yaml from 'js-yaml';

const MAX_ROWS = 12;
const MAX_COLUMNS = 4;
const BLOCK = /```noobly-card[^\n]*\n([\s\S]*?)```/g;

const text = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

const BUILD = {
  facts(card) {
    const rows = list(card.rows, MAX_ROWS).map((r) => ({ label: text(r?.label, 60), value: text(r?.value, 200) })).filter((r) => r.label && r.value);
    return rows.length ? { type: 'facts', rows } : null;
  },
  plan(card) {
    const steps = list(card.steps, MAX_ROWS).map((s) => text(s, 300)).filter(Boolean);
    return steps.length ? { type: 'plan', steps } : null;
  },
  comparison(card) {
    const columns = list(card.columns, MAX_COLUMNS).map((c) => text(c, 60)).filter(Boolean);
    const rows = list(card.rows, MAX_ROWS)
      .map((r) => ({ label: text(r?.label, 60), values: list(r?.values, columns.length).map((v) => text(v, 200)) }))
      .filter((r) => r.label && r.values.length === columns.length);
    return columns.length >= 2 && rows.length ? { type: 'comparison', columns, rows } : null;
  },
};

/** How a teammate is told to answer in a thread. It goes into the task's context. */
export const REPLY_RULES = [
  'You are answering in an NooblyJS team chat thread, next to the work. Answer the person who mentioned you.',
  'Keep it short: a few sentences, plain text. Say what you know from the context given, and say so when you do not know.',
  'Never invent numbers, dates, people or sources. Use "[PLACEHOLDER: what is missing]" for a fact you do not have.',
  'You draft and advise. You cannot approve, change a status, merge or grant access, and you must not say that you did.',
  'When a short table helps, end with ONE fenced block like this (types: facts, plan, comparison):',
  '```noobly-card',
  'type: facts',
  'title: PRD-031 · status',
  'rows:',
  '  - { label: Stage, value: Architect }',
  '```',
  'A plan card has `steps` (a list of sentences). A comparison card has `columns` (2 to 4 names) and `rows` of { label, values }.',
].join('\n');

/**
 * Splits a model's answer into the text and the cards it may carry. An `noobly-card` block that isn't one of the
 * three types, or doesn't parse, is dropped; it is never repaired. The text is kept either way.
 */
export function readReply(output, { maxText = 4000 } = {}) {
  const raw = typeof output === 'string' ? output : '';
  const cards = [];
  for (const [, body] of raw.matchAll(BLOCK)) {
    if (cards.length) break; // one card per reply
    let card;
    try {
      card = yaml.load(body, { schema: yaml.CORE_SCHEMA });
    } catch {
      continue;
    }
    if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
    const built = BUILD[card.type]?.(card);
    const title = text(card.title, 120);
    if (built && title) cards.push({ ...built, title });
  }
  const said = raw.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxText);
  return { text: said || cards[0]?.title || 'I have no answer for that.', cards };
}
