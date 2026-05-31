// Pack a sprite document's frames into a single anchor-aligned, uniform-grid
// PNG sheet plus a portable manifest. Alignment removes the per-frame jitter
// you get from raw slices: every frame's anchor (feet-center for top-down) is
// placed at the same spot in its cell, the way tib's runtime re-aligns sheets.

import { cropCanvas, alphaBounds, newCanvas, ctx2d } from "../core/image";
import { DIRECTIONS } from "../core/types";
import type { SpriteDoc, SpriteManifest } from "../core/types";

interface Aligned {
  id: string;
  content: HTMLCanvasElement; // the (optionally trimmed) frame pixels
  left: number; // px from anchor to content's left edge
  up: number; // px from anchor to content's top edge
}

export interface PackedSprite {
  sheet: HTMLCanvasElement;
  manifest: SpriteManifest;
}

function alignFrame(doc: SpriteDoc, keyed: HTMLCanvasElement, fid: string): Aligned | null {
  const box = doc.frames.find((f) => f.id === fid);
  if (!box) return null;
  const slice = cropCanvas(keyed, box.x, box.y, box.w, box.h);
  // Anchor point in slice-local coordinates.
  const apx = box.w * doc.anchor.x;
  const apy = box.h * doc.anchor.y;

  if (doc.trim) {
    const b = alphaBounds(slice);
    if (!b) return null; // empty frame — skip
    const content = cropCanvas(slice, b.x, b.y, b.w, b.h);
    return { id: fid, content, left: apx - b.x, up: apy - b.y };
  }
  return { id: fid, content: slice, left: apx, up: apy };
}

export function packSprite(doc: SpriteDoc, keyed: HTMLCanvasElement): PackedSprite {
  // Document order defines stable frame indices the manifest references.
  const aligned: Aligned[] = [];
  const indexOf = new Map<string, number>();
  for (const f of doc.frames) {
    const a = alignFrame(doc, keyed, f.id);
    if (!a) continue;
    indexOf.set(f.id, aligned.length);
    aligned.push(a);
  }

  if (aligned.length === 0) {
    const sheet = newCanvas(1, 1);
    return {
      sheet,
      manifest: {
        schema: "asset-forge/sprite-frames@1",
        name: doc.name,
        image: `${doc.name}.png`,
        frameWidth: 1,
        frameHeight: 1,
        columns: 1,
        rows: 1,
        frameCount: 0,
        anchor: doc.anchor,
        directions: [...DIRECTIONS],
        animations: {}
      }
    };
  }

  // Uniform cell big enough to hold every aligned frame around the anchor.
  let maxLeft = 0, maxUp = 0, maxRight = 0, maxDown = 0;
  for (const a of aligned) {
    maxLeft = Math.max(maxLeft, a.left);
    maxUp = Math.max(maxUp, a.up);
    maxRight = Math.max(maxRight, a.content.width - a.left);
    maxDown = Math.max(maxDown, a.content.height - a.up);
  }
  const cellW = Math.ceil(maxLeft + maxRight);
  const cellH = Math.ceil(maxUp + maxDown);
  const anchorX = Math.round(maxLeft);
  const anchorY = Math.round(maxUp);

  // Columns: widest animation row reads naturally as one sheet row; else square.
  let widestRow = 0;
  for (const clip of doc.clips) for (const row of clip.rows) widestRow = Math.max(widestRow, row.frames.length);
  const columns = Math.max(1, widestRow || Math.ceil(Math.sqrt(aligned.length)));
  const rows = Math.ceil(aligned.length / columns);

  const sheet = newCanvas(columns * cellW, rows * cellH);
  const g = ctx2d(sheet);
  aligned.forEach((a, i) => {
    const cx = (i % columns) * cellW;
    const cy = Math.floor(i / columns) * cellH;
    g.drawImage(a.content, Math.round(cx + anchorX - a.left), Math.round(cy + anchorY - a.up));
  });

  // Animations reference frame indices.
  const animations: SpriteManifest["animations"] = {};
  for (const clip of doc.clips) {
    for (const row of clip.rows) {
      const key = row.dir === "all" ? clip.name : `${clip.name}-${row.dir}`;
      const frames = row.frames.map((id) => indexOf.get(id)).filter((n): n is number => n != null);
      if (frames.length) animations[key] = { frames, frameRate: clip.fps, loop: clip.loop };
    }
  }

  return {
    sheet,
    manifest: {
      schema: "asset-forge/sprite-frames@1",
      name: doc.name,
      image: `${doc.name}.png`,
      frameWidth: cellW,
      frameHeight: cellH,
      columns,
      rows,
      frameCount: aligned.length,
      anchor: doc.anchor,
      directions: [...DIRECTIONS],
      animations
    }
  };
}
