// @ts-check
// Phase 16d: THE CODE MAP and the scripted application architecture. Pure functions: what a repository's JavaScript and
// TypeScript modules export (with their parameters) and import, and, from that and the story's design, the draft an
// agent would make with no model configured: the application flow, the objects the story touches, the NFRs per
// component and the changes it proposes. A model's draft has the same shape (architecture.js reads it).
//
// It is a reading of the code, not a guess about it: every module and export it names is one it found. Where it found
// none that concerns the story, it proposes a new module next to the existing ones, and says so.

const STOP = new Set(['that', 'with', 'this', 'from', 'they', 'their', 'them', 'have', 'which', 'when', 'then', 'what', 'into', 'still', 'before', 'after', 'while', 'there', 'will', 'within', 'given', 'customer', 'customers', 'must', 'part', 'does', 'changes', 'business', 'requirements', 'below', 'nfrs', 'index', 'main', 'test', 'tests']);
/** The words of a name or a sentence: camelCase and kebab-case split, four letters or more, a plural s dropped. */
export function wordsOf(text) {
  return new Set(String(text ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '')));
}

const isTest = (file) => /(^|\/)(test|tests|__tests__|spec)\//.test(file) || /\.(test|spec)\.[mc]?[jt]s$/.test(file);
const params = (list) => String(list ?? '').split(',').map((p) => p.replace(/=.*$/, '').replace(/[{}[\]\s.]/g, '').trim()).filter(Boolean);

/**
 * The modules of a repository from its sources ({ path: text }): each module's exports and its relative imports.
 * @param {Record<string, string>} sources
 */
export function mapModules(sources) {
  return Object.entries(sources).map(([file, text]) => {
    const exports = [];
    const add = (name, kind, list = []) => { if (name && !exports.some((e) => e.name === name)) exports.push({ name, kind, params: list }); };
    for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) add(m[1], 'function', params(m[2]));
    for (const m of text.matchAll(/export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'class');
    for (const m of text.matchAll(/export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)) add(m[1], 'function', params(m[2] ?? m[3]));
    for (const m of text.matchAll(/export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/g)) add(m[1], 'function', params(m[2]));
    for (const m of text.matchAll(/export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) add(m[1], 'value');
    for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) add(n.split(/\s+as\s+/).pop()?.trim(), 'value');
    const imports = [...text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
    return { path: file, test: isTest(file), exports, imports };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

/** formatSlot → "Slot"; holdTimerLabel → "Hold timer label"; a name that is one word stands as it is. */
function nounOf(name) {
  const parts = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  const VERBS = /^(get|set|format|make|build|create|load|read|save|show|render|find|list|parse|to|is|has|compute|calculate|check|handle|on|use|update|delete|remove|add|send|fetch)$/i;
  const rest = parts.length > 1 && VERBS.test(parts[0]) ? parts.slice(1) : parts;
  const words = rest.join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** A short module name for the story: its first three words that say something ("stores same-day capacity"). */
function moduleNameFor(title) {
  const words = String(title).toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length >= 4 && !STOP.has(w)).slice(0, 3);
  return (words.length ? words : ['story']).join('-').replace(/-+/g, '-');
}
const camel = (kebab) => kebab.split('-').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');

/**
 * The scripted application architecture of one impacted system for one story.
 * @param {object} o
 * @param {{ id: string, title: string, criteria?: string[] }} o.story
 * @param {{ name: string, repo?: string, change?: string }} o.system
 * @param {Array<{ id: string, name: string, kind: string, from: string, to: string, contract: string }>} [o.interfaces]
 * @param {Array<{ id: string, system: string, text: string }>} [o.technical]
 * @param {Array<{ id: string, category: string, requirement: string, target: string }>} [o.nfrs]
 * @param {ReturnType<typeof mapModules> | null} o.modules   null: the repository could not be read
 * @param {string[]} [o.files]   every file of the repository (for its layout)
 * @param {string} [o.unread]    why it could not be read
 */
export function draftArchitecture({ story, system, interfaces = [], technical = [], nfrs = [], modules, files = [], unread = '' }) {
  const mine = technical.filter((t) => t.system === system.name);
  const theirs = interfaces.filter((i) => i.from === system.name || i.to === system.name);
  const storyWords = wordsOf([story.title, ...(story.criteria ?? []), ...mine.map((t) => t.text)].join(' '));
  const sourceModules = (modules ?? []).filter((m) => !m.test);
  const scored = sourceModules.map((m) => {
    const names = wordsOf([m.path.replace(/\.[^.]+$/, ''), ...m.exports.map((e) => e.name)].join(' '));
    return { m, score: [...names].filter((w) => storyWords.has(w)).length };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.m.path.localeCompare(b.m.path)).slice(0, 3);
  const touched = scored.map((x) => x.m);

  // A new module for the story, next to the existing source, with its test where the repository keeps its tests.
  const name = moduleNameFor(story.title);
  const firstSource = sourceModules[0]?.path ?? '';
  const dir = firstSource.includes('/') ? firstSource.slice(0, firstSource.lastIndexOf('/') + 1) : '';
  const ext = /\.ts$/.test(firstSource) ? 'ts' : 'js';
  const testDir = files.find((f) => /^test\//.test(f)) ? 'test/' : files.find((f) => /^tests\//.test(f)) ? 'tests/' : dir;
  const entry = `${dir}${name}.${ext}`;
  const entryExport = camel(name);

  const used = touched.flatMap((m) => m.exports.filter((e) => e.kind === 'function').map((e) => ({ ...e, module: m.path })));
  const flow = [
    `The story starts in ${entry} (new): ${entryExport}() does "${story.title}" for ${system.name}.`,
    ...used.map((e) => `It uses ${e.name}(${e.params.join(', ')}) from ${e.module}.`),
    ...theirs.map((i) => (i.from === system.name
      ? `It calls ${i.to || 'the other side (not named yet)'} through ${i.id} (${i.kind}): ${i.contract}.`
      : `${i.from || 'The other side (not named yet)'} calls it through ${i.id} (${i.kind}): ${i.contract}.`)),
    ...(story.criteria ?? []).slice(0, 3).map((c) => `It meets: ${c.replace(/^Given\s+/i, 'given ')}.`),
  ];
  if (modules === null) flow.unshift(`Drawn from the design alone: ${unread || `${system.name} can't be read here`}.`);
  else if (!touched.length) flow.splice(1, 0, `No module in ${system.name} concerns this story yet; the existing ones are ${sourceModules.slice(0, 5).map((m) => m.path).join(', ') || 'none'}.`);

  const objects = [
    ...used.filter((e) => e.params.length).map((e) => ({ name: nounOf(e.name), kind: 'value', fields: e.params, note: `What ${e.name}() in ${e.module} takes` })),
    ...touched.flatMap((m) => m.exports.filter((e) => e.kind === 'class').map((e) => ({ name: e.name, kind: 'class', fields: [], note: `Exported by ${m.path}` }))),
    { name: nounOf(entryExport), kind: 'value', fields: [], note: `What ${entryExport}() answers: named when the analyst edits this` },
  ].filter((o, i, all) => all.findIndex((x) => x.name === o.name) === i);

  const componentFor = (n) => (/performance|availability|cost/.test(n.category) ? entry : /accessibility/.test(n.category) && touched[0] ? touched[0].path : entry);
  const changes = [
    { kind: 'new', path: entry, what: `${entryExport}(): "${story.title}"` },
    { kind: 'new', path: `${testDir}${name}.test.${ext}`, what: 'Its automated tests (the test analysis\'s cases for this system)' },
    ...touched.map((m, i) => ({ kind: scored[i].score >= 2 ? 'changed' : 'uses', path: m.path, what: `${m.exports.map((e) => e.name).join(', ') || 'its code'}${scored[i].score >= 2 ? ': changes for this story' : ': used as it is'}` })),
  ];
  return {
    flow,
    objects,
    nfrs: nfrs.map((n) => ({ component: componentFor(n), requirement: n.requirement, target: n.target, from: n.id })),
    changes,
    modules: (modules ?? []).map((m) => m.path),
  };
}
