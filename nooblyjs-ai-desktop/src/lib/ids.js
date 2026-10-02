'use strict';

const crypto = require('node:crypto');

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;

function slugify(input, fallback = 'item') {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function randomSuffix(length = 4) {
  // base36 over random bytes, padded so the suffix is always `length` chars.
  const n = crypto.randomBytes(4).readUInt32BE(0);
  return n.toString(36).padStart(length, '0').slice(-length);
}

function makeId(name, fallback = 'item') {
  return `${slugify(name, fallback)}-${randomSuffix()}`.slice(0, MAX_ID_LENGTH);
}

function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

function messageId() {
  return `m_${Date.now().toString(36)}${randomSuffix(3)}`;
}

module.exports = { slugify, randomSuffix, makeId, isValidId, messageId, ID_PATTERN, MAX_ID_LENGTH };
