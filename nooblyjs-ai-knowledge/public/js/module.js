// The Wiki's UI module for the NooblyJS frame (noobly structure.md §2a): the route table the frame matches, relative to
// the mount path. NooblyJS draws the rail and the person; the wiki draws the content area (layout: 'full', because its
// own navigation tree and panels take the room the frame's sidebar and chat would).
//
// One page serves every wiki route (pages/wiki.js). The wiki's own location is in the URL hash
// (/wiki/#/Space/folder/doc), so `/` is the only real page; the deeper paths exist so that a link to
// /wiki/Space/folder/doc still lands, and are moved into the hash on arrival. The frame's router has no wildcard,
// so each depth is listed.
//
// The datasources screens (standalone: /applications/datasources) are the other set of pages, under /datasources,
// in the frame's usual layout: their sidebar rows are the app's nav (index.mjs NAV). They come first, because the
// frame takes the first route that matches and /datasources/workflows also reads as a wiki location.
const page = () => import('./pages/wiki.js');
const datasources = () => import('./pages/datasources.js');
const DEPTH = 16;
const deep = Array.from({ length: DEPTH }, (unused, i) => ({
  path: `/${Array.from({ length: i + 1 }, (u, n) => `:p${n}`).join('/')}`,
  nav: 'home', title: 'Wiki', layout: 'full', page,
}));

// Everyone signed in to NooblyJS may open these: no route asks for a permission, and hosted, their API asks for a
// sign-in only (src/hosted/platform.cjs sets `datasourcesOpenToSignedIn`).
// `meta.screen` is the id the screen registered with the datasources Router (src/web/datasources/public/js/screens).
const admin = [
  { path: '/datasources', nav: 'dashboard', title: 'Dashboard', meta: { screen: 'dashboard' } },
  { path: '/datasources/workflows', nav: 'workflows', title: 'Workflows', meta: { screen: 'workflows' } },
  { path: '/datasources/schedules', nav: 'schedules', title: 'Schedules', meta: { screen: 'schedules' } },
  { path: '/datasources/executions', nav: 'executions', title: 'Execution history', meta: { screen: 'executions' } },
  { path: '/datasources/repositories', nav: 'repositories', title: 'Repositories', meta: { screen: 'repositories' } },
  { path: '/datasources/spaces', nav: 'spaces', title: 'Spaces', meta: { screen: 'spaces' } },
  // NooblyJS Phase 8: where content came from, and the documents behind an answer reported as wrong.
  { path: '/datasources/sources', nav: 'sources', title: 'Sources', meta: { screen: 'sources' } },
  { path: '/datasources/needs-review', nav: 'needs-review', title: 'Needs review', meta: { screen: 'needs-review' } },
  { path: '/datasources/agents', nav: 'agents', title: 'Agents', meta: { screen: 'agents' } },
  { path: '/datasources/prompts', nav: 'prompts', title: 'Prompts', meta: { screen: 'prompts' } },
  { path: '/datasources/user-activity', nav: 'user-activity', title: 'Users', meta: { screen: 'user-activity' } },
  { path: '/datasources/settings', nav: 'settings', title: 'Settings', meta: { screen: 'settings' } },
  // No sidebar row of its own (the standalone app had none either): reached from the screens that use it.
  { path: '/datasources/connections', nav: 'dashboard', title: 'Connections', meta: { screen: 'connections' } },
].map((route) => ({ ...route, page: datasources }));

export const routes = [
  { path: '/', nav: 'home', title: 'Wiki', layout: 'full', page },
  ...admin,
  ...deep,
];
