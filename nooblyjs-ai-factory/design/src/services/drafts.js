// Phase 16c: the Design section's scripted drafts. Each one reads what the Product section has for the item (the spec,
// its repositories, the container view, the quality attributes) and proposes the entries a part of the design is
// missing, without ids: the design service numbers them when it adds them. With no model configured this is what the
// teammate's task plays; a model's answer has the same shape. Pure functions: nothing here reads or writes a file.

const STOP = new Set(['that', 'with', 'this', 'from', 'they', 'their', 'them', 'have', 'which', 'when', 'then', 'what', 'into', 'still', 'before', 'after', 'while', 'there', 'will', 'within', 'customer', 'customers', 'given']);
/** The words of a text that say something (four letters or more, a trailing s, ed or ing dropped). */
export const wordsOf = (text) => new Set(String(text ?? '').toLowerCase().split(/[^a-z0-9-]+/)
  .filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|s)$/, '')));
const shared = (a, b) => [...wordsOf(a)].filter((w) => wordsOf(b).has(w)).length;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// "As a customer ordering after work, I can see … so I can pick …" → role, want, why.
const STORY = /^as an? (.+?),\s*i (?:can|want to|need to|would like to) (.+?)(?:,?\s+so (?:that )?(.+?))?\.?$/i;
const theirs = (s) => s.replace(/\bI\b/g, 'they').replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them').replace(/\bI'm\b/g, 'they are');

/** A user story's parts, or { want: the story } when it isn't written "As a …, I can …". */
export function readStory(text) {
  const m = STORY.exec(String(text ?? '').trim());
  return m ? { role: m[1], want: m[2], why: m[3] ?? null } : { role: null, want: String(text ?? '').trim(), why: null };
}

/** A criterion as one line: "Given …, when …, then …". */
export const criterionText = (c) => (c?.given ? `Given ${c.given}, when ${c.when}, then ${c.then}` : String(c?.text ?? c ?? ''));

// ---------------------------------------------------------------------------- business requirements

/** One per goal and one per user story, each quoting the words of the spec it comes from. */
export function draftRequirements(inputs) {
  const { goals = [], stories = [] } = inputs.spec ?? {};
  return {
    requirements: [
      ...goals.filter((g) => g.measure).map((g) => ({
        text: sentence(`${cap(g.measure)} goes from ${g.today || '[PLACEHOLDER: today]'} to ${g.target || '[PLACEHOLDER: target]'}`),
        source: { section: 'Goals', quote: g.measure },
      })),
      ...stories.map((s) => {
        const { role, want, why } = readStory(s);
        const text = role ? `${/^[aeiou]/i.test(role) ? 'An' : 'A'} ${role} can ${theirs(want)}${why ? `, so ${theirs(why)}` : ''}` : cap(want);
        return { text: sentence(text), source: { section: 'User stories', quote: s } };
      }),
    ],
  };
}

// ---------------------------------------------------------------------------- solution architecture

// Which NFR category a quality attribute belongs to, by its words; the catalogue's categories are the keys.
const CATEGORY_WORDS = [
  ['performance', /latenc|performance|load|response|throughput|p9\d/i],
  ['availability', /availab|uptime|consisten|resilien|recover|durab|double/i],
  ['security', /secur|auth|threat|secret/i],
  ['privacy', /privacy|personal|gdpr|popia|consent/i],
  ['accessibility', /accessib|wcag|screen reader/i],
  ['cost', /cost|spend|budget|\$/i],
  ['operability', /operab|monitor|alert|observab|log/i],
];
const categoryOf = (text) => CATEGORY_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'operability';

/**
 * Impacted systems (each repository: changed when Platform has it, new when it doesn't, with its team), NFRs (one per
 * quality attribute, then the catalogue's default for every category not covered) and the feature landscape (one
 * feature per user story). `repositories` is Platform's list; `knowledgeFor(name)` the sources Knowledge has.
 */
export function draftSolution(inputs, { repositories = [], catalogue = { categories: [] }, knowledgeFor = () => [] } = {}) {
  const systems = (inputs.repositories ?? []).map((ref) => {
    const short = String(ref).split('/').pop();
    const found = repositories.find((r) => r.name === ref || r.shortName === short);
    return {
      repo: found?.name ?? ref, name: found?.shortName ?? short, change: found ? 'changed' : 'new', team: found?.team ?? null,
      note: found ? (String(found.body ?? '').split(/(?<=\.)\s/)[0] || found.stack || '') : 'Not in Platform yet: a new repository',
      knowledge: knowledgeFor(found?.shortName ?? short),
    };
  });
  const fromQa = (inputs.qualityAttributes ?? []).map((q) => ({
    category: categoryOf(`${q.attribute} ${q.scenario} ${q.target}`), requirement: `${q.attribute}: ${q.scenario}`, target: q.target,
    source: { kind: 'quality-attribute', text: `${q.attribute} · ${q.scenario}` },
  }));
  const covered = new Set(fromQa.map((n) => n.category));
  const fromCatalogue = (catalogue.categories ?? []).filter((c) => !covered.has(c.key) && c.entries?.length).map((c) => ({
    category: c.key, requirement: c.entries[0].requirement, target: c.entries[0].target,
    source: { kind: 'catalogue', text: `NFR catalogue · ${c.label} · ${c.entries[0].key}` },
  }));
  const stories = inputs.spec?.stories ?? [];
  const features = (stories.length ? stories : [inputs.title]).map((s) => {
    const { want } = readStory(s);
    return { title: cap(want.replace(/\s+so\s+.*$/i, '')).slice(0, 120), summary: s, dependsOn: [] };
  });
  return { systems, nfrs: [...fromQa, ...fromCatalogue], features };
}

// ---------------------------------------------------------------------------- functional analysis

const KIND = (rel) => (/publish|event|kafka|queue|topic/i.test(`${rel.label} ${rel.tech}`) ? 'event' : /file|sftp|csv|batch/i.test(`${rel.label} ${rel.tech}`) ? 'file' : 'api');

/**
 * Interface requirements (one per relation of the container view: its two sides, by their labels, and its contract in
 * the relation's words) and technical requirements (one per impacted system, serving every requirement and NFR).
 */
export function draftFunctional(inputs, design) {
  const label = (id) => inputs.containers?.find((c) => c.id === id)?.label ?? id;
  const interfaces = (inputs.relations ?? []).map((r) => ({
    name: `${label(r.from)} → ${label(r.to)}`, kind: KIND(r), from: label(r.from), to: label(r.to),
    contract: [r.label, r.tech].filter(Boolean).join(' · ') || '[PLACEHOLDER: contract]',
  }));
  const serves = [...(design.requirements ?? []).map((r) => r.id), ...(design.nfrs ?? []).map((n) => n.id)];
  const technical = (design.systems ?? []).filter((s) => s.change !== 'retired').map((s) => ({
    system: s.name,
    text: `${s.name} ${s.change === 'new' ? 'is built to do' : 'changes to do'} its part of ${inputs.title}: the business requirements below, within the NFRs.`,
    serves,
  }));
  return { interfaces, technical };
}

// ---------------------------------------------------------------------------- feature generation

/**
 * One story per feature that has none: tracing to the requirement drawn from its user story, each goal's requirement
 * (to the story it shares the most words with, else the first), every impacted system, interface, technical requirement
 * and NFR, and the acceptance criteria that share its words (each to one story; else the first).
 */
export function draftStories(inputs, design) {
  const features = (design.features ?? []).filter((f) => !(design.stories ?? []).some((s) => s.feature === f.id));
  if (!features.length) return { stories: [] };
  const all = design.features ?? [];
  const textOf = (f) => `${f.title} ${f.summary}`;
  const bestFeature = (text) => {
    let best = all[0];
    let score = 0;
    for (const f of all) {
      const n = shared(text, textOf(f));
      if (n > score) [best, score] = [f, n];
    }
    return best?.id;
  };
  const requirementsFor = (f) => (design.requirements ?? []).filter((r) => (r.source?.section === 'User stories' ? r.source.quote === f.summary : bestFeature(`${r.text} ${r.source?.quote ?? ''}`) === f.id)).map((r) => r.id);
  const criteria = (inputs.spec?.acceptanceCriteria ?? []).map(criterionText);
  const systems = (design.systems ?? []).filter((s) => s.change !== 'retired').map((s) => s.name);
  return {
    stories: features.map((f) => ({
      feature: f.id, title: f.title,
      requirements: requirementsFor(f),
      systems,
      interfaces: (design.interfaces ?? []).map((i) => i.id),
      technical: (design.technical ?? []).map((t) => t.id),
      nfrs: (design.nfrs ?? []).map((n) => n.id),
      criteria: criteria.filter((c) => bestFeature(c) === f.id),
    })),
  };
}
