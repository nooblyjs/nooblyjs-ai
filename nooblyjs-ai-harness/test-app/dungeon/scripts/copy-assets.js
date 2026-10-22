// Phase 0: copy the sprites the game uses from the Kenney pack (.noobly/ui) into public/assets.
// .noobly/ui stays the untouched source. Copying only what we need keeps the served folder small.
// For now the list is fixed (the test room and Level 1). In Phase 6 it will be worked out from the level files.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE_DIR = path.join(root, '.noobly', 'ui');
export const TARGET_DIR = path.join(root, 'public', 'assets');

/** Every tile comes in four facings. */
export const FACINGS = ['N', 'E', 'S', 'W'];

/** Tiles for the Phase 1 test room and Level 1. test/levels.test.js checks every level's tiles are here. */
export const STARTER_TILES = [
  'stone',
  'stoneWall',
  'stoneWallCorner',
  'stoneWallDoorOpen',
  'stoneWallWindow',
  'barrel',
  'barrels',
  'barrelsStacked',
  'chestClosed',
  'tableRoundChairs',
  'woodenCrate',
  'woodenCrates',
  'woodenSupports',
  'stairs',
];

/** The character's animations and how many frames each one has (see Characters/Male). */
export const CHARACTER_ANIMATIONS = { Idle: 1, Run: 10, Pickup: 10 };

/** The 8 directions the character faces, 0 = N, 2 = E, 4 = S, 6 = W. */
export const CHARACTER_DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7];

/** List the files to copy as { from, to } pairs, relative to the source and target folders. */
export function assetList({ tiles = STARTER_TILES } = {}) {
  const files = [];
  for (const tile of tiles) {
    for (const facing of FACINGS) {
      const name = `${tile}_${facing}.png`;
      files.push({ from: path.join('Isometric', name), to: path.join('tiles', name) });
    }
  }
  for (const direction of CHARACTER_DIRECTIONS) {
    for (const [animation, frames] of Object.entries(CHARACTER_ANIMATIONS)) {
      for (let frame = 0; frame < frames; frame++) {
        const name = `Male_${direction}_${animation}${frame}.png`;
        files.push({ from: path.join('Characters', 'Male', name), to: path.join('characters', name) });
      }
    }
  }
  return files;
}

/** Copy the listed files. Files already there with the same size are skipped, so re-running is quick. */
export async function copyAssets({ source = SOURCE_DIR, target = TARGET_DIR, tiles } = {}) {
  let copied = 0;
  let skipped = 0;
  for (const { from, to } of assetList({ tiles })) {
    const fromPath = path.join(source, from);
    const toPath = path.join(target, to);
    const fromStat = await stat(fromPath).catch(() => null);
    if (!fromStat) throw new Error(`Missing sprite in the asset pack: ${from}`);
    const toStat = await stat(toPath).catch(() => null);
    if (toStat && toStat.size === fromStat.size) {
      skipped++;
      continue;
    }
    await mkdir(path.dirname(toPath), { recursive: true });
    await copyFile(fromPath, toPath);
    copied++;
  }
  return { copied, skipped };
}

// Run when called directly (`npm run assets`), not when a test imports this file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { copied, skipped } = await copyAssets();
    console.log(`Assets ready in public/assets (${copied} copied, ${skipped} already up to date).`);
  } catch (error) {
    console.error(`Could not copy the assets: ${error.message}`);
    process.exitCode = 1;
  }
}
