import { readJson } from '../../checks.js';

const EXPECTED = { name: 'widget-server', port: 8080, host: '0.0.0.0', debug: true, plugins: ['auth', 'logging'], limits: { requestsPerMinute: 120, maxBodyKb: 512 } };

export default async function check({ dir }) {
  let config;
  try {
    config = readJson(dir, 'config.json');
  } catch (error) {
    return { pass: false, message: `config.json is not valid JSON: ${error.message}` };
  }
  const sorted = (value) => JSON.stringify(value, Object.keys(value).sort());
  return sorted(config) === sorted(EXPECTED) && JSON.stringify(config.limits) === JSON.stringify(EXPECTED.limits)
    ? { pass: true }
    : { pass: false, message: `config.json is ${JSON.stringify(config)}` };
}
