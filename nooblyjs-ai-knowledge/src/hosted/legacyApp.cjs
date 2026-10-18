'use strict';

/**
 * @fileoverview The `app` the platform's modules see when NooblyJS hosts them.
 *
 * src/datasources and src/wiki were written against the standalone Express 4 app
 * (app.js): they register ABSOLUTE paths on it (`/applications/wiki/api/…`,
 * `/api/…`), keep shared objects in app settings (`app.set('spaceManager', …)`)
 * and use Express 4 wildcard syntax. Hosted, there is one Express 5 router at the
 * mount path and the API belongs under `<mountPath>/api/v1`. This facade is the
 * whole translation, so the modules themselves stay unchanged:
 *
 *   /applications/wiki/api/x   →  /api/v1/x
 *   /api/x  (datasources)      →  /api/v1/ds/x
 *   /applications/wiki/media   →  /media        (also /avatars)
 *   anything else              →  not mounted   (the standalone pages, login,
 *                                 logout, the legacy views: the frame owns those)
 *
 * and `:name(*)` / a trailing `*` become Express 5 wildcards whose value is
 * joined back into the single string the handlers expect.
 */

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'use'];

/** Legacy absolute path → path under the hosted router, or null when it is not mounted. */
function mapPath(legacyPath) {
  const rules = [
    ['/applications/wiki/api', '/api/v1'],
    ['/applications/wiki/media', '/media'],
    ['/applications/wiki/avatars', '/avatars'],
    ['/api', '/api/v1/ds'],
  ];
  for (const [from, to] of rules) {
    if (legacyPath === from || legacyPath === `${from}/`) return to;
    if (legacyPath.startsWith(`${from}/`)) return to + legacyPath.slice(from.length);
  }
  return null;
}

/**
 * Express 4 wildcards → Express 5. Returns the new path and the wildcard names,
 * so their matched segments can be joined back into one string.
 */
function toExpress5(routePath) {
  const wildcards = [];
  let out = routePath.replace(/:([A-Za-z_]\w*)\(\*\)/g, (match, name) => {
    wildcards.push(name);
    return `{*${name}}`;
  });
  if (out.endsWith('/*')) {
    wildcards.push('0');
    out = `${out.slice(0, -1)}{*splat}`;
  }
  return { path: out, wildcards };
}

/** Joins the segments Express 5 matched for each wildcard: handlers expect `a/b/c`, and '' when nothing matched. */
function joinWildcards(wildcards) {
  return (req, res, next) => {
    for (const name of wildcards) {
      const value = req.params[name === '0' ? 'splat' : name];
      req.params[name] = Array.isArray(value) ? value.join('/') : (value ?? '');
    }
    next();
  };
}

/**
 * @param {object} o
 * @param {import('express').Router} o.router   the hosted router (Express 5)
 * @param {import('express').Express} o.hostApp the host's app, for settings this app never set
 * @returns {object} an object with the parts of the Express app API the modules use
 */
function createLegacyApp({ router, hostApp }) {
  const settings = new Map();
  const skipped = [];
  const facade = { locals: {}, skipped };

  facade.set = (name, value) => {
    settings.set(name, value);
    return facade;
  };

  for (const method of METHODS) {
    facade[method] = (first, ...handlers) => {
      // app.get('name') reads a setting.
      if (method === 'get' && typeof first === 'string' && handlers.length === 0) {
        return settings.has(first) ? settings.get(first) : hostApp?.get?.(first);
      }
      if (typeof first !== 'string' && !Array.isArray(first)) {
        throw new TypeError(`A hosted module may not register ${method}() without a path (it would apply to all of NooblyJS).`);
      }
      for (const legacyPath of [].concat(first)) {
        const mapped = typeof legacyPath === 'string' ? mapPath(legacyPath) : null;
        if (!mapped) {
          skipped.push(`${method.toUpperCase()} ${legacyPath}`);
          continue;
        }
        const { path, wildcards } = toExpress5(mapped);
        router[method](path, ...(wildcards.length ? [joinWildcards(wildcards)] : []), ...handlers);
      }
      return facade;
    };
  }

  /**
   * Runs first on every request to the hosted router. Handlers reach shared
   * objects through `req.app.get(…)`, which on a mounted router is the HOST's
   * app, so point it at the facade for this request. Express 5 also made
   * `req.query` read-only and leaves `req.body` undefined without a body; the
   * handlers assign the first and destructure the second.
   */
  facade.prepare = (req, res, next) => {
    Object.defineProperty(req, 'app', { value: facade, configurable: true, writable: true });
    Object.defineProperty(req, 'query', { value: req.query, configurable: true, writable: true, enumerable: true });
    if (req.body === undefined) req.body = {};
    next();
  };

  return facade;
}

module.exports = { createLegacyApp, mapPath, toExpress5 };
