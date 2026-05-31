// Edge classification for auto-building an autotile terrain directly from a
// sheet that already contains edge/corner transition tiles. Given two reference
// fills (primary, e.g. grass; secondary, e.g. dirt), we look at each tile's
// centre and four edge strips and decide — by colour similarity — which side is
// primary. That yields the edge16 mask the tile represents, with no manual
// slot assignment.

import { ctx2d } from "../core/image";
import { N, E, S, W, blobKeyFromBits } from "./autotile";

export type RGB = [number, number, number];

/** Average colour of opaque pixels in a sub-rect of a tile canvas (null if the
 * region is essentially transparent). */
export function avgColor(c: HTMLCanvasElement, rx: number, ry: number, rw: number, rh: number): RGB | null {
  const x = Math.max(0, Math.floor(rx)), y = Math.max(0, Math.floor(ry));
  const w = Math.min(c.width - x, Math.ceil(rw)), h = Math.min(c.height - y, Math.ceil(rh));
  if (w <= 0 || h <= 0) return null;
  const d = ctx2d(c).getImageData(x, y, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (n < 4) return null;
  return [r / n, g / n, b / n];
}

const dist2 = (a: RGB, b: RGB): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function tileCenter(c: HTMLCanvasElement): RGB | null {
  return avgColor(c, c.width * 0.32, c.height * 0.32, c.width * 0.36, c.height * 0.36);
}

/** Classify a tile against two fills. Returns the edge16 mask of sides that
 * read as `primary`, plus whether the tile's centre is primary (so callers can
 * keep only primary-based tiles). Returns null if the tile is too empty. */
export function classifyTile(
  c: HTMLCanvasElement,
  primary: RGB,
  secondary: RGB
): { mask: number; centerPrimary: boolean } | null {
  const w = c.width, h = c.height;
  const center = tileCenter(c);
  if (!center) return null;
  const isPrimary = (col: RGB | null): boolean => (col ? dist2(col, primary) <= dist2(col, secondary) : false);

  const edges: Array<{ bit: number; col: RGB | null }> = [
    { bit: N, col: avgColor(c, w * 0.2, 0, w * 0.6, h * 0.16) },
    { bit: S, col: avgColor(c, w * 0.2, h * 0.84, w * 0.6, h * 0.16) },
    { bit: W, col: avgColor(c, 0, h * 0.2, w * 0.16, h * 0.6) },
    { bit: E, col: avgColor(c, w * 0.84, h * 0.2, w * 0.16, h * 0.6) }
  ];
  let mask = 0;
  for (const e of edges) if (isPrimary(e.col)) mask |= e.bit;
  return { mask, centerPrimary: isPrimary(center) };
}

/** Classify a tile into a blob-47 key by sampling 4 edges + 4 corners. A corner
 * reads as "diagonal present" when its small corner patch is primary; the
 * canonical key gates corners on their edges, matching paint-time resolution. */
export function classifyTileBlob(
  c: HTMLCanvasElement,
  primary: RGB,
  secondary: RGB
): { key: number; centerPrimary: boolean } | null {
  const w = c.width, h = c.height;
  const center = tileCenter(c);
  if (!center) return null;
  const isP = (col: RGB | null): boolean => (col ? dist2(col, primary) <= dist2(col, secondary) : false);
  const cw = w * 0.16, ch = h * 0.16;
  const n = isP(avgColor(c, w * 0.3, 0, w * 0.4, ch));
  const s = isP(avgColor(c, w * 0.3, h - ch, w * 0.4, ch));
  const wEdge = isP(avgColor(c, 0, h * 0.3, cw, h * 0.4));
  const e = isP(avgColor(c, w - cw, h * 0.3, cw, h * 0.4));
  const nw = isP(avgColor(c, 0, 0, cw, ch));
  const ne = isP(avgColor(c, w - cw, 0, cw, ch));
  const sw = isP(avgColor(c, 0, h - ch, cw, ch));
  const se = isP(avgColor(c, w - cw, h - ch, cw, ch));
  return { key: blobKeyFromBits(n, e, s, wEdge, ne, se, sw, nw), centerPrimary: isP(center) };
}
