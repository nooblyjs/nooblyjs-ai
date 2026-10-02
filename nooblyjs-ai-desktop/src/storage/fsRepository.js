'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { enqueue } = require('./writeQueue');
const { NotFoundError, StorageError } = require('../lib/errors');

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new StorageError(`Could not create directory ${dir}`, err);
  }
}

async function readJson(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFoundError(`No such file: ${path.basename(file)}`);
    throw new StorageError(`Could not read ${file}`, err);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new StorageError(`Malformed JSON in ${file}`, err);
  }
}

// tmp -> fsync -> rename. A crash leaves either the previous complete file or
// the new complete one, never a partial write.
async function writeJsonAtomic(file, value) {
  return enqueue(file, async () => {
    await ensureDir(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let handle;
    try {
      handle = await fs.open(tmp, 'w');
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } catch (err) {
      throw new StorageError(`Could not write ${file}`, err);
    } finally {
      await handle?.close().catch(() => {});
    }
    try {
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw new StorageError(`Could not commit ${file}`, err);
    }
    return value;
  });
}

async function listDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new StorageError(`Could not list ${dir}`, err);
  }
}

async function listFiles(dir, extension = '.json') {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(extension) && !e.name.includes('.tmp-'))
      .map((e) => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new StorageError(`Could not list ${dir}`, err);
  }
}

async function remove(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (err) {
    throw new StorageError(`Could not remove ${target}`, err);
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

module.exports = { ensureDir, readJson, writeJsonAtomic, listDirs, listFiles, remove, exists };
