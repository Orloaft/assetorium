# Asset generation guide (for the image-gen agent)

Specs for producing tile/terrain assets that drop cleanly into **Asset Forge**
and build a comprehensive high-fantasy world. Written against the existing
"BIOME TILESET" series (snow, swamp, highland, desert, beach, jungle, etc.),
which this should match and extend.

---

## 1. Hard format rules (must follow)

- **Background = pure magenta `#FF00FF`** behind every tile/object. Asset Forge
  keys this out. Do **not** use a transparent PNG background — use solid magenta.
  Avoid magenta/near-magenta (purples, hot pinks) *inside* the art.
- **PNG**, RGB, no premultiplied alpha.
- **One biome (or theme) per sheet.** Keep the existing labeled-section layout
  (Ground · Cliffs & Ledges · Water/Shore · Paths & Road Edges · Decorative
  Details · Rocks & Boulders · Wooden Props · Ruins · Water/Pond Edges · Cliff
  Slopes · Stairs & Ramps · Cave Entrances · Misc). Consistency across biomes is
  what makes them interchangeable.
- **Fixed tile unit per sheet.** Use a single base tile size (recommend **64×64
  px**) for all ground/terrain/road/water tiles in a sheet. Larger objects
  should be whole multiples (2×2, 2×3, 3×3 cells). Sheet canvas ~1536×1024 is
  fine.
- **Separate tiles by a few px of magenta** (≥4 px gutter) so blob auto-detect
  can split them. Terrain fills that are meant to tile seamlessly can sit in a
  tight grid, but keep a thin magenta gutter between cells.
- **No drop shadows that bleed onto the magenta** for terrain tiles (they break
  seamless tiling). Props may have soft shadows.

---

## 2. Autotile-friendly layouts (the important part)

Asset Forge auto-builds autotile terrains by **classifying tile edges**, and can
also **synthesize** transitions. To make auto-build reliable, lay out transition
tiles as a strict, complete set. Two terrain-transition models — pick per use:

### 2a. Area terrain transition (e.g. dirt patch on grass) — 16-tile "edge" set
Provide the higher terrain (e.g. dirt) blending into the lower (grass) as a
**4×4 grid (16 tiles)**, where each tile encodes which of its 4 sides connect to
**more of the same (higher) terrain**. Bit values: **N=1, E=2, S=4, W=8**; tile
index = sum of connected sides. Lay them out row-major, index 0→15:

```
 0:none   1:N      2:E      3:N+E
 4:S      5:N+S    6:E+S    7:N+E+S
 8:W      9:N+W   10:E+W   11:N+E+W
12:S+W   13:N+S+W 14:E+S+W 15:N+E+S+W(center, fully surrounded)
```

- Index **15** = solid interior of the higher terrain.
- Index **0** = a lone patch (higher terrain surrounded by lower on all sides).
- Corners (3,6,9,12) = outer corners; T-shapes (7,11,13,14) = one open side.
- Keep the cell size identical to the ground tiles; the "open" sides should show
  the **lower** terrain so the tile blends into it.

### 2b. Full inner-corner set — 47-tile "blob" (optional, best quality)
If you can produce inner corners, add the blob-47 set (adds tiles where the
terrain wraps a concave corner). Same idea, but a corner only "rounds" when both
its edges connect. If this is too hard, ship 2a — Asset Forge degrades blob-47
to the 16-edge case automatically, and can synthesize the rest.

### 2c. Roads / rivers — 16-tile "line/connection" set
A road or river is a **line**, not an area. Provide a **4×4 grid (16 tiles)**
using the *same* N/E/S/W bit indexing, but here a bit means "the road continues
in that direction." The art shapes are:

```
 0: isolated dot      1/2/4/8: end caps (N,E,S,W stub)
 5 (N+S): vertical straight     10 (E+W): horizontal straight
 3 (N+E),6(E+S),12(S+W),9(N+W): corners
 7,11,13,14: T-junctions        15: 4-way crossroads
```

- Road tiles have a **transparent (magenta) surround** so the ground shows
  through — they're painted on an overlay. Center the road path in the cell.
- Same model works for rivers (water line) and walls/fences.

### 2d. Water as area terrain (lakes/oceans with shorelines)
Treat water like 2a: water = the "fill", land/sand = the base. Provide the 16
(or 47) shore-transition tiles so a painted lake gets correct banks and corners.
The Beach sheet's "Water & Shore" section is the reference.

> If a strict template is impractical, just provide **clean fill tiles + a
> handful of edge/corner pieces**; Asset Forge's color-classify auto-build and
> dither-synthesized transitions will fill the rest. Strict templates only make
> the result pixel-perfect with zero manual fixup.

---

## 3. Per-biome content checklist

For each biome, aim to include:
- **Ground fills**: 3–6 variants of the main surface (for natural scatter), +
  1–2 secondary surfaces (e.g. grass + dirt + rock).
- **Transitions** between the main surfaces (§2a/2b) and to water (§2d).
- **Road/path** line set (§2c) in the biome's material.
- **Water** + shoreline (where the biome has water).
- **Cliffs / ledges / slopes / stairs** for elevation (keep the existing
  sections).
- **Rocks, vegetation, ruins, structures, props** as objects (any size, magenta
  separated).
- **Cave/dungeon entrance** pieces.

---

## 4. Object / decoration sheets

- Objects on magenta, **clearly separated** (no two touching — each must be one
  connected blob). Varied sizes are fine; Asset Forge places them at native
  proportion across multiple cells.
- Group similar items; leave generous magenta gutters.
- For trees/structures the "base" (where it meets the ground) should be at the
  bottom of its bounding box — Asset Forge anchors objects by their base.

---

## 5. Gaps to fill for a comprehensive high-fantasy world

Existing biomes (keep/repurpose): woodland/highland, snow/tundra, swamp, rocky
mountain, mystic rainforest, desert, beach, jungle, badlands, dark forest, town,
graveyard, crypt/dungeon, city, village.

**Recommended new sheets to generate** (same template + §2 layouts):
1. **Grassland / plains** — a clean bright-green base biome (the "default" world
   surface) with grass↔dirt↔stone transitions and a cobble **road** set. (The
   current foresttiles is the closest but lacks complete transitions/roads.)
2. **Volcanic / ashlands** — lava (animated-optional), obsidian rock, ash
   ground, cracked-earth, lava "rivers" (§2c), basalt cliffs. Distinct from
   badlands.
3. **Farmland / settlement ground** — tilled soil, crop rows, fences (§2c line
   set), paths, wells — for villages/kingdoms.
4. **Ocean / coast** — deep-water fills + a strong shoreline set (§2d) and
   cliffs-meeting-sea, beyond the beach sheet's ponds.
5. **Cavern / underground floor** — rock floor, chasm edges, mushroom/crystal
   props, underground water (for dungeon-world layers).
6. **Cross-biome transition strips** *(optional, high value)* — a small sheet of
   universal **sand/dirt blend** tiles to bridge any two biomes on the world map
   (HoMM3 uses sand as the universal transition). Asset Forge can also synthesize
   these, so generate only if you want hand-art quality.
7. **Unified road/bridge set** — one cobblestone road (§2c) + wood/stone bridges
   that read on every biome, so the world has a consistent road network.

**Within existing biomes, the most common missing piece** is a *complete*
transition set (most sheets have a partial "Paths & Road Edges" section). If you
regenerate any biome, prioritise the §2a 16-tile (or §2b 47-tile) transition
grid for its main surface pair — that's what turns "place tiles" into "paint
terrain."

---

## 6. Quick acceptance test

A sheet is "Asset Forge ready" when:
- [ ] Magenta background, fixed tile size, magenta gutters between tiles.
- [ ] Ground fills tile seamlessly (no shadow bleed, no fringe beyond ~2 px).
- [ ] At least the 16-tile edge transition for the main surface pair.
- [ ] Road/water sets follow the N/E/S/W connection indexing (§2c/2d).
- [ ] Objects are individually separated on magenta.
