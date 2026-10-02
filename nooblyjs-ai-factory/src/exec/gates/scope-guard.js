// @ts-check
// Phase F14: the SCOPE GUARD. Did the change stay where it said it would?
//
// A spec's tasks declare their Paths (F08). That's a promise: "this task changes
// these files". Until now nothing checked it (F10 only used it to plan waves). An
// agent that also "tidied up" three other files, or edited the CI config, would
// sail through. The scope guard checks every changed file:
//
//   allowed    a declared task path (a file, or a folder and what's in it)
//              any test file (tasks write tests; declaring every test path is noise)
//              the spec folder itself
//              paths a person GRANTED during the run (request_scope, Phase F16)
//   protected  CI config, the factory's own config/roles/steering, harness settings,
//              lockfiles: never changed by accident. Allowed only if a task DECLARES
//              it explicitly (and even then, F12's merge station leaves it to a person)
//
// Without a spec (small items) there's nothing declared, so only protected paths count.
//
// It runs as one more CHECK in verify ("scope"), so a violation is a failure like
// any other: the fixer (F13) gets it ("revert the change to x, or ask for scope").
// A repo can set "scope": "warn" to record violations without failing.
import { isTestFile } from '../../review/tampering.js';
import { matchesAny } from '../../util/glob.js';

export const PROTECTED = ['.github/**', '.gitlab-ci.yml', '.factory/config.json', '.factory/roles/**', '.factory/steering/**', '.noobly/**', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** Does `file` fall under a declared path (a file, or a folder: "src/" or "src")? */
function declared(file, paths) {
  return paths.some((p) => {
    const clean = p.replace(/^\.\//, '').replace(/\/+$/, '');
    return file === clean || file.startsWith(`${clean}/`) || matchesAny(file, [clean]);
  });
}

/**
 * @param {{ changed: string[], tasks?: { id: string, paths: string[] }[] | null, specDir?: string | null, granted?: string[] }} input
 * @returns {{ ok: boolean, violations: { file: string, why: 'outside' | 'protected' }[], declaredProtected: string[] }}
 */
export function checkScope({ changed, tasks = null, specDir = null, granted = [] }) {
  const paths = [...(tasks ?? []).flatMap((t) => t.paths), ...granted];
  const violations = [];
  const declaredProtected = [];
  for (const file of changed) {
    if (specDir && file.startsWith(`${specDir}/`)) continue;
    const isProtected = matchesAny(file, PROTECTED);
    const isDeclared = declared(file, paths);
    if (isProtected) {
      if (isDeclared) declaredProtected.push(file);
      else violations.push({ file, why: 'protected' });
      continue;
    }
    if (tasks && !isDeclared && !isTestFile(file)) violations.push({ file, why: 'outside' });
  }
  return { ok: violations.length === 0, violations, declaredProtected };
}

/** The scope result as a gate result (for verify, the PR table and the fixer). */
export function scopeGate(scope) {
  const lines = scope.violations.map((v) => (v.why === 'protected' ? `${v.file}: a PROTECTED path (CI, factory config, lockfiles…) that no task declares` : `${v.file}: outside every task's declared Paths`));
  return {
    name: 'scope',
    command: '(factory scope guard)',
    status: /** @type {const} */ (scope.ok ? 'passed' : 'failed'),
    exitCode: scope.ok ? 0 : 1,
    durationMs: 0,
    excerpt: scope.ok ? '' : `${lines.join('\n')}\n\nRevert these changes, or (if the task really needs them) ask for scope instead of changing them.`,
  };
}
