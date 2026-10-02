// Phase 15: SKILLS, and progressive disclosure.
//
// A skill is a folder with instructions for one kind of job, plus any files
// that help (templates, scripts, examples):
//
//   .noobly/skills/release-notes/
//   ├── SKILL.md          ---
//   │                     name: release-notes
//   │                     description: Use when the user asks for release notes or a changelog
//   │                     ---
//   │                     1. Run git log … 2. Fill in template.md …
//   └── template.md
//
// The trick is WHEN each part reaches the model:
//   1. Always: just the name and description (a line per skill in the system prompt). Cheap.
//   2. When relevant: the model calls the Skill tool and gets the SKILL.md body.
//   3. If needed: it Reads the supporting files.
// So you can install fifty skills and pay for fifty lines, not fifty manuals.
//
// Skills live in ~/.noobly/skills/ (yours, every project) and .noobly/skills/
// (this project; it wins on a name clash).
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../util/frontmatter.js';
import { nooblyHome } from '../util/paths.js';

export function skillFolders(cwd, nooblyDir = nooblyHome()) {
  return [
    { scope: 'user', dir: path.join(nooblyDir, 'skills') },
    { scope: 'project', dir: path.join(cwd, '.noobly', 'skills') },
  ];
}

/**
 * Find every skill. Only the frontmatter is kept; the body is read when the skill is used.
 * @returns {Array<{ name: string, description: string, dir: string, file: string, scope: string }>}
 */
export function loadSkills(cwd, { nooblyDir } = {}) {
  const skills = new Map();
  for (const { scope, dir } of skillFolders(cwd, nooblyDir)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const skillDir = path.join(dir, entry.name);
      const file = path.join(skillDir, 'SKILL.md');
      if (!entry.isDirectory() || !fs.existsSync(file)) continue;
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const name = String(data.name || entry.name);
      skills.set(name, {
        name,
        description: data.description ?? body.trim().split('\n')[0].slice(0, 120),
        dir: skillDir,
        file,
        scope,
      });
    }
  }
  return [...skills.values()];
}

/** Level 2: the skill's instructions (read fresh, so edits apply at once), plus a list of its other files. */
export function readSkill(skill) {
  const { body } = parseFrontmatter(fs.readFileSync(skill.file, 'utf8'));
  return { body: body.trim(), files: listFiles(skill.dir).filter((file) => file !== 'SKILL.md') };
}

function listFiles(dir, prefix = '', limit = 50) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (found.length >= limit || entry.name.startsWith('.')) continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(path.join(dir, entry.name), relative, limit - found.length));
    else found.push(relative);
  }
  return found;
}
