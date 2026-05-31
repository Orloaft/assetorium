// Auto-detect tiles by connected-component (blob) detection on the chroma-keyed
// image — the tile analogue of Sprite Studio's auto-detect frames. Each opaque
// region separated by transparent (keyed) background becomes one tile. This
// excels at object/decoration sheets (trees, rocks, bushes, logs scattered on
// magenta); a packed seamless terrain block has no internal gaps so it detects
// as one blob — slice those regions with the manual grid instead.
//
// Unlike the sprite detector we deliberately do NOT merge same-row boxes, so
// distinct objects sitting side by side stay separate tiles.

import { ctx2d } from "../core/image";

export interface DetectTilesOptions {
  /** Ignore blobs smaller than this in either dimension (specks, single px). */
  minSize: number;
  /** Grow each detected box outward by this many px. */
  pad: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export function detectTiles(keyed: HTMLCanvasElement, opts: DetectTilesOptions): Rect[] {
  const w = keyed.width;
  const h = keyed.height;
  const { data } = ctx2d(keyed).getImageData(0, 0, w, h);
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) opaque[i] = data[i * 4 + 3] > 16 ? 1 : 0;

  const labels = new Int32Array(w * h).fill(-1);
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const stack: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (!opaque[start] || labels[start] >= 0) continue;
    const id = boxes.length;
    boxes.push({ x0: start % w, y0: (start / w) | 0, x1: start % w, y1: (start / w) | 0 });
    labels[start] = id;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p / w) | 0;
      const box = boxes[id];
      if (px < box.x0) box.x0 = px;
      if (px > box.x1) box.x1 = px;
      if (py < box.y0) box.y0 = py;
      if (py > box.y1) box.y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (opaque[q] && labels[q] < 0) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
  }

  const rects = boxes
    .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }))
    .filter((b) => b.w >= opts.minSize && b.h >= opts.minSize)
    .map((b) => {
      const x0 = Math.max(0, b.x - opts.pad);
      const y0 = Math.max(0, b.y - opts.pad);
      return { x: x0, y: y0, w: Math.min(w, b.x + b.w + opts.pad) - x0, h: Math.min(h, b.y + b.h + opts.pad) - y0 };
    });

  // Reading order: top-to-bottom in coarse rows, then left-to-right.
  const rowTol = 24;
  rects.sort((a, b) => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    if (Math.abs(ay - by) > rowTol) return ay - by;
    return a.x - b.x;
  });
  return rects;
}
