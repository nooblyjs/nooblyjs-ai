// Reading and writing Bot Framework activities (tech.md §7.3): what Microsoft Teams sends to the bot's messaging
// endpoint, and what the bot sends back. Only the fields the bot uses are read; everything else is ignored.
import crypto from 'node:crypto';
import { HttpError } from '../util/errors.js';
import { ADAPTIVE_CARD } from './cards.js';

export const BOT = { id: 'noobly-bot', name: 'NooblyJS' };
const TYPES = new Set(['message', 'conversationUpdate', 'invoke', 'typing', 'installationUpdate', 'messageReaction']);
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const MAX_TEXT = 4000;

/** A file-safe name for a Teams conversation id ("19:meeting_…@thread.v2" has characters a path can't hold). */
export const conversationKey = (id) => (SAFE_KEY.test(id) ? id : `c_${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}`);

/** "<at>NooblyJS</at> what's blocking?" → "what's blocking?"; other tags are dropped too. */
const plain = (text) => String(text ?? '').replace(/<at[^>]*>.*?<\/at>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The parts of an incoming activity the bot acts on. Throws a 400 for something that isn't an activity.
 * `mentioned` holds the names people were mentioned by, lower-cased; `botMentioned` says whether NooblyJS was one.
 * `at` is the time Teams stamped the activity with, which is what "after the teammate joined" is measured against.
 */
export function readActivity(raw, { botId: given = null } = {}) {
  // In Teams the bot is the activity's recipient ("28:<app id>"); the simulator calls it noobly-bot.
  const botId = given ?? (typeof raw?.recipient?.id === 'string' ? raw.recipient.id : BOT.id);
  if (!raw || typeof raw !== 'object' || !TYPES.has(raw.type)) throw new HttpError(400, 'bad_activity', 'This is not a Bot Framework activity.');
  const conversationId = typeof raw.conversation?.id === 'string' ? raw.conversation.id.slice(0, 300) : '';
  if (!conversationId) throw new HttpError(400, 'bad_activity', 'The activity has no conversation.');
  const at = raw.timestamp && !Number.isNaN(Date.parse(raw.timestamp)) ? new Date(raw.timestamp).toISOString() : null;
  const entities = Array.isArray(raw.entities) ? raw.entities.filter((e) => e?.type === 'mention' && e.mentioned) : [];
  const text = plain(raw.text).slice(0, MAX_TEXT);
  // People also type a teammate's name as plain text ("@Ada …"): there is one bot, so Teams offers no mention for it.
  const typed = [...String(raw.text ?? '').replace(/<[^>]+>/g, ' ').matchAll(/(?:^|[^\w@])@([A-Za-z][\w-]{0,40})/g)].map((m) => m[1].toLowerCase());
  const value = raw.value && typeof raw.value === 'object' && !Array.isArray(raw.value) ? raw.value : null;
  return {
    type: raw.type,
    id: typeof raw.id === 'string' ? raw.id.slice(0, 200) : null,
    conversationId,
    conversationKey: conversationKey(conversationId),
    conversationName: typeof raw.conversation?.name === 'string' ? raw.conversation.name.slice(0, 120) : null,
    serviceUrl: typeof raw.serviceUrl === 'string' ? raw.serviceUrl : null,
    channelId: typeof raw.channelId === 'string' ? raw.channelId : null,
    recipient: raw.recipient?.id ? { id: String(raw.recipient.id), name: String(raw.recipient.name ?? BOT.name).slice(0, 120) } : null,
    tenantId: typeof raw.channelData?.tenant?.id === 'string' ? raw.channelData.tenant.id : (typeof raw.conversation?.tenantId === 'string' ? raw.conversation.tenantId : null),
    personal: raw.conversation?.conversationType === 'personal',
    from: { id: String(raw.from?.id ?? ''), name: String(raw.from?.name ?? '').slice(0, 120), aadObjectId: raw.from?.aadObjectId ? String(raw.from.aadObjectId) : null, isBot: raw.from?.role === 'bot' || raw.from?.id === botId },
    at,
    text: text.replace(/(^|\s)@[A-Za-z][\w-]{0,40}/g, ' ').replace(/\s+/g, ' ').trim(),
    said: text,
    mentioned: [...new Set([...entities.map((e) => String(e.mentioned.name ?? '').toLowerCase()), ...typed])].filter(Boolean),
    botMentioned: entities.some((e) => e.mentioned.id === botId || e.mentioned.id === BOT.id) || typed.includes(BOT.name.toLowerCase()),
    botAdded: ['conversationUpdate', 'installationUpdate'].includes(raw.type) && (raw.action === 'add' || (Array.isArray(raw.membersAdded) && raw.membersAdded.some((m) => m?.id === botId))),
    // A card's Action.Submit: Teams sends its `data` back as the activity's value.
    action: typeof value?.noobly === 'string' ? { name: value.noobly, teammateId: typeof value.teammateId === 'string' ? value.teammateId : null } : null,
  };
}

/** A message from the bot. `noobly` (channelData) says who is speaking and what kind of line it is, for the simulator. */
export function botMessage({ text = '', attachment = null, noobly = {} } = {}) {
  return {
    type: 'message',
    from: { ...BOT, role: 'bot' },
    ...(text ? { text } : {}),
    ...(attachment ? { attachments: [attachment] } : {}),
    channelData: { noobly },
  };
}

export const typing = (noobly = {}) => ({ type: 'typing', from: { ...BOT, role: 'bot' }, channelData: { noobly } });
export const isCard = (attachment) => attachment?.contentType === ADAPTIVE_CARD;
