// The app logger: every line goes to core's rotating log file, and lines at or above `consoleLevel` are echoed to
// the console (the first-run setup code is read from there). Logging never throws and never blocks a request.
const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
// Keys that hold credentials. `tokens` (a count) is not one; `token`, `authToken`, `session_token` are.
const SECRET_WORD = /(secret|password|authorization|api[-_]?key|cookie)/i;
const TOKEN_KEY = /(^token$|[-_]token$|[a-z]Token$)/i;
const isSecret = (key) => SECRET_WORD.test(key) || TOKEN_KEY.test(key);

export function redact(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecret(k) ? '[redacted]' : redact(v)]));
}

/** Accepts log.error(err), log.warn('text'), log.info('text', { fields }) and log.error('text', err). */
function normalize(message, meta) {
  if (message instanceof Error) return { text: message.message, fields: { error: message.name, stack: message.stack, ...redact(meta ?? {}) } };
  if (meta instanceof Error) return { text: String(message), fields: { error: meta.message, stack: meta.stack } };
  return { text: String(message), fields: meta == null ? undefined : redact(meta) };
}

export function createLogger({ file = null, consoleLevel = 'info', console: out = globalThis.console } = {}) {
  const threshold = consoleLevel === false ? Infinity : (RANK[consoleLevel] ?? RANK.info);
  const write = (level) => (message, meta) => {
    const { text, fields } = normalize(message, meta);
    try {
      Promise.resolve(file?.[level]?.(text, fields)).catch(() => {});
    } catch { /* a broken log file must not break the caller */ }
    if (RANK[level] >= threshold) {
      const line = fields && level !== 'error' ? `${text} ${JSON.stringify(fields)}` : text;
      out[level === 'debug' ? 'log' : level](line);
      if (level === 'error' && fields?.stack) out.error(fields.stack);
    }
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

/** Sends to several loggers at once, e.g. core's file log and a caller-supplied logger. */
export function teeLogger(...loggers) {
  const all = loggers.filter(Boolean);
  const write = (level) => (...args) => {
    for (const l of all) l[level]?.(...args);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
