// Backup and restore of data/ (Phase 13). NooblyJS keeps everything in files, so a backup is a copy of the folder with a
// manifest: every file's size and SHA-256, and how many audit records each day holds. A restore copies it back into
// an EMPTY data folder and checks every hash and the audit log before it says it worked.
//
//   <BACKUP_DIR>/noobly-20261011-0200/
//     manifest.json    { createdAt, files: [{ path, size, sha256 }], audit: { days, records, perDay }, … }
//     data/…           the files
//
// What is left out: logs, the Software Factory's workspaces and caches (re-made from the repositories), temporary
// files of a write in progress, and the files that hold a generated secret (each is made again at start). A backup
// still holds people's names and the sign-in store, so it is kept as carefully as data/ itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import yaml from 'js-yaml';

const NAME = /^noobly-\d{8}-\d{6}$/;
/** Folders and files not backed up, as paths under data/ (forward slashes). */
export const LEFT_OUT = Object.freeze(['logs', 'factory/workspaces', 'factory/cache', 'factory/secret', 'factory/dashboard-token', 'core/auth/INITIAL_ADMIN_PASSWORD.txt']);
const TRANSIENT = /\.tmp-[0-9a-f]{8}$|\.lock$/;

const stamp = (at) => new Date(at).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const skipped = (rel) => TRANSIENT.test(rel) || LEFT_OUT.some((p) => rel === p || rel.startsWith(`${p}/`));

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Every file under `root`, as paths relative to it with forward slashes, sorted. */
async function walk(root, rel = '') {
  const out = [];
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (skipped(next) || e.isSymbolicLink()) continue;
    if (e.isDirectory()) out.push(...await walk(root, next));
    else if (e.isFile()) out.push(next);
  }
  return out;
}

/** The audit log of a data folder: how many records each day's stream holds. A day that does not parse is an error. */
export async function auditCount(dataDir) {
  const days = (await walk(path.join(dataDir, 'audit'))).filter((f) => f.endsWith('.yaml'));
  const perDay = {};
  let records = 0;
  for (const day of days) {
    const text = await fs.readFile(path.join(dataDir, 'audit', day), 'utf8');
    const docs = yaml.loadAll(text, null, { schema: yaml.CORE_SCHEMA }).flat().filter((r) => r && typeof r === 'object');
    for (const r of docs) if (!r.id || !r.at || !r.action) throw new Error(`audit/${day} holds a record with no id, time or action.`);
    perDay[day] = docs.length;
    records += docs.length;
  }
  return { days: days.length, records, perDay };
}

/**
 * @param {object} options
 * @param {string} options.dataDir     the folder to back up (DATA_DIR)
 * @param {string} options.backupDir   where backups go (BACKUP_DIR); never inside dataDir
 * @param {number} [options.keep]      how many to keep (the oldest go)
 */
export function createBackups({ dataDir, backupDir, keep = 14, clock = Date, log = null, version = null }) {
  const data = path.resolve(dataDir);
  const root = backupDir ? path.resolve(backupDir) : null;
  const check = () => {
    if (!root) throw new Error('Set BACKUP_DIR to the folder backups go to.');
    const inside = path.relative(data, root);
    if (!inside || (!inside.startsWith('..') && !path.isAbsolute(inside))) throw new Error(`BACKUP_DIR (${root}) must not be inside the data folder (${data}): a backup would copy itself.`);
  };

  /** The backups there are, newest first: [{ name, path, createdAt, files, bytes }]. */
  async function list() {
    if (!root) return [];
    const names = (await fs.readdir(root).catch(() => [])).filter((n) => NAME.test(n)).sort().reverse();
    const out = [];
    for (const name of names) {
      const m = await fs.readFile(path.join(root, name, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (m) out.push({ name, path: path.join(root, name), createdAt: m.createdAt, files: m.files.length, bytes: m.bytes, audit: { days: m.audit.days, records: m.audit.records } });
    }
    return out;
  }

  /** Copies data/ to a new backup and writes its manifest. Resolves with { name, path, files, bytes, audit }. */
  async function create() {
    check();
    const at = clock.now();
    const name = `noobly-${stamp(at)}`;
    const target = path.join(root, name);
    const partial = `${target}.partial`;
    if (await fs.stat(target).catch(() => null)) throw new Error(`There is already a backup called ${name}.`);
    await fs.rm(partial, { recursive: true, force: true });
    await fs.mkdir(path.join(partial, 'data'), { recursive: true });
    const files = [];
    let bytes = 0;
    for (const rel of await walk(data)) {
      const to = path.join(partial, 'data', rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      // A file can go while we copy (a temporary one, a rotated log): that one is left out, the rest go on.
      const copied = await fs.copyFile(path.join(data, rel), to).then(() => true, (err) => (err.code === 'ENOENT' ? false : Promise.reject(err)));
      if (!copied) continue;
      const size = (await fs.stat(to)).size;
      files.push({ path: rel, size, sha256: await sha256(to) });
      bytes += size;
    }
    // The audit count is taken from the copy, so the manifest describes exactly what the backup holds.
    const audit = await auditCount(path.join(partial, 'data'));
    const manifest = { format: 1, name, createdAt: new Date(at).toISOString(), version, source: data, leftOut: LEFT_OUT, bytes, files, audit };
    await fs.writeFile(path.join(partial, 'manifest.json'), JSON.stringify(manifest, null, 1));
    await fs.rename(partial, target);
    const removed = await prune();
    log?.info?.(`backup: ${name} (${files.length} files, ${audit.records} audit records)${removed.length ? `; removed ${removed.join(', ')}` : ''}`);
    return { name, path: target, files: files.length, bytes, audit: { days: audit.days, records: audit.records }, removed };
  }

  /** Keeps the newest `keep` backups. */
  async function prune() {
    const all = (await fs.readdir(root).catch(() => [])).filter((n) => NAME.test(n)).sort().reverse();
    const gone = all.slice(Math.max(Number(keep) || 14, 1));
    for (const name of gone) await fs.rm(path.join(root, name), { recursive: true, force: true });
    return gone;
  }

  return { list, create, prune, dir: root, lastFor: async () => (await list())[0] ?? null };
}

/**
 * Checks a backup against its manifest: every file is there with the size and hash the manifest says, nothing else is,
 * and the audit log holds the records it should. Resolves with { ok, files, problems: [..] }.
 */
export async function verifyBackup(backupPath, { dataPath = path.join(backupPath, 'data') } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(backupPath, 'manifest.json'), 'utf8'));
  const problems = [];
  const present = new Set(await walk(dataPath));
  for (const f of manifest.files) {
    if (!present.has(f.path)) { problems.push(`missing: ${f.path}`); continue; }
    present.delete(f.path);
    const full = path.join(dataPath, f.path);
    if ((await fs.stat(full)).size !== f.size || (await sha256(full)) !== f.sha256) problems.push(`changed: ${f.path}`);
  }
  for (const extra of present) problems.push(`not in the backup: ${extra}`);
  let audit = null;
  try {
    audit = await auditCount(dataPath);
    if (audit.records !== manifest.audit.records || audit.days !== manifest.audit.days) problems.push(`the audit log holds ${audit.records} records over ${audit.days} days; the backup recorded ${manifest.audit.records} over ${manifest.audit.days}`);
  } catch (err) {
    problems.push(`the audit log does not read: ${err.message}`);
  }
  return { ok: problems.length === 0, name: manifest.name, createdAt: manifest.createdAt, files: manifest.files.length, audit, problems };
}

/**
 * Restores a backup into `dataDir`, which must be empty or not there (a restore never overwrites: move the old
 * folder away first). Verifies the backup before copying and the restored folder after.
 */
export async function restoreBackup(backupPath, dataDir) {
  const source = path.resolve(backupPath);
  const target = path.resolve(dataDir);
  if (!(await fs.stat(path.join(source, 'manifest.json')).catch(() => null))) throw new Error(`${source} is not a backup (no manifest.json).`);
  const existing = await fs.readdir(target).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
  if (existing.length) throw new Error(`${target} is not empty (${existing.length} entries). A restore never overwrites: move that folder away, or restore into a new one.`);
  const before = await verifyBackup(source);
  if (!before.ok) throw new Error(`The backup is damaged and was not restored: ${before.problems.slice(0, 5).join('; ')}`);
  await fs.mkdir(target, { recursive: true });
  // The target is empty (checked above), so nothing can be overwritten.
  await fs.cp(path.join(source, 'data'), target, { recursive: true, force: false });
  const after = await verifyBackup(source, { dataPath: target });
  return { ...after, restoredTo: target };
}

/**
 * The nightly backup: one a day, at the first check at or after `hour` (local time) on a day that has none yet.
 * Resolves with the backup made, or null when none was due. Business time comes from the clock.
 */
export async function nightlyBackup(backups, { clock = Date, hour = 2 } = {}) {
  const at = new Date(clock.now());
  if (at.getHours() < hour) return null;
  const sameDay = (iso) => { const d = new Date(iso); return d.getFullYear() === at.getFullYear() && d.getMonth() === at.getMonth() && d.getDate() === at.getDate(); };
  if ((await backups.list()).some((b) => sameDay(b.createdAt))) return null;
  return backups.create();
}
