// Phase 1–2: a hard-coded 8 × 8 test room. Since Phase 3 the game plays level files (levels.js);
// this room stays as a fixture for the draw-order and movement tests, because it has the tricky cases.
import { LAYER } from './render.js';
import { WALL_EDGE, BACK_CORNER } from './levels.js';

export { WALL_EDGE, BACK_CORNER };

export const ROOM_SIZE = 8;

/** Build the test room as a list of drawables: { tile, facing, col, row, layer }. */
export function testRoom() {
  const items = [];
  const facings = ['N', 'E', 'S', 'W'];

  // The floor. Turning the same stone tile to different facings breaks up the repeating pattern.
  for (let row = 0; row < ROOM_SIZE; row++) {
    for (let col = 0; col < ROOM_SIZE; col++) {
      items.push({ tile: 'stone', facing: facings[(col * 3 + row * 5) % 4], col, row, layer: LAYER.floor });
    }
  }

  // Back walls along row 0 and column 0. The front is left open (a cut-away), so we can see inside.
  // Walls are listed before the props so a prop on the same tile is drawn in front of its wall.
  items.push({ tile: 'stoneWallCorner', facing: BACK_CORNER, col: 0, row: 0, layer: LAYER.object });
  for (let i = 1; i < ROOM_SIZE; i++) {
    const doorway = i === 5;
    items.push({ tile: doorway ? 'stoneWallDoorOpen' : 'stoneWall', facing: WALL_EDGE.backRow, col: i, row: 0, layer: LAYER.object });
    items.push({ tile: 'stoneWall', facing: WALL_EDGE.backCol, col: 0, row: i, layer: LAYER.object });
  }

  // A few props to test the draw order (each should be covered by anything in front of it)
  // and, from Phase 2, blocking: the player cannot walk onto them.
  items.push({ tile: 'barrel', facing: 'N', col: 1, row: 1, layer: LAYER.object });
  items.push({ tile: 'barrel', facing: 'E', col: 2, row: 1, layer: LAYER.object });
  items.push({ tile: 'chestClosed', facing: 'S', col: 1, row: 4, layer: LAYER.object });
  items.push({ tile: 'woodenSupports', facing: 'N', col: 4, row: 3, layer: LAYER.object });
  items.push({ tile: 'barrel', facing: 'S', col: 5, row: 5, layer: LAYER.object });
  return items;
}

/** The test room as a level for game.js: its size, where the player starts, and its drawables. */
export function testLevel() {
  return {
    width: ROOM_SIZE,
    height: ROOM_SIZE,
    start: { col: 3, row: 6, facing: 0 },
    items: testRoom(),
  };
}
