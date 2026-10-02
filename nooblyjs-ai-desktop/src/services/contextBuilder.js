'use strict';

const { estimate, estimateMessage } = require('../lib/tokens');
const { ValidationError } = require('../lib/errors');

const SAFETY_MARGIN = 1024;
const DOCUMENT_BUDGET_SHARE = 0.4;

const APP_PREAMBLE =
  'You are assisting inside a project workspace. The project description below is ' +
  'standing context supplied by the user; treat it as always relevant background for ' +
  'this conversation, and do not ask the user to repeat it.';

function buildSystemPrompt(project, documentsBlock) {
  const parts = [APP_PREAMBLE, `# Project: ${project.name}`];
  const description = (project.description || '').trim();
  if (description) parts.push(description);
  if (documentsBlock) parts.push(documentsBlock);
  return parts.join('\n\n');
}

/**
 * Fit history to the model's context window, dropping oldest turns first.
 * The system block is never trimmed — the project description is the point.
 */
function fitToBudget(messages, budget) {
  const kept = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = estimateMessage(messages[i]);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(messages[i]);
  }

  // A window must not open on an assistant turn — providers reject that, and it
  // reads as the model talking to itself.
  while (kept.length > 0 && kept[0].role === 'assistant') {
    used -= estimateMessage(kept[0]);
    kept.shift();
  }

  return { kept, used, truncated: kept.length < messages.length };
}

/**
 * A turn that failed leaves the user's message with no assistant reply after it,
 * so the next turn would send two user messages back to back. Several providers
 * reject that, so adjacent same-role turns are combined.
 */
function mergeConsecutive(messages) {
  const merged = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  }
  return merged;
}

/**
 * Pure: project + chat + new message -> CompletionRequest. No I/O, so the
 * budgeting rules are directly testable.
 */
/**
 * How much of the context window retrieved documents may occupy. History and
 * the project description always come first; documents fill what is left.
 */
function documentBudget({ model, maxOutputTokens, project }) {
  const base = model.contextWindow - estimate(buildSystemPrompt(project)) - maxOutputTokens - SAFETY_MARGIN;
  return Math.max(0, Math.floor(base * DOCUMENT_BUDGET_SHARE));
}

function build({ project, messages, model, temperature, maxOutputTokens, documentsBlock }) {
  const system = buildSystemPrompt(project, documentsBlock);
  const budget = model.contextWindow - estimate(system) - maxOutputTokens - SAFETY_MARGIN;

  if (budget <= 0) {
    throw new ValidationError(
      `The project context plus reserved output (${maxOutputTokens} tokens) exceeds ` +
        `the ${model.label} context window. Shorten the description or lower max output tokens.`
    );
  }

  const { kept, truncated } = fitToBudget(messages, budget);

  if (kept.length === 0) {
    throw new ValidationError(
      `That message is too large for the ${model.label} context window. Send something shorter.`
    );
  }

  return {
    system,
    messages: mergeConsecutive(kept),
    model: model.id,
    temperature,
    maxOutputTokens,
    truncatedHistory: truncated,
    droppedCount: messages.length - kept.length
  };
}

module.exports = {
  build,
  buildSystemPrompt,
  documentBudget,
  fitToBudget,
  mergeConsecutive,
  APP_PREAMBLE,
  SAFETY_MARGIN,
  DOCUMENT_BUDGET_SHARE
};
