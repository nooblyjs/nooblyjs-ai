// Infrastructure's UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches,
// relative to the mount path. NooblyJS draws the rail, the sidebar (from register()'s `nav`), the person and the chat;
// this app draws the content area only. Pages take render(view, { params, query, ctx, route }); the frame aborts
// ctx.signal when the person leaves, which stops their requests and timers.
export const routes = [
  { path: '/', redirect: '/environments' },
  { path: '/environments', nav: 'environments', title: 'Environments', page: () => import('./pages/environments.js') },
  { path: '/environments/:name', nav: 'environments', title: 'Environment', page: () => import('./pages/environment.js') },
  { path: '/designs', nav: 'designs', title: 'Designs', page: () => import('./pages/designs.js') },
  { path: '/designs/:id', nav: 'designs', title: 'Design', page: () => import('./pages/design.js') },
  { path: '/runs', nav: 'runs', title: 'Provisioning runs', page: () => import('./pages/runs.js') },
  { path: '/runs/:id', nav: 'runs', title: 'Run', page: () => import('./pages/run.js') },
  { path: '/testing', nav: 'testing', title: 'Testing in environments', page: () => import('./pages/testing.js') },
  { path: '/blueprints', nav: 'blueprints', title: 'Blueprints', page: () => import('./pages/blueprints.js') },
  { path: '/cost', nav: 'cost', title: 'Cost', page: () => import('./pages/cost.js') },
  { path: '/policies', nav: 'policies', title: 'Policies', page: () => import('./pages/policies.js') },
];
