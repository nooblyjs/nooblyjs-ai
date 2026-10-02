'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
process.env.DEFAULT_ADMIN_PASSWORD = 'core-test-Passw0rd!';
const { bootstrap } = require('../src/storage/bootstrap');
const { createApp } = require('../src/app');
const { getCore, shutdownCore } = require('../src/core');

const app = createApp();

test.before(() => bootstrap());
test.after(async () => {
  await shutdownCore();
  cleanup(dir);
});

test('nooblyjs-core services are created and exposed under /services', async () => {
  const core = getCore();
  for (const name of ['log', 'cache', 'dataServe', 'filing', 'queue', 'searching', 'auth']) {
    assert.ok(core[name], `${name} service should exist`);
  }
  await request(app).get('/services/caching/api/status').expect(200);
});

test('the /services dashboards get core\'s CSP while app pages keep the strict one', async () => {
  const services = await request(app).get('/services/authservice/views/login.html').expect(200);
  assert.match(services.headers['content-security-policy'], /script-src [^;]*'unsafe-inline'/);

  const page = await request(app).get('/').expect(200);
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline/);
});

test('a JSON body parsed by the main app still reaches core routes', async () => {
  // The admin user is created asynchronously on first start.
  const auth = getCore().auth;
  for (let i = 0; i < 50; i++) {
    try {
      await auth.authenticateUser('admin@localhost', process.env.DEFAULT_ADMIN_PASSWORD);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const login = await request(app)
    .post('/services/authservice/api/login')
    .send({ email: 'admin@localhost', password: process.env.DEFAULT_ADMIN_PASSWORD })
    .expect(200);
  const token = login.body.data.session.token;

  await request(app)
    .post('/services/caching/api/put/greeting')
    .set('Authorization', `Bearer ${token}`)
    .send({ value: { hello: 'world' } })
    .expect(200);
  const { body } = await request(app)
    .get('/services/caching/api/get/greeting')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.deepEqual(body.value, { hello: 'world' });
});

test('the services API rejects unauthenticated requests', async () => {
  await request(app).post('/services/caching/api/put/x').send({ value: 1 }).expect(401);
});
