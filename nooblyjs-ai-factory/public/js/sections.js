// The Software Factory's sections in the browser (2026-10-19): the Product pages, which were an app of their own, shown
// inside the Factory's module. The server side is src/services/sections.js; this table must agree
// with its SECTIONS (test/sections.test.js checks it).
//
// The frame gives every page a ctx bound to the app (/factory). A section's pages were written for an app of their
// own, so each gets a ctx bound to the section instead: its API client calls /factory/<section>/api/v1, its links and
// navigate() stay under /factory/<section>, and it draws inside an element scoped like its own app was
// (data-module="product"), so its stylesheet applies as it always did. Everything else in ctx is the frame's.
export const SECTIONS = [
  { key: 'product', path: '/product', prefix: 'product' },
];

const under = (base, path) => `${base}${path === '/' ? '' : path}`;

/** The kit's API client. It is only there in the browser; tests pass their own (sectionRoutes' `deps`). */
const kitApi = async () => (await import('/ui/js/api.js')).createApi;

/** The ctx a section's page gets: the frame's, bound to the section. */
export function sectionContext(ctx, section, createApi) {
  const mountPath = under(ctx.app.mountPath === '/' ? '' : ctx.app.mountPath, section.path);
  return {
    ...ctx,
    app: { ...ctx.app, section: section.key, mountPath },
    api: createApi(`${mountPath}/api/v1`, { signal: ctx.signal }),
    navigate: (path, { absolute = false, replace = false } = {}) => ctx.navigate(absolute ? path : under(section.path, path), { replace }),
  };
}

/** A section's page, wrapped: drawn in its own scope, with its own ctx. destroy() is passed on. */
function wrapPage(load, section, { api = kitApi, doc = () => document } = {}) {
  return async () => {
    const page = await load();
    return {
      async render(view, args) {
        const root = doc().createElement('div');
        root.dataset.module = section.key;
        root.className = 'factory-section';
        view.append(root);
        return page.render(root, { ...args, ctx: sectionContext(args.ctx, section, await api()) });
      },
      destroy: () => page.destroy?.(),
    };
  };
}

/**
 * A section's route table as routes of the Factory's: paths, nav keys and redirects moved under the section.
 * `deps` ({ api, doc }) replace the kit's API client and the document, for tests.
 */
export function sectionRoutes(section, routes, deps) {
  return routes.map((route) => ({
    ...route,
    path: under(section.path, route.path),
    ...(route.nav ? { nav: `${section.prefix}-${route.nav}` } : {}),
    ...(route.redirect ? { redirect: under(section.path, route.redirect) } : {}),
    ...(route.page ? { page: wrapPage(route.page, section, deps) } : {}),
  }));
}
