// The Design app's route table (Phase 16c; an app of its own since CHG-009), relative to its mount path. Each part of
// the design has a list (the items in Design, that part in words) and a page per item. The Architecture rows are the
// Product app's pages, drawn in its scope (product-pages.js).
import { productPage } from './product-pages.js';

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
  { path: '/architecture', nav: 'architecture', title: 'Architecture', page: productPage('stage-list.js'), meta: { stage: 'architecture' } },
  { path: '/architecture/:id', nav: 'architecture', title: 'Architecture', page: productPage('architecture.js') },
  ...PARTS.flatMap(({ key, title }) => [
    { path: `/${key}`, nav: key, title, page: list, meta: { part: key } },
    { path: `/${key}/:id`, nav: key, title, page: item, meta: { part: key } },
  ]),
];
