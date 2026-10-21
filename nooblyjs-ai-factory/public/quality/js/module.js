// The Test section's route table (Phase 16d), relative to the section's path; the Factory's UI module adds it under
// /quality (../../js/sections.js). Test analysis: the stories in Engineer, and a story's test cases.
const page = () => import('./pages/analysis.js');

export const routes = [
  { path: '/', redirect: '/test-analysis' },
  { path: '/test-analysis', nav: 'test-analysis', title: 'Test analysis', page, meta: { view: 'list' } },
  { path: '/test-analysis/:id', nav: 'test-analysis', title: 'Test analysis', page, meta: { view: 'story' } },
];
