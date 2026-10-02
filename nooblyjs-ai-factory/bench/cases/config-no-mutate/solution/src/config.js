const DEFAULTS = { port: 8080, host: 'localhost', debug: false };

export function withDefaults(options) {
  const out = { ...options };
  for (const [k, v] of Object.entries(DEFAULTS)) if (out[k] === undefined) out[k] = v;
  return out;
}
