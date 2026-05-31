import type { Editor } from "../main";
import { el, button, numberField, textField, checkbox, clear } from "../core/dom";
import { getProject, mutate, setStatus, slug } from "../core/store";
import { getKeyedCanvas, uid, cropCanvas, newCanvas, ctx2d, canvasToBlob } from "../core/image";
import { Viewport } from "../core/viewport";
import type { StageDoc, StageLayer, PlacedObject } from "../core/types";
import { buildStageManifest } from "./stage-export";
import { buildZip, textEntry, blobEntry } from "../core/zip";
import { downloadBlob } from "../core/download";
import { packTileset } from "../tile/tile-pack";
import { resolveCell, EDGE16_SLOTS, maskGlyph } from "./autotile";
import { generateTransitionSheet } from "./transition-gen";
import { classifyTileBlob, tileCenter, isSeamlessFill, colorDist, colorName } from "./classify";
import type { RGB } from "./classify";
import { importSourceDataUrl } from "../core/image";
import type { Terrain, TilesetDoc, TileDef } from "../core/types";

type Tool = "paint" | "erase" | "fill" | "rect" | "collision" | "object" | "terrain";

interface RefMeta {
  cellsW: number;
  cellsH: number;
  blocked: boolean;
  /** 1-cell tile with no baked border — safe to paint as a contiguous area. */
  seamless: boolean;
}

interface Local {
  stageId: string | null;
  tool: Tool;
  activeRef: string | null; // "<tilesetId>/<tileId>"
  activeLayer: number;
  /** Native-aspect tile art (cropped, not squished), keyed by ref. */
  tileImg: Map<string, HTMLCanvasElement>;
  /** Per-ref footprint (in stage cells) + collision flag. */
  refMeta: Map<string, RefMeta>;
  selectedObjectId: string | null;
  activeTerrainId: string | null;
  brushRadius: number; // 0 = 1 cell, 1 = 3x3, 2 = 5x5 …
  brushShape: "square" | "circle";
  transFill: string | null;
  transBase: string | null;
  transBand: number;
  /** Shift-clicked palette tiles to paint randomly among (terrain variation). */
  scatterRefs: string[];
  scatter: boolean;
  hover: { x: number; y: number } | null;
  rectStart: { x: number; y: number } | null;
  collisionPaintValue: boolean;
  showCollision: boolean;
  showGrid: boolean;
}

function makeGrid<T>(cols: number, rows: number, fill: T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

export function mountStageEditor(root: HTMLElement): Editor {
  const L: Local = {
    stageId: getProject().stages[0]?.id ?? null,
    tool: "paint",
    activeRef: null,
    activeLayer: 0,
    tileImg: new Map(),
    refMeta: new Map(),
    selectedObjectId: null,
    activeTerrainId: null,
    brushRadius: 0,
    brushShape: "square",
    transFill: null,
    transBase: null,
    transBand: 10,
    scatterRefs: [],
    scatter: false,
    hover: null,
    rectStart: null,
    collisionPaintValue: true,
    showCollision: true,
    showGrid: true
  };

  const workspace = el("div.workspace");
  const sidebar = el("div.sidebar");
  const stageArea = el("div.stage-area");
  const inspector = el("div.inspector");
  workspace.append(sidebar, stageArea, inspector);
  root.append(workspace);

  const doc = (): StageDoc | null => getProject().stages.find((s) => s.id === L.stageId) ?? null;

  const vp = new Viewport({
    draw: (g) => drawScene(g),
    onPointerDown: (p) => onPaint(p.worldX, p.worldY, true),
    onPointerMove: (p) => onPaint(p.worldX, p.worldY, false),
    onPointerUp: (p) => onPaintEnd(p.worldX, p.worldY),
    onHover: (p) => {
      const d = doc();
      if (!d || !p) { L.hover = null; vp.render(); return; }
      L.hover = { x: Math.floor(p.worldX / d.tileSize), y: Math.floor(p.worldY / d.tileSize) };
      vp.render();
    }
  });
  vp.mount(stageArea);

  function cellAt(d: StageDoc, wx: number, wy: number): { x: number; y: number } | null {
    const x = Math.floor(wx / d.tileSize);
    const y = Math.floor(wy / d.tileSize);
    if (x < 0 || y < 0 || x >= d.cols || y >= d.rows) return null;
    return { x, y };
  }

  /** Cells covered by the brush centred on (cx,cy), clamped to the grid. */
  function brushCells(d: StageDoc, cx: number, cy: number): Array<{ x: number; y: number }> {
    const r = L.brushRadius;
    if (r <= 0) return [{ x: cx, y: cy }];
    const cells: Array<{ x: number; y: number }> = [];
    const rr = (r + 0.35) * (r + 0.35);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (L.brushShape === "circle" && dx * dx + dy * dy > rr) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < d.cols && y < d.rows) cells.push({ x, y });
      }
    }
    return cells;
  }

  function onPaint(wx: number, wy: number, isDown: boolean): void {
    const d = doc();
    if (!d) return;
    const c = cellAt(d, wx, wy);
    if (!c) return;
    const layer = d.layers[L.activeLayer];
    if (L.tool === "object") {
      if (isDown) {
        // Click an existing object to select it; otherwise place a new one.
        const hit = topObjectAt(d, c.x, c.y);
        if (hit) { L.selectedObjectId = hit.id; renderInspector(); vp.render(); }
        else placeObject(d, c.x, c.y);
      }
      return;
    }
    if (L.tool === "rect") {
      if (isDown) L.rectStart = c;
      vp.render();
      return;
    }
    if (L.tool === "collision") {
      if (isDown) L.collisionPaintValue = !d.collision[c.y][c.x];
      mutate(() => { for (const p of brushCells(d, c.x, c.y)) d.collision[p.y][p.x] = L.collisionPaintValue; });
      vp.render();
      return;
    }
    if (L.tool === "terrain") {
      if (!layer || !L.activeTerrainId) { if (isDown) setStatus("Pick or create a terrain first"); return; }
      ensureTerrainGrid(layer, d);
      const cells = brushCells(d, c.x, c.y);
      let changed = false;
      mutate(() => { for (const p of cells) if (layer.terrain![p.y][p.x] !== L.activeTerrainId) { layer.terrain![p.y][p.x] = L.activeTerrainId; changed = true; } });
      if (changed) { resolveSet(d, layer, cells); vp.render(); }
      return;
    }
    if (L.tool === "fill") {
      if (isDown && layer) floodFill(layer, c.x, c.y);
      return;
    }
    // paint / erase (drag-and-drop placement), brush-aware
    if (!layer) return;
    mutate(() => {
      for (const p of brushCells(d, c.x, c.y)) {
        const ref = L.tool === "erase" ? null : pickRef();
        layer.data[p.y][p.x] = ref;
      }
    });
    vp.render();
  }

  /** The tile to lay down for one cell: a random pick from the scatter set when
   * scatter is on, else the single active tile. Drives natural-looking terrain
   * variation without manual placement. */
  function pickRef(): string | null {
    if (L.scatter && L.scatterRefs.length) {
      return L.scatterRefs[Math.floor(Math.random() * L.scatterRefs.length)];
    }
    return L.activeRef;
  }

  function onPaintEnd(wx: number, wy: number): void {
    const d = doc();
    if (!d || L.tool !== "rect" || !L.rectStart) return;
    const c = cellAt(d, wx, wy) ?? L.rectStart;
    const layer = d.layers[L.activeLayer];
    const x0 = Math.min(L.rectStart.x, c.x), x1 = Math.max(L.rectStart.x, c.x);
    const y0 = Math.min(L.rectStart.y, c.y), y1 = Math.max(L.rectStart.y, c.y);
    mutate(() => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) layer.data[y][x] = pickRef();
    });
    L.rectStart = null;
    vp.render();
  }

  function floodFill(layer: StageLayer, x: number, y: number): void {
    const target = layer.data[y][x];
    const cols = layer.data[0].length;
    const stack = [[x, y]];
    const seen = new Set<number>(); // visited cells, so scatter (which may re-pick
    // the target value) can't cause reprocessing / infinite loops
    mutate(() => {
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= layer.data.length) continue;
        const key = cy * cols + cx;
        if (seen.has(key)) continue;
        if (layer.data[cy][cx] !== target) continue;
        seen.add(key);
        layer.data[cy][cx] = pickRef();
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    });
    vp.render();
  }

  // ---- Autotiling --------------------------------------------------------
  function ensureTerrainGrid(layer: StageLayer, d: StageDoc): void {
    if (!layer.terrain || layer.terrain.length !== d.rows || layer.terrain[0]?.length !== d.cols) {
      const next = makeGrid<string | null>(d.cols, d.rows, null);
      if (layer.terrain) {
        for (let y = 0; y < Math.min(d.rows, layer.terrain.length); y++)
          for (let x = 0; x < Math.min(d.cols, layer.terrain[0].length); x++) next[y][x] = layer.terrain[y][x];
      }
      layer.terrain = next;
    }
  }

  /** Re-resolve a set of painted cells plus their 8-neighbours from terrain
   * membership (one mutate), writing resolved autotiles into the tile layer. */
  /** Priority rank of a terrain id by its order in the project list (higher
   * index = higher priority = owns boundaries / drawn on top). */
  function terrainRank(): (id: string | null) => number {
    const order = new Map(getProject().terrains.map((t, i) => [t.id, i]));
    return (id) => (id && order.has(id) ? order.get(id)! : -Infinity);
  }

  function resolveSet(d: StageDoc, layer: StageLayer, cells: Array<{ x: number; y: number }>): void {
    const terrains = getProject().terrains;
    const rank = terrainRank();
    const seen = new Set<number>();
    mutate(() => {
      for (const cell of cells) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cell.x + dx, y = cell.y + dy;
            if (x < 0 || y < 0 || x >= d.cols || y >= d.rows) continue;
            const key = y * d.cols + x;
            if (seen.has(key)) continue;
            seen.add(key);
            const tid = layer.terrain?.[y]?.[x];
            if (!tid) continue;
            const terrain = terrains.find((t) => t.id === tid);
            if (!terrain) continue;
            const ref = resolveCell(terrain, layer.terrain!, x, y, d.cols, d.rows, rank);
            if (ref) layer.data[y][x] = ref;
          }
        }
      }
    });
  }

  /** Re-resolve every terrain cell on a layer (after a role assignment changes). */
  function reflowTerrain(d: StageDoc): void {
    const terrains = getProject().terrains;
    const rank = terrainRank();
    mutate(() => {
      for (const layer of d.layers) {
        if (!layer.terrain) continue;
        for (let y = 0; y < d.rows; y++)
          for (let x = 0; x < d.cols; x++) {
            const tid = layer.terrain[y]?.[x];
            if (!tid) continue;
            const terrain = terrains.find((t) => t.id === tid);
            if (!terrain) continue;
            const ref = resolveCell(terrain, layer.terrain, x, y, d.cols, d.rows, rank);
            if (ref) layer.data[y][x] = ref;
          }
      }
    });
    vp.render();
  }

  // ---- Tile thumbnails ---------------------------------------------------
  async function ensureTileImages(): Promise<void> {
    const project = getProject();
    L.tileImg.clear();
    L.refMeta.clear();
    for (const ts of project.tilesets) {
      if (!ts.sourceId) continue;
      const keyed = await getKeyedCanvas(ts.sourceId, ts.chroma);
      const unit = ts.tileSize || 32; // a tile this many source px ≈ one cell
      for (const tile of ts.tiles) {
        // Inset trims the soft anti-aliased fringe off terrain tiles so they
        // tile seamlessly; objects (multi-cell decorations) keep their full
        // silhouette, so they get no inset.
        const terrain = tile.w <= unit * 1.6 && tile.h <= unit * 1.6;
        const inset = terrain ? ts.grid.inset : 0;
        const ix = Math.max(0, tile.x + inset);
        const iy = Math.max(0, tile.y + inset);
        const iw = Math.max(1, tile.w - inset * 2);
        const ih = Math.max(1, tile.h - inset * 2);
        const ref = `${ts.id}/${tile.id}`;
        // Keep native aspect (no squish) — used both for terrain cells (drawn
        // stretched to one cell) and multi-cell objects (drawn to footprint).
        const crop = cropCanvas(keyed, ix, iy, iw, ih);
        L.tileImg.set(ref, crop);
        const cellsW = Math.max(1, Math.round(iw / unit));
        const cellsH = Math.max(1, Math.round(ih / unit));
        L.refMeta.set(ref, {
          cellsW,
          cellsH,
          blocked: tile.blocked,
          seamless: cellsW === 1 && cellsH === 1 && isSeamlessFill(crop)
        });
      }
    }
  }

  /** A ref is "big" (an object/decoration) if it spans more than one cell. */
  function isObjectRef(ref: string | null): boolean {
    if (!ref) return false;
    const m = L.refMeta.get(ref);
    return !!m && (m.cellsW > 1 || m.cellsH > 1);
  }

  // ---- Render ------------------------------------------------------------
  function drawScene(g: CanvasRenderingContext2D): void {
    const d = doc();
    if (!d) return;
    const ts = d.tileSize;
    const W = d.cols * ts;
    const H = d.rows * ts;
    g.fillStyle = "#0e1116";
    g.fillRect(0, 0, W, H);

    for (const layer of d.layers) {
      if (!layer.visible) continue;
      for (let y = 0; y < d.rows; y++) {
        for (let x = 0; x < d.cols; x++) {
          const ref = layer.data[y][x];
          if (!ref) continue;
          const img = L.tileImg.get(ref);
          if (img) g.drawImage(img, 0, 0, img.width, img.height, x * ts, y * ts, ts, ts);
          else { g.fillStyle = "#444"; g.fillRect(x * ts, y * ts, ts, ts); }
        }
      }
    }

    if (L.showGrid && vp.scale > 0.25) {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 1 / vp.scale;
      g.beginPath();
      for (let x = 0; x <= d.cols; x++) { g.moveTo(x * ts, 0); g.lineTo(x * ts, H); }
      for (let y = 0; y <= d.rows; y++) { g.moveTo(0, y * ts); g.lineTo(W, y * ts); }
      g.stroke();
    }

    if (L.showCollision) {
      g.fillStyle = "rgba(255,80,80,0.35)";
      for (let y = 0; y < d.rows; y++)
        for (let x = 0; x < d.cols; x++)
          if (d.collision[y][x]) g.fillRect(x * ts, y * ts, ts, ts);
    }

    // objects — y-sorted by base so nearer (lower) objects overlap farther ones,
    // the standard top-down depth trick.
    const sorted = [...d.objects].sort((a, b) => a.y + a.h - (b.y + b.h));
    const showObjBounds = L.tool === "object";
    for (const o of sorted) {
      const img = o.tileRef ? L.tileImg.get(o.tileRef) : null;
      if (img) {
        g.drawImage(img, 0, 0, img.width, img.height, o.x * ts, o.y * ts, o.w * ts, o.h * ts);
      } else {
        g.fillStyle = "rgba(0,0,0,0.5)";
        const fs = 11 / vp.scale;
        g.font = `${fs}px monospace`;
        g.fillStyle = "#fff";
        g.fillText(o.key, o.x * ts + 2 / vp.scale, o.y * ts + fs);
      }
      if (showObjBounds || o.id === L.selectedObjectId) {
        g.strokeStyle = o.id === L.selectedObjectId ? "#ffcf6b" : o.blocking ? "#ff8d6b" : "#7ee0a0";
        g.lineWidth = (o.id === L.selectedObjectId ? 2 : 1) / vp.scale;
        g.strokeRect(o.x * ts, o.y * ts, o.w * ts, o.h * ts);
      }
    }

    // hover
    if (L.hover && L.hover.x >= 0 && L.hover.y >= 0 && L.hover.x < d.cols && L.hover.y < d.rows) {
      // Show the brush footprint for area tools; a single cell otherwise.
      const brushTools = L.tool === "paint" || L.tool === "erase" || L.tool === "terrain" || L.tool === "collision";
      const cells = brushTools ? brushCells(d, L.hover.x, L.hover.y) : [{ x: L.hover.x, y: L.hover.y }];
      g.fillStyle = "rgba(255,207,107,0.18)";
      for (const p of cells) g.fillRect(p.x * ts, p.y * ts, ts, ts);
      g.strokeStyle = "#ffcf6b";
      g.lineWidth = 2 / vp.scale;
      for (const p of cells) g.strokeRect(p.x * ts, p.y * ts, ts, ts);
    }
    // border
    g.strokeStyle = "rgba(255,255,255,0.3)";
    g.lineWidth = 1 / vp.scale;
    g.strokeRect(0, 0, W, H);
  }

  // ---- Sidebar (palette) -------------------------------------------------
  function renderSidebar(): void {
    clear(sidebar);
    const project = getProject();
    sidebar.append(
      el("div.section", {},
        el("h3", {}, "Stages"),
        el("div.list", {}, ...project.stages.map((s) =>
          el("div.list-item" + (s.id === L.stageId ? ".active" : ""),
            { onclick: () => selectStage(s.id) },
            el("div.name", {}, s.name),
            el("span.meta", {}, `${s.cols}×${s.rows}`),
            button("✕", (e: Event) => { e.stopPropagation(); deleteStage(s.id); }, "sm danger")))),
        el("div.btn-row", { style: { marginTop: "8px" } }, button("+ New stage", newStage, "primary")))
    );

    // Palette of tiles, grouped by tileset
    const pal = el("div.section", {}, el("h3", {}, "Palette"));
    pal.append(el("div.btn-row", {},
      button("🩹 Eraser", () => { L.tool = "erase"; renderInspector(); }, L.tool === "erase" ? "active" : "")));
    if (!project.tilesets.length) {
      pal.append(el("div.hint", {}, "No tilesets yet. Build one in Tile Studio first."));
    }
    for (const ts of project.tilesets) {
      const row = el("div.palette");
      for (const tile of ts.tiles) {
        const ref = `${ts.id}/${tile.id}`;
        const big = isObjectRef(ref);
        const inScatter = L.scatterRefs.includes(ref);
        const sw = el("div.swatch" + (L.activeRef === ref ? ".active" : "") + (inScatter ? ".scatter" : ""), {
          title: tile.name + (tile.blocked ? " (blocks)" : "") + (big ? " — object" : "") + "\n(shift-click = add to scatter set)",
          onclick: (e: MouseEvent) => {
            if (e.shiftKey || e.ctrlKey) {
              // Toggle membership in the scatter set (paint random among these).
              const i = L.scatterRefs.indexOf(ref);
              if (i >= 0) L.scatterRefs.splice(i, 1); else L.scatterRefs.push(ref);
              L.scatter = L.scatterRefs.length > 0;
              L.tool = "paint";
            } else {
              // Big tiles are placed as multi-cell objects; small ones painted.
              L.activeRef = ref;
              L.scatterRefs = [];
              L.scatter = false;
              L.tool = big ? "object" : "paint";
            }
            renderInspector();
            renderSidebar();
          }
        });
        const img = L.tileImg.get(ref);
        if (img) {
          const c = newCanvas(img.width, img.height);
          ctx2d(c).drawImage(img, 0, 0);
          c.style.objectFit = "contain"; // preserve aspect in the square swatch
          sw.append(c);
        }
        if (big) sw.append(el("span.badge", { style: { left: "-2px", right: "auto", color: "#7ee0a0" }, title: "object (multi-cell)" }, "◳"));
        else if (!L.refMeta.get(ref)?.seamless) {
          // Bordered 1-cell tile (pond/patch with baked edges): painting it raw
          // repeats the border. Flag it so users build a terrain instead.
          sw.append(el("span.badge", { style: { left: "-2px", right: "auto", color: "#ffcf6b" }, title: "edged tile — paint as a Terrain, not directly (or it tiles its border)" }, "◱"));
        }
        if (tile.blocked) sw.append(el("span.badge", {}, "⛌"));
        row.append(sw);
      }
      pal.append(el("div", {}, el("div.hint", { style: { margin: "4px 0" } }, ts.name), row));
    }
    sidebar.append(pal);
  }

  function newStage(): void {
    const tileSize = getProject().tilesets[0]?.tileSize ?? 32;
    const d: StageDoc = {
      id: uid("stg"),
      name: `stage-${getProject().stages.length + 1}`,
      tileSize,
      cols: 40,
      rows: 25,
      layers: [
        { id: uid("ly"), name: "ground", visible: true, data: makeGrid(40, 25, null) },
        { id: uid("ly"), name: "overlay", visible: true, data: makeGrid(40, 25, null) }
      ],
      collision: makeGrid(40, 25, false),
      objects: []
    };
    mutate((p) => p.stages.push(d));
    selectStage(d.id);
  }

  function deleteStage(id: string): void {
    mutate((p) => (p.stages = p.stages.filter((s) => s.id !== id)));
    if (L.stageId === id) L.stageId = getProject().stages[0]?.id ?? null;
    refreshAll();
  }
  function selectStage(id: string): void { L.stageId = id; L.activeLayer = 0; refreshAll(); }

  function resizeStage(d: StageDoc, cols: number, rows: number): void {
    mutate(() => {
      for (const layer of d.layers) {
        const next = makeGrid<string | null>(cols, rows, null);
        for (let y = 0; y < Math.min(rows, d.rows); y++)
          for (let x = 0; x < Math.min(cols, d.cols); x++) next[y][x] = layer.data[y][x];
        layer.data = next;
        if (layer.terrain) {
          const nt = makeGrid<string | null>(cols, rows, null);
          for (let y = 0; y < Math.min(rows, d.rows); y++)
            for (let x = 0; x < Math.min(cols, d.cols); x++) nt[y][x] = layer.terrain[y][x];
          layer.terrain = nt;
        }
      }
      const col = makeGrid(cols, rows, false);
      for (let y = 0; y < Math.min(rows, d.rows); y++)
        for (let x = 0; x < Math.min(cols, d.cols); x++) col[y][x] = d.collision[y][x];
      d.collision = col;
      d.cols = cols;
      d.rows = rows;
    });
    vp.fit(d.cols * d.tileSize, d.rows * d.tileSize);
  }

  // ---- Terrains (autotiling) UI -----------------------------------------
  function renderTerrainsSection(d: StageDoc): HTMLElement {
    const project = getProject();
    const sec = el("div.section", {}, el("h3", {}, "Terrains (autotile)"));
    const list = el("div.list");
    // Listed low→high priority (higher = drawn on top, owns boundaries).
    project.terrains.forEach((t, i) => {
      list.append(el("div.list-item" + (t.id === L.activeTerrainId ? ".active" : ""),
        { onclick: () => { L.activeTerrainId = t.id; L.tool = "terrain"; renderInspector(); } },
        el("span.meta", {}, `p${i}`),
        el("div.name", {}, t.name),
        button("▲", (e: Event) => { e.stopPropagation(); moveTerrain(i, +1); }, "sm"),
        button("▼", (e: Event) => { e.stopPropagation(); moveTerrain(i, -1); }, "sm"),
        button("✕", (e: Event) => { e.stopPropagation(); mutate(() => (project.terrains = project.terrains.filter((x) => x.id !== t.id))); if (L.activeTerrainId === t.id) L.activeTerrainId = null; refreshCanvasInspector(); }, "sm danger")));
    });
    sec.append(list,
      el("div.hint", {}, `Pick a texture & paint (HoMM3-style): ① click a clean tile in the palette → ② Make terrain → ③ select it + paint. First terrain is the base (use ▣ Fill); later ones blend over it. ${L.activeRef ? "" : "(select a palette tile to enable)"}`),
      el("div.btn-row", { style: { marginTop: "6px" } },
        button("➕ Make terrain from selected tile", () => makeTerrainFromSelected(), L.activeRef ? "primary" : "")),
      el("div.btn-row", { style: { marginTop: "6px" } },
        button("✨ Auto-create (guess all)", () => autoCreateTerrains()),
        button("+ Road", () => newTerrain("path"))));

    // Synthesized transitions: blend one fill terrain into another (for sheets
    // with no dedicated edge/corner art). Generates a 16-tile transition set.
    const fillImg = L.transFill ? L.tileImg.get(L.transFill) : null;
    const baseImg = L.transBase ? L.tileImg.get(L.transBase) : null;
    const thumb = (img: HTMLCanvasElement | null | undefined): HTMLElement => {
      const box = el("div.swatch", { style: { width: "28px", height: "28px" } });
      if (img) { const c = newCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); c.style.objectFit = "contain"; box.append(c); }
      return box;
    };
    sec.append(
      el("div.divider"),
      el("div.hint", {}, "Synthesized transition — blend a fill terrain into a base (for sheets without edge/corner art): select a palette tile, Set fill; select another, Set base; Generate."),
      el("div.btn-row", { style: { alignItems: "center" } },
        button("Set fill", () => { L.transFill = L.activeRef; renderInspector(); }, "sm"), thumb(fillImg),
        button("Set base", () => { L.transBase = L.activeRef; renderInspector(); }, "sm"), thumb(baseImg)),
      el("div.btn-row", { style: { alignItems: "center" } },
        numberField("Blend px", L.transBand, (v) => (L.transBand = Math.max(0, v)), { min: 0, max: 64, width: 56 }),
        button("✨ Generate transition", () => createSynthesizedTerrain(), L.transFill && L.transBase ? "primary" : "")),
      el("div.hint", { style: { marginTop: "4px" } }, "Or, if the sheet already has edge/corner tiles: set fill = the primary terrain, base = the other, then auto-build — the tool classifies each tile's edges and assigns the 16 roles for you."),
      el("div.btn-row", {}, button("🧩 Auto-build from sheet", () => autoBuildTerrain(), L.transFill && L.transBase ? "primary" : "")));

    const terrain = project.terrains.find((t) => t.id === L.activeTerrainId);
    if (terrain) {
      sec.append(el("div.btn-row", { style: { marginTop: "4px" } },
        button(`▣ Fill active layer with "${terrain.name}"`, () => fillLayerWithTerrain(terrain))));
    }
    if (terrain && terrain.kind === "blob47") {
      sec.append(el("div.hint", { style: { margin: "6px 0" } },
        `Auto-built terrain (inner corners): ${Object.keys(terrain.roles).length} configurations from the sheet. Paint with the terrain tool. Re-run auto-build to rebuild.`));
    }
    if (terrain && (terrain.kind === "edge16" || terrain.kind === "path")) {
      sec.append(el("div.hint", { style: { margin: "6px 0" } },
        terrain.kind === "path"
          ? "Assign road tiles to the connection slots (the glyph shows which sides connect: straights, corners, T-junctions, cross). Paint with the terrain tool on an overlay layer; junctions resolve automatically. Right-click a slot to clear."
          : "Click a palette tile, then click a slot below to assign it to that edge pattern. Then use the terrain tool to paint — borders & corners resolve automatically. Right-click a slot to clear."));
      const grid = el("div.palette");
      for (const slot of EDGE16_SLOTS) {
        const cell = el("div.swatch", {
          title: slot.label,
          style: { position: "relative" },
          onclick: () => assignRole(terrain, slot.mask),
          oncontextmenu: (e: Event) => { e.preventDefault(); mutate(() => { delete terrain.roles[slot.mask]; }); reflowTerrain(d); renderInspector(); }
        });
        cell.append(maskGlyph(slot.mask));
        const ref = terrain.roles[slot.mask];
        const img = ref && L.tileImg.get(ref);
        if (img) {
          const c = newCanvas(img.width, img.height);
          ctx2d(c).drawImage(img, 0, 0);
          Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", opacity: "0.92" });
          cell.append(c);
        }
        grid.append(cell);
      }
      sec.append(grid);
    }
    return sec;
  }

  function moveTerrain(i: number, dir: number): void {
    const terrains = getProject().terrains;
    const j = i + dir;
    if (j < 0 || j >= terrains.length) return;
    mutate(() => { const [m] = terrains.splice(i, 1); terrains.splice(j, 0, m); });
    const d = doc();
    if (d) reflowTerrain(d); // priority changed → re-resolve borders
    renderInspector();
  }

  /** Lay a base biome instantly: set the whole active layer's terrain
   * membership to this terrain, then reflow autotiles. */
  function fillLayerWithTerrain(terrain: Terrain): void {
    const d = doc();
    if (!d) return;
    const layer = d.layers[L.activeLayer];
    if (!layer) return;
    ensureTerrainGrid(layer, d);
    mutate(() => {
      for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++) layer.terrain![y][x] = terrain.id;
    });
    reflowTerrain(d);
    L.activeTerrainId = terrain.id;
    setStatus(`Filled "${layer.name}" with ${terrain.name}`);
    renderInspector();
  }

  function newTerrain(kind: "edge16" | "path"): void {
    const project = getProject();
    const tilesetId = (L.activeRef && L.activeRef.split("/")[0]) || project.tilesets[0]?.id;
    if (!tilesetId) { setStatus("Create a tileset first"); return; }
    const label = kind === "path" ? "road" : "terrain";
    const t: Terrain = { id: uid("terr"), name: `${label}-${project.terrains.length + 1}`, tilesetId, kind, roles: {} };
    mutate(() => project.terrains.push(t));
    L.activeTerrainId = t.id;
    L.tool = "terrain";
    setStatus(kind === "path"
      ? "Road created — assign road tiles to the 16 connection slots (straights, corners, T, cross), then paint on an overlay layer"
      : "Terrain created — assign tiles to the 16 edge slots");
    refreshCanvasInspector();
  }

  async function createSynthesizedTerrain(): Promise<void> {
    const d = doc();
    if (!d) return;
    if (!L.transFill || !L.transBase) { setStatus("Set both a fill and a base tile"); return; }
    const fillImg = L.tileImg.get(L.transFill);
    const baseImg = L.tileImg.get(L.transBase);
    if (!fillImg || !baseImg) { setStatus("Tile art not loaded"); return; }
    setStatus("Generating transition tiles…");
    const size = d.tileSize || 48;
    const name = `${L.transFill.split("/")[1] ?? "fill"}-on-${L.transBase.split("/")[1] ?? "base"}`;
    const built = await buildSynthTerrain(fillImg, baseImg, size, name, L.transBand);
    mutate((p) => { p.sources.push(built.source); p.tilesets.push(built.tileset); p.terrains.push(built.terrain); });
    L.activeTerrainId = built.terrain.id;
    L.tool = "terrain";
    await ensureTileImages();
    setStatus(`Generated transition "${name}" — paint with the terrain tool`);
    renderSidebar();
    renderInspector();
    vp.render();
  }

  /** Crop the baked border/vignette off a tile so its centre tiles seamlessly.
   * Many "biome" ground tiles are drawn as standalone squares with dark edges;
   * tiling them raw produces a grid of bordered squares. */
  function centerCrop(img: HTMLCanvasElement, frac = 0.18): HTMLCanvasElement {
    const x = Math.floor(img.width * frac), y = Math.floor(img.height * frac);
    return cropCanvas(img, x, y, img.width - 2 * x, img.height - 2 * y);
  }

  /** A plain seamless-fill terrain from a single (cropped) fill image. */
  async function buildFillTerrain(
    fillImg: HTMLCanvasElement, size: number, name: string
  ): Promise<{ source: import("../core/types").SourceImage; tileset: TilesetDoc; terrain: Terrain }> {
    const c = newCanvas(size, size);
    ctx2d(c).drawImage(fillImg, 0, 0, fillImg.width, fillImg.height, 0, 0, size, size);
    const dataUrl = await blobToDataUrl(await canvasToBlob(c));
    const source = await importSourceDataUrl(uid("src"), name, dataUrl);
    const tsId = uid("ts");
    const tile: TileDef = { id: uid("t"), char: "", name: "fill", x: 0, y: 0, w: size, h: size, blocked: false, sightBlocked: false, tags: [] };
    const tileset: TilesetDoc = {
      id: tsId, name, sourceId: source.id, chroma: { enabled: false, tolerance: 0, fringe: 0 },
      tileSize: size, grid: { offsetX: 0, offsetY: 0, cols: 1, rows: 1, cellW: size, cellH: size, spacing: 0, inset: 0 }, tiles: [tile]
    };
    const ref = `${tsId}/${tile.id}`;
    return { source, tileset, terrain: { id: uid("terr"), name, tilesetId: tsId, kind: "edge16", roles: { 0: ref, 15: ref } } };
  }

  /** Generate a synthesized edge16 terrain: `fillImg` dither-blended over
   * `baseImg`, packed as a 16-tile sheet → source + tileset + terrain. Returns
   * the docs (caller mutates). */
  async function buildSynthTerrain(
    fillImg: HTMLCanvasElement, baseImg: HTMLCanvasElement, size: number, name: string, band: number
  ): Promise<{ source: import("../core/types").SourceImage; tileset: TilesetDoc; terrain: Terrain }> {
    const sheet = generateTransitionSheet(fillImg, baseImg, size, band);
    const dataUrl = await blobToDataUrl(await canvasToBlob(sheet));
    const source = await importSourceDataUrl(uid("src"), name, dataUrl);
    const tsId = uid("ts");
    const tiles: TileDef[] = Array.from({ length: 16 }, (_, i) => ({
      id: uid("t"), char: "", name: `m${i}`, x: i * size, y: 0, w: size, h: size, blocked: false, sightBlocked: false, tags: []
    }));
    const tileset: TilesetDoc = {
      id: tsId, name, sourceId: source.id,
      chroma: { enabled: false, tolerance: 0, fringe: 0 },
      tileSize: size,
      grid: { offsetX: 0, offsetY: 0, cols: 16, rows: 1, cellW: size, cellH: size, spacing: 0, inset: 0 },
      tiles
    };
    const roles: Record<number, string> = {};
    tiles.forEach((t, mask) => (roles[mask] = `${tsId}/${t.id}`));
    return { source, tileset, terrain: { id: uid("terr"), name, tilesetId: tsId, kind: "edge16", roles } };
  }

  /** Build an edge16 terrain from a sheet that already has edge/corner tiles, by
   * classifying each tile's edges against the two chosen fills. No manual slots. */
  function autoBuildTerrain(): void {
    if (!L.transFill || !L.transBase) { setStatus("Set a fill (primary) and base (secondary) tile first"); return; }
    const pImg = L.tileImg.get(L.transFill);
    const sImg = L.tileImg.get(L.transBase);
    if (!pImg || !sImg) { setStatus("Tile art not loaded"); return; }
    const primary = tileCenter(pImg);
    const secondary = tileCenter(sImg);
    if (!primary || !secondary) { setStatus("Could not read fill colours"); return; }

    const tsId = L.transFill.split("/")[0];
    const ts = getProject().tilesets.find((t) => t.id === tsId);
    if (!ts) return;
    const roles: Record<number, string> = {};
    const filled = new Set<number>();
    let scanned = 0;
    for (const tile of ts.tiles) {
      const ref = `${tsId}/${tile.id}`;
      const img = L.tileImg.get(ref);
      if (!img) continue;
      const cl = classifyTileBlob(img, primary, secondary);
      if (!cl || !cl.centerPrimary) continue; // only tiles whose body is the primary terrain
      scanned++;
      if (!filled.has(cl.key)) { roles[cl.key] = ref; filled.add(cl.key); }
    }
    if (!roles[255]) roles[255] = L.transFill; // fully-surrounded centre fallback
    const name = `${L.transFill.split("/")[1]}-terrain`;
    const terrain: Terrain = { id: uid("terr"), name, tilesetId: tsId, kind: "blob47", roles };
    mutate((p) => p.terrains.push(terrain));
    L.activeTerrainId = terrain.id;
    L.tool = "terrain";
    setStatus(`Auto-built "${name}" (blob47): ${Object.keys(roles).length} configurations from ${scanned} primary tiles`);
    refreshCanvasInspector();
  }

  /** One-click: cluster a tileset's seamless fills into surfaces and auto-build
   * a paintable blob47 terrain for each (HoMM3-style "pick a surface, paint").
   * Largest surface = base (lowest priority); water sorts to highest. */
  /** HoMM3-style: turn the selected palette tile into a paintable terrain. The
   * first one is the seamless base; later ones dither-blend over the base. The
   * user picks clean textures, so results aren't at the mercy of auto-guessing. */
  async function makeTerrainFromSelected(): Promise<void> {
    const d = doc();
    if (!d) return;
    if (!L.activeRef) { setStatus("Click a tile in the palette first, then Make terrain"); return; }
    const img = L.tileImg.get(L.activeRef);
    if (!img) { setStatus("Tile art not loaded"); return; }
    const project = getProject();
    const name = colorName(tileCenter(img) ?? [128, 128, 128]);
    const crop = centerCrop(img);
    const base = project.terrains[0];

    if (!base) {
      // First terrain = seamless base; adopt the picked tile's size as the cell.
      const [tsId, tileId] = L.activeRef.split("/");
      const tile = project.tilesets.find((t) => t.id === tsId)?.tiles.find((x) => x.id === tileId);
      const unit = tile ? Math.round((tile.w + tile.h) / 2) : d.tileSize;
      const built = await buildFillTerrain(crop, unit, name);
      mutate((p) => { p.sources.push(built.source); p.tilesets.push(built.tileset); p.terrains.push(built.terrain); d.tileSize = unit; });
      await ensureTileImages();
      vp.fit(d.cols * d.tileSize, d.rows * d.tileSize);
      L.activeTerrainId = built.terrain.id;
      setStatus(`Base terrain "${name}" — ▣ Fill active layer, then add more textures`);
    } else {
      // Blend the picked texture over the base.
      const baseImg = L.tileImg.get(base.roles[15] ?? base.roles[0] ?? "");
      if (!baseImg) { setStatus("Base terrain art missing"); return; }
      const band = Math.max(2, Math.round(d.tileSize * 0.18));
      const built = await buildSynthTerrain(crop, baseImg, d.tileSize, name, band);
      mutate((p) => { p.sources.push(built.source); p.tilesets.push(built.tileset); p.terrains.push(built.terrain); });
      await ensureTileImages();
      L.activeTerrainId = built.terrain.id;
      setStatus(`Added terrain "${name}" — pick it and paint; it blends over ${base.name}`);
    }
    L.tool = "terrain";
    renderSidebar();
    renderInspector();
    vp.render();
  }

  async function autoCreateTerrains(): Promise<void> {
    const project = getProject();
    const d = doc();
    const tsId = (L.activeRef && L.activeRef.split("/")[0]) || project.tilesets[0]?.id;
    const ts = project.tilesets.find((t) => t.id === tsId);
    if (!ts) { setStatus("Slice a tileset first"); return; }

    // Candidate terrain tiles = roughly square, medium-sized source tiles
    // (independent of the current tile size, which may be wrong). Cluster these
    // by centre colour to discover surfaces.
    type Fill = { ref: string; color: RGB };
    const fills: Fill[] = [];
    const sizes: number[] = [];
    for (const tile of ts.tiles) {
      const lo = Math.min(tile.w, tile.h), hi = Math.max(tile.w, tile.h);
      if (lo < 40 || hi > 144 || lo / hi < 0.7) continue; // not a square-ish terrain tile
      const img = L.tileImg.get(`${tsId}/${tile.id}`);
      if (!img) continue;
      const c = tileCenter(img);
      if (!c) continue;
      fills.push({ ref: `${tsId}/${tile.id}`, color: c });
      sizes.push(Math.round((tile.w + tile.h) / 2));
    }
    if (fills.length < 2) { setStatus("No square terrain tiles found — slice with a grid first"); return; }
    // Match the tile size to the terrain tiles so cells/proportions are right.
    sizes.sort((a, b) => a - b);
    const unit = sizes[sizes.length >> 1];

    type Cluster = { color: RGB; sum: RGB; members: Fill[] };
    const clusters: Cluster[] = [];
    for (const f of fills) {
      let best: Cluster | null = null, bd = Infinity;
      for (const cl of clusters) { const d = colorDist(cl.color, f.color); if (d < bd) { bd = d; best = cl; } }
      if (best && bd < 58) {
        best.members.push(f);
        best.sum = [best.sum[0] + f.color[0], best.sum[1] + f.color[1], best.sum[2] + f.color[2]];
        best.color = [best.sum[0] / best.members.length, best.sum[1] / best.members.length, best.sum[2] / best.members.length];
      } else {
        clusters.push({ color: [...f.color], sum: [...f.color], members: [f] });
      }
    }
    // Merge colour clusters that name to the same surface (grass variants, etc.)
    // so we end up with a few clean surfaces, not many near-duplicates.
    const named = new Map<string, { name: string; color: RGB; members: Fill[] }>();
    for (const c of clusters) {
      if (c.members.length < 2) continue;
      const nm = colorName(c.color);
      const ex = named.get(nm);
      if (ex) ex.members.push(...c.members);
      else named.set(nm, { name: nm, color: c.color, members: [...c.members] });
    }
    let surfaces = [...named.values()].sort((a, b) => b.members.length - a.members.length).slice(0, 5);
    if (!surfaces.length) { setStatus("No dominant surfaces found — try slicing with a fixed grid"); return; }

    // Representative seamless fill image for a surface.
    const rep = (s: { members: Fill[] }): { ref: string; img: HTMLCanvasElement } | null => {
      for (const m of s.members) { const img = L.tileImg.get(m.ref); if (img && isSeamlessFill(img)) return { ref: m.ref, img }; }
      const img = L.tileImg.get(s.members[0].ref);
      return img ? { ref: s.members[0].ref, img } : null;
    };
    const isWet = (n: string): boolean => n === "water" || n === "shallows";
    // Base = largest dry surface (the floor everything blends into).
    const baseSurf = surfaces.find((s) => !isWet(s.name)) ?? surfaces[0];
    const baseRep = rep(baseSurf);
    if (!baseRep) { setStatus("Couldn't read a base fill tile"); return; }
    // Crop the baked border off fills so they tile seamlessly.
    const baseCrop = centerCrop(baseRep.img);

    const newSources: Array<import("../core/types").SourceImage> = [];
    const newTilesets: TilesetDoc[] = [];
    const newTerrains: Terrain[] = [];

    // Base terrain = a plain seamless fill (the floor) from the cropped centre.
    const baseT = await buildFillTerrain(baseCrop, unit, baseSurf.name);
    newSources.push(baseT.source); newTilesets.push(baseT.tileset); newTerrains.push(baseT.terrain);

    // Every other surface = its cropped fill dither-blended over the base, so
    // painting it always blends (independent of the sheet's edge art). Non-water
    // first, water last so water sits highest priority.
    const band = Math.max(2, Math.round(unit * 0.18));
    const others = surfaces.filter((s) => s !== baseSurf).sort((a, b) => (isWet(a.name) ? 1 : 0) - (isWet(b.name) ? 1 : 0) || b.members.length - a.members.length);
    for (const s of others) {
      const r = rep(s);
      if (!r) continue;
      const built = await buildSynthTerrain(centerCrop(r.img), baseCrop, unit, s.name, band);
      newSources.push(built.source);
      newTilesets.push(built.tileset);
      newTerrains.push(built.terrain);
    }

    mutate((p) => {
      ts.tileSize = unit;
      if (d) d.tileSize = unit;
      for (const s of newSources) p.sources.push(s);
      for (const t of newTilesets) p.tilesets.push(t);
      for (const t of newTerrains) p.terrains.push(t);
    });
    await ensureTileImages(); // tile size changed → recompute crops/footprints
    if (d) vp.fit(d.cols * d.tileSize, d.rows * d.tileSize);
    L.activeTerrainId = newTerrains[0]?.id ?? null;
    L.tool = "terrain";
    setStatus(`Auto-created ${newTerrains.length} terrain(s) @${unit}px: ${newTerrains.map((t) => t.name).join(", ")} — Fill the base, then paint the rest`);
    renderSidebar();
    renderInspector();
    vp.render();
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }

  function assignRole(terrain: Terrain, mask: number): void {
    if (!L.activeRef) { setStatus("Pick a palette tile first, then click a slot"); return; }
    mutate(() => { terrain.roles[mask] = L.activeRef!; });
    const d = doc();
    if (d) reflowTerrain(d);
    renderInspector();
  }

  function recomputeCollision(d: StageDoc): void {
    const project = getProject();
    const blockedByRef = new Map<string, boolean>();
    for (const ts of project.tilesets) for (const t of ts.tiles) blockedByRef.set(`${ts.id}/${t.id}`, t.blocked);
    mutate(() => {
      for (let y = 0; y < d.rows; y++) {
        for (let x = 0; x < d.cols; x++) {
          let blocked = false;
          for (const layer of d.layers) {
            const ref = layer.data[y][x];
            if (ref && blockedByRef.get(ref)) { blocked = true; break; }
          }
          d.collision[y][x] = blocked;
        }
      }
      // Blocking object footprints also occupy collision cells.
      for (const o of d.objects) {
        if (!o.blocking) continue;
        for (let y = o.y; y < o.y + o.h && y < d.rows; y++)
          for (let x = o.x; x < o.x + o.w && x < d.cols; x++)
            if (y >= 0 && x >= 0) d.collision[y][x] = true;
      }
    });
    setStatus("Collisions recomputed from tiles + blocking objects");
    vp.render();
  }

  // ---- Inspector ---------------------------------------------------------
  function renderInspector(): void {
    clear(inspector);
    const d = doc();
    if (!d) { inspector.append(el("div.hint", {}, "Create a stage to begin. Build tilesets in Tile Studio first.")); return; }

    inspector.append(el("div.section", {},
      el("h3", {}, "Stage"),
      textField("Name", d.name, (v) => mutate(() => (d.name = v))),
      el("div.btn-row", {},
        numberField("Cols", d.cols, (v) => resizeStage(d, Math.max(1, v), d.rows), { min: 1, width: 56 }),
        numberField("Rows", d.rows, (v) => resizeStage(d, d.cols, Math.max(1, v)), { min: 1, width: 56 })),
      numberField("Tile size", d.tileSize, (v) => { mutate(() => (d.tileSize = v)); vp.fit(d.cols * d.tileSize, d.rows * d.tileSize); }, { min: 1, width: 64 })));

    inspector.append(el("div.section", {},
      el("h3", {}, "Tools"),
      el("div.btn-row", {},
        ...(["paint", "erase", "fill", "rect", "object", "terrain", "collision"] as Tool[]).map((t) =>
          button(t, () => { L.tool = t; renderInspector(); }, L.tool === t ? "active" : ""))),
      el("div.btn-row", { style: { marginTop: "6px", alignItems: "center" } },
        el("span.field-label", {}, "Brush"),
        ...[0, 1, 2, 3].map((r) => button(r === 0 ? "1×1" : `${r * 2 + 1}²`, () => { L.brushRadius = r; renderInspector(); }, L.brushRadius === r ? "active sm" : "sm")),
        button(L.brushShape === "circle" ? "● round" : "■ square", () => { L.brushShape = L.brushShape === "circle" ? "square" : "circle"; renderInspector(); }, "sm")),
      el("div.btn-row", { style: { marginTop: "6px" } },
        checkbox("Grid", L.showGrid, (b) => { L.showGrid = b; vp.render(); }),
        checkbox("Show collision", L.showCollision, (b) => { L.showCollision = b; vp.render(); }),
        checkbox(`🎲 Scatter (${L.scatterRefs.length})`, L.scatter, (b) => { L.scatter = b; renderInspector(); })),
      el("div.hint", {}, "Paint/fill/rect place 1-cell tiles. Object stamps a multi-cell decoration at true proportions (◳ tiles switch here automatically). Terrain auto-picks edge/corner tiles from neighbours (set one up in Terrains below). Scatter: shift-click several tiles, then paint/fill randomly among them. Collision = drag to toggle blocked cells.")));

    // Layers
    const layerList = el("div.list");
    d.layers.forEach((layer, i) => {
      layerList.append(el("div.list-item" + (i === L.activeLayer ? ".active" : ""),
        { onclick: () => { L.activeLayer = i; renderInspector(); } },
        el("input", { type: "checkbox", checked: layer.visible, onclick: (e: Event) => { e.stopPropagation(); mutate(() => (layer.visible = (e.target as HTMLInputElement).checked)); vp.render(); } }),
        el("div.name", {}, layer.name),
        button("↑", (e: Event) => { e.stopPropagation(); moveLayer(d, i, -1); }, "sm"),
        button("✕", (e: Event) => { e.stopPropagation(); if (d.layers.length > 1) { mutate(() => d.layers.splice(i, 1)); L.activeLayer = 0; refreshCanvasInspector(); } }, "sm danger")));
    });
    inspector.append(el("div.section", {},
      el("h3", {}, "Layers"),
      layerList,
      el("div.btn-row", { style: { marginTop: "6px" } },
        button("+ Layer", () => { mutate(() => d.layers.push({ id: uid("ly"), name: `layer-${d.layers.length + 1}`, visible: true, data: makeGrid(d.cols, d.rows, null) })); refreshCanvasInspector(); }),
        button("Rename", () => { const layer = d.layers[L.activeLayer]; const n = prompt("Layer name", layer.name); if (n) { mutate(() => (layer.name = n)); renderInspector(); } }, "sm"))));

    // Terrains (autotiling)
    inspector.append(renderTerrainsSection(d));

    // Collision
    inspector.append(el("div.section", {},
      el("h3", {}, "Collisions"),
      button("Recompute from tile flags", () => recomputeCollision(d)),
      button("Clear collisions", () => { mutate(() => (d.collision = makeGrid(d.cols, d.rows, false))); vp.render(); }, "sm")));

    // Objects
    const objList = el("div.list");
    d.objects.forEach((o) => {
      objList.append(el("div.list-item" + (o.id === L.selectedObjectId ? ".active" : ""),
        { onclick: () => { L.selectedObjectId = o.id; refreshCanvasInspector(); } },
        el("div.name", {}, `${o.key} @${o.x},${o.y}`),
        el("span.meta", {}, `${o.w}×${o.h}`),
        button("✕", (e: Event) => { e.stopPropagation(); mutate(() => (d.objects = d.objects.filter((x) => x.id !== o.id))); if (L.selectedObjectId === o.id) L.selectedObjectId = null; refreshCanvasInspector(); }, "sm danger")));
    });
    inspector.append(el("div.section", {},
      el("h3", {}, "Objects"),
      el("div.hint", {}, "Use the object tool, then click the map to stamp the selected palette tile at its true proportions. Click an object to select/move it."),
      objList,
      button("+ Marker object", () => addObject(d)),
      renderObjectEditor(d)));

    inspector.append(el("div.section", {},
      el("h3", {}, "Export"),
      button("⬇ Export stage (JSON + tilesets + preview)", () => exportStage(d), "primary"),
      el("div.hint", {}, "Self-contained zip: stage.json, referenced tileset PNG+JSON, ascii map, preview PNG.")));
  }

  function renderObjectEditor(d: StageDoc): HTMLElement {
    const sel = d.objects.find((o) => o.id === L.selectedObjectId) ?? d.objects[d.objects.length - 1];
    if (!sel) return el("div.hint", {}, "No objects yet.");
    return el("div", { style: { marginTop: "6px" } },
      el("div.hint", {}, `Editing: ${sel.key}`),
      textField("Key", sel.key, (v) => mutate(() => (sel.key = v))),
      el("div.btn-row", {},
        numberField("X", sel.x, (v) => { mutate(() => (sel.x = v)); vp.render(); }, { width: 48 }),
        numberField("Y", sel.y, (v) => { mutate(() => (sel.y = v)); vp.render(); }, { width: 48 }),
        numberField("W", sel.w, (v) => { mutate(() => (sel.w = v)); vp.render(); }, { width: 44 }),
        numberField("H", sel.h, (v) => { mutate(() => (sel.h = v)); vp.render(); }, { width: 44 })),
      checkbox("Blocking footprint", sel.blocking, (b) => { mutate(() => (sel.blocking = b)); vp.render(); }));
  }

  /** Topmost object whose footprint covers cell (x,y), preferring later-drawn. */
  function topObjectAt(d: StageDoc, x: number, y: number): PlacedObject | null {
    for (let i = d.objects.length - 1; i >= 0; i--) {
      const o = d.objects[i];
      if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return o;
    }
    return null;
  }

  /** Stamp the active palette tile as an object at its native cell footprint,
   * anchored so its base row sits on the clicked cell (top-down trees etc). */
  function placeObject(d: StageDoc, cx: number, cy: number): void {
    if (!L.activeRef) { setStatus("Pick a palette tile first"); return; }
    const m = L.refMeta.get(L.activeRef) ?? { cellsW: 1, cellsH: 1, blocked: false };
    const w = m.cellsW, h = m.cellsH;
    const x = Math.max(0, Math.min(d.cols - w, cx - (w >> 1)));
    const y = Math.max(0, Math.min(d.rows - h, cy - (h - 1)));
    const key = L.activeRef.split("/")[1] ?? "object";
    const o: PlacedObject = { id: uid("obj"), key, tileRef: L.activeRef, x, y, w, h, blocking: m.blocked };
    mutate(() => d.objects.push(o));
    L.selectedObjectId = o.id;
    setStatus(`Placed ${key} (${w}×${h})`);
    refreshCanvasInspector();
  }

  function addObject(d: StageDoc): void {
    const o: PlacedObject = { id: uid("obj"), key: "marker", x: Math.floor(d.cols / 2), y: Math.floor(d.rows / 2), w: 2, h: 2, blocking: true };
    mutate(() => d.objects.push(o));
    L.selectedObjectId = o.id;
    refreshCanvasInspector();
  }

  function moveLayer(d: StageDoc, i: number, dir: number): void {
    const j = i + dir;
    if (j < 0 || j >= d.layers.length) return;
    mutate(() => { const [m] = d.layers.splice(i, 1); d.layers.splice(j, 0, m); });
    L.activeLayer = j;
    refreshCanvasInspector();
  }

  async function exportStage(d: StageDoc): Promise<void> {
    setStatus("Packing stage…");
    const project = getProject();
    const manifest = buildStageManifest(d, project);
    const entries = [textEntry(`${slug(d.name)}.stage.json`, JSON.stringify(manifest, null, 2))];

    // Bundle referenced tilesets (PNG + JSON) so the stage is self-contained.
    for (const ref of manifest.tilesets) {
      const ts = project.tilesets.find((t) => t.id === ref.id);
      if (!ts || !ts.sourceId) continue;
      const keyed = await getKeyedCanvas(ts.sourceId, ts.chroma);
      const { atlas, manifest: tm } = packTileset(ts, keyed);
      tm.image = ref.image;
      entries.push(await blobEntry(ref.image, await canvasToBlob(atlas)));
      entries.push(textEntry(ref.manifest, JSON.stringify(tm, null, 2)));
    }

    // Preview PNG of the composited stage.
    const preview = renderPreview(d);
    entries.push(await blobEntry(`${slug(d.name)}-preview.png`, await canvasToBlob(preview)));

    downloadBlob(buildZip(entries), `${slug(d.name)}-stage.zip`);
    setStatus(`Exported stage ${d.name} (${manifest.tilesets.length} tilesets bundled)`);
  }

  function renderPreview(d: StageDoc): HTMLCanvasElement {
    const ts = d.tileSize;
    const c = newCanvas(d.cols * ts, d.rows * ts);
    const g = ctx2d(c);
    g.fillStyle = "#0e1116";
    g.fillRect(0, 0, c.width, c.height);
    for (const layer of d.layers) {
      if (!layer.visible) continue;
      for (let y = 0; y < d.rows; y++)
        for (let x = 0; x < d.cols; x++) {
          const ref = layer.data[y][x];
          const img = ref && L.tileImg.get(ref);
          if (img) g.drawImage(img, 0, 0, img.width, img.height, x * ts, y * ts, ts, ts);
        }
    }
    // Objects on top, y-sorted (matches the editor's depth order).
    for (const o of [...d.objects].sort((a, b) => a.y + a.h - (b.y + b.h))) {
      const img = o.tileRef ? L.tileImg.get(o.tileRef) : null;
      if (img) g.drawImage(img, 0, 0, img.width, img.height, o.x * ts, o.y * ts, o.w * ts, o.h * ts);
    }
    return c;
  }

  function refreshCanvasInspector(): void { renderInspector(); renderSidebar(); vp.render(); }
  function refreshAll(): void {
    ensureTileImages().then(() => {
      renderSidebar();
      renderInspector();
      const d = doc();
      if (d) vp.fit(d.cols * d.tileSize, d.rows * d.tileSize);
      else vp.render();
    });
  }

  refreshAll();

  return {
    refresh: () => {
      if (!getProject().stages.some((s) => s.id === L.stageId)) L.stageId = getProject().stages[0]?.id ?? null;
      refreshAll();
    },
    unmount: () => { vp.destroy(); root.replaceChildren(); }
  };
}
