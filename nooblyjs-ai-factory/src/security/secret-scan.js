// @ts-check
// Phase F24: SECRET SCAN (and risky changes), on every commit the factory would deliver.
//
// Two kinds of finding:
//
//   secret   something that looks like a credential: cloud keys, forge tokens, private keys,
//            `password = "…"` with a long, random-looking value
//   risky    a change that runs code or moves data where review is easy to miss: a new npm
//            install script, `curl … | sh`, reading ~/.ssh or ~/.aws, sending the environment
//            somewhere
//
// It scans EACH COMMIT's added lines, not the net diff: a secret added in one commit and
// "removed" in the next is still in the history, and pushing the branch publishes it.
// That's also why a finding BLOCKS delivery (nothing is pushed) and goes to a person,
// rather than to the fixer: no later commit can take a pushed secret back.
//
// Regexes over added lines: fast, explainable, and wrong sometimes. A false positive costs a
// person a look; a false negative costs a rotated key. So it leans towards flagging.
import { git } from '../exec/workspace/git.js';

const SECRETS = [
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['slack-webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/],
  ['private-key', /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/],
  ['generic-secret', /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["']([^"'\s]{16,})["']/i],
];

const RISKY = [
  ['pipe-to-shell', /\b(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b/],
  ['reads-credentials', /(~|\$HOME|homedir\(\))[/'"\s,+]*\.(ssh|aws|gnupg|netrc|npmrc|docker\/config)/],
  ['env-to-network', /(printenv|\benv\b\s*\||JSON\.stringify\(\s*process\.env\s*\))[\s\S]{0,80}(curl|wget|fetch|http)/],
  ['reverse-shell', /\b(nc|ncat|netcat)\b[^\n]*\s-e\s|\/dev\/tcp\//],
];

const INSTALL_SCRIPTS = /"(preinstall|install|postinstall|prepare|prepublish)"\s*:/;

/** Shannon entropy per character: random keys are high, words are low. */
function entropy(s) {
  const counts = {};
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1;
  return Object.values(counts).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

const redact = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`);

/**
 * Scan added lines. `file` matters for install scripts (package.json only).
 * @returns {Array<{ kind: string, severity: 'secret' | 'risky', file: string, line: number | null, excerpt: string }>}
 */
export function scanLines(lines, { file = '', commit = null } = {}) {
  const out = [];
  lines.forEach(({ text, line }) => {
    for (const [kind, re] of SECRETS) {
      const m = re.exec(text);
      if (!m) continue;
      const value = kind === 'generic-secret' ? m[2] : m[0];
      if (kind === 'generic-secret' && (entropy(value) < 3.2 || /^(process\.env|\$\{|<|your|example|changeme|xxx)/i.test(value))) continue; // "changeme", placeholders, env lookups
      out.push({ kind, severity: 'secret', file, line, commit, excerpt: text.replace(value, redact(value)).trim().slice(0, 160) });
    }
    for (const [kind, re] of RISKY) if (re.test(text)) out.push({ kind, severity: 'risky', file, line, commit, excerpt: text.trim().slice(0, 160) });
    if (/(^|\/)package\.json$/.test(file) && INSTALL_SCRIPTS.test(text)) out.push({ kind: 'install-script', severity: 'risky', file, line, commit, excerpt: text.trim().slice(0, 160) });
  });
  return out;
}

/** Added lines per file, from a unified diff (git log -p / git diff). */
export function addedLines(patch) {
  const files = new Map();
  let file = null;
  let line = 0;
  let commit = null;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('commit ')) commit = raw.slice(7, 19);
    else if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      if (file === '/dev/null') file = null;
    } else if (raw.startsWith('@@')) line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 1);
    else if (file && raw.startsWith('+')) {
      const key = `${commit}|${file}`;
      if (!files.has(key)) files.set(key, { file, commit, lines: [] });
      files.get(key).lines.push({ text: raw.slice(1), line: line++ });
    } else if (file && !raw.startsWith('-')) line++;
  }
  return [...files.values()];
}

/**
 * Every commit between base and sha, every added line.
 * @returns {Promise<{ findings: ReturnType<typeof scanLines>, blocked: boolean, secrets: number, risky: number }>}
 */
export async function scanCommits(mirrorDir, base, sha) {
  const patch = await git(['log', '-p', '--no-color', '--no-renames', '--format=commit %H', `${base}..${sha}`], { cwd: mirrorDir });
  const findings = addedLines(patch).flatMap((f) => scanLines(f.lines, { file: f.file, commit: f.commit }));
  const secrets = findings.filter((f) => f.severity === 'secret').length;
  return { findings, blocked: findings.length > 0, secrets, risky: findings.length - secrets };
}
