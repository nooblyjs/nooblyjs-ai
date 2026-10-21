// Phase F26: the factory's UI module for the NooblyJS frame (../nooblyjs-ai-host structure.md §2a): the route
// table the frame matches, relative to the mount path. NooblyJS draws the rail, the sidebar (from
// register()'s `nav`, src/services/hosted.js), the signed-in person and the chat. This app
// draws the content area only. Old dashboard links map one to one: #/run/<id> → /runs/<id>.
//
// Since 2026-10-19 the Product section's pages are here too, under /product (sections.js). Its route table is imported
// at the same relative URL it is served from. Since lifecycle v3 (Phase 16b) its Architecture pages are the Design
// section's, under /design; the old addresses move on. Engineering, Pull requests and Test show the lifecycle's stories,
// pull requests and approvals with the seed story's sample (CHG-008) until Phases 16d, 16e and 20.
import { SECTIONS, sectionRoutes } from './sections.js';
import { routes as productRoutes } from '../product/js/module.js';
import { routes as designRoutes } from '../design/js/module.js';
import { routes as qualityRoutes } from '../quality/js/module.js';

const isArchitecture = (route) => route.nav === 'architecture';
// The Design section's Architecture pages are the Product section's (drawn in its scope); the rest are Design's own.
const OWN = {
  product: productRoutes.filter((r) => !isArchitecture(r)),
  design: [...productRoutes.filter(isArchitecture).map((r) => ({ ...r, scope: 'product' })), ...designRoutes],
  quality: qualityRoutes,
};

const PAGES = { engineering: () => import('./pages/engineering.js'), testing: () => import('./pages/testing.js') };
const view = (path, nav, title, module, name) => ({ path, nav, title, page: PAGES[module], meta: { view: name } });

export const routes = [
  { path: '/', redirect: '/line' },
  { path: '/line', nav: 'line', title: 'Line', page: () => import('./pages/line.js') },
  { path: '/runs', nav: 'runs', title: 'Runs', page: () => import('./pages/runs.js') },
  { path: '/runs/:id', nav: 'runs', title: 'Run', page: () => import('./pages/run.js') },
  { path: '/inbox', nav: 'inbox', title: 'Inbox', page: () => import('./pages/inbox.js') },
  { path: '/campaigns', nav: 'campaigns', title: 'Campaigns', page: () => import('./pages/campaigns.js') },
  { path: '/metrics', nav: 'metrics', title: 'Metrics', page: () => import('./pages/metrics.js') },
  // Engineering, Pull requests and Test (CHG-008): the lifecycle's stories, pull requests and approvals, with the seed
  // story's sample architecture, test analysis, runs and defects until Phases 16d, 16e and 20 build them.
  view('/pull-requests', 'pull-requests', 'Pull requests', 'testing', 'pull-requests'),
  view('/engineering/architecture', 'app-architecture', 'Application architecture', 'engineering', 'architecture'),
  view('/engineering/architecture/:id', 'app-architecture', 'Application architecture', 'engineering', 'architecture-detail'),
  // Test analysis is the Test section's since Phase 16d (/quality/test-analysis): old links keep working.
  { path: '/engineering/test-analysis', redirect: '/quality/test-analysis' },
  { path: '/engineering/test-analysis/:id', nav: 'quality-test-analysis', title: 'Test analysis', page: () => import('./pages/moved.js'), meta: { to: '/quality/test-analysis' } },
  view('/engineering/sign-off', 'engineering-signoff', 'Engineering sign-off', 'engineering', 'signoff'),
  view('/test/approvals', 'test-approvals', 'Test approvals', 'testing', 'approvals'),
  view('/test/runs', 'test-runs', 'Test runs', 'testing', 'runs'),
  view('/test/coverage', 'coverage', 'Coverage', 'testing', 'coverage'),
  view('/test/defects', 'defects', 'Defects', 'testing', 'defects'),
  // Architecture moved to the Design section (Phase 16b): old links keep working.
  { path: '/product/architecture', redirect: '/design/architecture' },
  { path: '/product/architecture/:id', nav: 'design-architecture', title: 'Architecture', page: () => import('./pages/moved.js'), meta: { to: '/design/architecture' } },
  ...SECTIONS.flatMap((section) => sectionRoutes(section, OWN[section.key])),
];
