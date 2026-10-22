import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetList, copyAssets, STARTER_TILES, SOURCE_DIR } from '../scripts/copy-assets.js';

/** A fresh temporary folder, removed after the test. */
async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dungeon-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the asset list has four facings per tile and every character frame', () => {
  const files = assetList();
  const tiles = files.filter((file) => file.to.startsWith('tiles'));
  const characters = files.filter((file) => file.to.startsWith('characters'));
  assert.equal(tiles.length, STARTER_TILES.length * 4);
  assert.equal(characters.length, 8 * (1 + 10 + 10));
  assert.ok(tiles.some((file) => file.to === path.join('tiles', 'stoneWall_N.png')));
  assert.ok(characters.some((file) => file.to === path.join('characters', 'Male_6_Run9.png')));
});

test('every listed sprite exists in the Kenney pack', async () => {
  for (const { from } of assetList()) {
    await stat(path.join(SOURCE_DIR, from)); // throws if it is missing
  }
});

test('copying fills the target folder, and a second run skips files already copied', async (t) => {
  const target = await tempDir(t);
  const first = await copyAssets({ target });
  assert.equal(first.copied, assetList().length);
  assert.equal(first.skipped, 0);
  assert.equal((await readdir(path.join(target, 'tiles'))).length, STARTER_TILES.length * 4);

  const second = await copyAssets({ target });
  assert.deepEqual(second, { copied: 0, skipped: assetList().length });
});

test('a sprite missing from the pack gives a clear error', async (t) => {
  const target = await tempDir(t);
  await assert.rejects(copyAssets({ target, tiles: ['noSuchTile'] }), /Missing sprite in the asset pack: .*noSuchTile_N\.png/);
});
