// Central data model for Asset Forge.
//
// Two layers live here:
//   1. The in-app *document* model (what the editors mutate, what gets saved
//      to a project file). Optimised for editing.
//   2. The exported *manifest* model (the portable JSON written next to the
//      generated PNGs). Optimised for any engine to consume. Export functions
//      transform documents into manifests; the two are intentionally separate
//      so the editing model can evolve without breaking exported assets.

export const DIRECTIONS = ["up", "right", "down", "left"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** A loaded source image. Pixels live in IndexedDB (see core/store); the
 * document only keeps metadata + the id used to fetch the bitmap. */
export interface SourceImage {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** Magenta chroma-key settings, ported from the tib runtime convention
 * (bright magenta backgrounds keyed to transparent). Tolerance widens the
 * match so near-magenta anti-aliased edges also drop out. */
export interface ChromaSettings {
  enabled: boolean;
  /** 0..255 — how far a pixel may stray from pure magenta and still key out. */
  tolerance: number;
  /** Hue-based anti-alias fringe cleanup. Targets dark/desaturated magenta
   * edge pixels (where red & blue both exceed green) that the brightness-based
   * tolerance can't reach. The value is the "magenta cast" cutoff: pixels with
   * cast above it become transparent, milder casts are de-tinted (despilled).
   * 0 = off. */
  fringe: number;
}

export function defaultChroma(): ChromaSettings {
  return { enabled: true, tolerance: 60, fringe: 24 };
}

// ---------------------------------------------------------------------------
// Sprite documents
// ---------------------------------------------------------------------------

/** A single sub-rectangle in source-image pixel space. */
export interface FrameBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One row of an animation — a direction (or "all" for non-directional) plus
 * the ordered frames that play for it. */
export interface ClipRow {
  dir: Direction | "all";
  frames: string[]; // FrameBox ids
}

export interface AnimationClip {
  id: string;
  name: string; // e.g. "walk", "attack"
  fps: number;
  loop: boolean;
  rows: ClipRow[];
}

export interface SpriteDoc {
  id: string;
  name: string;
  sourceId: string | null;
  chroma: ChromaSettings;
  /** Origin used when aligning frames into the packed sheet. Feet-center
   * (0.5, 1.0) is the top-down convention; head/center sprites use (0.5,0.5). */
  anchor: { x: number; y: number };
  /** Trim transparent margins per frame before packing/aligning. */
  trim: boolean;
  frames: FrameBox[];
  clips: AnimationClip[];
}

// ---------------------------------------------------------------------------
// Tileset documents
// ---------------------------------------------------------------------------

export interface TileDef {
  id: string; // stable id within the tileset
  /** Optional single-character code for ascii-style stage export. */
  char: string;
  name: string;
  /** Source rectangle in the tilesheet. */
  x: number;
  y: number;
  w: number;
  h: number;
  blocked: boolean; // blocks movement
  sightBlocked: boolean; // blocks line of sight / projectiles
  tags: string[];
}

export interface TilesetDoc {
  id: string;
  name: string;
  sourceId: string | null;
  chroma: ChromaSettings;
  /** Output tile edge in px (every tile is normalised to this in the atlas). */
  tileSize: number;
  /** Grid the slicer used to seed tiles (kept so it can be re-sliced). */
  grid: { offsetX: number; offsetY: number; cols: number; rows: number; cellW: number; cellH: number; spacing: number; inset: number };
  tiles: TileDef[];
}

// ---------------------------------------------------------------------------
// Terrains (autotiling)
// ---------------------------------------------------------------------------

/** An autotile terrain: paint membership, and each cell resolves to the right
 * tile from its neighbours. `roles` maps a neighbour bitmask to a tile ref
 * ("<tilesetId>/<tileId>").
 *
 * kind "edge16": 4-bit mask of orthogonal neighbours that share the terrain —
 *   bit 0 = N, 1 = E, 2 = S, 3 = W (16 tiles: edges + outer corners).
 * kind "blob47": 8-neighbour mask reduced to 47 cases (adds inner corners).
 * kind "path": a linear road/river — same 4-bit mask, but connects only to the
 *   same path id (no priority) and ends at the map edge; rendered as an overlay.
 * kind "wang": corner-based Wang (the primary terrain model) — 16 tiles indexed
 *   by which CORNERS are this terrain (TL=1,TR=2,BR=4,BL=8); dual-grid rendered.
 */
export interface Terrain {
  id: string;
  name: string;
  tilesetId: string;
  kind: "edge16" | "blob47" | "path" | "wang" | "cliff";
  /** maskValue -> tile ref. */
  roles: Record<number, string>;
  /** kind "cliff": a single south-facing cliff-face tile ref. Painted as a
   * region; the face is drawn (rotated) on every exposed edge of the region, so
   * one hand-drawn front face yields cliffs on all sides. Tiers nest. */
  faceRef?: string;
  /** Cliff wall, drawn on the cells directly below this terrain's south edge
   * (RPG-Maker-A4 style). `tiles` is a 9-entry array of tile refs laid out
   * row-major [topL,topC,topR, midL,midC,midR, baseL,baseC,baseR]; `height` is
   * how many cells tall the wall face is. Only meaningful for kind "wang"
   * (the plateau top is a normal corner-Wang set). */
  wall?: { tiles: string[]; height: number };
}

// ---------------------------------------------------------------------------
// Stage documents
// ---------------------------------------------------------------------------

export interface PlacedObject {
  id: string;
  /** Free label / sprite key for the object. */
  key: string;
  /** Tile this object draws, "<tilesetId>/<tileId>". When set, the object is
   * rendered with that tile's art at native proportion across its w×h cells
   * (used for multi-cell decorations like trees/rocks that shouldn't be
   * squished into a single terrain cell). */
  tileRef?: string;
  x: number; // tile coords (top-left)
  y: number;
  w: number; // tile span
  h: number;
  blocking: boolean;
}

export interface StageLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Grid of tile refs. Empty cell = null. A ref is "<tilesetId>/<tileId>". */
  data: (string | null)[][];
  /** Optional autotile membership grid parallel to `data`: terrainId per cell
   * (or null). When present, cells are resolved to tiles from neighbours, and
   * the resolved tiles live in `data` (so export/render need no special path). */
  terrain?: (string | null)[][];
}

export interface StageDoc {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  layers: StageLayer[];
  /** Explicit collision grid (true = blocked). Auto-seeded from tile flags,
   * manually overridable. */
  collision: boolean[][];
  objects: PlacedObject[];
}

// ---------------------------------------------------------------------------
// Project (the unit of save/load)
// ---------------------------------------------------------------------------

export const PROJECT_VERSION = 1;

export interface Project {
  version: number;
  name: string;
  sources: SourceImage[];
  sprites: SpriteDoc[];
  tilesets: TilesetDoc[];
  terrains: Terrain[];
  stages: StageDoc[];
}

export function emptyProject(name = "Untitled"): Project {
  return { version: PROJECT_VERSION, name, sources: [], sprites: [], tilesets: [], terrains: [], stages: [] };
}

// ---------------------------------------------------------------------------
// Exported manifest schemas (the portable, engine-agnostic contract)
// ---------------------------------------------------------------------------

export interface SpriteManifest {
  schema: "asset-forge/sprite-frames@1";
  name: string;
  image: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  anchor: { x: number; y: number };
  directions: Direction[];
  animations: Record<string, { frames: number[]; frameRate: number; loop: boolean }>;
}

export interface TilesetManifest {
  schema: "asset-forge/tileset@1";
  name: string;
  image: string;
  tileSize: number;
  columns: number;
  rows: number;
  tiles: Array<{
    index: number;
    id: string;
    char: string;
    name: string;
    blocked: boolean;
    sightBlocked: boolean;
    tags: string[];
  }>;
}

export interface StageManifest {
  schema: "asset-forge/stage@1";
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  tilesets: Array<{ id: string; name: string; image: string; manifest: string }>;
  layers: Array<{ name: string; type: "tile"; data: (string | null)[][] }>;
  collision: number[][];
  objects: Array<{ key: string; tile?: string; x: number; y: number; w: number; h: number; blocking: boolean }>;
  /** Convenience ascii rendering: one char per ground-layer cell + legend. */
  ascii?: { legend: Record<string, string>; rows: string[] };
}
