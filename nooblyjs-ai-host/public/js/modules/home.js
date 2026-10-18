// Home (built-in app at /): the cross-cutting screens (product.md §5.2). For you and Teams & roles (Phase 3) and Overview,
// Lifecycle, Approvals and Activity (Phase 2) and Metrics (Phase 10) are built.

export const routes = [
  { path: '/', nav: 'for-you', title: 'For you', page: () => import('../pages/home/for-you.js') },
  { path: '/home', redirect: '/' },
  { path: '/home/overview', nav: 'overview', title: 'From idea to merged code', page: () => import('../pages/home/overview.js') },
  { path: '/home/lifecycle', nav: 'lifecycle', title: 'Lifecycle', page: () => import('../pages/home/lifecycle.js') },
  { path: '/home/lifecycle/:id', nav: 'lifecycle', title: 'Item', page: () => import('../pages/home/item.js') },
  { path: '/home/approvals', nav: 'approvals', title: 'Approvals', page: () => import('../pages/home/approvals.js') },
  { path: '/home/activity', nav: 'activity', title: 'Activity', page: () => import('../pages/home/activity.js') },
  { path: '/home/metrics', nav: 'metrics', title: 'Metrics', page: () => import('../pages/home/metrics.js') },
  { path: '/home/teams', nav: 'teams', title: 'Teams & roles', page: () => import('../pages/home/teams.js') },
];
