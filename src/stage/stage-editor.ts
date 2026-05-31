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

type Tool = "paint" | "erase" | "fill" | "rect" | "collision";

interface Local {
  stageId: string | null;
  tool: Tool;
  activeRef: string | null; // "<tilesetId>/<tileId>"
  activeLayer: number;
  tileImg: Map<string, HTMLCanvasElement>;
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
    if (L.tool === "fill") {
      if (isDown && layer) floodFill(layer, c.x, c.y, L.activeRef);
      return;
    }
    // paint / erase (drag-and-drop placement)
    if (!layer) return;
    const ref = L.tool === "erase" ? null : L.activeRef;
    if (layer.data[c.y][c.x] !== ref) mutate(() => (layer.data[c.y][c.x] = ref));
    vp.render();
  }

  function onPaintEnd(wx: number, wy: number): void {
    const d = doc();
    if (!d || L.tool !== "rect" || !L.rectStart) return;
    const c = cellAt(d, wx, wy) ?? L.rectStart;
    const layer = d.layers[L.activeLayer];
    const x0 = Math.min(L.rectStart.x, c.x), x1 = Math.max(L.rectStart.x, c.x);
    const y0 = Math.min(L.rectStart.y, c.y), y1 = Math.max(L.rectStart.y, c.y);
    mutate(() => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) layer.data[y][x] = L.activeRef;
    });
    L.rectStart = null;
    vp.render();
  }

  function floodFill(layer: StageLayer, x: number, y: number, ref: string | null): void {
    const target = layer.data[y][x];
    if (target === ref) return;
    const stack = [[x, y]];
    mutate(() => {
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= layer.data[0].length || cy >= layer.data.length) continue;
        if (layer.data[cy][cx] !== target) continue;
        layer.data[cy][cx] = ref;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    });
    vp.render();
  }

  // ---- Tile thumbnails ---------------------------------------------------
  async function ensureTileImages(): Promise<void> {
    const project = getProject();
    L.tileImg.clear();
    for (const ts of project.tilesets) {
      if (!ts.sourceId) continue;
      const keyed = await getKeyedCanvas(ts.sourceId, ts.chroma);
      for (const tile of ts.tiles) {
        const ix = Math.max(0, tile.x + ts.grid.inset);
        const iy = Math.max(0, tile.y + ts.grid.inset);
        const iw = Math.max(1, tile.w - ts.grid.inset * 2);
        const ih = Math.max(1, tile.h - ts.grid.inset * 2);
        const cell = cropCanvas(keyed, ix, iy, iw, ih);
        const thumb = newCanvas(64, 64);
        const g = ctx2d(thumb);
        g.drawImage(cell, 0, 0, iw, ih, 0, 0, 64, 64);
        L.tileImg.set(`${ts.id}/${tile.id}`, thumb);
      }
    }
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

    // objects
    for (const o of d.objects) {
      g.strokeStyle = o.blocking ? "#ff8d6b" : "#7ee0a0";
      g.lineWidth = 2 / vp.scale;
      g.strokeRect(o.x * ts, o.y * ts, o.w * ts, o.h * ts);
      g.fillStyle = "rgba(0,0,0,0.5)";
      const fs = 11 / vp.scale;
      g.font = `${fs}px monospace`;
      g.fillStyle = "#fff";
      g.fillText(o.key, o.x * ts + 2 / vp.scale, o.y * ts + fs);
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
        const sw = el("div.swatch" + (L.activeRef === ref ? ".active" : ""), {
          title: tile.name + (tile.blocked ? " (blocks)" : ""),
          onclick: () => { L.activeRef = ref; L.tool = "paint"; renderInspector(); renderSidebar(); }
        });
        const img = L.tileImg.get(ref);
        if (img) { const c = img.cloneNode() as HTMLCanvasElement; c.getContext("2d")!.drawImage(img, 0, 0); sw.append(c); }
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
    });
    setStatus("Collisions recomputed from tile flags");
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
        ...(["paint", "erase", "fill", "rect", "collision"] as Tool[]).map((t) =>
          button(t, () => { L.tool = t; renderInspector(); }, L.tool === t ? "active" : ""))),
      el("div.btn-row", { style: { marginTop: "6px" } },
        checkbox("Grid", L.showGrid, (b) => { L.showGrid = b; vp.render(); }),
        checkbox("Show collision", L.showCollision, (b) => { L.showCollision = b; vp.render(); })),
      el("div.hint", {}, "Paint = drag tiles on. Rect = drag a filled box. Collision = drag to toggle blocked cells.")));

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

    // Collision
    inspector.append(el("div.section", {},
      el("h3", {}, "Collisions"),
      button("Recompute from tile flags", () => recomputeCollision(d)),
      button("Clear collisions", () => { mutate(() => (d.collision = makeGrid(d.cols, d.rows, false))); vp.render(); }, "sm")));

    // Objects
    const objList = el("div.list");
    d.objects.forEach((o) => {
      objList.append(el("div.list-item", {},
        el("div.name", {}, `${o.key} @${o.x},${o.y}`),
        el("span.meta", {}, `${o.w}×${o.h}`),
        button("✕", () => { mutate(() => (d.objects = d.objects.filter((x) => x.id !== o.id))); refreshCanvasInspector(); }, "sm danger")));
    });
    inspector.append(el("div.section", {},
      el("h3", {}, "Objects"),
      objList,
      button("+ Object at center", () => addObject(d)),
      renderObjectEditor(d)));

    inspector.append(el("div.section", {},
      el("h3", {}, "Export"),
      button("⬇ Export stage (JSON + tilesets + preview)", () => exportStage(d), "primary"),
      el("div.hint", {}, "Self-contained zip: stage.json, referenced tileset PNG+JSON, ascii map, preview PNG.")));
  }

  function renderObjectEditor(d: StageDoc): HTMLElement {
    const last = d.objects[d.objects.length - 1];
    if (!last) return el("div.hint", {}, "Objects mark props/structures and their blocking footprint.");
    return el("div", { style: { marginTop: "6px" } },
      el("div.hint", {}, "Edit last object:"),
      textField("Key", last.key, (v) => mutate(() => (last.key = v))),
      el("div.btn-row", {},
        numberField("X", last.x, (v) => { mutate(() => (last.x = v)); vp.render(); }, { width: 48 }),
        numberField("Y", last.y, (v) => { mutate(() => (last.y = v)); vp.render(); }, { width: 48 }),
        numberField("W", last.w, (v) => { mutate(() => (last.w = v)); vp.render(); }, { width: 44 }),
        numberField("H", last.h, (v) => { mutate(() => (last.h = v)); vp.render(); }, { width: 44 })),
      checkbox("Blocking footprint", last.blocking, (b) => { mutate(() => (last.blocking = b)); vp.render(); }));
  }

  function addObject(d: StageDoc): void {
    const o: PlacedObject = { id: uid("obj"), key: "prop", x: Math.floor(d.cols / 2), y: Math.floor(d.rows / 2), w: 2, h: 2, blocking: true };
    mutate(() => d.objects.push(o));
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
