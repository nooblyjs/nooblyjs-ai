/**
 * @fileoverview Route registration ORDER for the datasources workflow routes.
 *
 * Express matches routes in registration order, so a literal path registered
 * AFTER a parameterised one that can swallow it is dead: `/api/workflows/x`
 * binds as `:id = "x"` and the `:id` handler answers 404 "Workflow not found".
 * That is indistinguishable from an unregistered endpoint, and — because the
 * auth middleware redirects unauthenticated callers BEFORE routing — it is also
 * indistinguishable from a login redirect when probed with an anonymous curl.
 * It cost a full debugging session once; this pins it.
 */

'use strict';

const registerWorkflowRoutes = require('../../../src/datasources/routes/workflowdashboard');

/**
 * A fake Express app that records the path of every route registered against
 * it, in order, per method. Handlers are never invoked — only the ORDER of
 * registration is under test.
 */
function recordingApp() {
  const routes = [];
  const record = (method) => (path, ...rest) => {
    // Route registrations may carry middleware before the handler; ignore both.
    if (typeof path === 'string') routes.push({ method, path });
  };
  return {
    routes,
    get: record('get'),
    post: record('post'),
    put: record('put'),
    delete: record('delete'),
    set: jest.fn(),
  };
}

describe('datasources workflow route registration order', () => {
  let app;

  beforeAll(() => {
    app = recordingApp();
    registerWorkflowRoutes('routes', {
      app,
      dependencies: {
        logging: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      },
    }, { on: jest.fn(), emit: jest.fn() });
  });

  const indexOfGet = (path) =>
    app.routes.findIndex((r) => r.method === 'get' && r.path === path);

  it('registers GET /api/workflows/last-runs', () => {
    expect(indexOfGet('/api/workflows/last-runs')).toBeGreaterThanOrEqual(0);
  });

  it('registers /api/workflows/last-runs BEFORE /api/workflows/:id', () => {
    const literal = indexOfGet('/api/workflows/last-runs');
    const param = indexOfGet('/api/workflows/:id');

    expect(param).toBeGreaterThanOrEqual(0);
    // Strictly before, or `:id` captures "last-runs" and answers 404.
    expect(literal).toBeLessThan(param);
  });

  /**
   * The same trap applies to EVERY single-segment literal under /api/workflows.
   * Asserting them as a group means a newly added one is covered by default
   * rather than needing its own test nobody remembers to write.
   */
  it('registers every literal /api/workflows/<name> before /api/workflows/:id', () => {
    const param = indexOfGet('/api/workflows/:id');
    const literals = app.routes.filter((r) =>
      r.method === 'get' &&
      /^\/api\/workflows\/[a-z0-9-]+$/i.test(r.path));

    expect(literals.length).toBeGreaterThan(1);

    const shadowed = literals
      .filter((r) => app.routes.indexOf(r) > param)
      .map((r) => r.path);

    expect(shadowed).toEqual([]);
  });
});
