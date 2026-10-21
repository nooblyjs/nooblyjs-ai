// @ts-check
// The Software Factory's SECTIONS: parts of the Factory with code, pages and data of their own, mounted under its path.
//
//   /factory/quality/…          the Test section (Phase 16d): its API at /factory/quality/api/v1, its pages, its files
//
// Product (2026-10-19 to 2026-10-21, CHG-005) and Design (Phase 16c to 2026-10-21) were sections too. They are hosted
// apps of their own now (CHG-009: nooblyjs-ai-product at /product, nooblyjs-ai-design at /design), as Infrastructure
// is again since CHG-007: the Factory is Engineering · Build · Test, and Product feeds Design, which feeds it.
//
// A section's register() takes what a hosted app's does, so its tests still mount it on its own. Here it is given
// the Factory's host with a store of its own (data/factory/<section>), so it writes only inside the Factory's
// folder. Other NooblyJS apps ask for host.service('quality'): the Factory returns it under `provides`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register as registerQuality, NAV as QUALITY_NAV } from '../../quality/index.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

/**
 * Each section: where it is under the Factory's mount path, the sidebar group its rows go in and whether that group
 * comes before or after the Factory's own rows, in lifecycle order, or `within` them (each row in the Factory group its
 * `factoryGroup` names, Phase 16d), the prefix that keeps its nav and badge
 * keys apart from the Factory's own, and its stylesheet (relative to the Factory's mount path).
 * The browser side has the same table (public/js/sections.js); test/sections.test.js checks the two agree.
 */
export const SECTIONS = [
  // The Test section (Phase 16d): its rows go within the Factory's own groups (Test analysis is Engineering's).
  { key: 'quality', label: 'Test', group: 'Test', icon: 'approve', hint: 'Testers verify pull requests and approve', place: 'within', path: '/quality', prefix: 'quality', register: registerQuality, nav: QUALITY_NAV, styles: 'quality/css/quality.css' },
];

/** The Factory's own group for the line, after the sections that come 'before' it. */
export const BUILD_GROUP = { name: 'Build', icon: 'factory', hint: 'The AI builds and tests; engineers approve' };

/** The Factory's own groups, in their order (Phase 16b): what each part of the work after Design does. */
export const FACTORY_GROUPS = [
  { name: 'Engineering', icon: 'grid', hint: 'Application architecture and test analysis, signed off' },
  BUILD_GROUP,
  { name: 'Test', icon: 'approve', hint: 'Testers verify pull requests and approve' },
];

// Rows whose own label would read oddly inside a group named after the section.
const RELABEL = {};

/**
 * A section's sidebar rows, as rows of the Factory's sidebar: prefixed keys and badges, paths under the section. Rows it
 * leaves to another section (`omit`) are left out; a row may name the Factory group it goes in (`factoryGroup`).
 */
export function sectionNav(section) {
  return section.nav.filter((row) => !section.omit?.includes(row.key)).map(({ factoryGroup, ...row }) => ({
    ...row,
    key: `${section.prefix}-${row.key}`,
    label: RELABEL[`${section.key}:${row.key}`] ?? row.label,
    path: `${section.path}${row.path === '/' ? '' : row.path}`,
    group: factoryGroup ?? section.group,
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
      // A section with no server part of its own: its rows only.
      if (!section.register) {
        mounted.push({ section, hosted: null });
        continue;
      }
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
    for (const { hosted } of mounted.reverse()) await hosted?.close?.().catch(() => {});
    throw error;
  }

  return {
    /** The sections that are mounted, in sidebar order. */
    list: mounted,
    /** Sidebar rows for one place in the sidebar ('before' the Factory's own rows, 'after' them, or 'within' its groups). */
    nav: (where) => mounted.filter(({ section }) => section.place === where).flatMap(({ section }) => sectionNav(section)),
    /**
     * How the sidebar names each group, in its order ({ name, icon, hint }): the sections' and the Factory's own,
     * which the kit draws as a header with a divider above it.
     */
    groups: () => [
      ...mounted.filter(({ section }) => section.place === 'before').map(({ section }) => ({ name: section.group, icon: section.icon, hint: section.hint })),
      ...FACTORY_GROUPS,
      ...mounted.filter(({ section }) => section.place === 'after').map(({ section }) => ({ name: section.group, icon: section.icon, hint: section.hint })),
    ],
    /** Stylesheets the frame loads with the Factory's module. */
    styles: mounted.map(({ section }) => section.styles).filter(Boolean),
    /** What other apps ask of each section, by the name they ask for (host.service('product')). */
    provides: Object.fromEntries(mounted.filter(({ hosted }) => hosted?.services).map(({ section, hosted }) => [section.key, hosted.services])),
    /** Each section's status card and badges, with the badges' keys prefixed. A section that fails says so. */
    async status() {
      const out = [];
      for (const { section, hosted } of mounted.filter((m) => m.hosted)) {
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
      for (const { hosted } of mounted) await hosted?.seed?.({ reset, content });
    },
    /** Closes the sections, last mounted first. One failing close doesn't stop the others. */
    async close() {
      for (const { section, hosted } of [...mounted].reverse()) {
        try {
          await hosted?.close?.();
        } catch (error) {
          log.warn?.(`factory: closing ${section.key}: ${error.message}`);
        }
      }
    },
  };
}
