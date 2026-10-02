'use strict';

const fsSync = require('node:fs');
const config = require('../config');

// Listing projects means reading N project.json files. This caches the summary
// view and invalidates on write or on any change fs.watch reports. If watching
// is unavailable (some network filesystems) it degrades to a short TTL.

const TTL_MS = 5000;

let cache = null;
let cachedAt = 0;
let watcher = null;
let watchWorks = false;

function startWatching() {
  if (watcher) return;
  try {
    watcher = fsSync.watch(config.projectsDir, { persistent: false }, () => invalidate());
    watcher.on('error', () => {
      watchWorks = false;
      watcher = null;
    });
    watchWorks = true;
  } catch {
    watchWorks = false;
  }
}

function invalidate() {
  cache = null;
}

function isFresh() {
  if (!cache) return false;
  if (watchWorks) return true;
  return Date.now() - cachedAt < TTL_MS;
}

function get() {
  return isFresh() ? cache : null;
}

function set(summaries) {
  cache = summaries;
  cachedAt = Date.now();
  startWatching();
  return summaries;
}

function close() {
  watcher?.close();
  watcher = null;
  invalidate();
}

module.exports = { get, set, invalidate, close, _debug: () => ({ watchWorks, cached: Boolean(cache) }) };
