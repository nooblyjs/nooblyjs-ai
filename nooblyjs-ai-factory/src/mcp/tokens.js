// @ts-check
// Phase F16: per-step TOKENS. Each agent's factory tools act for ONE step of ONE run.
//
//   token = HMAC-SHA256(factory secret, "<runId>/<step>")
//
// The tools server is told which step it serves (--step) and gets the token in its
// environment. It refuses to start if they don't match. So a server started for step A
// can't be pointed at step B (or another run) without the factory's secret, which lives
// in ~/.factory/secret (0600) and never goes into a workspace.
//
// What a token is NOT: a secret from the agent itself. The agent can use its own step's
// tools; the token only stops it reaching anyone else's.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../util/paths.js';

/** The factory's signing secret, created on first use. */
export function factorySecret(env = process.env) {
  const file = path.join(factoryHome(env), 'secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const secret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(file, `${secret}\n`, { mode: 0o600, flag: 'wx' }); // wx: a concurrent first use keeps the other one
    } catch {
      return fs.readFileSync(file, 'utf8').trim();
    }
    return secret;
  }
}

export function stepToken(env, runId, step) {
  return crypto.createHmac('sha256', factorySecret(env)).update(`${runId}/${step}`).digest('hex');
}

export function verifyStepToken(env, runId, step, token) {
  const expected = Buffer.from(stepToken(env, runId, step));
  const got = Buffer.from(String(token ?? ''));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
