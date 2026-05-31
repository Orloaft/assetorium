// Pack a tileset document into a normalised atlas (every tile resized to the
// output tileSize) plus a manifest carrying per-tile collision metadata. The
// inset crop mirrors tib's makeTileTexture, which trims a border off each
// source cell to avoid bleeding pixels from neighbouring tiles.

import { newCanvas, ctx2d, cropCanvas } from "../core/image";
import type { TilesetDoc, TilesetManifest } from "../core/types";

export interface PackedTileset {
  atlas: HTMLCanvasElement;
  manifest: TilesetManifest;
}

export function packTileset(doc: TilesetDoc, keyed: HTMLCanvasElement): PackedTileset {
  const tiles = doc.tiles;
  const ts = doc.tileSize;
  const columns = Math.max(1, Math.min(doc.grid.cols || 8, tiles.length || 1));
  const rows = Math.max(1, Math.ceil(tiles.length / columns));
  const atlas = newCanvas(columns * ts, rows * ts);
  const g = ctx2d(atlas);

  tiles.forEach((tile, i) => {
    const cx = (i % columns) * ts;
    const cy = Math.floor(i / columns) * ts;
    // Inset only terrain-sized tiles (trim soft fringe so they tile cleanly);
    // larger object tiles keep their full silhouette.
    const terrain = tile.w <= ts * 1.6 && tile.h <= ts * 1.6;
    const inset = terrain ? doc.grid.inset : 0;
    const ix = Math.max(0, tile.x + inset);
    const iy = Math.max(0, tile.y + inset);
    const iw = Math.max(1, tile.w - inset * 2);
    const ih = Math.max(1, tile.h - inset * 2);
    const cell = cropCanvas(keyed, ix, iy, iw, ih);
    g.imageSmoothingEnabled = false;
    g.drawImage(cell, 0, 0, iw, ih, cx, cy, ts, ts);
  });

  const manifest: TilesetManifest = {
    schema: "asset-forge/tileset@1",
    name: doc.name,
    image: `${doc.name}.png`,
    tileSize: ts,
    columns,
    rows,
    tiles: tiles.map((t, i) => ({
      index: i,
      id: t.id,
      char: t.char,
      name: t.name,
      blocked: t.blocked,
      sightBlocked: t.sightBlocked,
      tags: t.tags
    }))
  };
  return { atlas, manifest };
}
