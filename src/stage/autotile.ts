// Autotiling: resolve each terrain cell to the right edge/corner tile from its
// neighbours. Resolved tiles are written into the normal tile layer, so render
// and export need no special handling.
//
// edge16 — 4-bit mask of orthogonal neighbours sharing the terrain:
//   bit 0 = N, 1 = E, 2 = S, 3 = W. 16 tiles cover straight edges + outer
//   corners. Out-of-bounds counts as "same" so the map border stays filled.

import type { Terrain } from "../core/types";

export const N = 1, E = 2, S = 4, W = 8;

/** A grid of terrainId|null. */
export type TerrainGrid = (string | null)[][];

function same(grid: TerrainGrid, x: number, y: number, id: string, cols: number, rows: number): boolean {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return true; // OOB = same (no border at map edge)
  return grid[y][x] === id;
}

export function edgeMask(grid: TerrainGrid, x: number, y: number, id: string, cols: number, rows: number): number {
  let m = 0;
  if (same(grid, x, y - 1, id, cols, rows)) m |= N;
  if (same(grid, x + 1, y, id, cols, rows)) m |= E;
  if (same(grid, x, y + 1, id, cols, rows)) m |= S;
  if (same(grid, x - 1, y, id, cols, rows)) m |= W;
  return m;
}

/** Resolve the tile ref for cell (x,y) given the terrain membership grid.
 * Returns null if the cell isn't this terrain or no role is assigned. */
export function resolveCell(
  terrain: Terrain,
  grid: TerrainGrid,
  x: number,
  y: number,
  cols: number,
  rows: number
): string | null {
  if (grid[y]?.[x] !== terrain.id) return null;
  const mask = terrain.kind === "edge16" ? edgeMask(grid, x, y, terrain.id, cols, rows) : edgeMask(grid, x, y, terrain.id, cols, rows);
  // Fall back to the fully-surrounded ("center", mask 15) tile, then any role.
  return terrain.roles[mask] ?? terrain.roles[15] ?? Object.values(terrain.roles)[0] ?? null;
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
