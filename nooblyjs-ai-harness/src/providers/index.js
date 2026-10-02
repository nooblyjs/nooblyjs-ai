// Which AI company noobly talks to.
//
// Each provider needs an API key in an environment variable. noobly uses the
// first provider whose key it finds, unless you choose one with
// `--provider <id>` or NOOBLY_PROVIDER=<id>:
//
//   anthropic  ANTHROPIC_API_KEY
//   openai     OPENAI_API_KEY
//   grok       XAI_API_KEY (or GROK_API_KEY)
//   ollama     no key: a model running on your own computer (Phase 18)
//
// Model: `--model <id>`, NOOBLY_MODEL=<id>, or `/model <id>` in the chat.
// Otherwise the provider's default model below is used.
import { createEchoProvider } from './echo.js';
import { PROVIDERS as KNOWN, createProvider as connect, providerForModel as catalogueProvider } from 'nooblyjs-ai-common';

// What each provider IS (label, key variables, default and small models, which
// model names are its own, whether it takes images, its address and API style)
// comes from the shared model catalogue in nooblyjs-ai-common (src/models.js), and
// so does the code that talks to it (src/providers/). What stays here is which
// providers noobly offers, and the echo provider, which is noobly's own.
//
// The `baseUrl` setting only moves OpenAI and Ollama, as it always has; any
// provider's address can also be moved with <ID>_BASE_URL (e.g. ANTHROPIC_BASE_URL).
const without = (options, key) => Object.fromEntries(Object.entries(options).filter(([name]) => name !== key));

export const PROVIDERS = {
  anthropic: {
    ...KNOWN.anthropic, // smallModel: a cheaper model for side jobs like summarising (Phase 08); images: Phase 28
    create: (options) => connect('anthropic', without(options, 'baseUrl')),
  },
  openai: {
    ...KNOWN.openai,
    // OpenAI itself: the Responses API, the only one that allows reasoning models to use tools.
    // With a `baseUrl` (setting) it talks to another OpenAI-compatible server (LM Studio, vLLM…)
    // instead, and those usually only have Chat Completions.
    create: (options) => connect('openai', options),
  },
  grok: {
    ...KNOWN.grok,
    create: (options) => connect('grok', without(options, 'baseUrl')),
  },
  // Phase 18: a local model. Install Ollama (https://ollama.com), `ollama pull llama3.2`, then
  // `noobly --provider ollama` (or --model <any model you pulled>). Ollama speaks the OpenAI API,
  // at http://localhost:11434/v1 unless the `baseUrl` setting or OLLAMA_BASE_URL says otherwise.
  ollama: {
    ...KNOWN.ollama,
    create: (options) => connect('ollama', options),
  },
  echo: {
    ...KNOWN.echo,
    create: () => createEchoProvider(),
  },
};

/** Every environment variable that holds a provider API key (Bash hides these from commands). */
export const API_KEY_ENV_VARS = Object.values(PROVIDERS).flatMap((p) => p.envKeys);

/** The API key for a provider, and which variable it came from, or null. */
export function findApiKey(id, env = process.env) {
  for (const name of PROVIDERS[id]?.envKeys ?? []) {
    if (env[name]) return { apiKey: env[name], keyName: name };
  }
  return null;
}

/**
 * Decide which provider to use.
 * @returns {{ id: string, apiKey?: string, keyName?: string }}
 */
export function chooseProvider({ requested, env = process.env } = {}) {
  const wanted = requested ?? env.NOOBLY_PROVIDER;
  if (wanted) {
    if (!PROVIDERS[wanted]) throw new Error(`Unknown provider "${wanted}". Choose one of: ${Object.keys(PROVIDERS).join(', ')}.`);
    if (PROVIDERS[wanted].envKeys.length === 0) return { id: wanted }; // echo and ollama need no key
    const key = findApiKey(wanted, env);
    if (!key) throw new Error(missingKeyHelp(wanted));
    return { id: wanted, ...key };
  }

  for (const id of ['anthropic', 'openai', 'grok']) {
    const key = findApiKey(id, env);
    if (key) return { id, ...key };
  }
  throw new Error(missingKeyHelp());
}

/**
 * Which provider a model name belongs to ("grok-4.7" → "grok"), or null.
 * The catalogue knows models from providers noobly can't talk to yet (Gemini, DeepSeek), so those are null too.
 */
export function providerForModel(model) {
  const id = catalogueProvider(model);
  return PROVIDERS[id] ? id : null;
}

/** Create a provider object ready to use. (Tests pass `fetchImpl` so nothing goes over the network.) */
export function createProvider(id, options = {}) {
  return PROVIDERS[id].create(options);
}

/**
 * Point a running session at another provider (and optionally model).
 * The conversation carries over: history is stored in one format and each
 * provider translates it. Returns a message for the user.
 */
export function switchProvider(session, id, { model, env = process.env } = {}) {
  const { apiKey } = chooseProvider({ requested: id, env });
  const { thinking, effort, baseUrl, fallbacks, promptCaching } = session.settings ?? {};
  session.provider = createProvider(id, { apiKey, thinking, effort, baseUrl, fallbacks, caching: promptCaching });
  session.providerId = id;
  session.model = model ?? PROVIDERS[id].defaultModel;
  return `Switched to ${PROVIDERS[id].label}, model ${session.model}. The conversation continues.`;
}

export function missingKeyHelp(id) {
  const ids = id ? [id] : ['anthropic', 'openai', 'grok'];
  const lines = [id ? `No API key found for ${PROVIDERS[id].label}.` : 'No API key found.', '', 'Set one of these:'];
  for (const each of ids) {
    const p = PROVIDERS[each];
    lines.push(`  export ${`${p.envKeys[0]}=...`.padEnd(22)} # ${p.label}: ${p.keyUrl}`);
  }
  lines.push('', 'Or run a local model with Ollama: noobly --provider ollama', 'Or try noobly offline with: noobly --echo');
  return lines.join('\n');
}
