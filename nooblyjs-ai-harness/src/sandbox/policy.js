// Phase 20: WHAT a sandboxed command may do, as plain data.
//
// The permission gate (Phase 06) guesses what a command WILL do from its text.
// A sandbox limits what it CAN do, whatever the text says. The policy is the
// same for every backend (bubblewrap, seatbelt); each backend only translates it.
//
//   read       everything, except `hidden` (your keys and cloud credentials)
//   write      only `writable` (the project, a private /tmp, a few caches),
//              and never `readOnly` (places that would let a command escape later)
//   network    "none", "allow", or a list of domains (via a filtering proxy)
import os from 'node:os';
import path from 'node:path';

export const SANDBOX_DEFAULTS = {
  // On by default: Bash runs in the sandbox when a backend is available (see sandbox/index.js).
  enabled: true,
  // "auto" picks bubblewrap on Linux, seatbelt on macOS. Or name one: "bwrap", "seatbelt", "none".
  backend: 'auto',
  // Extra folders commands may write to (besides the project, the sandbox's /tmp and CACHES).
  writable: [],
  // "none" (default), "allow" (anything), or domains, e.g. ["registry.npmjs.org", "github.com"].
  network: 'none',
  // In default mode, commands that run in the sandbox don't ask first (deny rules still apply).
  autoAllow: true,
};

// Package-manager caches under your home folder. Installing packages writes there.
const CACHES = ['.npm', '.cache', '.yarn', '.local/share/pnpm', '.bun/install/cache', '.cargo/registry', '.cargo/git'];

// Readable by default is fine for most of your home folder, but not for these:
// a command (or a model tricked by a README) could print them into the conversation.
const HIDDEN = ['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.config/gcloud', '.config/gh', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.noobly'];

// Inside the (writable) project, these stay read-only: writing them would run code
// LATER, outside the sandbox. A git hook runs on your next `git commit`; git config can
// name programs (core.pager, core.fsmonitor…); .noobly holds hooks and settings.
const PROJECT_READ_ONLY = ['.git/hooks', '.git/config', '.noobly'];

/**
 * Turn the `sandbox` setting into a concrete policy for one project.
 * @param {object} setting   the merged `sandbox` setting (may be partial)
 * @param {{ cwd: string, home?: string, tmpDir: string }} where  tmpDir: this session's private /tmp on the host
 */
export function resolvePolicy(setting = {}, { cwd, home = os.homedir(), tmpDir, extraReadOnly = [] }) {
  const merged = { ...SANDBOX_DEFAULTS, ...setting };
  const expand = (p) => (p.startsWith('~/') ? path.join(home, p.slice(2)) : path.resolve(cwd, p));
  return {
    enabled: merged.enabled !== false,
    backend: merged.backend,
    autoAllow: merged.autoAllow !== false,
    network: normalizeNetwork(merged.network),
    tmpDir, // mounted at /tmp inside the sandbox
    writable: unique([cwd, ...CACHES.map((c) => path.join(home, c)), ...(merged.writable ?? []).map(expand)]),
    // extraReadOnly (Phase 29): e.g. the main repository's .git, which a worktree's git commands need to read
    readOnly: [...PROJECT_READ_ONLY.map((p) => path.join(cwd, p)), ...extraReadOnly],
    hidden: HIDDEN.map((p) => path.join(home, p)),
  };
}

function normalizeNetwork(value) {
  if (value === 'allow' || value === true) return 'allow';
  if (Array.isArray(value) && value.length) return value.map((d) => String(d).toLowerCase().replace(/^\*\./, ''));
  return 'none';
}

const unique = (list) => [...new Set(list)];

/** Is `host` one of the allowed domains (or a subdomain of one)? Same rule as WebFetch(domain:…). */
export function domainAllowed(host, domains) {
  const name = host.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** A short description for /sandbox and the system prompt. */
export function describeNetwork(network) {
  if (network === 'allow') return 'allowed';
  if (network === 'none') return 'off';
  return `only ${network.join(', ')} (through a proxy)`;
}
