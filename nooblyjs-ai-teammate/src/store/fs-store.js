// File-system store: every entity is a Markdown file with YAML front matter.
// Writes are atomic (tmp + rename) and serialized per path with an async mutex.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class StoreError extends Error {}

export function parseMarkdown(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text };
  // CORE_SCHEMA keeps ISO dates as strings instead of Date objects.
  const data = yaml.load(match[1], { schema: yaml.CORE_SCHEMA }) ?? {};
  return { data, body: match[2].replace(/^\r?\n/, '') };
}

export function serializeMarkdown(data, body = '') {
  const front = yaml.dump(stripUndefined(data), { schema: yaml.CORE_SCHEMA, lineWidth: 100, noRefs: true });
  return `---\n${front}---\n\n${body.trim()}\n`;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)]),
    );
  }
  return value;
}

export class FsStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.locks = new Map();
  }

  /** Resolve path segments under the data root, rejecting anything that could escape it. */
  resolve(segments) {
    for (const s of segments) {
      if (typeof s !== 'string' || !SEGMENT.test(s) || s.includes('..')) {
        throw new StoreError(`Invalid path segment: ${JSON.stringify(s)}`);
      }
    }
    const full = path.resolve(this.root, ...segments);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new StoreError('Path escapes data directory');
    }
    return full;
  }

  async withLock(segments, fn) {
    const key = this.resolve(segments);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((r) => (release = r));
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  async exists(segments) {
    try {
      await fs.access(this.resolve(segments));
      return true;
    } catch {
      return false;
    }
  }

  async readText(segments) {
    try {
      return await fs.readFile(this.resolve(segments), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeText(segments, text) {
    const full = this.resolve(segments);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, full);
  }

  async writeBuffer(segments, buffer) {
    const full = this.resolve(segments);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, buffer);
    await fs.rename(tmp, full);
  }

  async readDoc(segments) {
    const text = await this.readText(segments);
    return text == null ? null : parseMarkdown(text);
  }

  async writeDoc(segments, data, body = '') {
    await this.writeText(segments, serializeMarkdown(data, body));
  }

  /** Read-modify-write under the path lock. `fn` receives the doc (or null) and returns the new doc. */
  async updateDoc(segments, fn) {
    return this.withLock(segments, async () => {
      const doc = await this.readDoc(segments);
      const next = await fn(doc);
      if (next) await this.writeDoc(segments, next.data, next.body ?? '');
      return next;
    });
  }

  async list(segments, { dirs = false } = {}) {
    try {
      const entries = await fs.readdir(this.resolve(segments), { withFileTypes: true });
      return entries
        .filter((e) => (dirs ? e.isDirectory() : e.isFile()) && !e.name.includes('.tmp-') && SEGMENT.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async remove(segments) {
    await fs.rm(this.resolve(segments), { recursive: true, force: true });
  }

  async move(from, to) {
    const target = this.resolve(to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(this.resolve(from), target);
  }
}
