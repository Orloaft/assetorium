# Asset Forge export formats

Every export is a `.zip` containing PNG art plus engine-agnostic JSON. The JSON
schemas live in [`/schema`](../schema). Nothing here is engine-specific — the
worked examples below happen to use [Phaser 3](https://phaser.io) because that's
a common top-down target, but the data maps cleanly onto any 2D engine.

---

## 1. Sprite — `*.frames.json` + `*.png`

A packed, **anchor-aligned** sheet. All frames share one uniform cell
(`frameWidth × frameHeight`); the slicer trims and re-aligns each frame so a
chosen anchor (feet-center `0.5,1.0` for top-down) lands at the same spot in
every cell — this removes the per-frame jitter you get from raw slices.

```jsonc
{
  "schema": "asset-forge/sprite-frames@1",
  "name": "goblin",
  "image": "goblin.png",
  "frameWidth": 28, "frameHeight": 29,
  "columns": 4, "rows": 4,
  "frameCount": 16,
  "anchor": { "x": 0.5, "y": 1.0 },
  "directions": ["up", "right", "down", "left"],
  "animations": {
    "walk-up":    { "frames": [0,1,2,3],     "frameRate": 8, "loop": true },
    "walk-right": { "frames": [4,5,6,7],     "frameRate": 8, "loop": true },
    "walk-down":  { "frames": [8,9,10,11],   "frameRate": 8, "loop": true },
    "walk-left":  { "frames": [12,13,14,15], "frameRate": 8, "loop": true }
  }
}
```

Frame indices are **row-major** over the grid. `animations` keys are
`"<clip>-<direction>"`, or just `"<clip>"` for non-directional clips.

### Consuming in Phaser

```ts
// preload
this.load.spritesheet("goblin", "goblin.png", { frameWidth: 28, frameHeight: 29 });

// create — build every animation straight from the manifest
const manifest = await (await fetch("goblin.frames.json")).json();
for (const [key, a] of Object.entries(manifest.animations)) {
  this.anims.create({
    key: `goblin-${key}`,
    frames: a.frames.map((f) => ({ key: "goblin", frame: f })),
    frameRate: a.frameRate,
    repeat: a.loop ? -1 : 0
  });
}
const goblin = this.add.sprite(x, y, "goblin");
goblin.setOrigin(manifest.anchor.x, manifest.anchor.y); // feet-center
goblin.play("goblin-walk-down");
```

---

## 2. Tileset — `*.tileset.json` + `*.png`

A normalised atlas: every tile is resized to `tileSize`, laid out row-major.
Per-tile metadata carries collision flags so a map built from this tileset can
derive its collision grid.

```jsonc
{
  "schema": "asset-forge/tileset@1",
  "name": "town",
  "image": "town.png",
  "tileSize": 32,
  "columns": 8, "rows": 4,
  "tiles": [
    { "index": 0, "id": "t_grass", "char": ".", "name": "Grass", "blocked": false, "sightBlocked": false, "tags": [] },
    { "index": 1, "id": "t_wall",  "char": "#", "name": "Wall",  "blocked": true,  "sightBlocked": true,  "tags": ["structure"] }
  ]
}
```

### Consuming in Phaser

```ts
this.load.spritesheet("town", "town.png", { frameWidth: 32, frameHeight: 32 });
// draw tile `index` at pixel (px,py):
this.add.image(px, py, "town", index).setOrigin(0);
```

---

## 3. Stage — `*.stage.json` (+ bundled tilesets + preview)

A stage zip is **self-contained**: it bundles the `*.stage.json`, every
tileset PNG+JSON it references, a `*-preview.png`, and an ascii rendering.

```jsonc
{
  "schema": "asset-forge/stage@1",
  "name": "waystone",
  "tileSize": 32,
  "cols": 40, "rows": 25,
  "tilesets": [
    { "id": "...", "name": "town", "image": "town.png", "manifest": "town.tileset.json" }
  ],
  "layers": [
    { "name": "ground",  "type": "tile", "data": [[ "town:0", "town:0", null ], ...] },
    { "name": "overlay", "type": "tile", "data": [[ null, "town:1", null ], ...] }
  ],
  "collision": [[0,0,1], ...],
  "objects": [{ "key": "spriteWell", "x": 10, "y": 12, "w": 2, "h": 2, "blocking": true }],
  "ascii": { "legend": { ".": "town:0", "#": "town:1", "empty": "empty" }, "rows": ["..#..", ...] }
}
```

- **Tile refs** are `"<tilesetName>:<index>"`, matching the tile's `index` in
  that tileset's manifest. `null` = empty cell.
- **`collision`** is an explicit `rows × cols` grid (`1` = blocked). It is
  seeded from tile `blocked` flags but can be hand-edited in the editor, so it
  is authoritative — consumers should read it directly rather than re-deriving.
- **`objects`** are free-placed props/structures in tile coordinates with a
  `blocking` footprint flag.
- **`ascii`** + `legend` is a convenience for engines (or humans) that prefer a
  char-grid map; it renders the first tile layer.

### Consuming a stage (engine-agnostic sketch)

```ts
const stage = await (await fetch("waystone.stage.json")).json();
const sets = {};
for (const ts of stage.tilesets) sets[ts.name] = await loadTileset(ts.image, ts.manifest);

for (const layer of stage.layers) {
  layer.data.forEach((row, y) => row.forEach((ref, x) => {
    if (!ref) return;
    const [name, idx] = ref.split(":");
    drawTile(sets[name], +idx, x * stage.tileSize, y * stage.tileSize);
  }));
}
// collision[y][x] === 1  -> blocked
```

---

## Background removal (magenta chroma key)

All three studios key out magenta backgrounds before slicing, using the same
heuristic as the tib runtime (bright magenta plus the dark red-leaning purple
gradient case). Two controls:

- **Tolerance** — widens the match around *bright* magenta for anti-aliased
  edges (a distance-from-`(255,0,255)` test).
- **Fringe cleanup** — a *hue-based* pass that catches the **dark** anti-aliased
  magenta/purple edge pixels (where red & blue both exceed green) that a
  brightness test can't reach. Strongly magenta-cast pixels become transparent;
  milder casts are despilled (the pink/purple tint is removed so edges don't
  leave a coloured halo). Raise it if remnants linger; lower it toward 0 if real
  art starts to erode.

For tilesheets, the per-tile **inset** (Tile Studio slice grid) also trims a
border off each cell, removing any bleed right at the tile boundary.

Exports are already keyed — the PNGs ship with a transparent background.
