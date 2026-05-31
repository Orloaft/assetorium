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

/** The "magenta cast" of a pixel: how much red & blue jointly exceed green.
 * Positive => magenta-leaning, regardless of brightness. This is what catches
 * dark anti-aliased fringe that a distance-from-bright-magenta test misses. */
export function magentaCast(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

/** Key magenta to transparent, in place. With `fringe > 0`, also clean up the
 * hue-based anti-alias fringe: strongly magenta-cast pixels go transparent,
 * milder casts are despilled (red & blue pulled down to green so the edge
 * loses its pink/purple tint instead of leaving a coloured halo). */
export function chromaKeyImageData(image: ImageData, tolerance: number, fringe = 0): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (isMagenta(r, g, b, tolerance)) {
      d[i + 3] = 0;
      continue;
    }
    if (fringe > 0) {
      const cast = magentaCast(r, g, b);
      if (cast > fringe) {
        d[i + 3] = 0;
      } else if (cast > 0) {
        d[i] = r - cast; // neutralise the magenta tint
        d[i + 2] = b - cast;
      }
    }
  }
}

export function chromaKeyCanvas(ctx: CanvasRenderingContext2D, w: number, h: number, tolerance: number, fringe = 0): void {
  const image = ctx.getImageData(0, 0, w, h);
  chromaKeyImageData(image, tolerance, fringe);
  ctx.putImageData(image, 0, 0);
}
