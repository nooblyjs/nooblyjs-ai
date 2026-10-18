// Teammates' UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches, relative to
// the mount path. NooblyJS draws the rail, sidebar (from register()'s `nav`), person and chat; this app draws content
// only. Each page exports render(view, { params, query, ctx, route }) and destroy(). `requires` names a NooblyJS
// permission: the frame shows "Not for your role" without it, and the API refuses too.
import { api, lastProfile, start, PERMISSION_FOR_ROLE } from './client.js';

/** /profiles: the profile you looked at last, or the first teammate's. */
const profiles = {
  async render(view, { ctx }) {
    let id = lastProfile();
    if (!id) {
      const { teammates } = await api.get('/api/v1/teammates').catch(() => ({ teammates: [] }));
      id = teammates[0]?.id;
    }
    if (ctx.isCurrent()) ctx.navigate(id ? `/team/${encodeURIComponent(id)}` : '/team', { replace: true });
  },
};

export const routes = [
  { path: '/', redirect: '/team' },
  { path: '/team', nav: 'team', title: 'Team roster', page: () => import('./pages/roster.js') },
  { path: '/team/:id', nav: 'profiles', title: 'Profile', page: () => import('./pages/profile.js') },
  { path: '/profiles', nav: 'profiles', title: 'Profiles', page: () => profiles },
  { path: '/timeline', nav: 'timeline', title: 'Work timeline', page: () => import('./pages/timeline.js') },
  { path: '/board', nav: 'board', title: 'Team board', page: () => import('./pages/board.js') },
  { path: '/board/:postId', nav: 'board', title: 'Team board', page: () => import('./pages/board.js') },
  { path: '/billing', nav: 'billing', title: 'Billing & timesheets', page: () => import('./pages/billing.js') },
  { path: '/hire', nav: 'hire', title: 'Hire a teammate', requires: PERMISSION_FOR_ROLE.hire, page: () => import('./pages/hire.js') },
  { path: '/team-memory', nav: 'team-memory', title: 'Team memory', page: () => import('./pages/team-memory.js') },
  { path: '/settings', nav: 'settings', title: 'Settings', requires: PERMISSION_FOR_ROLE.owner, page: () => import('./pages/settings.js') },
  { path: '/admin', nav: 'admin', title: 'Admin', requires: PERMISSION_FOR_ROLE.owner, page: () => import('./pages/admin.js') },
];

/** Runs once per tab, the first time Teammates is opened. */
export function init() {
  return start();
}
