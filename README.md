# ⚒ Asset Forge

A **no-code, browser-based tool** for turning raw source images into
game-ready assets: sliced sprite sheets with animation previews, collision-aware
tilesets, and drag-and-drop stage maps. Everything exports as portable
PNG + JSON (see [`docs/formats.md`](docs/formats.md)) that any 2D engine can
load — it is **not** tied to any one game.

It was built for the workflow behind a top-down 2D game (slice source art,
key out magenta backgrounds, curate four-direction sprites, compose tile
worlds), but the export formats are deliberately engine-agnostic and reusable
across projects.

## Quick start

```bash
npm install
npm run dev          # opens http://localhost:5180
```

That's it — no backend, no accounts, no build step for the end user. Work is
**autosaved** to the browser, and you can `Save project` / `Open project` to
move a whole project (images included) between machines as one `.afproj.json`.

To ship a static copy you can open from disk or host anywhere:

```bash
npm run build        # -> dist/
```

## The three studios

### 🎞 Sprite Studio
Import a source image → key out the magenta background → slice frames
(uniform **grid**, hand-drawn **boxes**, or **auto-detect** blobs) → group them
into named animation clips with four-direction rows → **preview the animation**
on a dark stage → export an anchor-aligned sheet + frames manifest.

- **Quick-rig 4-dir walk** splits frames into `up, right, down, left` rows in one
  click (the standard top-down row order).
- Frames are **aligned to an anchor** (feet-center by default) so animations
  don't jitter.

### 🧱 Tile Studio
Import a tilesheet → set the slice grid (with an **inset** to avoid pixel bleed
from neighbouring tiles) → generate tiles (empty cells skipped) → tag each tile
with a char code and **collision flags** (blocks movement / blocks sight) →
export a normalised atlas + tileset manifest.

### 🗺 Stage Editor
Pick tiles from the palette and **paint / drag** them onto a grid. Tools:
`paint`, `erase`, `fill` (bucket), `rect`, and `collision` (paint blocked cells).
Multiple layers (ground, overlay, …), a live collision overlay, and free-placed
**objects** with blocking footprints. Collisions can be **auto-derived from tile
flags** or hand-painted. Export is a **self-contained** zip: the stage JSON, every
referenced tileset PNG+JSON, an ascii map + legend, and a composited preview PNG.

Controls everywhere: **wheel** = zoom, **middle-drag** or **Space-drag** = pan.

## Output

| Studio | Files in the zip |
| --- | --- |
| Sprite | `name.png`, `name.frames.json` |
| Tile | `name.png`, `name.tileset.json` |
| Stage | `name.stage.json`, bundled `*.tileset.json` + `*.png`, `name-preview.png` |

Schemas: [`schema/`](schema). Format guide + Phaser examples:
[`docs/formats.md`](docs/formats.md).

## Tech

Vanilla TypeScript + Canvas, bundled by Vite. No runtime dependencies. Source
images are stored in IndexedDB; the project model autosaves to localStorage.
The magenta chroma-key matches the tib runtime's `isMagentaKey` heuristic so
forged assets key out identically in-game.

```
src/
  core/     image loading, IndexedDB, chroma key, zip, pan/zoom viewport, store
  sprite/   slicer (grid + blob detect), packer/aligner, animation preview, UI
  tile/     tile packer, UI
  stage/    stage export (refs + ascii), interactive editor UI
```

## Smoke test (optional)

A headless Playwright check exercises all three studios (import → slice → rig →
export) and validates the zips. Playwright isn't a dependency of this repo;
point it at any installation:

```bash
npm run build
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.js npm run smoke
```
