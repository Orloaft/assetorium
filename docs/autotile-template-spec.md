# Autotile template spec (for the image-gen agent)

Asset Forge uses **corner-based Wang autotiling** (the Tiled/Godot standard) for
seamless terrain blending — no dithering, no repeating borders. To make a sheet
that drops in and auto-maps exactly, generate it to these templates.

General rules (all templates): **magenta `#FF00FF` background**, one fixed
**tile size** per sheet (recommend **64×64**), tiles laid out on an exact grid
with no gaps unless stated. PNG, RGB.

---

## 1. Terrain: 16-tile corner-Wang set ("X over base B")

Each terrain is authored as a surface **X** transitioning over a common **base
B** (e.g. *water over grass*, *dirt over grass*; grass itself is the base). Every
terrain in a world should transition over the **same base** so they compose.

A set is **16 tiles** in a **4×4 grid**, where each tile shows the 4 corners
filled with either **X** or **B**. Corner bit values:

```
TL = 1   TR = 2   BR = 4   BL = 8        tile index = sum of corners that are X
```

Lay tiles out **row-major by index**, index = `row*4 + col` (0..15):

```
 idx 0  : all base B              idx 8  : BL only is X
 idx 1  : TL is X                 idx 9  : TL+BL  (left edge X)
 idx 2  : TR is X                 idx 10 : TR+BL  (diagonal)
 idx 3  : TL+TR (top edge X)      idx 11 : TL+TR+BL
 idx 4  : BR is X                 idx 12 : BR+BL (bottom edge X)
 idx 5  : TL+BR (diagonal)        idx 13 : TL+BR+BL
 idx 6  : TR+BR (right edge X)    idx 14 : TR+BR+BL
 idx 7  : TL+TR+BR                idx 15 : all four X  (solid X fill)
```

- **idx 15 must be a clean, seamless X fill** (tileable, no border/vignette).
- **idx 0 must be a clean, seamless B fill.**
- The other 14 show X occupying those corner quadrants, blending into B in the
  rest — the X↔B transition art (rounded or organic edges welcome).
- Tiles are **opaque** (B is baked in). Keep the transition consistent so any
  two tiles meet seamlessly at shared edges.

Filename hint: `<x>-over-<base>.wang16.png` (e.g. `water-over-grass.wang16.png`).
One set per terrain pair. A biome = the base fill + a few of these sets.

---

## 2. Road / river: 16-tile edge-Wang set

Linear features match on **sides**, not corners. 16 tiles in a 4×4 grid, index =
4-bit **edge** mask of which sides the road continues toward:

```
N = 1   E = 2   S = 4   W = 8        tile index = sum of connected sides
```

```
 0 : isolated dot         5 : N+S vertical
 1/2/4/8 : single stubs   10: E+W horizontal
 3 : N+E ┐ corner         7/11/13/14 : T-junctions
 6 : E+S ┌ ...            15: 4-way cross
 9 : N+W ┘   12: S+W └
```

Road tiles have a **transparent (magenta) surround** (they overlay the ground),
the road path centred so segments connect across tile edges.

---

## 3. Cliffs: top set + wall block (RPG-Maker-A4 style)

A cliff = a raised **plateau top** + a **wall face** dropping to the lower
ground. Provide two parts on one sheet:

**A. Plateau top** — a 16-tile corner-Wang set (§1) of the top surface over the
lower ground (so the plateau edge blends/has a lip).

**B. Wall block** — the vertical face shown beneath the plateau's **south** edge:
- a **top-of-wall** row (where the plateau meets the face),
- a **repeating mid-wall** tile (1 wide, tiles vertically for tall cliffs),
- **left** and **right** wall **corner** columns (non-repeating end caps),
- optional **inner-corner** pieces where the wall turns.

Layout (each cell = tile size), label the block clearly:

```
[wall TL][wall top ][wall TR]
[wall L ][wall mid ][wall R ]
[wall BL][wall base][wall BR]
```

Asset Forge paints the plateau (top set); the wall face is auto-drawn on the
cells directly below the plateau's south edge, using top-of-wall → mid (repeated
for height) → base, with L/R corners at the ends.

---

## Acceptance test
- [ ] Magenta bg, exact grid, fixed tile size.
- [ ] Terrain: 16 tiles, idx 0 = seamless base, idx 15 = seamless X fill, others
      = corner-quadrant transitions; opaque.
- [ ] All terrains in a biome share the **same base**.
- [ ] Roads/rivers: 16 edge tiles, transparent surround.
- [ ] Cliffs: top corner-set + wall block (top/mid/base + L/R corners).
