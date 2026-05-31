import type { Editor } from "../main";
import { el, button, numberField, textField, checkbox, clear } from "../core/dom";
import { getProject, mutate, setStatus, slug } from "../core/store";
import { sourcePicker } from "../core/sources";
import { getKeyedCanvas, uid, cropCanvas, canvasToBlob, alphaBounds } from "../core/image";
import { Viewport } from "../core/viewport";
import { defaultChroma } from "../core/types";
import type { TilesetDoc, TileDef } from "../core/types";
import { packTileset } from "./tile-pack";
import { detectTiles } from "./tile-slicer";
import { buildZip, textEntry, blobEntry } from "../core/zip";
import { downloadBlob } from "../core/download";

interface Local {
  tilesetId: string | null;
  selectedTileId: string | null;
  skipEmpty: boolean;
  detect: { minSize: number; pad: number };
  keyed: HTMLCanvasElement | null;
  keyedKey: string;
}

export function mountTileStudio(root: HTMLElement): Editor {
  const L: Local = {
    tilesetId: getProject().tilesets[0]?.id ?? null,
    selectedTileId: null,
    skipEmpty: true,
    detect: { minSize: 16, pad: 1 },
    keyed: null,
    keyedKey: ""
  };

  const workspace = el("div.workspace");
  const sidebar = el("div.sidebar");
  const canvasWrap = el("div.canvas-wrap");
  const inspector = el("div.inspector");
  workspace.append(sidebar, canvasWrap, inspector);
  root.append(workspace);

  const doc = (): TilesetDoc | null => getProject().tilesets.find((t) => t.id === L.tilesetId) ?? null;

  const vp = new Viewport({
    draw: (g) => drawScene(g),
    onPointerDown: (p) => {
      const d = doc();
      if (!d) return;
      const hit = [...d.tiles].reverse().find((t) => p.worldX >= t.x && p.worldX <= t.x + t.w && p.worldY >= t.y && p.worldY <= t.y + t.h);
      if (hit) { L.selectedTileId = hit.id; refreshCanvasInspector(); }
    }
  });
  vp.mount(canvasWrap);

  function drawScene(g: CanvasRenderingContext2D): void {
    if (!L.keyed) return;
    const d = doc();
    vp.drawCheckerboard(g, L.keyed.width, L.keyed.height, 8);
    g.drawImage(L.keyed, 0, 0);
    if (!d) return;
    const lw = 1 / vp.scale;
    for (const t of d.tiles) {
      if (t.blocked) { g.fillStyle = "rgba(255,107,107,0.22)"; g.fillRect(t.x, t.y, t.w, t.h); }
      g.lineWidth = lw;
      g.strokeStyle = t.id === L.selectedTileId ? "#7ee0a0" : t.sightBlocked ? "#ffcf6b" : "#5db0ff";
      g.strokeRect(t.x + lw / 2, t.y + lw / 2, t.w - lw, t.h - lw);
      if (t.char) {
        g.fillStyle = "rgba(0,0,0,0.6)";
        const fs = 10 / vp.scale;
        g.font = `${fs}px monospace`;
        g.fillRect(t.x, t.y, fs, fs);
        g.fillStyle = "#fff";
        g.fillText(t.char, t.x + 1 / vp.scale, t.y + fs);
      }
    }
  }

  async function reloadKeyed(): Promise<void> {
    const d = doc();
    if (!d || !d.sourceId) { L.keyed = null; L.keyedKey = ""; vp.render(); return; }
    const key = `${d.sourceId}:${d.chroma.enabled}:${d.chroma.tolerance}:${d.chroma.fringe ?? 0}`;
    if (key === L.keyedKey && L.keyed) return;
    L.keyed = await getKeyedCanvas(d.sourceId, d.chroma);
    L.keyedKey = key;
    vp.fit(L.keyed.width, L.keyed.height);
  }

  // ---- Sidebar -----------------------------------------------------------
  function renderSidebar(): void {
    clear(sidebar);
    sidebar.append(sourcePicker(doc()?.sourceId ?? null, (id) => bindSource(id)));
    const list = el("div.list");
    for (const t of getProject().tilesets) {
      list.append(el("div.list-item" + (t.id === L.tilesetId ? ".active" : ""),
        { onclick: () => selectTileset(t.id) },
        el("div.name", {}, t.name),
        el("span.meta", {}, `${t.tiles.length} tiles`),
        button("✕", (e: Event) => { e.stopPropagation(); deleteTileset(t.id); }, "sm danger")));
    }
    sidebar.append(el("div.section", {}, el("h3", {}, "Tilesets"), list,
      el("div.btn-row", { style: { marginTop: "8px" } }, button("+ New tileset", newTileset, "primary"))));
  }

  function newTileset(): void {
    const d: TilesetDoc = {
      id: uid("ts"),
      name: `tileset-${getProject().tilesets.length + 1}`,
      sourceId: getProject().sources[0]?.id ?? null,
      chroma: defaultChroma(),
      tileSize: 32,
      grid: { offsetX: 0, offsetY: 0, cols: 8, rows: 8, cellW: 32, cellH: 32, spacing: 0, inset: 0 },
      tiles: []
    };
    mutate((p) => p.tilesets.push(d));
    selectTileset(d.id);
  }

  function deleteTileset(id: string): void {
    mutate((p) => (p.tilesets = p.tilesets.filter((t) => t.id !== id)));
    if (L.tilesetId === id) L.tilesetId = getProject().tilesets[0]?.id ?? null;
    refreshAll();
  }
  function selectTileset(id: string): void { L.tilesetId = id; L.selectedTileId = null; refreshAll(); }
  function bindSource(id: string): void {
    if (!doc()) newTileset();
    const d = doc();
    if (d) mutate(() => (d.sourceId = id));
    refreshAll();
  }

  // ---- Inspector ---------------------------------------------------------
  function renderInspector(): void {
    clear(inspector);
    const d = doc();
    if (!d) { inspector.append(el("div.hint", {}, "Create a tileset and pick a source image.")); return; }

    inspector.append(el("div.section", {},
      el("h3", {}, "Tileset"),
      textField("Name", d.name, (v) => mutate(() => (d.name = v))),
      numberField("Output tile size", d.tileSize, (v) => mutate(() => (d.tileSize = v)), { min: 1, width: 64 })));

    const tolRow = el("div.range-row", {},
      el("input", { type: "range", min: 0, max: 180, value: String(d.chroma.tolerance),
        oninput: (e: Event) => { mutate(() => (d.chroma.tolerance = Number((e.target as HTMLInputElement).value))); reloadKeyed().then(() => vp.render()); } }),
      el("span.tag", {}, String(d.chroma.tolerance)));
    const fringe = d.chroma.fringe ?? 24;
    const fringeRow = el("div.range-row", {},
      el("input", { type: "range", min: 0, max: 120, value: String(fringe),
        oninput: (e: Event) => { mutate(() => (d.chroma.fringe = Number((e.target as HTMLInputElement).value))); reloadKeyed().then(() => { vp.render(); renderInspector(); }); } }),
      el("span.tag", {}, String(fringe)));
    inspector.append(el("div.section", {},
      el("h3", {}, "Background removal (magenta)"),
      checkbox("Key out magenta", d.chroma.enabled, (b) => { mutate(() => (d.chroma.enabled = b)); reloadKeyed().then(() => vp.render()); }),
      el("div.field", {}, el("span.field-label", {}, "Tolerance"), tolRow),
      el("div.field", {}, el("span.field-label", {}, "Fringe cleanup"), fringeRow),
      el("div.hint", {}, "Tolerance removes bright magenta. Fringe cleanup removes dark anti-aliased magenta edge pixels (hue-based) — raise it if pink/purple remnants linger; lower it if real art starts disappearing.")));

    const G = d.grid;
    inspector.append(el("div.section", {},
      el("h3", {}, "Slice grid"),
      el("div.btn-row", {},
        numberField("Cols", G.cols, (v) => mutate(() => (G.cols = v)), { min: 1, width: 50 }),
        numberField("Rows", G.rows, (v) => mutate(() => (G.rows = v)), { min: 1, width: 50 })),
      el("div.btn-row", {},
        numberField("Cell W", G.cellW, (v) => mutate(() => (G.cellW = v)), { min: 1, width: 56 }),
        numberField("Cell H", G.cellH, (v) => mutate(() => (G.cellH = v)), { min: 1, width: 56 })),
      el("div.btn-row", {},
        numberField("Off X", G.offsetX, (v) => mutate(() => (G.offsetX = v)), { width: 50 }),
        numberField("Off Y", G.offsetY, (v) => mutate(() => (G.offsetY = v)), { width: 50 }),
        numberField("Gap", G.spacing, (v) => mutate(() => (G.spacing = v)), { width: 44 })),
      el("div.btn-row", {},
        numberField("Inset", G.inset, (v) => mutate(() => (G.inset = v)), { min: 0, width: 50 }),
        checkbox("Skip empty cells", L.skipEmpty, (b) => (L.skipEmpty = b))),
      el("div.btn-row", { style: { marginTop: "6px" } },
        button("Generate from grid", () => generateTiles(), "primary"),
        button("Clear", () => { mutate(() => (d.tiles = [])); L.selectedTileId = null; refreshCanvasInspector(); })),
      el("div.divider"),
      el("div.btn-row", {},
        numberField("Min size", L.detect.minSize, (v) => (L.detect.minSize = v), { min: 1, width: 56 }),
        numberField("Pad", L.detect.pad, (v) => (L.detect.pad = v), { min: 0, width: 44 })),
      el("div.btn-row", { style: { marginTop: "6px" } },
        button("✨ Auto-detect tiles", () => autoDetectTiles(), "primary")),
      el("div.hint", {}, `${d.tiles.length} tiles. Auto-detect finds objects separated by the (keyed) background — great for trees/rocks/props. Packed terrain that touches detects as one blob; slice those with the grid above. Inset trims a border off each cell (avoids bleed).`)));

    // Selected tile editor
    const sel = d.tiles.find((t) => t.id === L.selectedTileId);
    if (sel) {
      inspector.append(el("div.section", {},
        el("h3", {}, `Tile: ${sel.name}`),
        el("div.btn-row", {},
          textField("Char", sel.char, (v) => mutate(() => (sel.char = v.slice(0, 1)))),
          textField("Name", sel.name, (v) => mutate(() => (sel.name = v)))),
        checkbox("Blocks movement", sel.blocked, (b) => { mutate(() => (sel.blocked = b)); vp.render(); }),
        checkbox("Blocks sight / projectiles", sel.sightBlocked, (b) => { mutate(() => (sel.sightBlocked = b)); vp.render(); }),
        button("Delete tile", () => { mutate(() => (d.tiles = d.tiles.filter((t) => t.id !== sel.id))); L.selectedTileId = null; refreshCanvasInspector(); }, "danger")));
    }

    // Bulk metadata list
    if (d.tiles.length) {
      const list = el("div.list");
      d.tiles.forEach((t, i) => {
        list.append(el("div.list-item" + (t.id === L.selectedTileId ? ".active" : ""),
          { onclick: () => { L.selectedTileId = t.id; refreshCanvasInspector(); } },
          el("span.meta", {}, String(i)),
          el("div.name", {}, t.char ? `${t.char} · ${t.name}` : t.name),
          t.blocked ? el("span.tag", {}, "⛌") : "",
          t.sightBlocked ? el("span.tag", {}, "◐") : ""));
      });
      inspector.append(el("div.section", {}, el("h3", {}, "All tiles"), list));
    }

    inspector.append(el("div.section", {},
      el("h3", {}, "Export"),
      button("⬇ Export tileset (PNG + JSON)", () => exportTileset(d), "primary"),
      el("div.hint", {}, "Normalised atlas PNG + tileset manifest with collision flags.")));
  }

  function generateTiles(): void {
    const d = doc();
    if (!d || !L.keyed) return;
    const G = d.grid;
    const tiles: TileDef[] = [];
    let n = 0;
    for (let r = 0; r < G.rows; r++) {
      for (let c = 0; c < G.cols; c++) {
        const x = G.offsetX + c * (G.cellW + G.spacing);
        const y = G.offsetY + r * (G.cellH + G.spacing);
        if (x + G.cellW > L.keyed.width + 2 || y + G.cellH > L.keyed.height + 2) continue;
        if (L.skipEmpty) {
          const crop = cropCanvas(L.keyed, x, y, G.cellW, G.cellH);
          if (!alphaBounds(crop)) continue; // fully transparent
        }
        tiles.push({ id: uid("t"), char: "", name: `tile-${n}`, x, y, w: G.cellW, h: G.cellH, blocked: false, sightBlocked: false, tags: [] });
        n++;
      }
    }
    mutate(() => (d.tiles = tiles));
    setStatus(`Generated ${tiles.length} tiles`);
    refreshCanvasInspector();
  }

  function autoDetectTiles(): void {
    const d = doc();
    if (!d || !L.keyed) { setStatus("Pick a source image first"); return; }
    setStatus("Detecting tiles…");
    const rects = detectTiles(L.keyed, L.detect);
    const tiles: TileDef[] = rects.map((r, i) => ({
      id: uid("t"), char: "", name: `tile-${i}`, x: r.x, y: r.y, w: r.w, h: r.h, blocked: false, sightBlocked: false, tags: []
    }));
    mutate(() => (d.tiles = tiles));
    L.selectedTileId = null;
    setStatus(`Auto-detected ${tiles.length} tiles`);
    refreshCanvasInspector();
  }

  async function exportTileset(d: TilesetDoc): Promise<void> {
    if (!L.keyed || !d.tiles.length) { setStatus("Generate tiles first"); return; }
    setStatus("Packing tileset…");
    const { atlas, manifest } = packTileset(d, L.keyed);
    const name = slug(d.name);
    manifest.image = `${name}.png`;
    const png = await canvasToBlob(atlas);
    const zip = buildZip([
      await blobEntry(`${name}.png`, png),
      textEntry(`${name}.tileset.json`, JSON.stringify(manifest, null, 2))
    ]);
    downloadBlob(zip, `${name}-tileset.zip`);
    setStatus(`Exported ${name}: ${manifest.tiles.length} tiles (${manifest.columns}×${manifest.rows})`);
  }

  function refreshCanvasInspector(): void { renderInspector(); vp.render(); }
  function refreshAll(): void {
    const d0 = doc();
    const srcs = getProject().sources;
    if (d0 && !d0.sourceId && srcs.length) d0.sourceId = srcs[srcs.length - 1].id;
    reloadKeyed().then(() => { renderSidebar(); renderInspector(); vp.render(); });
  }

  refreshAll();

  return {
    refresh: () => {
      if (!getProject().tilesets.some((t) => t.id === L.tilesetId)) L.tilesetId = getProject().tilesets[0]?.id ?? null;
      refreshAll();
    },
    unmount: () => { vp.destroy(); root.replaceChildren(); }
  };
}
