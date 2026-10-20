// Phase F26: the factory's UI module for the NooblyJS frame (../nooblyjs-ai-host structure.md §2a): the route
// table the frame matches, relative to the mount path. NooblyJS draws the rail, the sidebar (from
// register()'s `nav`, src/services/hosted.js), the signed-in person and the chat. This app
// draws the content area only. Old dashboard links map one to one: #/run/<id> → /runs/<id>.
//
// Since 2026-10-19 the Product section's pages are here too, under /product (sections.js). Its route table is imported
// at the same relative URL it is served from. Since lifecycle v3 (Phase 16b) its Architecture pages are the Design
// section's, under /design; the old addresses move on. Engineering and Test rows say which phase brings them.
import { SECTIONS, sectionRoutes } from './sections.js';
import { routes as productRoutes } from '../product/js/module.js';
import { routes as designRoutes } from '../design/js/module.js';

const isArchitecture = (route) => route.nav === 'architecture';
// The Design section's Architecture pages are the Product section's (drawn in its scope); the rest are Design's own.
const OWN = {
  product: productRoutes.filter((r) => !isArchitecture(r)),
  design: [...productRoutes.filter(isArchitecture).map((r) => ({ ...r, scope: 'product' })), ...designRoutes],
};

const coming = (path, nav, title, text, phase, link) => ({ path, nav, title, page: () => import('./pages/coming.js'), meta: { text, phase, ...(link ? { link } : {}) } });
const APPROVALS = { label: 'Decide them on Home · Approvals', href: '/home/approvals' };

export const routes = [
  { path: '/', redirect: '/line' },
  { path: '/line', nav: 'line', title: 'Line', page: () => import('./pages/line.js') },
  { path: '/runs', nav: 'runs', title: 'Runs', page: () => import('./pages/runs.js') },
  { path: '/runs/:id', nav: 'runs', title: 'Run', page: () => import('./pages/run.js') },
  { path: '/inbox', nav: 'inbox', title: 'Inbox', page: () => import('./pages/inbox.js') },
  { path: '/campaigns', nav: 'campaigns', title: 'Campaigns', page: () => import('./pages/campaigns.js') },
  { path: '/metrics', nav: 'metrics', title: 'Metrics', page: () => import('./pages/metrics.js') },
  coming('/pull-requests', 'pull-requests', 'Pull requests', 'Each pull request the AI opens, with the automated tests the test analysis asked for, waiting on an engineer\'s Build approval.', 'Phase 16e', APPROVALS),
  coming('/engineering/architecture', 'app-architecture', 'Application architecture', 'Each story\'s application flow, objects and NFRs per component, drawn by an agent from the code and the system, and accepted by an Application Architect.', 'Phase 16d'),
  coming('/engineering/test-analysis', 'test-analysis', 'Test analysis', 'Each story\'s test cases, automated testing requirements, integration tests and E2E tests, made ready by a test analyst.', 'Phase 16d'),
  coming('/engineering/sign-off', 'engineering-signoff', 'Engineering sign-off', 'An Application Architect and a test lead sign each story off before anything is built. The sign-offs are already approvals.', 'Phase 16d', APPROVALS),
  coming('/test/approvals', 'test-approvals', 'Test approvals', 'Pull requests a tester verifies and gives the Test approval, after the engineer\'s Build approval. They are already approvals.', 'Phase 16e', APPROVALS),
  coming('/test/runs', 'test-runs', 'Test runs', 'The Factory\'s gate results and the environment suites, recorded as test runs against requirements and test cases.', 'Phase 20'),
  coming('/test/coverage', 'coverage', 'Coverage', 'Per item and per feature, the acceptance criteria with a ready test case, an automated test and a passing run.', 'Phase 20'),
  coming('/test/defects', 'defects', 'Defects', 'Defects as items of their own, linked to the requirement and story they break.', 'Phase 20'),
  // Architecture moved to the Design section (Phase 16b): old links keep working.
  { path: '/product/architecture', redirect: '/design/architecture' },
  { path: '/product/architecture/:id', nav: 'design-architecture', title: 'Architecture', page: () => import('./pages/moved.js'), meta: { to: '/design/architecture' } },
  ...SECTIONS.flatMap((section) => sectionRoutes(section, OWN[section.key])),
];
