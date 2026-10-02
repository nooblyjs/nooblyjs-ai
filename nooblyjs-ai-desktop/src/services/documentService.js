'use strict';

const fs = require('node:fs/promises');
const nodePath = require('node:path');
const paths = require('../storage/paths');
const repo = require('../storage/fsRepository');
const projectService = require('./projectService');
const { enqueue } = require('../storage/writeQueue');
const { ValidationError, NotFoundError, StorageError } = require('../lib/errors');
const logger = require('../lib/logger');

const EXTENSION = '.md';
const MAX_DOCUMENT_BYTES = 1_000_000;

function isMarkdown(name) {
  return name.toLowerCase().endsWith(EXTENSION);
}

function withExtension(name) {
  return isMarkdown(name) ? name : `${name}${EXTENSION}`;
}

function joinRel(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function parentOf(relPath) {
  const segments = paths.splitRelPath(relPath);
  return segments.slice(0, -1).join('/');
}

/**
 * A symlink inside the documents directory could point outside it, which the
 * lexical containment check cannot see. Resolving the real path closes that gap.
 */
async function assertRealPathContained(projectId, absolute) {
  const root = paths.documentsDir(projectId);
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return; // root does not exist yet, so nothing can escape through it
  }
  let real;
  try {
    real = await fs.realpath(absolute);
  } catch {
    return; // target does not exist yet; the parent was already checked
  }
  if (real !== realRoot && !real.startsWith(realRoot + nodePath.sep)) {
    throw new ValidationError('Path escapes the documents directory');
  }
}

async function ensureRoot(projectId) {
  await projectService.get(projectId);
  const root = paths.documentsDir(projectId);
  await repo.ensureDir(root);
  return root;
}

/** Recursively reads the documents directory into a sorted tree. */
async function readTree(projectId, relPath = '', depth = 0) {
  if (depth > 16) return [];
  const absolute = paths.documentPath(projectId, relPath);
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new StorageError(`Could not read documents in ${relPath || '/'}`, err);
  }

  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = joinRel(relPath, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        type: 'folder',
        name: entry.name,
        path: childRel,
        children: await readTree(projectId, childRel, depth + 1)
      });
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      const stats = await fs.stat(nodePath.join(absolute, entry.name)).catch(() => null);
      nodes.push({
        type: 'document',
        name: entry.name,
        title: entry.name.slice(0, -EXTENSION.length),
        path: childRel,
        size: stats?.size ?? 0,
        updatedAt: stats?.mtime.toISOString() ?? null
      });
    }
    // Symlinks and non-markdown files are ignored rather than surfaced.
  }

  // Folders first, then documents, each alphabetical.
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return nodes;
}

async function tree(projectId) {
  await ensureRoot(projectId);
  return readTree(projectId);
}

/** Flat list of every document path in the project, for pickers and retrieval. */
async function listDocuments(projectId) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'folder') walk(node.children);
      else out.push(node);
    }
  };
  walk(await tree(projectId));
  return out;
}

async function readDocument(projectId, relPath) {
  const segments = paths.splitRelPath(relPath);
  if (segments.length === 0) throw new ValidationError('A document path is required');
  if (!isMarkdown(segments.at(-1))) throw new ValidationError('Only .md documents are supported');

  const absolute = paths.documentPath(projectId, relPath);
  await assertRealPathContained(projectId, absolute);

  let content;
  try {
    content = await fs.readFile(absolute, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFoundError(`Document ${relPath} not found`);
    if (err.code === 'EISDIR') throw new ValidationError(`${relPath} is a folder, not a document`);
    throw new StorageError(`Could not read ${relPath}`, err);
  }

  const stats = await fs.stat(absolute).catch(() => null);
  return {
    type: 'document',
    path: relPath,
    name: segments.at(-1),
    title: segments.at(-1).slice(0, -EXTENSION.length),
    content,
    size: stats?.size ?? content.length,
    updatedAt: stats?.mtime.toISOString() ?? null
  };
}

async function writeDocument(projectId, relPath, content) {
  await ensureRoot(projectId);
  const segments = paths.splitRelPath(relPath);
  if (segments.length === 0) throw new ValidationError('A document path is required');
  if (!isMarkdown(segments.at(-1))) throw new ValidationError('Only .md documents are supported');

  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new ValidationError('Document is too large (1 MB limit)', { content: 'too large' });
  }

  const absolute = paths.documentPath(projectId, relPath);
  const parent = nodePath.dirname(absolute);
  if (!(await repo.exists(parent))) {
    throw new NotFoundError(`Folder ${parentOf(relPath) || '/'} does not exist`);
  }
  await assertRealPathContained(projectId, parent);

  // Same atomic tmp -> rename discipline as the JSON store.
  await enqueue(absolute, async () => {
    const tmp = `${absolute}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    let handle;
    try {
      handle = await fs.open(tmp, 'w');
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } catch (err) {
      throw new StorageError(`Could not write ${relPath}`, err);
    } finally {
      await handle?.close().catch(() => {});
    }
    try {
      await fs.rename(tmp, absolute);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw new StorageError(`Could not commit ${relPath}`, err);
    }
  });

  return readDocument(projectId, relPath);
}

async function createDocument(projectId, parentPath, name, content = '') {
  await ensureRoot(projectId);
  const filename = withExtension(String(name ?? '').trim());
  paths.assertCreatableSegment(filename);
  const relPath = joinRel(parentPath || '', filename);

  if (await repo.exists(paths.documentPath(projectId, relPath))) {
    throw new ValidationError(`"${filename}" already exists here`, { name: 'duplicate' });
  }
  return writeDocument(projectId, relPath, content);
}

async function createFolder(projectId, parentPath, name) {
  await ensureRoot(projectId);
  const folderName = paths.assertCreatableSegment(String(name ?? '').trim());
  if (isMarkdown(folderName)) throw new ValidationError('A folder cannot be named like a document');

  const relPath = joinRel(parentPath || '', folderName);
  const absolute = paths.documentPath(projectId, relPath);
  if (await repo.exists(absolute)) {
    throw new ValidationError(`"${folderName}" already exists here`, { name: 'duplicate' });
  }
  const parent = nodePath.dirname(absolute);
  if (!(await repo.exists(parent))) throw new NotFoundError('Parent folder does not exist');

  await repo.ensureDir(absolute);
  return { type: 'folder', name: folderName, path: relPath, children: [] };
}

async function remove(projectId, relPath) {
  await ensureRoot(projectId);
  const segments = paths.splitRelPath(relPath);
  if (segments.length === 0) throw new ValidationError('Refusing to delete the documents root');

  const absolute = paths.documentPath(projectId, relPath);
  if (!(await repo.exists(absolute))) throw new NotFoundError(`${relPath} not found`);
  await assertRealPathContained(projectId, absolute);
  paths.assertContained(absolute, paths.documentsDir(projectId));

  await repo.remove(absolute);
  logger.info('Document entry deleted', { projectId, path: relPath });
}

/**
 * Moves or renames an entry. `destination` is the full new relative path, so
 * this covers both dragging into a folder and renaming in place.
 */
async function move(projectId, fromPath, destination) {
  await ensureRoot(projectId);
  const fromSegments = paths.splitRelPath(fromPath);
  const toSegments = paths.splitRelPath(destination);
  if (fromSegments.length === 0) throw new ValidationError('Cannot move the documents root');
  if (toSegments.length === 0) throw new ValidationError('A destination is required');

  const fromAbs = paths.documentPath(projectId, fromPath);
  const toAbs = paths.documentPath(projectId, destination);

  if (!(await repo.exists(fromAbs))) throw new NotFoundError(`${fromPath} not found`);
  await assertRealPathContained(projectId, fromAbs);

  // The destination is newly created, so it must satisfy the portability rules.
  paths.assertCreatableSegment(toSegments.at(-1));

  const fromIsDir = (await fs.stat(fromAbs)).isDirectory();
  if (!fromIsDir && !isMarkdown(toSegments.at(-1))) {
    throw new ValidationError('A document must keep its .md extension');
  }

  // Moving a folder into itself or its own descendant would detach the subtree.
  const fromKey = `${fromSegments.join('/')}/`;
  const toKey = `${toSegments.join('/')}/`;
  if (fromIsDir && toKey.startsWith(fromKey)) {
    throw new ValidationError('Cannot move a folder into itself');
  }
  if (fromSegments.join('/') === toSegments.join('/')) return { path: destination };

  if (await repo.exists(toAbs)) {
    throw new ValidationError(`"${toSegments.at(-1)}" already exists in the destination`, {
      name: 'duplicate'
    });
  }

  const destParent = nodePath.dirname(toAbs);
  if (!(await repo.exists(destParent))) throw new NotFoundError('Destination folder does not exist');
  await assertRealPathContained(projectId, destParent);

  try {
    await fs.rename(fromAbs, toAbs);
  } catch (err) {
    throw new StorageError(`Could not move ${fromPath}`, err);
  }
  logger.info('Document entry moved', { projectId, from: fromPath, to: destination });
  return { path: destination, type: fromIsDir ? 'folder' : 'document' };
}

module.exports = {
  tree,
  listDocuments,
  readDocument,
  writeDocument,
  createDocument,
  createFolder,
  remove,
  move,
  parentOf,
  joinRel,
  isMarkdown,
  EXTENSION,
  MAX_DOCUMENT_BYTES
};
