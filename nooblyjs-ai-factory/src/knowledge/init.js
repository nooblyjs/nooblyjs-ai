// @ts-check
// Phase F08: `factory init <repo>`: a first draft of what the factory needs to know, as a PR.
//
//   .factory/config.json          gates and setup, from what the repo already has
//   .factory/steering/product.md  what it is      (from package.json / README)
//   .factory/steering/tech.md     how it's built  (languages, commands, dependencies)
//   .factory/steering/structure.md where things are (the top-level layout)
//
// The draft is DETERMINISTIC: read from the repo at a pinned commit, the same
// input gives the same files, offline, for free. What a program can't know
// (why the product exists, what conventions matter, what to never do) is left
// as clearly marked TODOs for a human.
//
// Optionally (--agent) an agent then REFINES the drafts by reading the code.
// It may only write inside .factory/steering/.
//
// Either way the result is a PR, never a direct change: steering shapes every
// future agent's behaviour, so a human reads and edits it before it counts.
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../exec/workspace/git.js';
import { acquireWorkspace, releaseWorkspace } from '../exec/workspace/worktree.js';
import { readFileAt } from '../exec/workspace/mirror.js';
import { runStep } from '../exec/step-runner.js';
import { STEERING_DIR } from './steering.js';

const TODO = (what) => `_TODO (a human): ${what}_`;

/** What the repo tells us about itself, read at a commit. */
export async function detect(mirrorDir, sha) {
  const files = (await git(['ls-tree', '-r', '--name-only', sha], { cwd: mirrorDir })).split('\n').filter(Boolean);
  const top = (await git(['ls-tree', '--name-only', sha], { cwd: mirrorDir })).split('\n').filter(Boolean);
  const pkgText = await readFileAt(mirrorDir, sha, 'package.json');
  let pkg = null;
  try {
    pkg = pkgText ? JSON.parse(pkgText) : null;
  } catch {
    pkg = null;
  }
  const readme = (await readFileAt(mirrorDir, sha, 'README.md')) ?? '';
  const exts = {};
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext) exts[ext] = (exts[ext] ?? 0) + 1;
  }
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].find((l) => files.includes(l)) ?? null;
  return { files, top, pkg, readme, exts, lock, existingConfig: files.includes('.factory/config.json') };
}

const LANGUAGES = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.jsx': 'JavaScript (JSX)', '.ts': 'TypeScript', '.tsx': 'TypeScript (TSX)', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.rb': 'Ruby', '.cs': 'C#' };

/** The draft files, from what was detected. @returns {Record<string, string>} path → content */
export function draft(found) {
  const { pkg, readme, exts, lock, top } = found;
  const name = pkg?.name ?? 'this project';
  const firstParagraph = readme.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('!['));
  const scripts = pkg?.scripts ?? {};
  const languages = Object.entries(exts).filter(([e]) => LANGUAGES[e]).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${LANGUAGES[e]} (${n} files)`);

  // Gates: the repo's own checks, cheapest first. Only what exists; nothing invented.
  const gates = {};
  for (const [name2, script] of [['lint', 'lint'], ['typecheck', 'typecheck'], ['build', 'build'], ['test', 'test']]) {
    if (scripts[script] && !/no test specified/.test(scripts[script])) gates[name2] = `npm run ${script}`;
  }
  const setup = lock === 'package-lock.json' ? { command: 'npm ci', cacheKey: ['package-lock.json'], cachePaths: ['node_modules'] } : lock === 'pnpm-lock.yaml' ? { command: 'pnpm install --frozen-lockfile', cacheKey: ['pnpm-lock.yaml'], cachePaths: ['node_modules'] } : lock === 'yarn.lock' ? { command: 'yarn install --frozen-lockfile', cacheKey: ['yarn.lock'], cachePaths: ['node_modules'] } : null;
  const config = { network: setup ? ['registry.npmjs.org'] : 'none', ...(setup && { setup }), gates };

  const deps = Object.keys(pkg?.dependencies ?? {});
  const devDeps = Object.keys(pkg?.devDependencies ?? {});
  return {
    '.factory/config.json': `${JSON.stringify(config, null, 2)}\n`,
    [`${STEERING_DIR}/product.md`]: `# Product: ${name}

${pkg?.description ? `${pkg.description}\n\n` : ''}${firstParagraph ? `From the README:\n\n> ${firstParagraph.replace(/\n/g, '\n> ')}\n\n` : ''}## Who it's for
${TODO('who uses this, and what they need from it')}

## What matters
${TODO('the qualities that matter most here (e.g. readability over speed, no breaking changes, offline tests)')}

## Out of scope
${TODO('things agents should NOT add, even if asked')}
`,
    [`${STEERING_DIR}/tech.md`]: `# Tech

## Languages
${languages.length ? languages.map((l) => `- ${l}`).join('\n') : TODO('the languages used')}
${pkg?.engines ? `\nRuntime: ${Object.entries(pkg.engines).map(([k, v]) => `${k} ${v}`).join(', ')}\n` : ''}${pkg?.type === 'module' ? '\nES modules (`"type": "module"`).\n' : ''}
## Commands
${Object.keys(scripts).length ? Object.entries(scripts).map(([k, v]) => `- \`npm run ${k}\`: \`${v}\``).join('\n') : TODO('how to build and test')}

## Dependencies
${deps.length ? `Runtime: ${deps.join(', ')}.` : 'No runtime dependencies.'}${devDeps.length ? `\nDevelopment: ${devDeps.join(', ')}.` : ''}
${TODO('the policy for adding dependencies')}

## Conventions
${TODO('code style, naming, error handling, how tests are written, what "done" means')}
`,
    [`${STEERING_DIR}/structure.md`]: `# Structure

${structure(found)}
`,
  };
}

// Conventional folder names, so the draft can say something useful without guessing.
const KNOWN = { src: 'source code', lib: 'library code', bin: 'command-line entry points', test: 'tests', tests: 'tests', __tests__: 'tests', spec: 'tests', examples: 'examples to copy', docs: 'documentation', scripts: 'development scripts', public: 'static files served as-is', assets: 'static assets', config: 'configuration' };

/**
 * The top-level FOLDERS, with file counts: files like .gitignore or a lockfile aren't
 * "structure" (the first draft listed them, each with a useless TODO).
 */
function structure({ top, files }) {
  const folders = top.filter((t) => files.some((f) => f.startsWith(`${t}/`)) && !t.startsWith('.'));
  if (!folders.length) return TODO('where things live');
  const lines = folders.map((d) => {
    const count = files.filter((f) => f.startsWith(`${d}/`)).length;
    return `- \`${d}/\` (${count} file${count === 1 ? '' : 's'}): ${KNOWN[d] ?? TODO('what lives here')}`;
  });
  return `${lines.join('\n')}\n\n${TODO('anything an agent must know about the layout: where new code goes, what must not be touched')}`;
}

/**
 * Draft steering + config for a repo and deliver it as a PR (branch factory/init/main).
 * @param {{ repo: string, base?: string, env?: NodeJS.ProcessEnv, forge: any, agent?: any, log?: (l: string) => void, allowUnsandboxed?: boolean }} options
 */
export async function initRepo({ repo, base, env = process.env, forge, agent, log = () => {}, allowUnsandboxed }) {
  const ws = await acquireWorkspace({ repo, base, name: 'init', env });
  const found = await detect(ws.mirror, ws.baseSha);
  const files = draft(found);
  const written = [];
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(ws.path, file);
    if (fs.existsSync(target)) continue; // never overwrite what a human already wrote
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written.push(file);
  }
  log(`drafted: ${written.join(', ') || '(nothing new: everything exists already)'}`);
  const released = await releaseWorkspace(ws, { message: 'Factory: draft steering and config\n\nDrafted by `factory init` from what the repository contains. Edit before merging.' });
  if (!released.commits) return { written, pr: null, head: null };

  let branch = /** @type {string} */ (released.branch);
  let refinedBy = null;
  if (agent) {
    // An agent refines the drafts by reading the code; it may only touch .factory/steering/.
    const step = await runStep(
      {
        repo,
        base: branch,
        name: 'init-refine',
        commitMessage: 'Factory: refine steering by reading the code',
        driver: typeof agent.provider === 'object' ? 'in-process' : agent.driver,
        verify: false,
        stopHook: false,
        allowUnsandboxed,
        log,
        agent: {
          ...agent,
          permissionMode: 'default',
          allowedTools: [`Edit(${STEERING_DIR}/**)`],
          prompt: `Read this repository, then improve the draft steering files in ${STEERING_DIR}/ (product.md, tech.md, structure.md). Replace each "TODO (a human)" you can answer FROM THE CODE with a short, specific answer; leave the ones only a person can answer (goals, priorities, policy). Keep them brief: every agent that works here reads them. Read each file before you edit it. Only edit files in ${STEERING_DIR}/.`,
        },
      },
      { env },
    );
    if (step.commits) {
      branch = /** @type {string} */ (step.branch);
      refinedBy = step.result.model;
    }
  }

  const head = 'factory/init/main';
  await forge.pushBranch(ws.mirror, branch, head);
  const stat = await git(['diff', '--stat', `${ws.baseSha}..refs/heads/${branch}`], { cwd: ws.mirror });
  const pr = await forge.openOrUpdatePR(ws.slug, {
    title: 'Factory: steering and config (draft)',
    head,
    base: ws.baseRef,
    status: 'draft',
    body: `# Factory: steering and config (draft)

\`factory init\` read this repository and drafted what the factory needs to know about it.${refinedBy ? ` An agent (${refinedBy}) then refined the drafts by reading the code.` : ''}

**Please edit before merging.** Every factory agent will read these files, so they should say what's true and what matters here. Lines marked _TODO (a human)_ are things only you can answer.

| File | What it's for |
|---|---|
| \`.factory/config.json\` | the gates (checks) every change must pass, and setup |
| \`.factory/steering/product.md\` | what this is, for whom, what matters, what's out of scope |
| \`.factory/steering/tech.md\` | languages, commands, dependencies, conventions |
| \`.factory/steering/structure.md\` | where things live |

## Changes

\`\`\`
${stat.trim()}
\`\`\`

## Review it

\`\`\`bash
cd ${path.resolve(repo)}
git diff ${ws.baseRef}...${head}
git merge ${head}      # after editing
\`\`\`
`,
    meta: { kind: 'init' },
  });
  return { written, pr, head };
}
