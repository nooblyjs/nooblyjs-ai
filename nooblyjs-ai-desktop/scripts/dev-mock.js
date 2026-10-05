'use strict';

// Runs the app with a fake provider registered, so the whole flow can be
// exercised in a browser without any API key. `npm run dev:mock`.

const registry = require('../src/providers/registry');
const { makeMockProvider } = require('./mockProvider');

registry.register(makeMockProvider());

require('../app');
