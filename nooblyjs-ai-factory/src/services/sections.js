// @ts-check
// The Software Factory's SECTIONS (2026-10-19). Product (signals → ideas → specs → architecture → UX → UI → handoff) and
// Infrastructure (designs → environments → provisioning → drift → cloud cost) were hosted apps of their own,
// nooblyjs-ai-product at /product and nooblyjs-ai-infrastructure at /infrastructure. They are part of this app now: one
// rail item, one sidebar, one package. Each section keeps its own code (product/, infrastructure/), its own pages
// (public/product/, public/infrastructure/) and its own data, and is mounted here under the Factory's path:
//
//   /factory/product/…          the Product section: its API at /factory/product/api/v1, its pages, its files
//   /factory/infrastructure/…   the Infrastructure section, the same way
//
// A section's register() takes what a hosted app's does, so its tests still mount it on its own. Here it is given
// the Factory's host with a store of its own (data/factory/<section>), so it writes only inside the Factory's
// folder. Other NooblyJS apps still ask for host.service('product') and host.service('infrastructure'): the Factory
// returns both under `provides`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register as registerProduct, NAV as PRODUCT_NAV } from '../../product/index.js';
import { register as registerInfrastructure, NAV as INFRASTRUCTURE_NAV } from '../../infrastructure/index.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

/**
 * Each section: where it is under the Factory's mount path, the sidebar group its rows go in and whether that group
 * comes before or after the Factory's own (Build) rows, in lifecycle order, the prefix that keeps its nav and badge
 * keys apart from the Factory's own, and its stylesheet (relative to the Factory's mount path).
 * The browser side has the same table (public/js/sections.js); test/sections.test.js checks the two agree.
 */
export const SECTIONS = [
  { key: 'product', label: 'Product', group: 'Product', place: 'before', path: '/product', prefix: 'product', register: registerProduct, nav: PRODUCT_NAV, styles: 'product/css/product.css' },
  { key: 'infrastructure', label: 'Infrastructure', group: 'Infrastructure', place: 'after', path: '/infrastructure', prefix: 'infra', register: registerInfrastructure, nav: INFRASTRUCTURE_NAV, styles: 'infrastructure/css/infrastructure.css' },
];

// Rows whose own label would read oddly inside a group named after the section ("Product › Product").
const RELABEL = { 'product:board': 'Product board' };

/** A section's sidebar rows, as rows of the Factory's sidebar: prefixed keys and badges, paths under the section. */
export function sectionNav(section) {
  return section.nav.map((row) => ({
    ...row,
    key: `${section.prefix}-${row.key}`,
    label: RELABEL[`${section.key}:${row.key}`] ?? row.label,
    path: `${section.path}${row.path === '/' ? '' : row.path}`,
    group: section.group,
    ...(row.badge ? { badge: `${section.prefix}-${row.badge}` } : {}),
  }));
}

const isEmpty = (dir) => !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;

/**
 * Which sections to mount, from FACTORY_SECTIONS (comma-separated keys, e.g. "product"): an install that doesn't use
 * one leaves it out. Unset: all of them. An unknown key stops the Factory starting, so a typo is not a missing section.
 */
export function sectionsFromEnv(value) {
  if (value === undefined || value === null || String(value).trim() === '*') return undefined;
  const keys = String(value).split(',').map((k) => k.trim()).filter(Boolean);
  const unknown = keys.filter((k) => !SECTIONS.some((s) => s.key === k));
  if (unknown.length) throw new Error(`FACTORY_SECTIONS names ${unknown.join(', ')}, which is not a section (${SECTIONS.map((s) => s.key).join(', ')})`);
  return keys;
}

/**
 * Mounts every section on the host's app, under `mountPath`. Must run before the Factory's own router is mounted,
 * whose page fallback would otherwise answer the sections' URLs. A section whose folder is new (a Factory folder from
 * before the sections, or a first start) is seeded straight away, with sample content only when NooblyJS has it on.
 * @param {{ app: any, serverManager: any, mountPath: string, dataDir: string, host: any, only?: string[], options?: Record<string, object>, log?: any }} o
 *   only: which sections to mount (default all); options: extra register() options per section key (for tests)
 */
export async function mountSections({ app, serverManager, mountPath, dataDir, host, only, options = {}, log = console }) {
  const mounted = [];
  try {
    for (const section of SECTIONS.filter((s) => !only || only.includes(s.key))) {
      const dir = path.join(dataDir, section.key);
      const fresh = isEmpty(dir);
      fs.mkdirSync(dir, { recursive: true });
      const hosted = await section.register(app, serverManager, {
        mountPath: `${mountPath}${section.path}`, dataDir: dir, host: { ...host, store: new FsStore(dir) }, ...(options[section.key] ?? {}),
      });
      mounted.push({ section, hosted });
      if (fresh && typeof hosted.seed === 'function') await hosted.seed({ reset: false, content: host.sampleData !== false });
    }
  } catch (error) {
    // A section that fails stops the Factory starting, like any part of it would: close what was mounted first.
    for (const { hosted } of mounted.reverse()) await hosted.close?.().catch(() => {});
    throw error;
  }

  return {
    /** The sections that are mounted, in sidebar order. */
    list: mounted,
    /** Sidebar rows for one place in the sidebar ('before' the Factory's own rows, or 'after' them). */
    nav: (where) => mounted.filter(({ section }) => section.place === where).flatMap(({ section }) => sectionNav(section)),
    /** Stylesheets the frame loads with the Factory's module. */
    styles: mounted.map(({ section }) => section.styles),
    /** What other apps ask of each section, by the name they ask for (host.service('product')). */
    provides: Object.fromEntries(mounted.filter(({ hosted }) => hosted.services).map(({ section, hosted }) => [section.key, hosted.services])),
    /** Each section's status card and badges, with the badges' keys prefixed. A section that fails says so. */
    async status() {
      const out = [];
      for (const { section, hosted } of mounted) {
        try {
          const s = (await hosted.status?.()) ?? {};
          out.push({
            section,
            badges: Object.fromEntries(Object.entries(s.badges ?? {}).map(([k, v]) => [`${section.prefix}-${k}`, v])),
            card: s.card ?? null,
          });
        } catch (error) {
          log.warn?.(`factory: ${section.key} status: ${error.message}`);
          out.push({ section, badges: {}, card: { pill: { text: 'Status unavailable', tone: 'neutral' } } });
        }
      }
      return out;
    },
    /** Rewrites every section's seed (`reset`), or seeds them again where they have nothing. */
    async seed({ reset = false, content = true } = {}) {
      for (const { hosted } of mounted) await hosted.seed?.({ reset, content });
    },
    /** Closes the sections, last mounted first. One failing close doesn't stop the others. */
    async close() {
      for (const { section, hosted } of [...mounted].reverse()) {
        try {
          await hosted.close?.();
        } catch (error) {
          log.warn?.(`factory: closing ${section.key}: ${error.message}`);
        }
      }
    },
  };
}
