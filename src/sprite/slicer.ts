// Frame-slicing strategies for sprite sheets.
//   - grid:   uniform cells, the common case for clean sheets
//   - detect: connected-component (blob) detection on the chroma-keyed image,
//             mirroring the contour approach in tib's python sprite_processor —
//             good for irregular source sheets where frames aren't on a grid.

import { ctx2d, uid } from "../core/image";
import type { FrameBox } from "../core/types";

export interface GridSpec {
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  spacing: number;
}

export function sliceGrid(spec: GridSpec): FrameBox[] {
  const frames: FrameBox[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      frames.push({
        id: uid("f"),
        x: spec.offsetX + c * (spec.cellW + spec.spacing),
        y: spec.offsetY + r * (spec.cellH + spec.spacing),
        w: spec.cellW,
        h: spec.cellH
      });
    }
  }
  return frames;
}

export interface DetectOptions {
  /** Ignore blobs smaller than this in either dimension. */
  minSize: number;
  /** Merge blobs whose vertical centers fall within this band into one row,
   * then order left-to-right (handles dotted/disconnected limbs). */
  rowTolerance: number;
  /** Pad each detected box outward by this many px. */
  pad: number;
}

/** Detect frames as bounding boxes of opaque connected components. The input
 * canvas must already be chroma-keyed (transparent background). */
export function detectFrames(keyed: HTMLCanvasElement, opts: DetectOptions): FrameBox[] {
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
      // 8-connectivity
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

  // Filter tiny specks.
  let kept = boxes
    .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }))
    .filter((b) => b.w >= opts.minSize && b.h >= opts.minSize);

  // Merge boxes that overlap or sit within the row band and overlap in x —
  // reconnects disjoint pieces of a single frame (e.g. a thrown weapon).
  kept = mergeRowAligned(kept, opts.rowTolerance);

  // Order into reading rows.
  kept.sort((a, b) => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    if (Math.abs(ay - by) > opts.rowTolerance) return ay - by;
    return a.x - b.x;
  });

  return kept.map((b) => ({
    id: uid("f"),
    x: Math.max(0, b.x - opts.pad),
    y: Math.max(0, b.y - opts.pad),
    w: Math.min(w, b.x + b.w + opts.pad) - Math.max(0, b.x - opts.pad),
    h: Math.min(h, b.y + b.h + opts.pad) - Math.max(0, b.y - opts.pad)
  }));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function mergeRowAligned(boxes: Box[], rowTol: number): Box[] {
  const result = boxes.slice();
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        const sameRow = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < rowTol;
        const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
        const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
        if ((sameRow && xOverlap) || (xOverlap && yOverlap)) {
          const nx = Math.min(a.x, b.x);
          const ny = Math.min(a.y, b.y);
          result[i] = {
            x: nx,
            y: ny,
            w: Math.max(a.x + a.w, b.x + b.w) - nx,
            h: Math.max(a.y + a.h, b.y + b.h) - ny
          };
          result.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return result;
}
