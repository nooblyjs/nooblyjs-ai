// @ts-check
// Phase F05: ARTIFACTS. Files a run produced, stored by their content.
//
//   ~/.factory/artifacts/3f/9a1c…   (the file's sha256: first 2 characters as a folder)
//
// "Content-addressed" means the name IS the hash of the contents:
//   - storing the same bytes twice stores them once
//   - a file can't be changed without its name changing, so an event that says
//     "the PR text was 3f9a1c…" stays true forever
//   - writing is safe to retry: same content, same place
//
// The event log records WHICH artifacts a run has (artifact.stored); the bytes
// live here, outside the database, because transcripts and diffs can be large.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../util/paths.js';

const dirOf = (env) => path.join(factoryHome(env), 'artifacts');
const pathOf = (sha, env) => path.join(dirOf(env), sha.slice(0, 2), sha.slice(2));

/**
 * Store bytes; returns their address.
 * @param {string | Buffer} content
 * @returns {{ sha: string, bytes: number, path: string }}
 */
export function putArtifact(content, env = process.env) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const file = pathOf(sha, env);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file); // atomic: a reader never sees half a file
  }
  return { sha, bytes: buffer.length, path: file };
}

/** @returns {Buffer | null} */
export function getArtifact(sha, env = process.env) {
  const file = pathOf(sha, env);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

/**
 * Store content and record it on a run.
 * @param {import('./events.js').Store} store
 * @param {{ runId: string, kind: string, name: string, content: string | Buffer }} artifact
 */
export function recordArtifact(store, { runId, kind, name, content }) {
  const { sha, bytes } = putArtifact(content, store.env);
  store.append(`run:${runId}`, 'artifact.stored', { runId, kind, name, sha, bytes }, { key: `artifact:${runId}:${kind}:${sha}` });
  return sha;
}
