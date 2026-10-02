'use strict';

const MAX_TITLE_LENGTH = 60;

function deriveTitle(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  if (flat.length <= MAX_TITLE_LENGTH) return flat;

  const cut = flat.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > MAX_TITLE_LENGTH * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

module.exports = { deriveTitle, MAX_TITLE_LENGTH };
