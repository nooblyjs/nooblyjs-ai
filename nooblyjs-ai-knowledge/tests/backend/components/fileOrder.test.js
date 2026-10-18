/**
 * @fileoverview Per-folder child ordering, including the CASCADE.
 *
 * The contract under test:
 *   • a folder's own `.system/file-order.json` orders its children;
 *   • a folder WITHOUT one inherits the nearest ancestor's order, so a single
 *     file at the space root can impose a convention on a whole subtree;
 *   • an own order overrides an inherited one outright — no merging;
 *   • names not in the order fall to the default sort, after the named ones;
 *   • rename/delete/move keep an EXISTING order file honest but never create
 *     one (creating one would silently detach a folder from its parent's
 *     cascade).
 *
 * These rules live in exactly one place — wiki/utils/fileOrder.js. The folder
 * tree builder (wiki/routes/filingRoutes.js `buildTreeFromFiling`) is the only
 * consumer of the sorting half and must not grow a second copy of it.
 */

'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs').promises;

const {
  SETTINGS_DIR,
  LEGACY_SETTINGS_DIR,
  ORDER_FILE,
  MAX_ORDER_ENTRIES,
  orderPathFor,
  orderRelPathsFor,
  parseOrder,
  sanitizeOrderNames,
  applyFileOrder,
  defaultSort,
  resolveEffectiveOrder,
  readOrderWith,
  readFileOrder,
  writeFileOrder,
  renameInFileOrder,
  removeFromFileOrder,
} = require('../../../src/wiki/utils/fileOrder');

/** Shorthand for the {name, type} shape the tree builder produces. */
const doc = (name) => ({ name, type: 'document' });
const dir = (name) => ({ name, type: 'folder' });
const names = (items) => items.map(item => item.name);

let workDir;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-order-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/** Write an order file into `folder`, in the current or the legacy location. */
async function seedOrder(folder, order, settingsDir = SETTINGS_DIR) {
  await fs.mkdir(path.join(folder, settingsDir), { recursive: true });
  await fs.writeFile(
    path.join(folder, settingsDir, ORDER_FILE),
    JSON.stringify({ order }, null, 2),
    'utf8'
  );
}

describe('paths', () => {
  test('writes to the folder-local .system namespace', () => {
    expect(orderPathFor(path.join('C:', 'space', 'Sub')))
      .toBe(path.join('C:', 'space', 'Sub', '.system', 'file-order.json'));
  });

  test('relative candidates put .system first and .settings second', () => {
    expect(orderRelPathsFor('A/B')).toEqual([
      'A/B/.system/file-order.json',
      'A/B/.settings/file-order.json',
    ]);
  });

  test('the space root has no leading separator', () => {
    expect(orderRelPathsFor('')).toEqual([
      '.system/file-order.json',
      '.settings/file-order.json',
    ]);
  });
});

describe('parseOrder', () => {
  test('accepts the shape we write', () => {
    expect(parseOrder('{"order":["b","a"]}')).toEqual(['b', 'a']);
  });

  test('accepts a bare array from an older file', () => {
    expect(parseOrder('["b","a"]')).toEqual(['b', 'a']);
  });

  test('malformed JSON degrades to no order rather than throwing', () => {
    expect(parseOrder('{ not json')).toBeNull();
    expect(parseOrder('')).toBeNull();
    expect(parseOrder(null)).toBeNull();
  });

  test('drops non-string entries and reports an all-junk file as no order', () => {
    expect(parseOrder('{"order":["a",null,7,"b"]}')).toEqual(['a', 'b']);
    expect(parseOrder('{"order":[null,7]}')).toBeNull();
    expect(parseOrder('{"order":[]}')).toBeNull();
  });
});

describe('sanitizeOrderNames — what may be written', () => {
  test('passes plain child names through unchanged', () => {
    expect(sanitizeOrderNames(['Overview.md', 'Design'])).toEqual({
      ok: true,
      names: ['Overview.md', 'Design'],
    });
  });

  test('rejects paths — entries are child names, never paths', () => {
    expect(sanitizeOrderNames(['../escape']).ok).toBe(false);
    expect(sanitizeOrderNames(['sub/child.md']).ok).toBe(false);
    expect(sanitizeOrderNames(['sub\\child.md']).ok).toBe(false);
    expect(sanitizeOrderNames(['..']).ok).toBe(false);
  });

  test('rejects non-arrays and empty/non-string entries', () => {
    expect(sanitizeOrderNames('a,b').ok).toBe(false);
    expect(sanitizeOrderNames([42]).ok).toBe(false);
    expect(sanitizeOrderNames(['']).ok).toBe(false);
  });

  test('caps the list so a folder listing cannot become a data dump', () => {
    const huge = Array.from({ length: MAX_ORDER_ENTRIES + 1 }, (_, i) => `f${i}.md`);
    expect(sanitizeOrderNames(huge).ok).toBe(false);
  });

  test('drops duplicates, keeping the first position', () => {
    const result = sanitizeOrderNames(['a.md', 'b.md', 'A.md']);
    expect(result.ok).toBe(true);
    expect(result.names).toEqual(['a.md', 'b.md']);
  });
});

describe('applyFileOrder', () => {
  const items = [doc('zebra.md'), dir('Beta'), doc('alpha.md'), dir('Alpha')];

  test('with no order: folders first, then files, each alphabetical', () => {
    expect(names(applyFileOrder(items, null)))
      .toEqual(['Alpha', 'Beta', 'alpha.md', 'zebra.md']);
    expect(names(applyFileOrder(items, []))).toEqual(names(defaultSort(items)));
  });

  test('named items lead, in the order named', () => {
    expect(names(applyFileOrder(items, ['zebra.md', 'Beta'])))
      .toEqual(['zebra.md', 'Beta', 'Alpha', 'alpha.md']);
  });

  test('unnamed items follow in the default sort', () => {
    expect(names(applyFileOrder(items, ['zebra.md'])))
      .toEqual(['zebra.md', 'Alpha', 'Beta', 'alpha.md']);
  });

  test('names nothing in this folder = no effect (the cascade must be free)', () => {
    expect(names(applyFileOrder(items, ['nothing.md', 'Absent'])))
      .toEqual(names(defaultSort(items)));
  });

  test('matching is case-insensitive — the content lives on Windows', () => {
    expect(names(applyFileOrder(items, ['ZEBRA.MD']))[0]).toBe('zebra.md');
  });

  test('stale names in the order are simply ignored', () => {
    expect(names(applyFileOrder(items, ['deleted.md', 'Beta'])))
      .toEqual(['Beta', 'Alpha', 'alpha.md', 'zebra.md']);
  });

  test('does not mutate the caller\'s array', () => {
    const original = [...items];
    applyFileOrder(items, ['zebra.md']);
    expect(items).toEqual(original);
  });
});

describe('resolveEffectiveOrder — the cascade rule', () => {
  test('a folder with no order of its own inherits its ancestor\'s', () => {
    expect(resolveEffectiveOrder(null, ['a', 'b'])).toEqual(['a', 'b']);
  });

  test('its own order overrides outright — no merging', () => {
    expect(resolveEffectiveOrder(['x'], ['a', 'b'])).toEqual(['x']);
  });

  test('an empty own order still inherits (dragging writes a real one)', () => {
    expect(resolveEffectiveOrder([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  test('nothing anywhere means default sort', () => {
    expect(resolveEffectiveOrder(null, null)).toBeNull();
  });
});

describe('cascade end to end', () => {
  /**
   * Mirrors what buildTreeFromFiling does: walk down, carrying the effective
   * order into each child folder.
   */
  function walk(node, inherited) {
    const effective = resolveEffectiveOrder(node.order || null, inherited);
    const ordered = applyFileOrder(node.items, effective);
    return {
      order: names(ordered),
      children: Object.fromEntries(
        Object.entries(node.folders || {}).map(([name, child]) => [name, walk(child, effective)])
      ),
    };
  }

  test('a root order reaches folders that never declared one', () => {
    const tree = walk({
      order: ['Overview.md', 'Architecture', 'Design'],
      items: [dir('Design'), dir('Architecture'), doc('Overview.md')],
      folders: {
        Architecture: {
          items: [doc('Design.md'), doc('Overview.md'), dir('Design')],
          folders: { Design: { items: [doc('Notes.md'), doc('Overview.md')] } },
        },
      },
    }, null);

    expect(tree.order).toEqual(['Overview.md', 'Architecture', 'Design']);
    // Inherited two levels down, matching whatever each folder happens to hold.
    expect(tree.children.Architecture.order[0]).toBe('Overview.md');
    expect(tree.children.Architecture.children.Design.order)
      .toEqual(['Overview.md', 'Notes.md']);
  });

  test('a folder\'s own order overrides the cascade for it AND its children', () => {
    const tree = walk({
      order: ['Overview.md'],
      items: [dir('Ops'), doc('Overview.md')],
      folders: {
        Ops: {
          order: ['Runbook.md'],
          items: [doc('Overview.md'), doc('Runbook.md')],
          folders: { Deep: { items: [doc('Overview.md'), doc('Runbook.md')] } },
        },
      },
    }, null);

    expect(tree.children.Ops.order).toEqual(['Runbook.md', 'Overview.md']);
    expect(tree.children.Ops.children.Deep.order).toEqual(['Runbook.md', 'Overview.md']);
  });
});

describe('reading', () => {
  test('readOrderWith prefers .system and falls back to .settings', async () => {
    const files = {
      'A/.settings/file-order.json': '{"order":["legacy.md"]}',
      'A/.system/file-order.json': '{"order":["current.md"]}',
    };
    const read = async (relPath) => {
      if (!(relPath in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[relPath];
    };

    expect(await readOrderWith(read, 'A')).toEqual(['current.md']);
    delete files['A/.system/file-order.json'];
    expect(await readOrderWith(read, 'A')).toEqual(['legacy.md']);
  });

  test('readOrderWith treats every failure as "no order"', async () => {
    const boom = async () => { throw new Error('provider exploded'); };
    await expect(readOrderWith(boom, 'A')).resolves.toBeNull();

    const junk = async () => 'not json at all';
    await expect(readOrderWith(junk, 'A')).resolves.toBeNull();
  });

  test('readFileOrder reads from disk, legacy location included', async () => {
    await seedOrder(workDir, ['a.md'], LEGACY_SETTINGS_DIR);
    expect(await readFileOrder(workDir)).toEqual(['a.md']);
  });

  test('readFileOrder returns null when the folder has none', async () => {
    expect(await readFileOrder(workDir)).toBeNull();
  });
});

describe('writing', () => {
  test('writeFileOrder creates .system and round-trips', async () => {
    await writeFileOrder(workDir, ['b.md', 'a.md']);
    const raw = await fs.readFile(orderPathFor(workDir), 'utf8');
    expect(JSON.parse(raw)).toEqual({ order: ['b.md', 'a.md'] });
    expect(await readFileOrder(workDir)).toEqual(['b.md', 'a.md']);
  });
});

describe('maintenance — rename / delete / move', () => {
  test('a rename keeps the item in place instead of dropping it to the bottom', async () => {
    await seedOrder(workDir, ['first.md', 'second.md', 'third.md']);
    expect(await renameInFileOrder(workDir, 'second.md', 'renamed.md')).toBe(true);
    expect(await readFileOrder(workDir)).toEqual(['first.md', 'renamed.md', 'third.md']);
  });

  test('a delete prunes the dead name', async () => {
    await seedOrder(workDir, ['first.md', 'second.md']);
    expect(await removeFromFileOrder(workDir, 'second.md')).toBe(true);
    expect(await readFileOrder(workDir)).toEqual(['first.md']);
  });

  test('neither creates an order file — an inheriting folder keeps inheriting', async () => {
    expect(await renameInFileOrder(workDir, 'a.md', 'b.md')).toBe(false);
    expect(await removeFromFileOrder(workDir, 'a.md')).toBe(false);
    await expect(fs.access(path.join(workDir, SETTINGS_DIR))).rejects.toThrow();
  });

  test('an item the order never named leaves the file untouched', async () => {
    await seedOrder(workDir, ['first.md']);
    expect(await renameInFileOrder(workDir, 'unlisted.md', 'other.md')).toBe(false);
    expect(await removeFromFileOrder(workDir, 'unlisted.md')).toBe(false);
    expect(await readFileOrder(workDir)).toEqual(['first.md']);
  });

  test('a legacy order file is rewritten in place, not migrated behind the user', async () => {
    await seedOrder(workDir, ['first.md', 'second.md'], LEGACY_SETTINGS_DIR);
    await removeFromFileOrder(workDir, 'second.md');

    const legacyRaw = await fs.readFile(
      path.join(workDir, LEGACY_SETTINGS_DIR, ORDER_FILE), 'utf8'
    );
    expect(JSON.parse(legacyRaw)).toEqual({ order: ['first.md'] });
    await expect(fs.access(path.join(workDir, SETTINGS_DIR))).rejects.toThrow();
  });

  test('renaming onto a name a stale entry still holds leaves one entry', async () => {
    await seedOrder(workDir, ['a.md', 'b.md', 'c.md']);
    await renameInFileOrder(workDir, 'a.md', 'c.md');
    expect(await readFileOrder(workDir)).toEqual(['c.md', 'b.md']);
  });
});
