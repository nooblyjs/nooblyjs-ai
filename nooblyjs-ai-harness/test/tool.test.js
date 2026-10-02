import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool, validateInput } from '../src/tools/tool.js';

const schema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    count: { type: 'integer' },
    mode: { type: 'string', enum: ['fast', 'slow'] },
  },
  required: ['path'],
  additionalProperties: false,
};

test('validateInput accepts valid input', () => {
  assert.equal(validateInput(schema, { path: 'a', count: 2, mode: 'fast' }), null);
});

test('validateInput explains what is wrong', () => {
  assert.match(validateInput(schema, {}), /Missing required field "path"/);
  assert.match(validateInput(schema, { path: 1 }), /"path" must be of type string/);
  assert.match(validateInput(schema, { path: 'a', count: 1.5 }), /"count" must be of type integer/);
  assert.match(validateInput(schema, { path: 'a', mode: 'medium' }), /must be one of: fast, slow/);
  assert.match(validateInput(schema, { path: 'a', extra: true }), /Unknown field "extra"/);
  assert.match(validateInput(schema, 'nope'), /must be a JSON object/);
});

test('defineTool requires the essentials and defaults isReadOnly to false', () => {
  assert.throws(() => defineTool({ name: 'X' }), /missing "description"/);
  const tool = defineTool({ name: 'X', description: 'd', inputSchema: schema, call: async () => ({ content: '' }) });
  assert.equal(tool.isReadOnly, false);
});

test('registry exports API schemas and rejects duplicates', () => {
  const tool = defineTool({ name: 'X', description: 'd', inputSchema: schema, call: async () => ({ content: '' }) });
  const registry = new ToolRegistry([tool]);
  assert.deepEqual(registry.toApiSchemas(), [{ name: 'X', description: 'd', input_schema: schema }]);
  assert.throws(() => registry.register(tool), /already registered/);
});
