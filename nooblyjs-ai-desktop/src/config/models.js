'use strict';

// The models the app offers, per provider, in menu order. Adding one is a
// one-line edit here and needs no adapter change.
//
// What we know about each model (its label, context window, and quirks like
// tokenParam or supportsTemperature) comes from the shared model catalogue in
// nooblyjs-ai-common, so every nooblyjs AI project agrees on it. A model that
// isn't in the catalogue yet goes there first.

const { getModel } = require('nooblyjs-ai-common/models');

const OFFERED = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner']
};

// tokenParam: which max-output field the OpenAI-compatible API expects
// supportsTemperature: false for reasoning models that reject a custom temperature
function describe(id) {
  const model = getModel(id);
  if (!model) throw new Error(`Model "${id}" is not in the nooblyjs-ai-common model catalogue`);
  return {
    id, // the name we send, which may be an alias such as a dated snapshot
    label: model.label,
    contextWindow: model.contextWindow,
    ...(model.tokenParam ? { tokenParam: model.tokenParam } : {}),
    ...(model.supportsTemperature === false ? { supportsTemperature: false } : {})
  };
}

module.exports = Object.fromEntries(Object.entries(OFFERED).map(([provider, ids]) => [provider, ids.map(describe)]));
