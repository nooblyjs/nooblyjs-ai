// NooblyJS Phase 26: the OpenAPI description of the outside task endpoint (.claude/guides/task-api.openapi.yaml) is
// OpenAPI 3.1 in shape, every $ref resolves, and it matches the routes and the fields the controller reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

const doc = yaml.load(await fs.readFile(new URL('../../.claude/guides/task-api.openapi.yaml', import.meta.url), 'utf8'));
const routes = await fs.readFile(new URL('../../src/routes/api.js', import.meta.url), 'utf8');
const controller = await fs.readFile(new URL('../../src/controllers/tasks.js', import.meta.url), 'utf8');

test('it is OpenAPI 3.1 with info, paths and components, and every $ref resolves', () => {
  assert.equal(doc.openapi, '3.1.0');
  assert.ok(doc.info?.title && doc.info?.version);
  const refs = [];
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) (k === '$ref' ? refs.push(v) : walk(v));
  };
  walk(doc);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    const target = ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], doc);
    assert.ok(target, `${ref} resolves`);
  }
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      assert.ok(op.operationId && op.responses, `${method} ${path}`);
      const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const declared = (op.parameters ?? []).map((p) => (p.$ref ? p.$ref.split('/').pop() : p.name));
      assert.deepEqual(declared.sort(), params.sort(), `${method} ${path} declares its path parameters`);
    }
  }
});

test('its paths are the routes an API key may call, and the request fields are the ones the controller reads', () => {
  assert.match(routes, /r\.post\('\/teammates\/:id\/tasks', userOrKey/);
  assert.match(routes, /r\.get\('\/teammates\/:id\/tasks\/:workId', userOrKey/);
  assert.deepEqual(Object.keys(doc.paths).sort(), ['/teammates/{slug}/tasks', '/teammates/{slug}/tasks/{workId}']);
  for (const field of Object.keys(doc.components.schemas.TaskRequest.properties)) {
    assert.match(controller, new RegExp(`body\\.${field}\\b`), `the controller reads ${field}`);
  }
});
