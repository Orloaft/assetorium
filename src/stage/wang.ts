// Corner-based Wang autotiling, dual-grid rendering (the Tiled/Godot standard).
//
// A "wang" terrain is 16 tiles indexed by which of its 4 CORNERS are this
// terrain (TL=1, TR=2, BR=4, BL=8); idx 0 = none (base), idx 15 = solid fill.
// We render on a grid offset by half a tile: each display tile sits at a corner
// of 4 world cells, and shows the blend of the terrains in those 4 cells. This
// gives seamless transitions with inner+outer corners and NO repeating borders.

import type { Terrain } from "../core/types";

export const C_TL = 1, C_TR = 2, C_BR = 4, C_BL = 8;

export type TerrainGrid = (string | null)[][];
export type RankFn = (id: string | null) => number;
export type ImgFor = (ref: string) => HTMLCanvasElement | undefined;

/** Draw the dual-grid wang terrain for one membership layer into `g` (world
 * coordinates). Lower-priority terrains are owned/drawn where they're the
 * highest at a corner; out-of-bounds counts as empty. */
export function drawWangLayer(
  g: CanvasRenderingContext2D,
  membership: TerrainGrid,
  terrainsById: Map<string, Terrain>,
  rank: RankFn,
  imgFor: ImgFor,
  ts: number,
  cols: number,
  rows: number
): void {
  const cell = (x: number, y: number): string | null => (x < 0 || y < 0 || x >= cols || y >= rows ? null : membership[y]?.[x] ?? null);
  // Display tiles at world corners (i,j), i∈0..cols, j∈0..rows. Each covers the
  // ts×ts area centred on that corner.
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const tl = cell(i - 1, j - 1), tr = cell(i, j - 1), bl = cell(i - 1, j), br = cell(i, j);
      const rTL = rank(tl), rTR = rank(tr), rBL = rank(bl), rBR = rank(br);
      const owner = Math.max(rTL, rTR, rBL, rBR);
      if (owner === -Infinity) continue; // nothing here
      // Which corners belong to the owner terrain.
      let bits = 0;
      if (rTL === owner) bits |= C_TL;
      if (rTR === owner) bits |= C_TR;
      if (rBR === owner) bits |= C_BR;
      if (rBL === owner) bits |= C_BL;
      const ownerId = rTL === owner ? tl : rTR === owner ? tr : rBR === owner ? br : bl;
      const terrain = ownerId ? terrainsById.get(ownerId) : null;
      if (!terrain || terrain.kind !== "wang") continue; // legacy kinds render via tile data
      const ref = terrain.roles[bits] ?? terrain.roles[15] ?? Object.values(terrain.roles)[0];
      const img = ref ? imgFor(ref) : undefined;
      if (!img) continue;
      g.drawImage(img, 0, 0, img.width, img.height, Math.round((i - 0.5) * ts), Math.round((j - 0.5) * ts), ts, ts);
    }
  }
}
