// The Design section's route table (Phase 16c), relative to the section's path; the Factory's UI module adds it under
// /design (../../js/sections.js). Each part of the design has a list (the items in Design, that part in words) and a
// page per item. The Architecture rows are the Product section's pages, added by the Factory's module.
const list = () => import('./pages/list.js');
const item = () => import('./pages/item.js');

export const PARTS = [
  { key: 'requirements', title: 'Business requirements' },
  { key: 'solution', title: 'Solution architecture' },
  { key: 'functional', title: 'Functional analysis' },
  { key: 'stories', title: 'Stories' },
  { key: 'handoff', title: 'Handoff to the Factory' },
];

export const routes = [
  { path: '/', redirect: '/requirements' },
  ...PARTS.flatMap(({ key, title }) => [
    { path: `/${key}`, nav: key, title, page: list, meta: { part: key } },
    { path: `/${key}/:id`, nav: key, title, page: item, meta: { part: key } },
  ]),
];
