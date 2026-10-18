// @ts-check
// Phase F24: what an AGENT's environment may contain.
//
// The harness removes its own model keys from what the agent's commands see. But the
// factory has secrets of its own in its environment when it runs as a service:
// GITHUB_TOKEN (F15), FACTORY_WEBHOOK_SECRET, FACTORY_WORKER_ENROLL_TOKEN (F23),
// FACTORY_DASHBOARD_TOKEN (F17), a SLACK_WEBHOOK_URL (F18)… Found in F24: none of those were
// being removed. An agent that ran `env` (or was tricked into `curl …?t=$GITHUB_TOKEN`) would
// have had them.
//
//   subprocess driver   the `noobly` process gets a SCRUBBED copy of our environment: anything
//                       named like a secret is dropped, except the model keys the harness needs
//                       (and strips from the agent's own commands itself)
//   in-process driver   the agent's commands inherit OUR process's environment, which we can't
//                       scrub without breaking the control plane. So: if it holds secrets and the
//                       agent may run commands, REFUSE, and say to use the subprocess driver.

/** The model keys the harness itself needs, and hides from the agent's commands. */
export const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY'];

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY|WEBHOOK|_PAT$|SESSION_KEY)/i;
/** Named like a secret, but aren't (and are needed). */
const NOT_SECRET = new Set(['NOOBLY_HOME', 'FACTORY_HOME', 'SSH_AUTH_SOCK_DISABLED']);

/** The names in `env` that look like secrets and aren't provider keys. */
export function secretsInEnv(env = process.env) {
  return Object.keys(env).filter((k) => SECRET_NAME.test(k) && !PROVIDER_KEYS.includes(k) && !NOT_SECRET.has(k) && env[k]).sort();
}

/** A copy of `env` for an agent process: secret-looking names removed (provider keys kept). */
export function agentEnv(env = process.env) {
  const out = { ...env };
  for (const k of secretsInEnv(env)) delete out[k];
  // Also: git credentials the operator's shell may carry.
  delete out.GIT_ASKPASS;
  delete out.SSH_AUTH_SOCK;
  for (const k of Object.keys(out)) if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k)) delete out[k];
  return out;
}

/** Can this agent run shell commands at all? (Only then does its environment matter.) */
export function canRunCommands(run) {
  return run.permissionMode === 'bypass' || (run.allowedTools ?? []).some((r) => /^Bash(\(|$)/.test(String(r).trim()));
}

/** The in-process driver's refusal, or null. */
export function inProcessEnvProblem(run, env = process.env) {
  const found = secretsInEnv(env);
  if (!found.length || !canRunCommands(run)) return null;
  return `This process holds secrets (${found.join(', ')}), and an in-process agent's commands would inherit them. Use the subprocess driver (its environment is scrubbed), or unset them.`;
}
