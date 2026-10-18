// Sign-in sessions kept in a file, so a server restart doesn't sign everyone out (core's default store is memory).
// Keys are SHA-256 hashes of the session ids, so the file can't be used to take over a session; it is still
// readable only by the server's user (0600). Expired sessions are pruned. Writes are batched and atomic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRUNE_MS = 10 * 60000;
const WRITE_DELAY_MS = 250;
const DEFAULT_TTL_MS = 24 * 3600000;

const hash = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');

/** Milliseconds until the session's cookie expires. */
function ttlFor(sess) {
  const expires = sess?.cookie?.expires;
  if (expires) return Math.max(1, new Date(expires).getTime() - Date.now());
  const maxAge = sess?.cookie?.originalMaxAge;
  return maxAge > 0 ? maxAge : DEFAULT_TTL_MS;
}

/** Returns a FileSessionStore class for the given express-session module (its Store base class). */
export function fileSessionStore(session) {
  return class FileSessionStore extends session.Store {
    constructor({ file, log = null }) {
      super();
      this.file = file;
      this.log = log;
      this.sessions = new Map(); // sha256(sid) -> { sess, expiresAt }
      this.writeTimer = null;
      this.writing = Promise.resolve();
      this.load();
      this.pruneTimer = setInterval(() => this.prune(), PRUNE_MS);
      this.pruneTimer.unref();
    }

    load() {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const now = Date.now();
        for (const [key, entry] of Object.entries(saved.sessions ?? {})) if (entry.expiresAt > now) this.sessions.set(key, entry);
      } catch (err) {
        if (err.code !== 'ENOENT') this.log?.warn?.(`[sessions] could not read ${this.file}; starting with no sessions: ${err.message}`);
      }
    }

    get(sid, cb) {
      const key = hash(sid);
      const entry = this.sessions.get(key);
      if (!entry) return cb(null, null);
      if (entry.expiresAt <= Date.now()) {
        this.sessions.delete(key);
        this.saveSoon();
        return cb(null, null);
      }
      cb(null, structuredClone(entry.sess));
    }

    set(sid, sess, cb) {
      this.sessions.set(hash(sid), { sess: JSON.parse(JSON.stringify(sess)), expiresAt: Date.now() + ttlFor(sess) });
      this.saveSoon();
      cb?.(null);
    }

    touch(sid, sess, cb) {
      const entry = this.sessions.get(hash(sid));
      if (entry) {
        entry.expiresAt = Date.now() + ttlFor(sess);
        if (sess?.cookie) entry.sess.cookie = JSON.parse(JSON.stringify(sess.cookie));
        this.saveSoon();
      }
      cb?.(null);
    }

    destroy(sid, cb) {
      this.sessions.delete(hash(sid));
      this.saveSoon();
      cb?.(null);
    }

    length(cb) {
      cb(null, this.sessions.size);
    }

    clear(cb) {
      this.sessions.clear();
      this.saveSoon();
      cb?.(null);
    }

    prune() {
      const now = Date.now();
      let removed = 0;
      for (const [key, entry] of this.sessions) {
        if (entry.expiresAt <= now) {
          this.sessions.delete(key);
          removed += 1;
        }
      }
      if (removed) this.saveSoon();
    }

    snapshot() {
      return JSON.stringify({ sessions: Object.fromEntries(this.sessions) });
    }

    saveSoon() {
      if (this.writeTimer) return;
      this.writeTimer = setTimeout(() => {
        this.writeTimer = null;
        const text = this.snapshot();
        this.writing = this.writing.then(() => this.write(text)).catch((err) => this.log?.warn?.(`[sessions] could not save sessions: ${err.message}`));
      }, WRITE_DELAY_MS);
      this.writeTimer.unref();
    }

    async write(text) {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${crypto.randomBytes(4).toString('hex')}`;
      await fs.promises.writeFile(tmp, text, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    }

    /** Writes any pending change now and stops the timers. Called at shutdown. */
    async close() {
      clearInterval(this.pruneTimer);
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
        const text = this.snapshot();
        this.writing = this.writing.then(() => this.write(text));
      }
      await this.writing.catch(() => {});
    }
  };
}
