// Adaptive Cards for the NooblyJS Teams bot (tech.md §7.3). Each card is a YAML template in ./cards, filled from data
// and sent as JSON. A template is plain Adaptive Card 1.5 with three additions that are resolved here:
//   "{path}" in a string     replaced with that value from the data (dotted paths; a missing value is empty)
//   $each: path, $do: {…}    in a list: one copy of $do per element, each filled from that element (and the outer data)
//   $if: path                on an object: left out when the value is missing, false or an empty list
//
// Rule: an action that decides anything is Action.OpenUrl into NooblyJS. Action.Submit only ever carries
// { noobly: 'add' | 'choose-someone-else' }, which choose who is in the chat. A test checks every template.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const CARD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cards');
export const CARD_NAMES = ['pick-teammate', 'teammate-joined', 'teammate-says', 'answer', 'approval-waiting'];
export const ADAPTIVE_CARD = 'application/vnd.microsoft.card.adaptive';
/** The only things a card's Action.Submit may ask the bot to do. */
export const SUBMIT_ACTIONS = ['add', 'choose-someone-else'];

const lookup = (data, key) => key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), data);
const present = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

function fill(node, data) {
  if (typeof node === 'string') return node.replace(/\{([\w.]+)\}/g, (m, key) => { const v = lookup(data, key); return v == null ? '' : String(v); });
  if (Array.isArray(node)) {
    const out = [];
    for (const child of node) {
      if (child && typeof child === 'object' && '$each' in child) {
        for (const element of lookup(data, child.$each) ?? []) out.push(fill(child.$do, { ...data, ...element }));
      } else if (!(child && typeof child === 'object' && '$if' in child) || present(lookup(data, child.$if))) {
        out.push(fill(child, data));
      }
    }
    return out;
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$if') continue;
      if (value && typeof value === 'object' && !Array.isArray(value) && '$if' in value && !present(lookup(data, value.$if))) continue;
      out[key] = fill(value, data);
    }
    return out;
  }
  return node;
}

export async function loadCards(dir = CARD_DIR) {
  const templates = new Map();
  for (const name of CARD_NAMES) templates.set(name, yaml.load(await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8'), { schema: yaml.CORE_SCHEMA }));
  return {
    templates,
    /** The filled card, as the attachment a message activity carries. */
    attachment(name, data) {
      const template = templates.get(name);
      if (!template) throw new Error(`There is no card template "${name}".`);
      return { contentType: ADAPTIVE_CARD, content: fill(template, data) };
    },
  };
}

/** Every action in a card or template, wherever it sits. */
export function actionsIn(node, found = []) {
  if (Array.isArray(node)) for (const child of node) actionsIn(child, found);
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string' && node.type.startsWith('Action.')) found.push(node);
    for (const value of Object.values(node)) actionsIn(value, found);
  }
  return found;
}
