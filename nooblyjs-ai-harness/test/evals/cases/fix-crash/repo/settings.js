const DEFAULTS = { port: 3000, host: 'localhost' };

export function loadSettings(overrides = {}) {
  const settings = { ...DEFAULTS, ...overrides };
  if (settings.port < 1 || settings.port > 65535) {
    throw new Error(`Invalid port ${settings.port}`);
  return settings;
}
