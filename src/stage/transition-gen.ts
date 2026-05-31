// Synthesize edge16 transition tiles from two full-fill tiles (a "fill" terrain
// laid over a "base"). For each of the 16 edge masks we composite fill over
// base, letting the base creep in from the OPEN sides (no like-neighbour) with
// an ordered (Bayer) dither band — crisp, deterministic pixel-art edges. The
// result is a normal 16-tile sheet (tile index == mask), so it plugs straight
// into the autotiler and the export pipeline.

import { newCanvas, ctx2d } from "../core/image";
import { N, E, S as SOUTH, W } from "./autotile";

// 4x4 Bayer threshold matrix, normalised to (0,1).
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map((row) => row.map((v) => (v + 0.5) / 16));

function scaledTile(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0, src.width, src.height, 0, 0, size, size);
  return c;
}

/** Generate one transition tile for an edge mask. */
function genTile(fill: ImageData, base: ImageData, size: number, mask: number, band: number): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const g = ctx2d(c);
  const out = g.createImageData(size, size);
  const INF = size * 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance to the nearest OPEN edge (a side with no like-neighbour). The
      // base intrudes from open edges; connected edges stay solid fill. Corners
      // fall out naturally as the min over the two adjacent open sides.
      let d = INF;
      if (!(mask & N)) d = Math.min(d, y);
      if (!(mask & SOUTH)) d = Math.min(d, size - 1 - y);
      if (!(mask & W)) d = Math.min(d, x);
      if (!(mask & E)) d = Math.min(d, size - 1 - x);
      const frac = band <= 0 ? (d <= 0 ? 0 : 1) : Math.max(0, Math.min(1, d / band));
      const useFill = frac > BAYER[y & 3][x & 3];
      const srcData = useFill ? fill : base;
      const i = (y * size + x) * 4;
      out.data[i] = srcData.data[i];
      out.data[i + 1] = srcData.data[i + 1];
      out.data[i + 2] = srcData.data[i + 2];
      out.data[i + 3] = srcData.data[i + 3];
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/** Build a 16-wide sheet of transition tiles (tile index == edge mask). */
export function generateTransitionSheet(
  fillTile: HTMLCanvasElement,
  baseTile: HTMLCanvasElement,
  size: number,
  band: number
): HTMLCanvasElement {
  const fill = ctx2d(scaledTile(fillTile, size)).getImageData(0, 0, size, size);
  const base = ctx2d(scaledTile(baseTile, size)).getImageData(0, 0, size, size);
  const sheet = newCanvas(size * 16, size);
  const g = ctx2d(sheet);
  for (let mask = 0; mask < 16; mask++) {
    g.drawImage(genTile(fill, base, size, mask, band), mask * size, 0);
  }
  return sheet;
}
