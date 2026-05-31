// Build the portable stage manifest from a stage document. In-document tile
// references are "<tilesetId>/<tileId>"; for export we resolve them to the
// stable, human-readable "<tilesetName>:<index>" form that matches each
// tileset manifest's tile index, and emit a convenience ascii rendering of the
// first tile layer with a legend.

import { slug } from "../core/store";
import type { Project, StageDoc, StageManifest, TilesetDoc } from "../core/types";

interface Resolved {
  tilesetName: string;
  index: number;
  char: string;
  tileset: TilesetDoc;
}

function resolver(project: Project): (ref: string | null) => Resolved | null {
  const tilesetById = new Map(project.tilesets.map((t) => [t.id, t]));
  const indexById = new Map<string, Map<string, number>>();
  for (const ts of project.tilesets) {
    const m = new Map<string, number>();
    ts.tiles.forEach((t, i) => m.set(t.id, i));
    indexById.set(ts.id, m);
  }
  return (ref) => {
    if (!ref) return null;
    const [tsId, tileId] = ref.split("/");
    const ts = tilesetById.get(tsId);
    if (!ts) return null;
    const index = indexById.get(tsId)?.get(tileId);
    if (index == null) return null;
    return { tilesetName: ts.name, index, char: ts.tiles[index].char, tileset: ts };
  };
}

export function buildStageManifest(stage: StageDoc, project: Project): StageManifest {
  const resolve = resolver(project);
  const usedTilesets = new Map<string, TilesetDoc>();

  const layers = stage.layers.map((layer) => ({
    name: layer.name,
    type: "tile" as const,
    data: layer.data.map((row) =>
      row.map((ref) => {
        const r = resolve(ref);
        if (!r) return null;
        usedTilesets.set(r.tileset.id, r.tileset);
        return `${r.tilesetName}:${r.index}`;
      })
    )
  }));

  // ascii rendering of the first tile layer.
  const ground = stage.layers[0];
  let ascii: StageManifest["ascii"];
  if (ground) {
    const legend: Record<string, string> = {};
    const usedChars = new Map<string, string>(); // ref-key -> char
    let auto = 0;
    const autoChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const rows = ground.data.map((row) =>
      row
        .map((ref) => {
          const r = resolve(ref);
          if (!r) return ".";
          const key = `${r.tilesetName}:${r.index}`;
          let ch = r.char;
          if (!ch) {
            ch = usedChars.get(key) ?? autoChars[auto++ % autoChars.length];
          }
          usedChars.set(key, ch);
          legend[ch] = key;
          return ch;
        })
        .join("")
    );
    legend["."] = "empty";
    ascii = { legend, rows };
  }

  return {
    schema: "asset-forge/stage@1",
    name: stage.name,
    tileSize: stage.tileSize,
    cols: stage.cols,
    rows: stage.rows,
    tilesets: [...usedTilesets.values()].map((t) => ({
      id: t.id,
      name: t.name,
      image: `${slug(t.name)}.png`,
      manifest: `${slug(t.name)}.tileset.json`
    })),
    layers,
    collision: stage.collision.map((row) => row.map((b) => (b ? 1 : 0))),
    objects: stage.objects.map((o) => ({ key: o.key, x: o.x, y: o.y, w: o.w, h: o.h, blocking: o.blocking })),
    ascii
  };
}
