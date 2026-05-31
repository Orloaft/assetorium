# ⚒ Asset Forge

A **no-code, browser-based tool** for turning raw source images into
game-ready assets: sliced sprite sheets with animation previews, collision-aware
tilesets, and drag-and-drop stage maps. Everything exports as portable
**PNG + JSON** (see [`docs/formats.md`](docs/formats.md)) that any 2D engine can
load — it is **not** tied to any one game.

It was built for a top-down 2D game's asset pipeline (slice source art, key out
magenta backgrounds, curate four-direction sprites, compose tile worlds), but
the export formats are deliberately engine-agnostic and reusable across
projects.

---

## Contents

- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Background removal — Tolerance vs Fringe vs Inset](#background-removal--tolerance-vs-fringe-vs-inset)
- [🎞 Sprite Studio](#-sprite-studio)
- [🧱 Tile Studio](#-tile-studio)
- [🗺 Stage Editor](#-stage-editor)
- [Controls](#controls)
- [Output formats](#output-formats)
- [Troubleshooting](#troubleshooting)
- [Tech & architecture](#tech--architecture)
- [Smoke test](#smoke-test)

---

## Quick start

```bash
npm install
npm run dev          # opens http://localhost:5180
```

No backend, no accounts. Work **autosaves** to the browser as you go. Use
**Save project** / **Open project** (top-right) to move a whole project —
*images included* — between machines as one self-contained `.afproj.json`.

To ship a static copy you can open from disk or host anywhere:

```bash
npm run build        # -> dist/
```

> **After updating the code, hard-reload the tab** (`Ctrl+Shift+R`). A tab
> loaded against an older bundle won't show newly added controls.

---

## Core concepts

- **Source images** live in the left sidebar; import once and reuse across many
  documents. They're stored in your browser (IndexedDB), not re-uploaded.
- A **document** (sprite / tileset / stage) binds to a source image and holds
  your slicing, metadata, and layout. A new document auto-adopts the most
  recently imported image if you haven't picked one.
- **Three-panel workspace:** left = sources + document list; center = the
  zoom/pan canvas; right = the **inspector** (all settings, tools, preview, and
  export for the selected document). *Most actions live in the right panel —
  scroll it.*
- **Export** produces a `.zip` of PNG art + JSON manifests. Backgrounds are
  already keyed transparent in the output.

---

## Background removal — Tolerance vs Fringe vs Inset

Source art usually ships on a bright **magenta** background. Removing it cleanly
is the #1 source of confusion, so here's exactly how the three controls differ.
They're complementary — you often use all three.

| Control | Where | What it targets | Raise it when… |
| --- | --- | --- | --- |
| **Tolerance** | Sprite + Tile, *Background removal* | **Bright** magenta — measured as distance from `(255,0,255)` | The solid magenta field isn't fully gone |
| **Fringe cleanup** | Sprite + Tile, *Background removal* | **Dark** anti-aliased magenta edges — measured by *hue* (`min(r,b) > g`), brightness-independent | Faint pink/purple remnants linger at edges that tolerance can't kill |
| **Inset** | Tile, *Slice grid* | Bleed right at a tile's **cell border** | Remnants form a thin frame around each tile |

**Why Tolerance alone can't remove faint remnants:** Tolerance keys on *distance
from bright magenta*. Anti-aliasing produces *dark* magenta blend pixels (e.g.
`(65,0,66)`) that are far from bright magenta in brightness — so no tolerance
value catches them without also eating dark green/brown art. **Fringe cleanup**
solves this by detecting the magenta *hue* (red and blue both above green)
regardless of brightness: strong casts go transparent, mild casts are despilled
(the pink/purple tint is pulled out so edges go neutral instead of leaving a
coloured halo).

**Recipe for a magenta tilesheet:** Tolerance for the bright field → Fringe
cleanup (default 24; raise to 30–50 for stubborn edges) → a 1–2 px Inset if any
bleed sits right at the cell borders. Lower Fringe toward 0 only if genuinely
pink/purple *art* starts disappearing.

---

## 🎞 Sprite Studio

Turn a character/enemy sheet into an anchor-aligned animation sheet + manifest.

### Workflow
1. **Import** a source image (sidebar → *+ Import images*), or pick an existing
   one. Click **+ New sprite** and the image binds automatically.
2. **Remove the background:** toggle *Key out magenta*, then set **Tolerance**
   and **Fringe cleanup** (see [above](#background-removal--tolerance-vs-fringe-vs-inset)).
3. **Slice frames** — three ways, mix freely:
   - **Grid** — set Cols/Rows/Cell W/H/offsets/gap → *Apply grid* (or *＋ Add
     grid* to append a second region).
   - **Draw box** — switch *Tool → Draw box* and drag rectangles directly.
   - **Auto-detect** — finds opaque blobs automatically. Tune **Min size**
     (ignore specks/text), **Row tol** (group frames into reading rows), **Pad**.
4. **Delete unwanted frames** (auto-detect often grabs baked-in row labels or
   captions). In *Select frames* mode:
   - **Right-click** a frame box → deletes just that one.
   - **Click to select** (turns green, numbered in click order), then press
     **Delete**/**Backspace**, or use **🗑 Delete selected**.
5. **Preview** (the dark stage, right under the slice section — two modes):
   - **Quick preview:** click **▶ Preview** to play your *selected* frames (in
     click order) or *all* frames if none are selected. Adjust **fps** and zoom.
     This is a throwaway look — no setup needed.
   - **Clip preview:** click any animation row (below) to preview that rigged
     clip.
6. **Rig animations** (this is what gets *exported*):
   - **⚡ Quick-rig 4-dir walk** — splits frames evenly into `up, right, down,
     left` rows in one click (standard top-down order).
   - Or **+ Clip** → add rows with `+up/+right/+down/+left` (directional) or
     **+all** (non-directional, e.g. an idle/attack loop) → select the frames in
     play order → **Assign selection → row**. Set per-clip **fps** and **loop**.
7. **Export sprite** → `name.png` (aligned uniform-grid sheet) + `name.frames.json`.

### Notes
- **Anchor** (Alignment section) defaults to feet-center `(0.5, 1.0)` for
  top-down. All frames are aligned to it so the animation doesn't jitter; use
  `(0.5, 0.5)` for centered/floating sprites.
- The **quick preview is not exported** — only clips you rig become animations
  in the manifest. For a single short enemy animation, make one **+all** clip.

---

## 🧱 Tile Studio

Slice a tilesheet into a normalised atlas with per-tile collision metadata.

### Workflow
1. **Import** a tilesheet, **+ New tileset** (binds the image).
2. **Remove the background** (Tolerance + Fringe — tilesheets especially benefit
   from Fringe cleanup + a small Inset; see
   [above](#background-removal--tolerance-vs-fringe-vs-inset)).
3. **Slice tiles** — two ways:
   - **✨ Auto-detect tiles** — finds each object separated by the (keyed)
     background and makes it a tile. Ideal for trees/rocks/bushes/props scattered
     on magenta. Tune **Min size** (ignore specks) and **Pad**. Packed terrain
     whose cells touch detects as one blob — slice those with the grid instead.
   - **Generate from grid** — set Cols/Rows/Cell W/H/offsets/gap, an **Inset** to
     trim each cell's border, and *Skip empty cells*. Best for uniform packed
     tilesheets with no gaps.
4. **Set output tile size** (e.g. 32) — every tile is resized to this in the
   atlas.
5. **Tag tiles** — click a tile (canvas or *All tiles* list) and set its **char**
   code, **name**, **Blocks movement**, **Blocks sight/projectiles**. Blocked
   tiles show a red tint on the canvas; sight-blockers a yellow border.
6. **Export tileset** → `name.png` (atlas) + `name.tileset.json` (tile metadata
   + collision flags).

---

## 🗺 Stage Editor

Compose a stage by painting tiles from your tilesets, then define collisions.

### Workflow
1. **+ New stage** — set **Cols/Rows** and **Tile size**. (Build tilesets in
   Tile Studio first; they populate the palette.)
2. **Paint terrain** — pick a 1-cell tile from the **palette** and `paint`,
   `fill` (bucket), or `rect` it onto the ground layer.
3. **Scatter for natural variation** — `🎲 Scatter`: **shift-click** several
   terrain tiles (grass variants, grass+dirt, …) to build a scatter set, enable
   Scatter, then paint/fill — each cell gets a random pick, so terrain doesn't
   look obviously tiled.
4. **Place decorations** — palette tiles bigger than one cell show a `◳` badge;
   clicking one switches to the **object** tool. Click the map to **stamp** it
   at its true proportions across multiple cells (trees, rocks, buildings). They
   y-sort (nearer objects overlap farther ones) and snap to their base. Click an
   object to select/move it.
5. **Autotile terrains** — for tilesets with edge/corner transition tiles:
   **+ Terrain**, then click a palette tile and click one of the 16 edge slots to
   assign it (each slot's glyph shows which sides connect; right-click clears).
   Pick the **terrain** tool and paint — every cell auto-picks the right
   edge/corner tile from its neighbours, so grass↔dirt↔water borders resolve
   themselves. Resolved tiles land in the normal tile layer, so export is
   unchanged. (Current model: `edge16` — straight edges + outer corners.)
   - **Synthesized transitions** — for sheets with only *full-fill* tiles (no
     edge/corner art, like many biome sheets): select a tile and **Set fill**,
     select another and **Set base**, then **✨ Generate transition**. It blends
     fill over base with an ordered (Bayer) dither and builds a ready-to-paint
     16-tile terrain — so grass softly blends into dirt with no hand-drawn
     transition tiles.
6. **Layers** — multiple tile layers (e.g. `ground`, `overlay`); reorder,
   rename, hide. Painting affects the active layer.
6. **Collisions** — **Recompute from tiles + objects** seeds the grid from each
   tile's `blocked` flag and every blocking object footprint, or hand-paint with
   the `collision` tool. The exported grid is authoritative.
7. **Export stage** → a **self-contained** zip: `name.stage.json` (layers,
   collision, objects with their tile refs), every referenced tileset's PNG+JSON,
   an **ascii** map + legend, and a composited `name-preview.png`.

### Getting clean tiles from a source sheet
- **Set the output tile size to your terrain tile** (Tile Studio → *Output tile
  size*, or click a terrain tile and **Fit tile size → N**). Then terrain = 1
  cell and bigger art (trees) becomes multi-cell objects automatically.
- **Raise the slice Inset** until terrain edges are clean — it trims the soft
  anti-aliased fringe off terrain tiles so they tile seamlessly. Inset is applied
  to terrain-sized tiles only; objects keep their full silhouette.
- **Mixed sheets** (packed terrain + scattered props): grid-slice the terrain
  region, tick **Append**, then **Auto-detect tiles** for the props — both land
  in one palette.

---

## Controls

| Action | Where |
| --- | --- |
| Zoom | Mouse **wheel** (anchored at cursor) |
| Pan | **Middle-drag** or **Space-drag** |
| Select / paint / draw | **Left-click / drag** |
| Delete a frame (Sprite) | **Right-click** the frame box |
| Delete selected frames (Sprite) | **Delete** / **Backspace**, or 🗑 button |
| Save / open whole project | Top-right **Save project** / **Open project** |

---

## Output formats

| Studio | Files in the zip |
| --- | --- |
| Sprite | `name.png`, `name.frames.json` |
| Tile | `name.png`, `name.tileset.json` |
| Stage | `name.stage.json`, bundled `*.tileset.json` + `*.png`, `name-preview.png` |

- Frame/tile indices are **row-major**; sprite animations and stage tile-refs
  reference them by index.
- Stage tile refs are `"<tilesetName>:<index>"`; `null` = empty cell. The stage
  `collision` grid is explicit (`1` = blocked) and authoritative.
- JSON Schemas: [`schema/`](schema). Full format guide with **Phaser**
  integration examples: [`docs/formats.md`](docs/formats.md).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| **A newly added control/button isn't there** | Hard-reload the tab (`Ctrl+Shift+R`); you're on a stale bundle. |
| **Faint pink/purple remnants after keying** | Raise **Fringe cleanup** (Tolerance can't reach dark AA edges). For per-tile border bleed, raise the slice **Inset**. |
| **Real (purple/pink) art is disappearing** | Lower **Fringe cleanup** toward 0; lower **Tolerance**. |
| **Auto-detect boxed the row labels / caption text** | Delete those frames (right-click, or select + Delete), or raise **Min size** to skip small blobs. |
| **Preview stage is empty / "how do I preview?"** | It's right under the slice section. Click **▶ Preview** for a quick look (no clip needed); click a clip row to preview a rigged animation. |
| **Quick-rig says "need at least 4 frames"** | Slice/detect frames first; quick-rig splits existing frames into 4 directions. |
| **Animation jitters** | Check the **Anchor** (feet-center `0.5,1.0` for top-down) and enable **Trim**. |
| **Autosave failed (storage full)** | Use **Save project** to download a `.afproj.json`; clear old browser data. |

---

## Tech & architecture

Vanilla **TypeScript + Canvas**, bundled by **Vite**. **No runtime
dependencies.** Source images are stored in IndexedDB; the project model
autosaves to localStorage; the full project (with images base64-embedded)
round-trips through one `.afproj.json`. Export zips are written by a tiny
store-only ZIP encoder.

The magenta chroma-key matches the original game runtime's `isMagentaKey`
heuristic (bright magenta + the dark red-leaning purple gradient case) so forged
assets key out identically in-game, plus the hue-based fringe pass described
above.

```
src/
  core/     image loading, IndexedDB, chroma key, zip, pan/zoom viewport, store, DOM helpers
  sprite/   slicer (grid + blob detect), packer/aligner, animation preview, UI
  tile/     tile packer, UI
  stage/    stage export (tile refs + ascii), interactive editor UI
schema/     JSON Schemas for the three export manifests
docs/       formats.md — format guide + Phaser examples
```

---

## Smoke test

A headless Playwright check boots the built app and exercises all three studios
(import → slice → rig → export), asserting the zips are valid. Playwright is
**not** a dependency of this repo — point it at any installation:

```bash
npm run build
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.js npm run smoke
```
