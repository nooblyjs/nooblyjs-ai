const DEFAULTS = { port: 8080, host: 'localhost', debug: false };

export function withDefaults(options) {
  for (const [k, v] of Object.entries(DEFAULTS)) if (options[k] === undefined) options[k] = v;
  return options;
}
