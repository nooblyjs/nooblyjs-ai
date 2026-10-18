// The Product Factory's UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches,
// relative to the mount path. NooblyJS draws the rail, the sidebar (from register()'s `nav`), the person and the chat;
// this app draws the content area only. Pages take render(view, { params, query, ctx, route }) and may return
// nothing: the frame aborts ctx.signal when the person leaves, which stops their requests and timers.
const page = (load) => () => load();

export const routes = [
  { path: '/', nav: 'overview', title: 'Product Factory', page: page(() => import('./pages/overview.js')) },
  { path: '/portfolios', nav: 'portfolios', title: 'Portfolios', page: page(() => import('./pages/strategy.js')) },
  { path: '/portfolios/:id', nav: 'portfolios', title: 'Portfolio', page: page(() => import('./pages/document.js')), meta: { kind: 'portfolio' } },
  { path: '/value-streams/:id', nav: 'portfolios', title: 'Value stream', page: page(() => import('./pages/document.js')), meta: { kind: 'value-stream' } },
  { path: '/board', nav: 'board', title: 'Product', page: page(() => import('./pages/board.js')) },
  { path: '/specs', nav: 'specs', title: 'Specs', page: page(() => import('./pages/specs.js')) },
  { path: '/specs/:id', nav: 'specs', title: 'Spec', page: page(() => import('./pages/spec.js')) },
  { path: '/architecture', nav: 'architecture', title: 'Architecture', page: page(() => import('./pages/stage-list.js')), meta: { stage: 'architecture' } },
  { path: '/architecture/:id', nav: 'architecture', title: 'Architecture', page: page(() => import('./pages/architecture.js')) },
  { path: '/ux', nav: 'ux', title: 'UX Design', page: page(() => import('./pages/stage-list.js')), meta: { stage: 'ux' } },
  { path: '/ux/:id', nav: 'ux', title: 'UX Design', page: page(() => import('./pages/ux.js')) },
  { path: '/ui', nav: 'ui', title: 'UI Design', page: page(() => import('./pages/stage-list.js')), meta: { stage: 'ui' } },
  { path: '/ui/:id', nav: 'ui', title: 'UI Design', page: page(() => import('./pages/ui.js')) },
  { path: '/reviews', nav: 'reviews', title: 'Reviews', page: page(() => import('./pages/reviews.js')) },
  { path: '/handoffs', nav: 'handoffs', title: 'Handoffs', page: page(() => import('./pages/handoffs.js')) },
  { path: '/settings', nav: 'settings', title: 'Settings', page: page(() => import('./pages/settings.js')) },
];
