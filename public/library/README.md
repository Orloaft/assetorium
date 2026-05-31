# Asset library

Source tile sheets for building worlds in Asset Forge. Import a sheet in **Tile
Studio**, slice it (auto-detect / grid), then build terrains + paint stages in
the **Stage Editor**. All sheets use a **magenta `#FF00FF`** background that the
tool keys out. To add or fill gaps, see
[`../../docs/asset-generation-guide.md`](../../docs/asset-generation-guide.md).

## biomes/

The `*-biome` sheets share one labeled template: **Ground · Cliffs & Ledges ·
Water/Shore · Paths & Road Edges · Decorative Details · Rocks · Wooden Props ·
Ruins · Water/Pond Edges · Cliff Slopes · Stairs & Ramps · Cave Entrances ·
Misc**. Map them to the tool as: Ground → fill/scatter terrain; Paths & Road
Edges → road (`path`) autotile; Water + edges → water area autotile (shorelines);
Cliffs/Slopes/Stairs → elevation objects; everything else → objects.

| File | Biome | Highlights |
|---|---|---|
| `highland.png` | Woodland/highland (temperate) | cleanest/most complete; grass+dirt, water, roads, cliffs |
| `snow.png` | Frozen tundra | snow/ice, ice water, snow roads, caves, weather, bg mountains |
| `swamp.png` | Swamp/marsh | bog ground, swamp water + pond edges, ramps, cave mouths |
| `rocky-mountain.png` | Rocky mountain | strong cliffs/ledges/slopes, + snow & ice tiles |
| `mystic-rainforest.png` | Magical rainforest | lush ground, waterfalls, glowing props |
| `desert.png` | Desert | sand + dunes, oasis water edges, ruins |
| `beach.png` | Beach/coast | **best shorelines** (water & shore set), sand |
| `jungle.png` | Jungle | dense foliage ground, water, ruins |
| `badlands.png` | Badlands | cracked earth, rock formations, pits (no water) |
| `dark-forest.png` | Dark forest | dark grass, swamp water, dead trees, glowing accents |
| `forest.png` | Forest (legacy) | grass/dirt fills + rich props, but **partial** transitions, no roads/labels — weakest of the set |

## structures/

Architecture, settlements, and dungeon interiors (mostly objects + floor/wall
tiles, not biome terrain):

| File | Contents |
|---|---|
| `town.png` | grass/dirt/cobble floors, stone walls, houses (4 roof colors), well, lamps, fences, bridge, props |
| `graveyard.png` | dark ground, cobble paths, mausoleums/crypts, gravestones, statues, dead trees, coffins |
| `city-exterior-01/02.png` | city streets, walls, larger buildings, exterior props |
| `city-interiors.png` | interior floors, walls, furniture |
| `rural-village.png` | village houses, fences, rural props |
| `village-house-interiors.png` | cottage interiors |
| `crypt-dungeon.png` | dungeon/crypt floors, walls, doors, dungeon props |

## Gaps / wishlist
See [`../../docs/asset-generation-guide.md`](../../docs/asset-generation-guide.md) §5
— recommended new sheets (grassland/plains, volcanic/ashlands, farmland, ocean,
cavern floor, universal cross-biome transition strip, unified road/bridge set)
and the exact layout specs to make new art autotile-ready.

> Originals live in `tib/assetsources/` (the `deferred/` and `rejected/` folders
> hold the strongest, most complete sheets despite the names; `foresttiles` is
> the oldest/weakest). These copies are renamed for clarity.
