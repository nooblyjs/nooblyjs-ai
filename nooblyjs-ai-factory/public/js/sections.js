// The Software Factory's sections in the browser: the Test section's pages (Phase 16d), shown inside the Factory's
// module. Product and Design were sections too until CHG-009 (2026-10-21); they are apps of their own now. The server side is src/services/sections.js; this table must agree
// with its SECTIONS (test/sections.test.js checks it).
//
// The frame gives every page a ctx bound to the app (/factory). A section's pages were written for an app of their
// own, so each gets a ctx bound to the section instead: its API client calls /factory/<section>/api/v1, its links and
// navigate() stay under /factory/<section>, and it draws inside an element scoped like its own app was
// (data-module="quality"), so its stylesheet applies as it always did. Everything else in ctx is the frame's.
//
// A route may show another section's page (`scope` on the route, Phase 16b): its API, links and scope are that section's,
// its route and navigation the one it sits in. (Design's Architecture rows used it until CHG-009; the Design app does
// the same across apps now, ../../../nooblyjs-ai-design/public/js/product-pages.js.)
export const SECTIONS = [
  { key: 'quality', path: '/quality', prefix: 'quality' },
];

const under = (base, path) => `${base}${path === '/' ? '' : path}`;

/** The kit's API client. It is only there in the browser; tests pass their own (sectionRoutes' `deps`). */
const kitApi = async () => (await import('/ui/js/api.js')).createApi;

/** The section whose pages, API and scope a section's routes use: its own, or the one it names in `scope`. */
const ownerOf = (section) => (section.scope ? SECTIONS.find((s) => s.key === section.scope) ?? section : section);

/** The ctx a section's page gets: the frame's, bound to the section (its API and links to the section it shows). */
export function sectionContext(ctx, section, createApi) {
  const mountPath = under(ctx.app.mountPath === '/' ? '' : ctx.app.mountPath, ownerOf(section).path);
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
        root.dataset.module = ownerOf(section).key;
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
    ...(route.page ? { page: wrapPage(route.page, route.scope ? { ...section, scope: route.scope } : section, deps) } : {}),
  }));
}
