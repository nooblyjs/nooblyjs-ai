// @ts-check
// Phase F10: FAN-OUT. Which of a spec's tasks can be built at the same time?
//
// A spec's tasks.md says, for each task, what it depends on and which files it
// touches (F08). That's enough to plan parallel work:
//
//   ready  =  not done, not failed
//             and every task it depends on is DONE (and integrated)
//             and its Paths don't overlap a task already chosen for this wave
//
// Overlapping paths are kept apart on purpose: two agents editing the same file
// at once is a merge conflict waiting to happen. Put them in different waves and
// the second one starts from the first one's merged result instead.
//
//   tasks: T1 (a.js) · T2 (b.js) · T3 (a.js, c.js) · T4 depends on T1
//   wave 1: T1, T2          (T3 overlaps T1 on a.js; T4 waits for T1)
//   wave 2: T3, T4          (both start from wave 1's integrated code)
//
// Pure, like decide() and pickRuns(): state in, decision out, table-tested.

/** Do two tasks declare a file (or folder) in common? "src/" overlaps "src/a.js". */
export function overlaps(a, b) {
  const norm = (p) => p.replace(/^\.\//, '').replace(/\/+$/, '');
  for (const x of a.paths.map(norm)) {
    for (const y of b.paths.map(norm)) {
      if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
    }
  }
  return false;
}

/**
 * The next wave: tasks that may start together now.
 * @param {import('../specs/schema.js').Task[]} tasks
 * @param {{ done: string[], failed?: string[], limit?: number }} state
 * @returns {import('../specs/schema.js').Task[]}
 */
export function nextWave(tasks, { done, failed = [], limit = Infinity }) {
  const wave = [];
  for (const task of tasks) {
    if (wave.length >= limit) break;
    if (done.includes(task.id) || failed.includes(task.id)) continue;
    if (!task.dependsOn.every((d) => done.includes(d))) continue;
    if (wave.some((other) => overlaps(task, other))) continue;
    wave.push(task);
  }
  return wave;
}

/** The whole plan, wave by wave (assuming every task succeeds): for logs, docs and tests. */
export function planWaves(tasks, { limit = Infinity } = {}) {
  const waves = [];
  const done = [];
  for (let guard = 0; done.length < tasks.length && guard < tasks.length; guard++) {
    const wave = nextWave(tasks, { done, limit });
    if (!wave.length) break; // a dependency on a task that can never run (the spec check prevents this)
    waves.push(wave.map((t) => t.id));
    done.push(...wave.map((t) => t.id));
  }
  return waves;
}
