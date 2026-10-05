// People sign in with nooblyjs-core's authservice (see src/core): their account, password and roles live in
// data/core/auth/. This service maps those roles to Teammates roles, keeps the secret that signs the session and
// CSRF tokens, and manages API keys for calling teammates (data/system/api-keys.md; only key hashes are stored).
import crypto from 'node:crypto';
import { HttpError } from '../util/errors.js';
import { newId } from '../util/ids.js';

const KEY_PREFIX = 'dtk';
const KEYS_FILE = ['system', 'api-keys.md'];
const SECRET_FILE = ['system', 'session-secret.md'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const ROLES = ['viewer', 'manager', 'owner'];
const RANK = { viewer: 1, manager: 2, owner: 3 };
/** True when `actor` is a signed-in user with at least `role`. */
export const atLeast = (actor, role) => actor?.type === 'user' && (RANK[actor.role] ?? 0) >= RANK[role];

/**
 * The Teammates role for a core user: core admins and `owner` are owners, `manager` is a manager, and anyone else
 * (core's `user` and `guest`, or `viewer`) is a viewer.
 */
export function roleFromCore(roles = []) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (list.includes('owner') || list.includes('admin')) return 'owner';
  if (list.includes('manager')) return 'manager';
  return 'viewer';
}

export class AuthService {
  constructor(store, { sessionSecret = process.env.SESSION_SECRET, log = console } = {}) {
    this.store = store;
    this.envSecret = sessionSecret;
    this.log = log;
    this.lastUsedWrites = new Map(); // keyId -> ms of last persisted write
    this.lastUsedMem = new Map(); // keyId -> ISO time of last call (may be newer than the file)
    this.pendingUses = new Map(); // keyId -> calls not yet written to the file
  }

  /** Loads (or creates) the secret that signs sessions and CSRF tokens. */
  async init() {
    if (this.envSecret) this.secret = this.envSecret;
    else {
      const doc = await this.store.readDoc(SECRET_FILE);
      this.secret = doc?.data?.secret;
      if (!this.secret) {
        this.secret = b64url(crypto.randomBytes(32));
        await this.store.writeDoc(SECRET_FILE, { secret: this.secret }, 'Signs session cookies and CSRF tokens. Delete this file to sign everyone out (a new secret is generated on start).');
      }
    }
  }

  /** A per-session CSRF token: an HMAC of the core session id, so nothing extra is stored. */
  csrfFor(sessionId) {
    return sessionId ? crypto.createHmac('sha256', this.secret).update(`csrf:${sessionId}`).digest('base64url') : null;
  }

  checkCsrf(sessionId, token) {
    const expected = this.csrfFor(sessionId);
    return Boolean(expected && token) && safeEqual(expected, token);
  }

  // ---------- API keys ----------

  async readKeys() {
    return (await this.store.readDoc(KEYS_FILE))?.data?.keys ?? [];
  }

  async listKeys() {
    return (await this.readKeys())
      .map(({ hash, ...k }) => ({ ...k, lastUsedAt: this.lastUsedMem.get(k.id) ?? k.lastUsedAt, uses: (k.uses ?? 0) + (this.pendingUses.get(k.id) ?? 0) })) // never expose hashes
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateKeys(fn) {
    let result;
    await this.store.updateDoc(KEYS_FILE, (doc) => {
      const keys = doc?.data?.keys ?? [];
      result = fn(keys);
      return { data: { keys }, body: 'API keys for calling teammates. Only SHA-256 hashes of keys are stored.' };
    });
    return result;
  }

  /** Create a key. The full key is returned once and never stored. */
  async createKey({ name, teammates = '*', rateLimit = 30 }) {
    const label = String(name ?? '').trim().slice(0, 60);
    if (!label) throw new HttpError(422, 'validation_failed', 'Give the key a name', { name: 'Required' });
    const limit = Number(rateLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 600) throw new HttpError(422, 'validation_failed', 'Rate limit must be 1–600 calls a minute', { rateLimit: 'Between 1 and 600' });
    const scope = teammates === '*' ? '*' : Array.isArray(teammates) && teammates.length ? [...new Set(teammates.map(String))] : null;
    if (!scope) throw new HttpError(422, 'validation_failed', 'Choose at least one teammate', { teammates: 'Choose at least one teammate' });

    const id = newId('key');
    const secret = b64url(crypto.randomBytes(24));
    const key = `${KEY_PREFIX}_${id.slice(4)}_${secret}`;
    const record = {
      id, name: label, prefix: `${key.slice(0, 16)}…`, hash: sha256(key), teammates: scope, rateLimit: limit,
      createdAt: new Date().toISOString(), lastUsedAt: null, uses: 0, revokedAt: null,
    };
    await this.updateKeys((keys) => keys.push(record));
    const { hash, ...visible } = record;
    return { key, record: visible };
  }

  async revokeKey(id) {
    const found = await this.updateKeys((keys) => {
      const k = keys.find((x) => x.id === id);
      if (k && !k.revokedAt) k.revokedAt = new Date().toISOString();
      return k ? { ...k } : null;
    });
    if (!found) throw new HttpError(404, 'not_found', 'API key not found');
    const { hash, ...visible } = found;
    return visible;
  }

  /** Look up a presented key. Returns the active record or null. */
  async authenticateKey(raw) {
    const match = /^dtk_([a-z0-9]+_[a-f0-9]+)_([\w-]+)$/.exec(String(raw ?? '').trim());
    if (!match) return null;
    const id = `key_${match[1]}`;
    const record = (await this.readKeys()).find((k) => k.id === id);
    if (!record || record.revokedAt || !safeEqual(record.hash, sha256(raw.trim()))) return null;
    return record;
  }

  /** Count a call. Usage is kept in memory and persisted at most once a minute per key to keep writes low. */
  async recordUse(id) {
    const now = Date.now();
    this.pendingUses.set(id, (this.pendingUses.get(id) ?? 0) + 1);
    this.lastUsedMem.set(id, new Date(now).toISOString());
    if (now - (this.lastUsedWrites.get(id) ?? 0) < 60000) return;
    this.lastUsedWrites.set(id, now);
    const uses = this.pendingUses.get(id);
    this.pendingUses.delete(id);
    await this.updateKeys((keys) => {
      const k = keys.find((x) => x.id === id);
      if (k) {
        k.lastUsedAt = new Date(now).toISOString();
        k.uses = (k.uses ?? 0) + uses;
      }
    });
  }

  keyAllows(record, teammateId) {
    return record.teammates === '*' || (Array.isArray(record.teammates) && record.teammates.includes(teammateId));
  }
}

