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
