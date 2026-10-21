// Security's UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches, relative to
// the mount path. NooblyJS draws the rail, the sidebar (from register()'s `nav`), the person and the chat; this app
// draws the content area only. Pages take render(view, { params, query, ctx, route }); the frame aborts ctx.signal when
// the person leaves, which stops their requests.
export const routes = [
  { path: '/', redirect: '/findings' },
  { path: '/threat-models', nav: 'threat-models', title: 'Threat models', page: () => import('./pages/threat-models.js') },
  { path: '/threat-models/:id', nav: 'threat-models', title: 'Threat model', page: () => import('./pages/threat-model.js') },
  { path: '/findings', nav: 'findings', title: 'Findings', page: () => import('./pages/findings.js') },
  { path: '/findings/:id', nav: 'findings', title: 'Finding', page: () => import('./pages/finding.js') },
  { path: '/risks', nav: 'risks', title: 'Risk register', page: () => import('./pages/risks.js') },
  { path: '/policies', nav: 'policies', title: 'Policies', page: () => import('./pages/policies.js') },
];
