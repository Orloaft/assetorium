// Generate a 16-tile corner-Wang set: surface X blended over base B, one tile
// per corner mask (TL=1,TR=2,BR=4,BL=8). Each pixel takes X or B based on which
// corner it's nearest to — a clean, crisp corner transition (no dither). idx 0
// = pure base, idx 15 = pure X. Used to make Wang terrains from a sheet's plain
// fill tiles when hand-authored Wang art isn't available.

import { newCanvas, ctx2d } from "../core/image";

const C_TL = 1, C_TR = 2, C_BR = 4, C_BL = 8;

function scaled(src: HTMLCanvasElement, size: number): ImageData {
  const c = newCanvas(size, size);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0, src.width, src.height, 0, 0, size, size);
  return g.getImageData(0, 0, size, size);
}

// Generate a 16-tile corner-Wang CLIFF EDGE set from a single hand-drawn
// south-facing face tile (rock + grass lip, transparent surround). Hand-authoring
// orientation-correct dual-grid tiles is error-prone, so instead the artist draws
// one front face and we place/orient it into every index: south edges get the
// drop, north a thin lip, E/W vertical side faces, with inner+outer corners. The
// face's rock texture fills a verified positional mask; idx 0 & 15 stay empty.
export function generateCliffWang(faceImg: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const S = size;
  const fc = newCanvas(S, S);
  ctx2d(fc).drawImage(faceImg, 0, 0, faceImg.width, faceImg.height, 0, 0, S, S);
  const fd = ctx2d(fc).getImageData(0, 0, S, S).data;
  // Median rock colour from opaque pixels; a "patch" = the face with its
  // transparent surround filled by that median, so rock sampling never bleeds.
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < fd.length; i += 4) if (fd[i + 3] > 120) { rs.push(fd[i]); gs.push(fd[i + 1]); bs.push(fd[i + 2]); }
  const med = (a: number[]): number => { if (!a.length) return 110; a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const mr = med(rs), mg = med(gs), mb = med(bs);
  const patch = new Uint8ClampedArray(fd);
  for (let i = 0; i < patch.length; i += 4) if (patch[i + 3] <= 120) { patch[i] = mr; patch[i + 1] = mg; patch[i + 2] = mb; patch[i + 3] = 255; }
  const W = S * 16;
  const sheet = newCanvas(W, S);
  const g = ctx2d(sheet);
  const od = g.createImageData(W, S);
  const cx = S >> 1, cy = S >> 1;
  const Tsouth = Math.round(S * 0.5), Tside = Math.round(S * 0.3), Tnorth = Math.round(S * 0.12), LIP = Math.max(2, Math.round(S * 0.05));
  const quad = (c: number, r: number): number => (c === 0 ? (r === 0 ? 1 : 8) : (r === 0 ? 2 : 4)); // TL,BL,TR,BR
  for (let idx = 0; idx < 16; idx++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const col = x < cx ? 0 : 1, row = y < cy ? 0 : 1;
        const oi = (y * W + idx * S + x) * 4;
        if (idx & quad(col, row)) { od.data[oi + 3] = 0; continue; } // plateau top → transparent
        const va = row === 1 && (idx & quad(col, 0)); // high above → south drop
        const vb = row === 0 && (idx & quad(col, 1)); // high below → north lip
        const hh = idx & quad(1 - col, row);          // high beside → side face
        let rock = false, lp = false;
        if (va && y >= cy && y < cy + Tsouth) rock = true;
        if (va && y >= cy && y < cy + LIP) lp = true;
        if (vb && y >= cy - Tnorth && y < cy) rock = true;
        if (hh) {
          if (col === 0 && x >= cx - Tside && x < cx) rock = true;
          if (col === 1 && x >= cx && x < cx + Tside) rock = true;
          if (col === 0 && x >= cx - LIP && x < cx) lp = true;
          if (col === 1 && x >= cx && x < cx + LIP) lp = true;
        }
        if (lp) { od.data[oi] = 210; od.data[oi + 1] = 193; od.data[oi + 2] = 140; od.data[oi + 3] = 255; }
        else if (rock) {
          const pi = (y * S + x) * 4;
          const d = va ? Math.min(0.32, (y - cy) / (S - cy) * 0.5) : 0; // darken the drop downward
          od.data[oi] = patch[pi] * (1 - d); od.data[oi + 1] = patch[pi + 1] * (1 - d); od.data[oi + 2] = patch[pi + 2] * (1 - d); od.data[oi + 3] = 255;
        } else od.data[oi + 3] = 0;
      }
    }
  }
  g.putImageData(od, 0, 0);
  return sheet;
}

export function generateWang16(fillImg: HTMLCanvasElement, baseImg: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const fill = scaled(fillImg, size);
  const base = scaled(baseImg, size);
  const sheet = newCanvas(size * 16, size);
  const g = ctx2d(sheet);
  const corners = [
    { bit: C_TL, x: 0, y: 0 },
    { bit: C_TR, x: size - 1, y: 0 },
    { bit: C_BR, x: size - 1, y: size - 1 },
    { bit: C_BL, x: 0, y: size - 1 }
  ];
  for (let idx = 0; idx < 16; idx++) {
    const out = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Nearest corner decides X vs base; feather the tie boundary slightly.
        let best = corners[0], bestD = Infinity, second = Infinity;
        for (const c of corners) {
          const d = (x - c.x) ** 2 + (y - c.y) ** 2;
          if (d < bestD) { second = bestD; bestD = d; best = c; }
          else if (d < second) second = d;
        }
        const useFill = (idx & best.bit) !== 0;
        const src = useFill ? fill : base;
        const i = (y * size + x) * 4;
        out.data[i] = src.data[i];
        out.data[i + 1] = src.data[i + 1];
        out.data[i + 2] = src.data[i + 2];
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, idx * size, 0);
  }
  return sheet;
}
