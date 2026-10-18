/**
 * @fileoverview The enterprise process model (NooblyJS Phase 8).
 *
 * A model page carries ONE fenced block of `key: value` lines, the way a page
 * carries its reviews (components/reviewBlocks.js):
 *
 *   ```process-model
 *   level: L1
 *   code: VC-02
 *   name: Supply
 *   band: Value chain
 *   parent: Business processes/L0 Enterprise Process Model.md
 *   order: 2
 *   linked-items: PRD-031, ADR-014
 *   ```
 *
 * `parent` is the parent page's path in the same space. The L0 page has no
 * parent; its children are the L1 processes, drawn in three bands in this
 * order: Enterprise, Value chain, Support. `linked-items` are NooblyJS items that
 * use the process ("Used across NooblyJS").
 *
 * Pure (no I/O): parsing a page, and building the model around one page from
 * the parsed pages of its space.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const FENCE = /```process-model[ \t]*\r?\n([\s\S]*?)\r?\n```/;
const BANDS = ['Enterprise', 'Value chain', 'Support'];
const LEVELS = ['L0', 'L1', 'L2', 'L3'];
const ITEM_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').trim();

/**
 * The process-model block of a page, or null when it has none.
 * @param {string} markdown
 * @return {{ level: string, code: string, name: string, band: string|null, parent: string|null, order: number, linkedItems: string[] }|null}
 */
function parseBlock(markdown) {
  const match = FENCE.exec(String(markdown || ''));
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    fields[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  const level = String(fields.level || '').toUpperCase();
  if (!LEVELS.includes(level)) return null;
  const band = BANDS.find((b) => b.toLowerCase() === String(fields.band || '').toLowerCase()) || null;
  const order = Number.parseInt(fields.order, 10);
  return {
    level,
    code: String(fields.code || '').slice(0, 60),
    name: String(fields.name || '').slice(0, 120),
    band,
    parent: fields.parent ? normPath(fields.parent) : null,
    order: Number.isFinite(order) ? order : 999,
    linkedItems: String(fields['linked-items'] || '').split(',').map((s) => s.trim()).filter((s) => ITEM_ID.test(s)).slice(0, 50),
  };
}

const view = (page) => ({ path: page.path, level: page.level, code: page.code, name: page.name, band: page.band });
const inOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name);

/**
 * The model around one page.
 * @param {Array<{ path: string, markdown: string }>} pages - every candidate page of the space
 * @param {string} pagePath
 * @return {Object|null} null when the page has no process-model block
 */
function modelFor(pages, pagePath) {
  const parsed = [];
  for (const p of pages) {
    const block = parseBlock(p.markdown);
    if (block) parsed.push({ ...block, path: normPath(p.path), name: block.name || normPath(p.path).split('/').pop().replace(/\.[^.]+$/, '') });
  }
  const byPath = new Map(parsed.map((p) => [p.path.toLowerCase(), p]));
  const page = byPath.get(normPath(pagePath).toLowerCase());
  if (!page) return null;

  const childrenOf = (parent) => parsed.filter((p) => p.parent && p.parent.toLowerCase() === parent.path.toLowerCase()).sort(inOrder);

  // The chain of parents, outermost first. A loop in the data stops the walk rather than hanging it.
  const parents = [];
  const seen = new Set([page.path.toLowerCase()]);
  for (let up = page.parent && byPath.get(page.parent.toLowerCase()); up && !seen.has(up.path.toLowerCase()); up = up.parent && byPath.get(up.parent.toLowerCase())) {
    seen.add(up.path.toLowerCase());
    parents.unshift(view(up));
  }

  const children = childrenOf(page);
  const bands = page.level === 'L0'
    ? BANDS.map((name) => ({
      name,
      processes: children.filter((c) => c.band === name).map((c) => ({ ...view(c), children: childrenOf(c).length })),
    }))
    : null;

  return {
    page: { ...view(page), linkedItems: page.linkedItems },
    parents,
    children: children.map((c) => ({ ...view(c), children: childrenOf(c).length })),
    bands,
  };
}

module.exports = { parseBlock, modelFor, BANDS, FENCE };
