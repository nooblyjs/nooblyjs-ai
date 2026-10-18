// services/tools.js: tool input schemas and private addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInput, isPrivateAddress } from '../../src/services/tools.js';

test('tool inputs are checked against their schema', () => {
  const schema = { type: 'object', properties: { url: { type: 'string' }, n: { type: 'integer' } }, required: ['url'], additionalProperties: false };
  assert.equal(checkInput(schema, { url: 'https://x' }), null);
  assert.equal(checkInput(schema, {}), 'Missing "url"');
  assert.equal(checkInput(schema, { url: 'x', n: 1.5 }), '"n" must be integer');
  assert.equal(checkInput(schema, { url: 'x', other: 1 }), 'Unknown field "other"');
});

test('private and local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});
