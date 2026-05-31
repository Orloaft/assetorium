// Magenta chroma-key, ported from the tib runtime (src/main.ts isMagentaKey)
// so assets forged here key out exactly the way the game expects. On top of
// the heuristic we add a tolerance ball around pure magenta (255,0,255) so
// users can widen the match for anti-aliased edges via the UI.

/** tib's exact heuristic — bright keyed magenta plus the dark red-leaning
 * purple gradient case. Kept verbatim for parity. */
function isMagentaHeuristic(r: number, g: number, b: number): boolean {
  if (r > 95 && b > 90 && g < 135 && Math.abs(r - b) < 95 && r > g * 1.35 && b > g * 1.25) return true;
  return g < 10 && r > 70 && b > 42 && r > b - 5 && r > g * 7 && b > g * 7;
}

/** Distance from pure magenta, used for the tolerance slider. */
function magentaDistance(r: number, g: number, b: number): number {
  const dr = 255 - r;
  const dg = g - 0;
  const db = 255 - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function isMagenta(r: number, g: number, b: number, tolerance: number): boolean {
  if (isMagentaHeuristic(r, g, b)) return true;
  // Tolerance is expressed roughly in "channels of slack"; scale to the RGB
  // distance space. 0 disables the ball (heuristic only).
  if (tolerance <= 0) return false;
  return magentaDistance(r, g, b) <= tolerance * 1.8;
}

/** Key magenta to transparent, in place, on an ImageData buffer. */
export function chromaKeyImageData(image: ImageData, tolerance: number): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (isMagenta(d[i], d[i + 1], d[i + 2], tolerance)) d[i + 3] = 0;
  }
}

export function chromaKeyCanvas(ctx: CanvasRenderingContext2D, w: number, h: number, tolerance: number): void {
  const image = ctx.getImageData(0, 0, w, h);
  chromaKeyImageData(image, tolerance);
  ctx.putImageData(image, 0, 0);
}
