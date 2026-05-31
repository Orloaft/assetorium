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
import type { Terrain } from "../core/types";

type Tool = "paint" | "erase" | "fill" | "rect" | "collision" | "object" | "terrain";

interface RefMeta {
  cellsW: number;
  cellsH: number;
  blocked: boolean;
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
      mutate(() => (d.collision[c.y][c.x] = L.collisionPaintValue));
      vp.render();
      return;
    }
    if (L.tool === "terrain") {
      if (!layer || !L.activeTerrainId) { if (isDown) setStatus("Pick or create a terrain first"); return; }
      ensureTerrainGrid(layer, d);
      if (layer.terrain![c.y][c.x] !== L.activeTerrainId) {
        mutate(() => { layer.terrain![c.y][c.x] = L.activeTerrainId; });
        resolveAround(d, layer, c.x, c.y);
        vp.render();
      }
      return;
    }
    if (L.tool === "fill") {
      if (isDown && layer) floodFill(layer, c.x, c.y);
      return;
    }
    // paint / erase (drag-and-drop placement)
    if (!layer) return;
    const ref = L.tool === "erase" ? null : pickRef();
    if (layer.data[c.y][c.x] !== ref) mutate(() => (layer.data[c.y][c.x] = ref));
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

  /** Re-resolve a cell and its 8 neighbours from terrain membership, writing the
   * resolved autotile into the visible tile layer. */
  function resolveAround(d: StageDoc, layer: StageLayer, cx: number, cy: number): void {
    const terrains = getProject().terrains;
    mutate(() => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= d.cols || y >= d.rows) continue;
          const tid = layer.terrain?.[y]?.[x];
          if (!tid) continue;
          const terrain = terrains.find((t) => t.id === tid);
          if (!terrain) continue;
          const ref = resolveCell(terrain, layer.terrain!, x, y, d.cols, d.rows);
          if (ref) layer.data[y][x] = ref;
        }
      }
    });
  }

  /** Re-resolve every terrain cell on a layer (after a role assignment changes). */
  function reflowTerrain(d: StageDoc): void {
    const terrains = getProject().terrains;
    mutate(() => {
      for (const layer of d.layers) {
        if (!layer.terrain) continue;
        for (let y = 0; y < d.rows; y++)
          for (let x = 0; x < d.cols; x++) {
            const tid = layer.terrain[y]?.[x];
            if (!tid) continue;
            const terrain = terrains.find((t) => t.id === tid);
            if (!terrain) continue;
            const ref = resolveCell(terrain, layer.terrain, x, y, d.cols, d.rows);
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
        L.tileImg.set(ref, cropCanvas(keyed, ix, iy, iw, ih));
        L.refMeta.set(ref, {
          cellsW: Math.max(1, Math.round(iw / unit)),
          cellsH: Math.max(1, Math.round(ih / unit)),
          blocked: tile.blocked
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
      g.strokeStyle = "#ffcf6b";
      g.lineWidth = 2 / vp.scale;
      g.strokeRect(L.hover.x * ts, L.hover.y * ts, ts, ts);
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
        if (big) sw.append(el("span.badge", { style: { left: "-2px", right: "auto", color: "#7ee0a0" } }, "◳"));
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
    for (const t of project.terrains) {
      list.append(el("div.list-item" + (t.id === L.activeTerrainId ? ".active" : ""),
        { onclick: () => { L.activeTerrainId = t.id; L.tool = "terrain"; renderInspector(); } },
        el("div.name", {}, t.name),
        el("span.meta", {}, `${Object.keys(t.roles).length}/16`),
        button("✕", (e: Event) => { e.stopPropagation(); mutate(() => (project.terrains = project.terrains.filter((x) => x.id !== t.id))); if (L.activeTerrainId === t.id) L.activeTerrainId = null; refreshCanvasInspector(); }, "sm danger")));
    }
    sec.append(list, el("div.btn-row", { style: { marginTop: "6px" } }, button("+ Terrain", () => newTerrain())));

    const terrain = project.terrains.find((t) => t.id === L.activeTerrainId);
    if (terrain) {
      sec.append(el("div.hint", { style: { margin: "6px 0" } },
        "Click a palette tile, then click a slot below to assign it to that edge pattern. Then use the terrain tool to paint — borders & corners resolve automatically. Right-click a slot to clear."));
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

  function newTerrain(): void {
    const project = getProject();
    const tilesetId = (L.activeRef && L.activeRef.split("/")[0]) || project.tilesets[0]?.id;
    if (!tilesetId) { setStatus("Create a tileset first"); return; }
    const t: Terrain = { id: uid("terr"), name: `terrain-${project.terrains.length + 1}`, tilesetId, kind: "edge16", roles: {} };
    mutate(() => project.terrains.push(t));
    L.activeTerrainId = t.id;
    L.tool = "terrain";
    setStatus("Terrain created — assign tiles to the 16 edge slots");
    refreshCanvasInspector();
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
