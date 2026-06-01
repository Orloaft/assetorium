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

## 3. Cliffs / elevation: 16-tile corner-Wang EDGE set (Warcraft-III tiers)

A cliff is **not** a special top tile — it's a **rock face drawn around the
border of a raised region**, on every side. The raised area's *top* is just the
normal terrain (grass/dirt) showing through; only the **edge** is cliff art.

So a cliff set is a **16-tile corner-Wang set, identical in layout to §1**, with
two differences:
1. The "fill" is **transparent** (magenta), not a surface — the terrain on the
   higher tier shows through. So **idx 0 and idx 15 are fully magenta** (empty).
2. The 14 transition tiles are drawn as a **rock cliff face**, not a soft blend.

A SET corner = the **HIGH** side (the raised plateau); an UNSET corner = the
**LOW** side (the drop). The face is drawn where high meets low. Because it's
corner-Wang on the dual grid, **the cell boundary runs through the vertical &
horizontal CENTRE of each tile** — so a south drop is drawn in the *bottom half*
of its tile, a lip sits on the centre line, etc.

Lay out 4×4 row-major by index (same as §1). What to draw in each:

```
 EMPTY (all magenta):   idx 0 (all low) ,  idx 15 (all high / interior)

 STRAIGHT FACES
  idx 3  TL+TR high  → SOUTH face (the big one): tall rock wall in the BOTTOM
                       ~60% of the tile; bright grass/dirt LIP on the centre
                       line; soft shadow at its base. The main visible "drop".
  idx 12 BL+BR high  → NORTH (back) edge: a thin dark lip/shadow line along the
                       BOTTOM of the tile; rest transparent (barely seen).
  idx 6  TR+BR high  → WEST face: narrow vertical rock strip down the LEFT half,
                       lip on its right (plateau) side. Thinner than the south.
  idx 9  TL+BL high  → EAST face: narrow vertical rock strip down the RIGHT half,
                       lip on its left side. (mirror of idx 6)

 OUTER (convex) CORNERS — a single high corner:
  idx 1  TL only  → SE outer corner (south face wraps round to the east face)
  idx 2  TR only  → SW outer corner (south + west faces meet)
  idx 4  BR only  → NW outer corner (back lip wraps to the west face)
  idx 8  BL only  → NE outer corner (back lip wraps to the east face)

 INNER (concave) CORNERS — three high, one low (a notch):
  idx 7  all but BL → notch opening SW    idx 11 all but BR → notch opening SE
  idx 13 all but TR → notch opening NW    idx 14 all but TL → notch opening NE
            (draw the two faces turning the concave corner inward)

 DIAGONALS (two opposite high corners — rare):
  idx 5  TL+BR → SE corner + NW corner faces in one tile
  idx 10 TR+BL → SW corner + NE corner faces in one tile
```

**Consistency (critical — same lesson as roads):** the rock face must be the
**same height/thickness** and the lip the **same colour** across every tile, so
faces line up where tiles meet. Keep the south-face thickness identical in
idx 3, the outer corners and the inner corners. Shade so light reads from one
fixed direction.

**Tiers:** the *same* sheet handles every elevation level. To build a 2nd tier,
paint a smaller raised region inside the first — the editor draws another face
ring around it. No extra art.

**Ramp (optional, +2 tiles):** a **ramp** tile (a walkable stepped/diagonal slope
replacing the vertical south face) and a **ramp-top** tile (the lip where the
ramp meets the upper tier). Lay these in a 5th row; placed manually on a south
edge so a tier can be climbed (the editor marks it walkable).

Filename hint: `cliff-<rock>.wang16.png` (e.g. `cliff-granite.wang16.png`).
Drop it in, slice 4×4, then **"🏔 Cliff edge set (16-tile)"** — it paints on an
overlay so the tier's terrain shows through the transparent interior.

---

## Acceptance test
- [ ] Magenta bg, exact grid, fixed tile size.
- [ ] Terrain: 16 tiles, idx 0 = seamless base, idx 15 = seamless X fill, others
      = corner-quadrant transitions; opaque.
- [ ] All terrains in a biome share the **same base**.
- [ ] Roads/rivers: 16 edge tiles, transparent surround.
- [ ] Cliffs: 16-tile corner-Wang EDGE set — idx 0 & 15 fully transparent, the
      14 others rock faces (set corner = HIGH); south face in the bottom half;
      consistent face thickness; optional ramp + ramp-top.
