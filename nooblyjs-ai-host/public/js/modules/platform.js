// Platform (built-in app at /platform): repositories, containers, settings and governance (product.md §5.7), built in
// Phase 9 over /api/v1/platform. Environments is a summary: Infrastructure owns environments and previews.
const page = (name) => () => import(`../pages/platform/${name}.js`);

export const routes = [
  { path: '/', redirect: '/repositories' },
  { path: '/repositories', nav: 'repositories', title: 'Repositories', page: page('repositories') },
  { path: '/repositories/:id', nav: 'repositories', title: 'Repository', page: page('repositories') },
  { path: '/containers', nav: 'containers', title: 'Containers', page: page('containers') },
  { path: '/environments', nav: 'environments', title: 'Environments', page: page('environments') },
  { path: '/settings', nav: 'settings', title: 'Settings', page: page('settings') },
  { path: '/secrets', nav: 'secrets', title: 'Secrets', page: page('secrets') },
  { path: '/members', nav: 'members', title: 'Members', page: page('members') },
  { path: '/audit', nav: 'audit', title: 'Audit log', page: page('audit') },
];
