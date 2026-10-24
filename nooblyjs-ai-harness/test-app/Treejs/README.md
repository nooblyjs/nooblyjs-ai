# Space Miner

A point-and-click space mining game in three.js. Click the ground and your astronaut walks there. Click a crystal to mine it, then click your ship to sell the ore.

## Run it

```
npm start
```

Then open http://localhost:8080 in a browser. Three.js loads from a CDN, so the first start needs internet access.

The models must be served over http (not opened as a file), because the browser will not load them from `file://`.

## Controls

- Click the ground: walk there.
- Click a crystal: walk over and mine it. Each unit of ore is one swing of the pick.
- Click your ship: walk over and load your cargo. The ship flies to the depot when it is full.
- Scroll the view with the arrow keys or `WASD`, or move the mouse to the edge of the screen.
- `F`: snap the view back to following your astronaut.
- Click the minimap (top-right): jump the view to that spot.
- `M`: turn sound on or off. Sound starts after your first click, because browsers require that.

The map is 48 × 48 tiles. The ship sits at the bottom middle and the depot is at the top left, about 40 tiles away. A longer trip takes longer to fly (2.5 to 8 seconds).

## Test it

```
npm test
```

The tests cover the rules and the maths that have no three.js in them: pathfinding, world generation, mining, the astronaut's poses, the camera shake and scrolling limits, the minimap mapping, the flight time and the sound module (run against a fake audio system).

## Layout

- `index.html`: the page, the HUD and the three.js import map.
- `js/main.js`: the scene, the models, the mouse and the walking.
- `js/grid.js`: the walkable grid and A* pathfinding.
- `js/world.js`: builds the asteroid field from a seed.
- `js/mining.js`: cargo, mining speed, selling and the quota.
- `js/animation.js`: the astronaut's poses, the camera shake and the arc of flying ore.
- `js/effects.js`: the glows, the laser, sparks, the ore flying to the ship and the floating credits.
- `js/sound.js`: sound effects, made with the Web Audio API (no sound files).
- `ui/`: the Kenney Space Kit assets (CC0). Models are in `ui/Models/GLTF format/`.

## Credits

Models and textures: Space Kit by Kenney (www.kenney.nl), Creative Commons Zero (CC0).
