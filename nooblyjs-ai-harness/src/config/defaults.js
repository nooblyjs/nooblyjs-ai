// Every tunable default lives here, so there is one place to look.
import { SANDBOX_DEFAULTS } from '../sandbox/policy.js';
import { FEEDBACK_DEFAULTS } from '../feedback/index.js';

export const DEFAULTS = {
  // The provider and model are chosen from your API keys unless set here (see src/providers/index.js).
  provider: undefined,
  model: undefined,
  // A cheaper model for side jobs like summarising (Phase 08). Default: the provider's small model.
  smallModel: undefined,
  // Upper limit on how many tokens the model may write in one reply.
  maxTokens: 16000,
  // Most model requests ("rounds") one message may trigger before the agent loop stops.
  maxTurns: 25,
  // Ask the API to retry on a fallback model if the main model declines a request (Anthropic).
  fallbacks: true,
  // Phase 08: summarise the conversation when it fills this share of the context window.
  autoCompact: true,
  compactThreshold: 0.8,
  // Phase 08: override the model's context window, in tokens (e.g. 20000 to watch compaction happen).
  contextWindow: undefined,
  // Phase 09: mark the stable start of each request as cacheable (Anthropic; others cache automatically).
  promptCaching: true,
  // Phase 18: a different address for an OpenAI-compatible API (e.g. a local model), with --provider openai or ollama.
  baseUrl: undefined,
  // Phase 18 (Anthropic): "summarized" shows a summary of the model's thinking; "omitted" (the API default) doesn't.
  thinking: undefined,
  // Phase 18 (Anthropic): how hard the model thinks: low, medium, high, xhigh or max (model default if unset).
  effort: undefined,
  // Phase 06 rules, now configurable (Phase 10).
  permissions: { defaultMode: 'default', allow: [], deny: [] },
  // Extra environment variables for this session (visible to Bash commands).
  env: {},
  // Phase 12: commands run at fixed moments, e.g. { "PostToolUse": [{ "matcher": "Edit", "command": "..." }] }.
  hooks: {},
  // Phase 20: the OS sandbox for Bash. Each field is explained in src/sandbox/policy.js.
  sandbox: { ...SANDBOX_DEFAULTS },
  // Phase 24: quick checks after every Edit/Write, e.g. { "checkers": { "*.py": "python3 -m py_compile \"$FILE\"" } }.
  feedback: { ...FEEDBACK_DEFAULTS },
  // Phase 25: how the model edits files: "auto" (ApplyPatch for OpenAI, Edit for others), "edit" or "patch".
  editTools: 'auto',
  // Phase 27: a map of the codebase in the system prompt: "auto" (25-5,000 source files), "on" or "off". The RepoMap tool is always there.
  repoMap: 'auto',
};

// Model prices (PRICES) and context windows (CONTEXT_WINDOWS, Phase 08) now live in
// nooblyjs-ai-common (src/models.js), shared with the other nooblyjs AI projects.
export { CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW, PRICES } from 'nooblyjs-ai-common/models';
