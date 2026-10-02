// Shared test helpers: temporary folders and tiny git repositories.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmpDir = (prefix = 'factory-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** An environment whose FACTORY_HOME is a fresh temp folder (and, optionally, an operator config in it). */
export function testEnv(config) {
  const env = { ...process.env, FACTORY_HOME: tmpDir('factory-home-') };
  if (config) fs.writeFileSync(path.join(env.FACTORY_HOME, 'config.json'), JSON.stringify(config));
  return env;
}

const G = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main'];
export const gitIn = (cwd, ...args) => execFileSync('git', [...G, ...args], { cwd, encoding: 'utf8' }).trim();

/**
 * A git repository with one commit containing `files` ({ 'path': 'content' }).
 * @returns {string} its folder
 */
export function makeRepo(files = { 'README.md': '# hello\n' }) {
  const dir = tmpDir('factory-repo-');
  gitIn(dir, 'init', '-q');
  writeFiles(dir, files);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

export function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
}

export function commitFiles(dir, files, message = 'change') {
  writeFiles(dir, files);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD');
}

/** Phase F11: a scripted reviewer that approves (for tests that run the default line to the end). */
export async function approve(findings = []) {
  const { createMockProvider } = await import('../src/harness.js');
  const verdict = findings.some((f) => f.severity === 'blocking') ? 'changes_requested' : 'approve';
  return createMockProvider([{ text: `\`\`\`json\n${JSON.stringify({ verdict, summary: 'Looks right.', findings })}\n\`\`\`` }]);
}
