'use strict';

// Deliberately dependency-free and deliberately conservative: a real tokeniser
// per provider is a heavy dependency for a budget that already carries a safety
// margin. ~3.6 chars/token under-estimates capacity rather than over-estimating.
const CHARS_PER_TOKEN = 3.6;
const PER_MESSAGE_OVERHEAD = 4;

function estimate(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

function estimateMessage(message) {
  return estimate(message.content) + PER_MESSAGE_OVERHEAD;
}

function estimateMessages(messages) {
  return messages.reduce((sum, m) => sum + estimateMessage(m), 0);
}

module.exports = { estimate, estimateMessage, estimateMessages, CHARS_PER_TOKEN, PER_MESSAGE_OVERHEAD };
