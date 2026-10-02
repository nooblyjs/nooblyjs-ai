import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

const run = (tz) => execFileSync(process.execPath, ['--input-type=module', '-e', "import { addDays } from './src/dates.js'; console.log([addDays('2024-02-28', 2), addDays('2024-03-30', 1), addDays('2024-01-01', -1), addDays('2023-12-31', 1)].join(' '))"], { encoding: 'utf8', env: { ...process.env, TZ: tz } }).trim();

for (const tz of ['UTC', 'Pacific/Auckland', 'America/New_York']) {
  test(`addDays in ${tz}`, () => assert.equal(run(tz), '2024-03-01 2024-03-31 2023-12-31 2024-01-01'));
}
