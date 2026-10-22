// The templates a portfolio's and a value stream's documents start from (Product Factory · Settings, product.md §5.8).
// A template is Markdown kept in data/product/templates/<kind>.md: each `## Heading` is a section of the document, and
// the text under a heading is the hint shown next to that section while a person fills it in (it is not copied into
// the document). A new portfolio or value stream gets the template's headings, empty. Changing a template changes
// what every document of that kind shows: a section the template gained shows empty, and a section it lost stays in
// the documents that have text in it, marked as no longer in the template.
//
// Anyone signed in reads a template; changing one takes `approve`, and only a person (an agent never changes one).
import { splitSections } from '../util/sections.js';
import { checkIfMatch, etagOf, isAgent } from '../util/http.js';
import { HttpError, notFound } from '../util/errors.js';

/** The templates there are, and what each starts as before anyone changes it. */
export const TEMPLATE_KINDS = {
  portfolio: {
    label: 'Portfolio',
    sections: [
      ['Key Partners', 'Who the portfolio relies on to deliver: suppliers, partners, other portfolios.'],
      ['Key Activities', 'What the portfolio must do well for its value streams to work.'],
      ['Key Resources', 'The people, platforms, data and assets it needs.'],
      ['Cost Structure', 'Where the money goes: the biggest costs and what drives them.'],
      ['Revenue Streams', 'How the portfolio earns, or the value it returns to the business.'],
    ],
  },
  'value-stream': {
    label: 'Value stream',
    sections: [
      ['Description', 'What this value stream is, in a few sentences.'],
      ['Value Stream Vision', 'Where it is going: the future state it works towards.'],
      ['Customer Segments', 'Who it serves.'],
      ['Channels', 'How those customers are reached: app, web, stores, partners.'],
      ['Customer Relationship', 'The relationship each segment expects.'],
      ['KPIs or Revenue', 'How success is measured: the KPIs it moves, or the revenue it earns.'],
      ['Solution Context', 'The systems, products and constraints it works within.'],
      ['Economic Framework', 'How spend is decided: budget, guardrails, who decides.'],
      ['People and Locations', 'The teams and where they are.'],
      ['Attachments', 'Links to supporting documents: decks, canvases, reports.'],
    ],
  },
  // NooblyJS Phase 17: the work hierarchy's documents (hierarchy.js). A business case is kept on its own (business-cases.js).
  'portfolio-epic': {
    label: 'Portfolio epic',
    sections: [
      ['Outcome', 'The business outcome it aims for, in a sentence or two.'],
      ['Leading indicators', 'The early measures that show it is working.'],
      ['In scope', 'What it covers.'],
      ['Out of scope', 'What it leaves out.'],
    ],
  },
  epic: {
    label: 'Epic',
    sections: [
      ['Summary', 'What the epic delivers, and for whom.'],
      ['Outcome', 'The measure it should move.'],
      ['Non-functional requirements', 'Performance, availability, security and accessibility it must keep.'],
      ['Dependencies', 'Other epics, teams or systems it relies on.'],
    ],
  },
  feature: {
    label: 'Feature',
    sections: [
      ['Description', 'What a customer or colleague can do once it exists.'],
      ['Benefit hypothesis', 'What we believe it will change, and how we will know.'],
      ['Acceptance criteria', 'Given, when, then: how a person checks it is done.'],
      ['Dependencies', 'What it needs first.'],
    ],
  },
  // NooblyJS Phase 25b: the strategy documents (Portfolios page), which the drafting agents read.
  vision: {
    label: 'Vision',
    sections: [
      ['Vision', 'Where the products are going, in a sentence or two.'],
      ['Who it is for', 'The customers and colleagues it serves.'],
      ['What changes for them', 'What is different for them when it is true.'],
      ['How we will know', 'The few measures that say it is happening.'],
    ],
  },
  positioning: {
    label: 'Positioning',
    sections: [
      ['For', 'The target customer.'],
      ['Who', 'Their need or opportunity.'],
      ['Our product is', 'The category it belongs in.'],
      ['That', 'The key benefit: the reason to choose it.'],
      ['Unlike', 'The main alternative.'],
      ['We', 'How we are different.'],
    ],
  },
  persona: {
    label: 'Persona',
    sections: [
      ['Who they are', 'A short description: role, situation, context.'],
      ['Goals', 'What they are trying to get done.'],
      ['Frustrations', 'What gets in their way today.'],
      ['How they shop', 'Channels, times, habits.'],
      ['Quotes', 'Things they have said (from feedback or research).'],
    ],
  },
  competitor: {
    label: 'Competitor',
    sections: [
      ['Who they are', 'The company and its offer.'],
      ['Strengths', 'What they do well.'],
      ['Weaknesses', 'Where they fall short.'],
      ['How we compare', 'Where we win and where we lose.'],
    ],
  },
};
/** NooblyJS Phase 25b: the kinds of strategy document. */
export const STRATEGY_KINDS = ['vision', 'positioning', 'persona', 'competitor'];

const MAX_BODY = 20000;
const MAX_SECTIONS = 30;
const MAX_HEADING = 80;

/** The built-in body of a template: each section's heading with its hint under it. */
export const defaultTemplateBody = (kind) => TEMPLATE_KINDS[kind].sections.map(([heading, hint]) => `## ${heading}\n\n${hint}`).join('\n\n');

/** The sections of a template body, each { heading, hint }. */
export const templateSections = (body) => splitSections(body).map((s) => ({ heading: s.heading, hint: s.text }));

/** Checks a template body a person sent. Returns it tidied, or throws 422 saying what to fix. */
function checkBody(value) {
  const bad = (message) => new HttpError(422, 'invalid', message, { body: message });
  if (typeof value !== 'string') throw bad('The template is Markdown text.');
  const body = value.replace(/\r\n/g, '\n').trim();
  if (body.length > MAX_BODY) throw bad(`A template is at most ${MAX_BODY.toLocaleString('en-US')} characters.`);
  if (!/^##\s+\S/.test(body)) throw bad('Start the template with a "## " heading: each heading is a section of the document.');
  const sections = templateSections(body);
  if (sections.length > MAX_SECTIONS) throw bad(`A template has at most ${MAX_SECTIONS} sections.`);
  const seen = new Set();
  for (const { heading } of sections) {
    if (heading.length > MAX_HEADING) throw bad(`"${heading.slice(0, 40)}…" is too long for a heading (at most ${MAX_HEADING} characters).`);
    if (seen.has(heading.toLowerCase())) throw bad(`"${heading}" is in the template twice. Each heading names one section.`);
    seen.add(heading.toLowerCase());
  }
  return body;
}

export function createTemplates({ repos, host }) {
  const now = () => new Date().toISOString();
  const kindOf = (kind) => {
    if (!Object.hasOwn(TEMPLATE_KINDS, kind)) throw notFound(`There is no "${kind}" template. There are: ${Object.keys(TEMPLATE_KINDS).join(', ')}.`);
    return TEMPLATE_KINDS[kind];
  };

  /** The template as stored, or the built-in one (version 1) when nobody has written it yet. */
  async function get(kind) {
    const known = kindOf(kind);
    const stored = await repos.templates.get(kind);
    if (stored) return { ...stored, id: kind, kind, version: Number(stored.version) || 1 };
    return { id: kind, kind, title: known.label, version: 1, updatedAt: null, updatedBy: null, body: defaultTemplateBody(kind), builtIn: true };
  }

  /** The template as Settings shows it. `ctx.people` (views.js) names who changed it. */
  async function view(kind, ctx = null) {
    const t = await get(kind);
    const by = t.updatedBy ? ctx?.people?.get(t.updatedBy)?.name ?? t.updatedBy : null;
    return {
      kind,
      label: TEMPLATE_KINDS[kind].label,
      version: t.version,
      etag: etagOf(t),
      body: t.body ?? '',
      sections: templateSections(t.body),
      updatedAt: t.updatedAt ?? null,
      updatedBy: by,
      text: t.builtIn ? 'The starting template. Nobody has changed it yet.' : `Version ${t.version}${by ? ` · changed by ${by}` : ''}`,
    };
  }

  const list = (ctx) => Promise.all(Object.keys(TEMPLATE_KINDS).map((kind) => view(kind, ctx)));

  /** A person changes a template: a new version, with If-Match. Documents made from it keep their text. */
  async function set(kind, body, actor, { ifMatch } = {}) {
    kindOf(kind);
    if (isAgent(actor)) throw new HttpError(403, 'people_only', 'Agents propose and people decide: an agent can\'t change a template.');
    const clean = checkBody(body);
    const saved = await repos.templates.update(kind, async (current) => {
      const before = current ? { ...current, id: kind, version: Number(current.version) || 1 } : await get(kind);
      checkIfMatch(ifMatch, before);
      return { kind, title: TEMPLATE_KINDS[kind].label, version: before.version + 1, updatedAt: now(), updatedBy: actor.id, body: clean };
    });
    await host.events.emit('settings.template_updated', { system: 'product', template: kind, version: saved.version, summary: `changed the ${TEMPLATE_KINDS[kind].label.toLowerCase()} template (version ${saved.version})` }, { actor: actor.id });
    return saved;
  }

  return { get, view, list, set };
}
