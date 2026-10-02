// @ts-check
// Phase F08: the SHAPE of a spec, and checking it.
//
//   .factory/specs/issue-3/
//   ├── requirements.md    user stories + acceptance criteria in EARS form, with IDs
//   ├── design.md          how: components, data, decisions (free-form, but must exist)
//   └── tasks.md           what to do, in steps an agent can finish: each traced to criteria
//
// requirements.md:
//
//   ## R1: Subtract two numbers
//   As a calc user, I want to subtract numbers, so that I can compute differences.
//   - R1.1 WHEN subtract(a, b) is called with two numbers THE SYSTEM SHALL return a minus b
//   - R1.2 IF an argument is not a number THEN THE SYSTEM SHALL throw a TypeError
//
// EARS ("Easy Approach to Requirements Syntax", Mavin et al., Rolls-Royce) is a
// handful of sentence templates that make a requirement TESTABLE: a trigger or
// condition, then "THE SYSTEM SHALL" and an observable response.
//
//   ubiquitous    THE SYSTEM SHALL …
//   event         WHEN <trigger> THE SYSTEM SHALL …
//   state         WHILE <state> THE SYSTEM SHALL …
//   unwanted      IF <condition> THEN THE SYSTEM SHALL …
//   optional      WHERE <feature is included> THE SYSTEM SHALL …
//
// tasks.md:
//
//   - [ ] T1: Add subtract()
//     - Requirements: R1.1, R1.2
//     - Paths: subtract.js, test/subtract.test.js
//     - Depends on: none
//
// Checking is DETERMINISTIC: the same spec always gets the same problems.
// Problems go back to the spec-writer to fix (spec station), never guessed around.

import { coverage } from './trace.js';

const EARS = /^(?:(?:WHEN|WHILE|WHERE)\s+.+?\s+THE SYSTEM SHALL\s+\S|IF\s+.+?\s+THEN\s+THE SYSTEM SHALL\s+\S|THE SYSTEM SHALL\s+\S)/i;

/**
 * @typedef {{ id: string, text: string }} Criterion
 * @typedef {{ id: string, title: string, story: string, criteria: Criterion[] }} Requirement
 * @typedef {{ id: string, title: string, requirements: string[], paths: string[], dependsOn: string[] }} Task
 */

/** @returns {{ requirements: Requirement[], problems: string[] }} */
export function parseRequirements(md) {
  const problems = [];
  /** @type {Requirement[]} */
  const requirements = [];
  let current = null;
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    const head = line.match(/^#{2,3}\s+(R\d+)\s*[:.–-]\s*(.+)$/);
    if (head) {
      current = { id: head[1], title: head[2].trim(), story: '', criteria: [] };
      requirements.push(current);
      continue;
    }
    const crit = line.match(/^[-*]\s+(R\d+\.\d+)\s*[:.]?\s+(.+)$/);
    if (crit) {
      if (!current) problems.push(`${crit[1]} is not under a "## R<n>: …" heading`);
      else if (!crit[1].startsWith(`${current.id}.`)) problems.push(`${crit[1]} is listed under ${current.id}; criteria are numbered ${current.id}.1, ${current.id}.2, …`);
      else current.criteria.push({ id: crit[1], text: crit[2].trim() });
      continue;
    }
    if (current && !current.story && /^as an? /i.test(line)) current.story = line;
  }
  if (!requirements.length) problems.push('requirements.md has no requirements (headings like "## R1: Title")');
  const ids = new Set();
  for (const r of requirements) {
    if (ids.has(r.id)) problems.push(`${r.id} is used twice`);
    ids.add(r.id);
    if (!r.story) problems.push(`${r.id} has no user story ("As a …, I want …, so that …")`);
    if (!r.criteria.length) problems.push(`${r.id} has no acceptance criteria ("- ${r.id}.1 WHEN … THE SYSTEM SHALL …")`);
    for (const c of r.criteria) {
      if (ids.has(c.id)) problems.push(`${c.id} is used twice`);
      ids.add(c.id);
      if (!EARS.test(c.text)) problems.push(`${c.id} is not in EARS form (WHEN/WHILE/IF…THEN/WHERE … THE SYSTEM SHALL …): "${c.text.slice(0, 80)}"`);
    }
  }
  return { requirements, problems };
}

/** @returns {{ tasks: Task[], problems: string[] }} */
export function parseTasks(md) {
  const problems = [];
  /** @type {Task[]} */
  const tasks = [];
  let current = null;
  const list = (value) => value.replace(/_/g, '').split(/[,\s]+/).map((v) => v.trim()).filter((v) => v && !/^(none|-|n\/a)$/i.test(v));
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    const head = line.match(/^[-*]\s+\[[ xX]\]\s+(T\d+)\s*[:.–-]\s*(.+)$/);
    if (head) {
      current = { id: head[1], title: head[2].trim(), requirements: [], paths: [], dependsOn: [] };
      tasks.push(current);
      continue;
    }
    const field = line.match(/^[-*]?\s*_?(Requirements|Paths|Depends on)\s*:\s*(.*?)_?$/i);
    if (field && current) {
      const key = { requirements: 'requirements', paths: 'paths', 'depends on': 'dependsOn' }[field[1].toLowerCase()];
      current[key] = list(field[2]);
    }
  }
  if (!tasks.length) problems.push('tasks.md has no tasks (lines like "- [ ] T1: Title")');
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) problems.push('a task id is used twice');
  for (const t of tasks) {
    if (!t.paths.length) problems.push(`${t.id} declares no Paths (the files it may change)`);
    for (const d of t.dependsOn) if (!ids.has(d)) problems.push(`${t.id} depends on ${d}, which doesn't exist`);
  }
  const cycle = findCycle(tasks);
  if (cycle) problems.push(`tasks depend on each other in a circle: ${cycle.join(' → ')}`);
  return { tasks, problems };
}

/** A dependency cycle among tasks, as a list of ids, or null. */
function findCycle(tasks) {
  const deps = Object.fromEntries(tasks.map((t) => [t.id, t.dependsOn]));
  const state = {};
  const stack = [];
  const visit = (id) => {
    if (state[id] === 'done') return null;
    if (state[id] === 'active') return [...stack.slice(stack.indexOf(id)), id];
    state[id] = 'active';
    stack.push(id);
    for (const d of deps[id] ?? []) {
      const found = visit(d);
      if (found) return found;
    }
    stack.pop();
    state[id] = 'done';
    return null;
  };
  for (const t of tasks) {
    const found = visit(t.id);
    if (found) return found;
  }
  return null;
}

/**
 * Check a whole spec: each file's shape, then the links between them (trace.js).
 * @param {{ requirements?: string | null, design?: string | null, tasks?: string | null }} files
 */
export function checkSpec(files) {
  const problems = [];
  if (files.requirements == null) problems.push('requirements.md is missing');
  if (files.design == null || !files.design.trim()) problems.push('design.md is missing or empty');
  if (files.tasks == null) problems.push('tasks.md is missing');
  const r = files.requirements != null ? parseRequirements(files.requirements) : { requirements: [], problems: [] };
  const t = files.tasks != null ? parseTasks(files.tasks) : { tasks: [], problems: [] };
  problems.push(...r.problems, ...t.problems);
  const trace = coverage(r.requirements, t.tasks);
  for (const c of trace.uncovered) problems.push(`${c.id} is not covered by any task ("Requirements: ${c.id}" on the task that implements it)`);
  for (const u of trace.unknown) problems.push(`${u.task} refers to ${u.ref}, which is not an acceptance criterion in requirements.md`);
  for (const t2 of t.tasks) if (!t2.requirements.length) problems.push(`${t2.id} traces to no requirement ("Requirements: R1.1, …")`);
  return { ok: problems.length === 0, problems, requirements: r.requirements, tasks: t.tasks, trace };
}
