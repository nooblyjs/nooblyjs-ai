// The stub app's UI module (structure.md §2a): a route table. The frame loads it from Phase 1.
export const routes = [
  { path: '/', nav: 'home', title: 'Hello', page: () => import('./pages/hello.js') },
  // Gated: people without the permission get the frame's "Not for your role" card.
  { path: '/owners', nav: 'owners', title: 'Owners only', requires: 'change-guardrails', page: () => import('./pages/hello.js') },
];
