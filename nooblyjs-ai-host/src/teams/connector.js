// How the bot's replies leave NooblyJS (Phase 12, tech.md §7.3): the Bot Connector REST API, plain fetch.
//
//   POST {serviceUrl}/v3/conversations/{conversationId}/activities
//
// with a token for https://api.botframework.com/.default, from the bot's Entra app (client credentials), cached until
// shortly before it expires. The token only ever goes to Microsoft's Bot Connector hosts; a reply to the Agents
// Playground (a localhost address, development only) goes without one. The simulator keeps its own connector:
// an activity says which way it came in (`via`), and the reply goes back the same way.
import { isBotFrameworkServiceUrl, isLocalServiceUrl } from './auth.js';

const TOKEN_SCOPE = 'https://api.botframework.com/.default';

/**
 * @param {object} o
 * @param {{ appId?: string, secret?: string, tenantId?: string }} o.bot   the bot's Entra app (TEAMS_BOT_APP_*)
 * @param {{ send: Function }|null} [o.simulator]  the simulator's connector, for activities from /dev/teams
 * @param {boolean} [o.allowLocal]   development: replies may go to a localhost Playground
 */
export function createConnector({ bot = {}, simulator = null, allowLocal = false, fetch: fetchImpl = globalThis.fetch, now = Date.now, log } = {}) {
  let token = null; // { value, until }

  async function accessToken() {
    if (token && now() < token.until) return token.value;
    if (!bot.appId || !bot.secret) throw new Error('The Teams bot has no app id and secret (TEAMS_BOT_APP_ID, TEAMS_BOT_APP_SECRET), so it cannot reply in Teams.');
    const tenant = bot.tenantId || 'botframework.com';
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: bot.appId, client_secret: bot.secret, scope: TOKEN_SCOPE }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Microsoft did not give the bot a token: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
    token = { value: body.access_token, until: now() + Math.max(60, (Number(body.expires_in) || 3600) - 300) * 1000 };
    return token.value;
  }

  /** Sends one activity into the conversation `a` came from, as the bot that `a` was addressed to. */
  async function send(a, activity) {
    if (a.via === 'simulator' || a.via === 'dev-key') {
      if (!simulator) throw new Error('The Teams simulator is not running.');
      return simulator.send(a, activity);
    }
    const local = isLocalServiceUrl(a.serviceUrl);
    if (local && !allowLocal) throw new Error('A reply to a local address is only sent in development.');
    if (!local && !isBotFrameworkServiceUrl(a.serviceUrl)) throw new Error(`The bot will not reply to ${a.serviceUrl}: it is not a Bot Framework address.`);
    const base = String(a.serviceUrl).replace(/\/+$/, '');
    const body = {
      ...activity,
      // Teams wants the bot to speak as itself (the recipient of what it received) and to the person who wrote.
      from: { id: a.recipient?.id ?? activity.from?.id, name: a.recipient?.name ?? activity.from?.name },
      recipient: a.from?.id ? { id: a.from.id, name: a.from.name } : undefined,
      conversation: { id: a.conversationId },
      ...(a.id && activity.type === 'message' ? { replyToId: a.id } : {}),
    };
    const headers = { 'content-type': 'application/json' };
    if (!local) headers.authorization = `Bearer ${await accessToken()}`;
    const res = await fetchImpl(`${base}/v3/conversations/${encodeURIComponent(a.conversationId)}/activities`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`The Bot Connector refused the reply (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  /**
   * Starts a conversation with one person (a proactive message: an approval waiting for them). Needs the
   * serviceUrl and tenant Teams gave when they installed the app, and their Teams user id.
   */
  async function createPersonal({ serviceUrl, tenantId, userId }) {
    if (!isBotFrameworkServiceUrl(serviceUrl)) throw new Error('Personal messages only go to a Bot Framework address.');
    const res = await fetchImpl(`${String(serviceUrl).replace(/\/+$/, '')}/v3/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ bot: { id: `28:${bot.appId}` }, members: [{ id: userId }], tenantId, channelData: { tenant: { id: tenantId } }, isGroup: false }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new Error(`Teams did not open a chat with that person (HTTP ${res.status}).`);
    return body.id;
  }

  return { send, createPersonal, configured: Boolean(bot.appId && bot.secret), log };
}
