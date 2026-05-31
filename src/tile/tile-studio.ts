import type { Editor } from "../main";
import { el, button, numberField, textField, checkbox, clear } from "../core/dom";
import { getProject, mutate, setStatus, slug } from "../core/store";
import { sourcePicker } from "../core/sources";
import { getKeyedCanvas, uid, cropCanvas, canvasToBlob, alphaBounds, importSourceFromUrl } from "../core/image";
import { LIBRARY, libraryUrl, libraryThumbUrl } from "../core/library";
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
  append: boolean;
  detect: { minSize: number; pad: number };
  keyed: HTMLCanvasElement | null;
  keyedKey: string;
}

export function mountTileStudio(root: HTMLElement): Editor {
  const L: Local = {
    tilesetId: getProject().tilesets[0]?.id ?? null,
    selectedTileId: null,
    skipEmpty: true,
    append: false,
    detect: { minSize: 16, pad: 0 },
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

    // Built-in library: a thumbnail grid; click a sheet to load + auto-slice it.
    const libSec = el("div.section", {}, el("h3", {}, "Built-in library"));
    for (const cat of ["biome", "structure"] as const) {
      libSec.append(el("div.hint", { style: { margin: "6px 0 2px" } }, cat === "biome" ? "Biomes" : "Structures"));
      const grid = el("div.lib-grid");
      for (const e of LIBRARY.filter((x) => x.category === cat)) {
        const added = getProject().tilesets.some((t) => t.name === e.name);
        grid.append(el("div.lib-card" + (added ? ".added" : ""),
          { title: e.note ? `${e.name} — ${e.note}` : e.name, onclick: () => addFromLibrary(e.file) },
          el("img", { src: libraryThumbUrl(e.file), loading: "lazy", alt: e.name }),
          el("span.lib-name", {}, e.name)));
      }
      libSec.append(grid);
    }
    libSec.append(el("div.hint", { style: { marginTop: "6px" } }, "Click a sheet → loads + auto-slices. Then build terrains in the Stage Editor."));
    sidebar.append(libSec);

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
      grid: { offsetX: 0, offsetY: 0, cols: 8, rows: 8, cellW: 32, cellH: 32, spacing: 0, inset: 4 },
      tiles: []
    };
    mutate((p) => p.tilesets.push(d));
    selectTileset(d.id);
  }

  async function addFromLibrary(file: string): Promise<void> {
    const entry = LIBRARY.find((e) => e.file === file);
    if (!entry) return;
    if (getProject().tilesets.some((t) => t.name === entry.name)) { setStatus(`"${entry.name}" already added`); return; }
    setStatus(`Loading ${entry.name}…`);
    try {
      const src = await importSourceFromUrl(libraryUrl(file), entry.name);
      const d: TilesetDoc = {
        id: uid("ts"),
        name: entry.name,
        sourceId: src.id,
        chroma: defaultChroma(),
        tileSize: 64,
        // Inset 0: biome sheets carry real edge/corner tiles — don't trim them.
        grid: { offsetX: 0, offsetY: 0, cols: 8, rows: 8, cellW: 64, cellH: 64, spacing: 0, inset: 0 },
        tiles: []
      };
      mutate((p) => { p.sources.push(src); p.tilesets.push(d); });
      L.tilesetId = d.id;
      L.selectedTileId = null;
      await reloadKeyed();
      autoDetectTiles();
      setStatus(`Added "${entry.name}" — ${doc()?.tiles.length ?? 0} tiles. In Stage Editor: ✨ Auto-create terrains.`);
    } catch (e) {
      setStatus(`Failed to load ${entry.name}`);
      console.error(e);
    }
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
      el("div.btn-row", {},
        checkbox("Append (keep existing tiles)", L.append, (b) => (L.append = b))),
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
        el("div.btn-row", {},
          button(`Fit tile size → ${Math.round((sel.w + sel.h) / 2)}`, () => { mutate(() => (d.tileSize = Math.round((sel.w + sel.h) / 2))); setStatus(`Tile size = ${d.tileSize} (from ${sel.name})`); renderInspector(); }),
          button("Delete tile", () => { mutate(() => (d.tiles = d.tiles.filter((t) => t.id !== sel.id))); L.selectedTileId = null; refreshCanvasInspector(); }, "danger")),
        el("div.hint", {}, "Fit tile size: click a representative terrain tile, then this, so terrain = 1 world cell and larger props become multi-cell objects in the stage.")));
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
    const base = L.append ? d.tiles.length : 0;
    mutate(() => (d.tiles = L.append ? [...d.tiles, ...tiles] : tiles));
    setStatus(`${L.append ? "Appended" : "Generated"} ${tiles.length} tiles (${base + tiles.length} total)`);
    refreshCanvasInspector();
  }

  function autoDetectTiles(): void {
    const d = doc();
    if (!d || !L.keyed) { setStatus("Pick a source image first"); return; }
    setStatus("Detecting tiles…");
    const base = L.append ? d.tiles.length : 0;
    const rects = detectTiles(L.keyed, L.detect);
    const tiles: TileDef[] = rects.map((r, i) => ({
      id: uid("t"), char: "", name: `tile-${base + i}`, x: r.x, y: r.y, w: r.w, h: r.h, blocked: false, sightBlocked: false, tags: []
    }));
    // Estimate the base tile unit from the smaller cluster of detected tiles so
    // terrain ≈ 1 cell and bigger props become multi-cell. Without this, a sheet
    // of 80px tiles against the default 32px output makes every tile an "object".
    const suggested = suggestTileSize(rects.map((r) => Math.min(r.w, r.h)));
    mutate(() => {
      d.tiles = L.append ? [...d.tiles, ...tiles] : tiles;
      if (!L.append && suggested) d.tileSize = suggested;
    });
    L.selectedTileId = null;
    setStatus(`Auto-detected ${tiles.length} tiles${!L.append && suggested ? `; set tile size to ${suggested}` : ""}`);
    refreshCanvasInspector();
  }

  /** Estimate the base tile unit: the 30th-percentile of tile short-edges,
   * snapped to a tidy value. Robust to a few big props skewing the average. */
  function suggestTileSize(shortEdges: number[]): number | null {
    if (!shortEdges.length) return null;
    const s = shortEdges.slice().sort((a, b) => a - b);
    const p = s[Math.floor(s.length * 0.3)];
    return Math.max(8, Math.round(p));
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
