// Operations' UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches, relative to
// the mount path. NooblyJS draws the rail, the sidebar (from register()'s `nav`), the person and the chat; this app
// draws the content area only. Pages take render(view, { params, query, ctx, route }); the frame aborts ctx.signal when
// the person leaves, which stops their requests.
export const routes = [
  { path: '/', redirect: '/releases' },
  { path: '/releases', nav: 'releases', title: 'Releases', page: () => import('./pages/releases.js') },
  { path: '/releases/:id', nav: 'releases', title: 'Release', page: () => import('./pages/release.js') },
  { path: '/deployments', nav: 'deployments', title: 'Deployments', page: () => import('./pages/deployments.js') },
  { path: '/policies', nav: 'policies', title: 'Policies', page: () => import('./pages/policies.js') },
];
