// Autotiling: resolve each terrain cell to the right edge/corner tile from its
// neighbours. Resolved tiles are written into the normal tile layer, so render
// and export need no special handling.
//
// edge16 — 4-bit mask of orthogonal neighbours sharing the terrain:
//   bit 0 = N, 1 = E, 2 = S, 3 = W. 16 tiles cover straight edges + outer
//   corners. Out-of-bounds counts as "same" so the map border stays filled.

import type { Terrain } from "../core/types";

export const N = 1, E = 2, S = 4, W = 8;
// Diagonal bits for blob47.
export const NE = 16, SE = 32, SW = 64, NW = 128;

/** A grid of terrainId|null. */
export type TerrainGrid = (string | null)[][];

/** Priority of a terrain id (higher = drawn on top / owns boundaries). Empty or
 * unknown cells rank -Infinity. */
export type RankFn = (id: string | null) => number;

/** Whether the neighbour at (x,y) counts as "filled" for a cell of `myRank`:
 * true when it's same-or-higher priority (so a terrain only draws an edge toward
 * strictly-lower / empty neighbours — the HoMM3 priority rule). OOB = filled, so
 * the map border doesn't get a transition edge. */
function filled(grid: TerrainGrid, x: number, y: number, myRank: number, rank: RankFn, cols: number, rows: number): boolean {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
  return rank(grid[y][x]) >= myRank;
}

export function edgeMask(grid: TerrainGrid, x: number, y: number, myRank: number, rank: RankFn, cols: number, rows: number): number {
  let m = 0;
  if (filled(grid, x, y - 1, myRank, rank, cols, rows)) m |= N;
  if (filled(grid, x + 1, y, myRank, rank, cols, rows)) m |= E;
  if (filled(grid, x, y + 1, myRank, rank, cols, rows)) m |= S;
  if (filled(grid, x - 1, y, myRank, rank, cols, rows)) m |= W;
  return m;
}

/** Canonical blob-47 key: 4 orthogonal bits, plus a diagonal bit only when both
 * its adjacent orthogonals are also set (so a corner only "rounds" when the
 * edges around it are filled). Collapses the 256 raw 8-neighbour combos to the
 * 47 meaningful ones. Used for both resolution and edge classification, so they
 * always agree. */
export function blobKeyFromBits(
  n: boolean, e: boolean, s: boolean, w: boolean,
  ne: boolean, se: boolean, sw: boolean, nw: boolean
): number {
  let k = (n ? N : 0) | (e ? E : 0) | (s ? S : 0) | (w ? W : 0);
  if (n && e && ne) k |= NE;
  if (s && e && se) k |= SE;
  if (s && w && sw) k |= SW;
  if (n && w && nw) k |= NW;
  return k;
}

export function blobKey(grid: TerrainGrid, x: number, y: number, myRank: number, rank: RankFn, cols: number, rows: number): number {
  const f = (dx: number, dy: number): boolean => filled(grid, x + dx, y + dy, myRank, rank, cols, rows);
  return blobKeyFromBits(f(0, -1), f(1, 0), f(0, 1), f(-1, 0), f(1, -1), f(1, 1), f(-1, 1), f(-1, -1));
}

/** Resolve the tile ref for cell (x,y) given the terrain membership grid and a
 * priority `rank` function. Returns null if the cell isn't this terrain or no
 * role is assigned. */
export function resolveCell(
  terrain: Terrain,
  grid: TerrainGrid,
  x: number,
  y: number,
  cols: number,
  rows: number,
  rank: RankFn
): string | null {
  if (grid[y]?.[x] !== terrain.id) return null;
  if (terrain.kind === "path") {
    // Linear road/river: connects only to the same path id; OOB = not connected
    // (so it caps at the map edge). Same 4-bit mask as edge16.
    const con = (dx: number, dy: number): boolean => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
      return grid[ny][nx] === terrain.id;
    };
    let m = 0;
    if (con(0, -1)) m |= N;
    if (con(1, 0)) m |= E;
    if (con(0, 1)) m |= S;
    if (con(-1, 0)) m |= W;
    return terrain.roles[m] ?? terrain.roles[15] ?? Object.values(terrain.roles)[0] ?? null;
  }
  const myRank = rank(terrain.id);
  if (terrain.kind === "edge16") {
    const mask = edgeMask(grid, x, y, myRank, rank, cols, rows);
    return terrain.roles[mask] ?? terrain.roles[15] ?? Object.values(terrain.roles)[0] ?? null;
  }
  // blob47: try the full key, then the same key with corners stripped (degrade
  // to the edge-only case), then the fully-surrounded centre, then anything.
  const key = blobKey(grid, x, y, myRank, rank, cols, rows);
  const ortho = key & 15;
  return (
    terrain.roles[key] ??
    terrain.roles[ortho] ??
    terrain.roles[15 | NE | SE | SW | NW] ??
    terrain.roles[15] ??
    Object.values(terrain.roles)[0] ??
    null
  );
}

/** The 16 edge masks in a human-friendly order for the assignment UI, each with
 * a label describing which sides connect to like terrain. */
export const EDGE16_SLOTS: Array<{ mask: number; label: string }> = [
  { mask: 0, label: "isolated" },
  { mask: N, label: "N" },
  { mask: E, label: "E" },
  { mask: S, label: "S" },
  { mask: W, label: "W" },
  { mask: N | S, label: "N+S (vertical)" },
  { mask: E | W, label: "E+W (horizontal)" },
  { mask: S | E, label: "S+E (TL corner)" },
  { mask: S | W, label: "S+W (TR corner)" },
  { mask: N | E, label: "N+E (BL corner)" },
  { mask: N | W, label: "N+W (BR corner)" },
  { mask: N | E | S, label: "N+E+S (W edge)" },
  { mask: N | S | W, label: "N+S+W (E edge)" },
  { mask: E | S | W, label: "E+S+W (N edge)" },
  { mask: N | E | W, label: "N+E+W (S edge)" },
  { mask: N | E | S | W, label: "all (center)" }
];

/** Draw a tiny connectivity glyph (a plus showing which sides connect) into a
 * small canvas, for the role-assignment template. */
export function maskGlyph(mask: number, size = 26): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1b1f26";
  g.fillRect(0, 0, size, size);
  const m = size / 2;
  const r = size * 0.18;
  g.fillStyle = "#5db0ff";
  g.fillRect(m - r, m - r, r * 2, r * 2); // center always filled
  g.fillStyle = "#7ee0a0";
  if (mask & N) g.fillRect(m - r, 1, r * 2, m - r);
  if (mask & S) g.fillRect(m - r, m + r, r * 2, m - r - 1);
  if (mask & W) g.fillRect(1, m - r, m - r, r * 2);
  if (mask & E) g.fillRect(m + r, m - r, m - r - 1, r * 2);
  return c;
}
