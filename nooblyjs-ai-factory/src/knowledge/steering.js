// @ts-check
// Phase F08: STEERING files. What every agent should know about this repo, written down once.
//
//   .factory/steering/
//   ├── product.md     what this is, who it's for, what matters (and what doesn't)
//   ├── tech.md        languages, frameworks, commands, conventions, things to avoid
//   └── structure.md   where things live, and why
//
// (The names and the idea come from Amazon Kiro's "steering" files; AGENTS.md /
// CLAUDE.md / NOOBLY.md are the same idea in one file.)
//
// Every agent that plans or writes code gets them in its prompt, so the
// spec-writer doesn't invent a test framework the repo doesn't use, and the
// builder follows the house style without being told in every issue.
//
// They are read from the PINNED base commit, like the config: what's committed
// (and so reviewed) steers; a draft on someone's disk doesn't.
//
// Unlike issue text, steering is written by the repo's maintainers and changes
// only through reviewed commits, so it's presented as guidance, not fenced as
// untrusted. (That trust is why F21's "learning loop" may only change steering
// through a PR a human approves.)
import { readFileAt } from '../exec/workspace/mirror.js';

export const STEERING_FILES = ['product', 'tech', 'structure', 'conventions']; // conventions.md: Phase F21's learned rules
export const STEERING_DIR = '.factory/steering';

/** @returns {Promise<Record<string, string>>} the steering files that exist, by name */
export async function readSteering(mirrorDir, sha) {
  const out = {};
  for (const name of STEERING_FILES) {
    const text = await readFileAt(mirrorDir, sha, `${STEERING_DIR}/${name}.md`);
    if (text && text.trim()) out[name] = text.trim();
  }
  return out;
}

/** Steering as a prompt section ('' if there is none). */
export function steeringSection(steering) {
  const names = Object.keys(steering ?? {});
  if (!names.length) return '';
  const parts = names.map((n) => `<steering file="${STEERING_DIR}/${n}.md">\n${steering[n]}\n</steering>`);
  return `Project guidance from this repository's maintainers (follow it):\n\n${parts.join('\n\n')}\n\n`;
}
