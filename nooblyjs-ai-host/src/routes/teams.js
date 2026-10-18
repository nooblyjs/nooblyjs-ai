// POST /api/teams/messages: the NooblyJS Teams bot's messaging endpoint (tech.md §7.3). Microsoft Teams, through the
// Bot Framework, posts an activity here for everything that happens in a chat the bot is in.
//
// The caller is not a signed-in person, so there is no session and no CSRF token: the request proves itself.
//   - Teams: a Bot Framework token for NooblyJS's bot (src/teams/auth.js, Phase 12).
//   - The /dev/teams simulator: a key made when NooblyJS starts, only with NOOBLY_DEV_LOGIN=true.
//   - The Microsoft 365 Agents Playground (development only, TEAMS_BOT_DEV_UNSIGNED=true): no token, from this
//     machine, with a localhost serviceUrl.
// Everything else gets 401, audited with the reason. A valid activity is acknowledged with 200 first and handled
// after: Teams wants an answer within 15 seconds, and a teammate's answer can take longer.
import crypto from 'node:crypto';
import { HttpError, sendError } from '../util/errors.js';
import { readActivity } from '../teams/activities.js';
import { isLocalServiceUrl } from '../teams/auth.js';

export const TEAMS_ENDPOINT = '/api/teams/messages';

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * @param {object} o
 * @param {{ handle: Function }} o.bot
 * @param {string|null} o.devKey   the simulator's key, or null when there is no simulator (production)
 * @param {{ verify: Function }|null} [o.tokens]   the Bot Framework token check
 * @param {boolean} [o.devUnsigned]  accept unsigned Playground activities from this machine (development only)
 * @param {string|null} [o.devPerson]  who the Playground's mock user is in NooblyJS
 */
export function teamsEndpoint({ bot, devKey = null, tokens = null, devUnsigned = false, devPerson = null, log }) {
  const pending = new Set();

  /** Who sent this: { ok, via } or { ok: false, reason }. `remote` is the caller's address. */
  async function verify(authorization, activity, { remote = null } = {}) {
    const sent = String(authorization ?? '');
    if (devKey && sent.startsWith('Bearer dev:')) {
      return same(sent, `Bearer dev:${devKey}`) ? { ok: true, via: 'dev-key' } : { ok: false, reason: 'the simulator key is wrong' };
    }
    if (!sent && devUnsigned && isLocalServiceUrl(activity?.serviceUrl) && (remote === null || LOOPBACK.has(remote))) return { ok: true, via: 'playground' };
    if (tokens) return tokens.verify(sent, activity);
    return { ok: false, reason: sent ? 'the token is not one NooblyJS accepts' : 'no Authorization header' };
  }

  /** Reads and verifies one activity; throws a 401 or 400. */
  async function accept(raw, { authorization, remote = null } = {}) {
    const activity = readActivity(raw);
    const verified = await verify(authorization, activity, { remote });
    if (!verified.ok) throw new HttpError(401, 'unauthorized', `This endpoint only takes activities from the NooblyJS Teams bot: ${verified.reason}.`);
    activity.via = verified.via;
    // The Playground's mock user is no one NooblyJS knows: in development it stands for TEAMS_BOT_DEV_PERSON.
    if (verified.via === 'playground' && devPerson) activity.from = { ...activity.from, devPerson };
    return activity;
  }

  /** Verifies, reads and handles one activity, waiting for the bot. The simulator comes through here. */
  async function receive(raw, { authorization } = {}) {
    const activity = await accept(raw, { authorization });
    if (activity.via === 'dev-key') activity.via = 'simulator';
    return { activity, result: await bot.handle(activity) };
  }

  /** Handles an accepted activity after the request has been answered. */
  function later(activity) {
    const run = bot.handle(activity)
      .catch((err) => log?.error?.(`teams bot: ${err.stack ?? err.message}`))
      .finally(() => pending.delete(run));
    pending.add(run);
    return run;
  }

  /** Resolves when every activity handled after its answer is done (tests). */
  const settled = async () => { while (pending.size) await Promise.allSettled([...pending]); };

  return { verify, accept, receive, later, settled };
}

export function teamsRoutes({ express, endpoint, auditLog, log }) {
  const router = express.Router();
  router.post(TEAMS_ENDPOINT, async (req, res) => {
    let activity;
    try {
      activity = await endpoint.accept(req.body, { authorization: req.get('authorization'), remote: req.socket?.remoteAddress ?? null });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      res.locals.audit = { actor: 'teams-bot', action: status === 401 ? 'teams.activity_refused' : 'teams.activity_failed', reason: err.message };
      if (status === 401) {
        // A refused caller made no write, so the request audit would skip it: record it here.
        await auditLog?.record?.({ actor: 'teams-bot', action: 'teams.activity_refused', target: TEAMS_ENDPOINT, reason: err.message, remote: req.socket?.remoteAddress ?? null }).catch(() => {});
        log?.warn?.(`teams bot: refused an activity: ${err.message}`);
      }
      if (status === 500) log?.error?.(`teams bot: ${err.stack ?? err.message}`);
      return sendError(res, status, err.code ?? 'bot_failed', status === 500 ? 'The bot could not handle that activity.' : err.message);
    }
    res.locals.audit = { actor: 'teams-bot', action: 'teams.activity_received', target: activity.conversationId, type: activity.type, via: activity.via };
    // The Bot Framework wants a quick, empty 200; what the bot says goes out through the connector afterwards.
    res.status(200).json({});
    endpoint.later(activity);
  });
  return router;
}
