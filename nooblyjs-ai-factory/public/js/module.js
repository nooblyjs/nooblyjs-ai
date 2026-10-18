// Phase F26: the factory's UI module for the NooblyJS frame (../nooblyjs-ai-host structure.md §2a): the route
// table the frame matches, relative to the mount path. NooblyJS draws the rail, the sidebar (from
// register()'s `nav`, src/services/hosted.js), the signed-in person and the chat. This app
// draws the content area only. Old dashboard links map one to one: #/run/<id> → /runs/<id>.
export const routes = [
  { path: '/', redirect: '/line' },
  { path: '/line', nav: 'line', title: 'Line', page: () => import('./pages/line.js') },
  { path: '/runs', nav: 'runs', title: 'Runs', page: () => import('./pages/runs.js') },
  { path: '/runs/:id', nav: 'runs', title: 'Run', page: () => import('./pages/run.js') },
  { path: '/inbox', nav: 'inbox', title: 'Inbox', page: () => import('./pages/inbox.js') },
  { path: '/campaigns', nav: 'campaigns', title: 'Campaigns', page: () => import('./pages/campaigns.js') },
  { path: '/metrics', nav: 'metrics', title: 'Metrics', page: () => import('./pages/metrics.js') },
];
