// Sign-in for people (scrypt passwords, roles, signed session cookies) and API keys for calling teammates.
// Stored in data/system/users.md and data/system/api-keys.md (owner.md is the Phase 3 file, migrated on start). Secrets are never stored in clear text.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../util/errors.js';
import { newId } from '../util/ids.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 7;
const MIN_PASSWORD = 10;
const KEY_PREFIX = 'dtk';
const OWNER_FILE = ['system', 'owner.md'];
const KEYS_FILE = ['system', 'api-keys.md'];
const SECRET_FILE = ['system', 'session-secret.md'];
const USERS_FILE = ['system', 'users.md'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

export const ROLES = ['viewer', 'manager', 'owner'];
const RANK = { viewer: 1, manager: 2, owner: 3 };
/** True when `actor` is a signed-in user with at least `role`. */
export const atLeast = (actor, role) => actor?.type === 'user' && (RANK[actor.role] ?? 0) >= RANK[role];
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const visibleUser = ({ passwordHash, ...u }) => u;
const tempPassword = () => b64url(crypto.randomBytes(12));

export class AuthService {
  constructor(store, { sessionSecret = process.env.SESSION_SECRET, log = console } = {}) {
    this.store = store;
    this.envSecret = sessionSecret;
    this.log = log;
    this.setupCode = null;
    this.lastUsedWrites = new Map(); // keyId -> ms of last persisted write
    this.lastUsedMem = new Map(); // keyId -> ISO time of last call (may be newer than the file)
    this.pendingUses = new Map(); // keyId -> calls not yet written to the file
  }

  /**
   * Load or create the signing secret, move the Phase 3 single owner into the users list, and bootstrap the
   * owner password (env, or a one-time setup code).
   */
  async init({ ownerPassword = process.env.OWNER_PASSWORD, owner: ownerProfile = {} } = {}) {
    if (this.envSecret) this.secret = this.envSecret;
    else {
      const doc = await this.store.readDoc(SECRET_FILE);
      this.secret = doc?.data?.secret;
      if (!this.secret) {
        this.secret = b64url(crypto.randomBytes(32));
        await this.store.writeDoc(SECRET_FILE, { secret: this.secret }, 'Signs session cookies. Delete this file to sign everyone out (a new secret is generated on start).');
      }
    }
    if (!(await this.store.exists(USERS_FILE))) {
      const legacy = (await this.store.readDoc(OWNER_FILE))?.data ?? {};
      const id = ownerProfile.id ?? 'owner';
      await this.writeUsers([{
        id, username: id, name: ownerProfile.name ?? 'Owner', role: 'owner', passwordHash: legacy.passwordHash,
        sessionVersion: legacy.sessionVersion ?? 1, createdAt: new Date().toISOString(), passwordUpdatedAt: legacy.passwordUpdatedAt,
      }]);
    }
    const owner = await this.owner();
    if (!owner.passwordHash) {
      if (ownerPassword) {
        await this.setPassword(owner.id, ownerPassword);
        this.log.info?.('[auth] Owner password set from OWNER_PASSWORD.');
      } else {
        // Letters and digits that can't be confused when read off a terminal (no 0/O, 1/I, - or _).
        const pick = () => Array.from(crypto.randomBytes(4), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
        this.setupCode = `${pick()}-${pick()}`;
        this.log.info?.(`[auth] First run: open the app and enter setup code ${this.setupCode} to choose the owner password.`);
      }
    }
  }

  // ---------- Users ----------

  async readUsers() {
    return (await this.store.readDoc(USERS_FILE))?.data?.users ?? [];
  }

  async writeUsers(users) {
    await this.store.writeDoc(USERS_FILE, { users }, 'People who can sign in. Passwords are stored as scrypt hashes. Roles: owner, manager, viewer.');
  }

  /** Read-modify-write of the users list under the file lock. `fn(users)` mutates in place and may return a value. */
  async updateUsers(fn) {
    let result;
    await this.store.updateDoc(USERS_FILE, (doc) => {
      const users = doc?.data?.users ?? [];
      result = fn(users);
      return { data: { users }, body: doc?.body ?? '' };
    });
    return result;
  }

  async owner() {
    return (await this.readUsers()).find((u) => u.role === 'owner' && !u.disabledAt) ?? {};
  }

  async user(id) {
    return (await this.readUsers()).find((u) => u.id === id) ?? null;
  }

  async listUsers() {
    return (await this.readUsers()).map(visibleUser).sort((a, b) => (RANK[b.role] - RANK[a.role]) || a.name.localeCompare(b.name));
  }

  validateUser(input, users, { existing = null } = {}) {
    const errors = {};
    const out = {};
    if (!existing || input.username !== undefined) {
      const username = String(input.username ?? '').trim().toLowerCase();
      if (!USERNAME.test(username)) errors.username = '2–40 lowercase letters, digits, dots, dashes or underscores';
      else if (users.some((u) => u.username === username && u.id !== existing?.id)) errors.username = 'Someone already has that username';
      else out.username = username;
    }
    if (!existing || input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 60) errors.name = 'Use 1 to 60 characters';
      else out.name = name;
    }
    if (!existing || input.role !== undefined) {
      if (!ROLES.includes(input.role)) errors.role = 'Choose owner, manager or viewer';
      else out.role = input.role;
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  /** Add someone. Returns the user and a temporary password, shown once. */
  async createUser(input) {
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    const user = await this.updateUsers((users) => {
      const fields = this.validateUser(input, users);
      const u = { id: newId('usr'), ...fields, passwordHash, sessionVersion: 1, createdAt: new Date().toISOString(), mustChangePassword: true };
      users.push(u);
      return visibleUser(u);
    });
    return { user, password };
  }

  /** Change name, username, role, or disable/enable. The last active owner can't be demoted or disabled. */
  async updateUser(id, input, actor) {
    return this.updateUsers((users) => {
      const u = users.find((x) => x.id === id);
      if (!u) throw new HttpError(404, 'not_found', 'User not found');
      const patch = this.validateUser(input, users, { existing: u });
      const disabling = input.disabled === true && !u.disabledAt;
      if (id === actor?.id && ((patch.role && patch.role !== u.role) || disabling)) throw new HttpError(409, 'own_account', "You can't change your own role or disable yourself.");
      const losingOwner = u.role === 'owner' && ((patch.role && patch.role !== 'owner') || disabling);
      if (losingOwner && users.filter((x) => x.role === 'owner' && !x.disabledAt).length === 1) {
        throw new HttpError(409, 'last_owner', 'There must always be at least one active owner.');
      }
      const roleChanged = patch.role && patch.role !== u.role;
      Object.assign(u, patch);
      if (roleChanged) u.sessionVersion = (u.sessionVersion ?? 1) + 1; // the new role applies from the next sign-in
      if (input.disabled === true && !u.disabledAt) {
        u.disabledAt = new Date().toISOString();
        u.sessionVersion = (u.sessionVersion ?? 1) + 1; // signs them out
      } else if (input.disabled === false) u.disabledAt = undefined;
      return visibleUser(u);
    });
  }

  /** Issue a new temporary password (shown once) and sign the user out everywhere. */
  async resetPassword(id) {
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    const user = await this.updateUsers((users) => {
      const u = users.find((x) => x.id === id);
      if (!u) throw new HttpError(404, 'not_found', 'User not found');
      Object.assign(u, { passwordHash, sessionVersion: (u.sessionVersion ?? 1) + 1, mustChangePassword: true, passwordUpdatedAt: new Date().toISOString() });
      return visibleUser(u);
    });
    return { user, password };
  }

  get setupRequired() {
    return Boolean(this.setupCode);
  }

  async setPassword(userId, password, { bumpVersion = false } = {}) {
    if (String(password ?? '').length < MIN_PASSWORD) throw new HttpError(422, 'weak_password', `Use at least ${MIN_PASSWORD} characters.`, { password: `At least ${MIN_PASSWORD} characters`, next: `At least ${MIN_PASSWORD} characters` });
    const passwordHash = await hashPassword(String(password));
    await this.updateUsers((users) => {
      const u = users.find((x) => x.id === userId);
      if (!u) throw new HttpError(404, 'not_found', 'User not found');
      Object.assign(u, { passwordHash, mustChangePassword: undefined, passwordUpdatedAt: new Date().toISOString() });
      if (bumpVersion) u.sessionVersion = (u.sessionVersion ?? 1) + 1;
    });
  }

  async setup(code, password) {
    if (!this.setupCode) throw new HttpError(409, 'already_set_up', 'The owner password is already set.');
    if (!safeEqual(String(code ?? '').trim().toUpperCase(), this.setupCode)) throw new HttpError(401, 'invalid_setup_code', 'That setup code is not right. It is printed in the server log.');
    const owner = await this.owner();
    await this.setPassword(owner.id, password);
    this.setupCode = null;
    return this.issueSession(owner.id);
  }

  /** Sign in with a username and password. Without a username, the password is checked against the owner (Phase 3 style). */
  async login(password, username) {
    const users = await this.readUsers();
    const name = String(username ?? '').trim().toLowerCase();
    const u = name ? users.find((x) => x.username === name) : users.find((x) => x.role === 'owner' && !x.disabledAt);
    const ok = u && !u.disabledAt && u.passwordHash && (await verifyPassword(password, u.passwordHash));
    if (!ok) throw new HttpError(401, 'invalid_credentials', name ? 'That username and password do not match.' : 'That password is not right.');
    return this.issueSession(u.id);
  }

  async changePassword(userId, current, next) {
    const u = await this.user(userId);
    if (!u || !(await verifyPassword(current, u.passwordHash))) throw new HttpError(401, 'invalid_credentials', 'Your current password is not right.', { current: 'Not right' });
    await this.setPassword(userId, next, { bumpVersion: true }); // signs out every other session of this user
    return this.issueSession(userId);
  }

  /** Invalidate every session of every user (including the caller's). */
  async signOutEverywhere() {
    await this.updateUsers((users) => users.forEach((u) => (u.sessionVersion = (u.sessionVersion ?? 1) + 1)));
  }

  async issueSession(userId) {
    const u = await this.user(userId);
    const payload = { uid: u.id, v: u.sessionVersion ?? 1, exp: Date.now() + SESSION_DAYS * 86400000, csrf: b64url(crypto.randomBytes(18)) };
    const body = b64url(JSON.stringify(payload));
    return { token: `${body}.${this.sign(body)}`, csrf: payload.csrf, maxAgeMs: SESSION_DAYS * 86400000 };
  }

  sign(text) {
    return crypto.createHmac('sha256', this.secret).update(text).digest('base64url');
  }

  /** Returns `{ ...payload, user }` or null. Checks signature, expiry, the user and their session version. */
  async verifySession(token) {
    const [body, sig] = String(token ?? '').split('.');
    if (!body || !sig || !safeEqual(sig, this.sign(body))) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      return null;
    }
    if (!payload.exp || payload.exp < Date.now()) return null;
    const u = payload.uid ? await this.user(payload.uid) : await this.owner();
    if (!u?.id || u.disabledAt || (u.sessionVersion ?? 1) !== payload.v) return null;
    return { ...payload, user: visibleUser(u) };
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

export const passwordRules = { min: MIN_PASSWORD };
