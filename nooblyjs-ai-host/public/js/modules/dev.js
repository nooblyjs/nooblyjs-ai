// Development pages (built-in app at /dev, only with NOOBLY_DEV_LOGIN=true): the styleguide, the dev clock and the
// Teams simulator.
export const routes = [
  { path: '/', redirect: '/styleguide' },
  { path: '/styleguide', nav: 'styleguide', title: 'Styleguide', page: () => import('../pages/styleguide.js') },
  { path: '/clock', nav: 'clock', title: 'Dev clock', page: () => import('../pages/dev/clock.js') },
  { path: '/teams', nav: 'teams', title: 'Teams simulator', page: () => import('../pages/dev/teams-simulator.js') },
];
