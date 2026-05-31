import type { Editor } from "../main";
import { el, button, numberField, textField, checkbox, select, clear } from "../core/dom";
import { getProject, mutate, setStatus, slug } from "../core/store";
import { sourcePicker } from "../core/sources";
import { getKeyedCanvas, uid, cropCanvas, canvasToBlob } from "../core/image";
import { Viewport } from "../core/viewport";
import { DIRECTIONS, defaultChroma } from "../core/types";
import type { SpriteDoc, FrameBox, AnimationClip, Direction } from "../core/types";
import { sliceGrid, detectFrames } from "./slicer";
import { packSprite } from "./pack";
import { Animator } from "./animator";
import { buildZip, textEntry, blobEntry } from "../core/zip";
import { downloadBlob } from "../core/download";

type Tool = "select" | "draw";

interface Local {
  spriteId: string | null;
  tool: Tool;
  selection: string[]; // ordered frame ids
  activeClipId: string | null;
  activeRowDir: Direction | "all" | null;
  grid: { offsetX: number; offsetY: number; cols: number; rows: number; cellW: number; cellH: number; spacing: number };
  detect: { minSize: number; rowTolerance: number; pad: number };
  keyed: HTMLCanvasElement | null;
  keyedKey: string;
  dragBox: FrameBox | null;
  previewFps: number;
  previewZoom: number;
}

export function mountSpriteStudio(root: HTMLElement): Editor {
  const L: Local = {
    spriteId: getProject().sprites[0]?.id ?? null,
    tool: "select",
    selection: [],
    activeClipId: null,
    activeRowDir: null,
    grid: { offsetX: 0, offsetY: 0, cols: 4, rows: 4, cellW: 64, cellH: 64, spacing: 0 },
    detect: { minSize: 12, rowTolerance: 24, pad: 1 },
    keyed: null,
    keyedKey: "",
    dragBox: null,
    previewFps: 8,
    previewZoom: 3
  };

  const workspace = el("div.workspace");
  const sidebar = el("div.sidebar");
  const canvasWrap = el("div.canvas-wrap");
  const inspector = el("div.inspector");
  workspace.append(sidebar, canvasWrap, inspector);
  root.append(workspace);

  const animator = new Animator();

  const doc = (): SpriteDoc | null => getProject().sprites.find((s) => s.id === L.spriteId) ?? null;

  const vp = new Viewport({
    draw: (g) => drawScene(g),
    onPointerDown: (p) => {
      const d = doc();
      if (!d) return;
      if (L.tool === "draw") {
        L.dragBox = { id: "drag", x: Math.round(p.worldX), y: Math.round(p.worldY), w: 0, h: 0 };
      } else {
        const hit = hitFrame(d, p.worldX, p.worldY);
        if (hit) toggleSelection(hit.id);
      }
    },
    onPointerMove: (p) => {
      if (L.tool === "draw" && L.dragBox) {
        L.dragBox.w = Math.round(p.worldX) - L.dragBox.x;
        L.dragBox.h = Math.round(p.worldY) - L.dragBox.y;
        vp.render();
      }
    },
    onPointerUp: () => {
      const d = doc();
      if (L.tool === "draw" && L.dragBox && d) {
        let { x, y, w, h } = L.dragBox;
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        if (w > 2 && h > 2) {
          mutate(() => d.frames.push({ id: uid("f"), x, y, w, h }));
          setStatus(`Added frame (${d.frames.length})`);
        }
        L.dragBox = null;
        renderInspector();
        vp.render();
      }
    },
    onContextMenu: (p) => {
      const d = doc();
      if (!d) return;
      const hit = hitFrame(d, p.worldX, p.worldY);
      if (hit) deleteFrames([hit.id]);
    }
  });
  vp.mount(canvasWrap);

  // Delete / Backspace removes the currently selected frames (unless typing).
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (L.selection.length) {
      e.preventDefault();
      deleteFrames([...L.selection]);
    }
  };
  window.addEventListener("keydown", onKey);

  function hitFrame(d: SpriteDoc, wx: number, wy: number): FrameBox | null {
    for (let i = d.frames.length - 1; i >= 0; i--) {
      const f = d.frames[i];
      if (wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h) return f;
    }
    return null;
  }

  function toggleSelection(id: string): void {
    const i = L.selection.indexOf(id);
    if (i >= 0) L.selection.splice(i, 1);
    else L.selection.push(id);
    renderInspector();
    vp.render();
  }

  /** Remove frames from the document and from any animation rows referencing
   * them. Used by right-click, the Delete key, and the toolbar button. */
  function deleteFrames(ids: string[]): void {
    const d = doc();
    if (!d || !ids.length) return;
    const set = new Set(ids);
    mutate(() => {
      d.frames = d.frames.filter((f) => !set.has(f.id));
      for (const clip of d.clips) for (const row of clip.rows) row.frames = row.frames.filter((fid) => !set.has(fid));
    });
    L.selection = L.selection.filter((id) => !set.has(id));
    setStatus(`Deleted ${set.size} frame${set.size === 1 ? "" : "s"} · ${d.frames.length} left`);
    refreshCanvasInspector();
  }

  function drawScene(g: CanvasRenderingContext2D): void {
    if (!L.keyed) return;
    const w = L.keyed.width;
    const h = L.keyed.height;
    vp.drawCheckerboard(g, w, h, 8);
    g.drawImage(L.keyed, 0, 0);
    const d = doc();
    if (!d) return;
    const lw = 1 / vp.scale;
    d.frames.forEach((f, i) => {
      const selIdx = L.selection.indexOf(f.id);
      g.lineWidth = lw;
      g.strokeStyle = selIdx >= 0 ? "#7ee0a0" : "#5db0ff";
      g.strokeRect(f.x + lw / 2, f.y + lw / 2, f.w - lw, f.h - lw);
      if (selIdx >= 0) {
        g.fillStyle = "rgba(126,224,160,0.18)";
        g.fillRect(f.x, f.y, f.w, f.h);
      }
      // index label
      g.fillStyle = "rgba(0,0,0,0.6)";
      const fs = 10 / vp.scale;
      g.font = `${fs}px monospace`;
      const label = selIdx >= 0 ? `${i}·#${selIdx + 1}` : `${i}`;
      g.fillRect(f.x, f.y, g.measureText(label).width + 4 / vp.scale, fs + 2 / vp.scale);
      g.fillStyle = "#fff";
      g.fillText(label, f.x + 2 / vp.scale, f.y + fs);
    });
    if (L.dragBox) {
      g.strokeStyle = "#ffcf6b";
      g.lineWidth = lw;
      let { x, y, w: bw, h: bh } = L.dragBox;
      g.strokeRect(x, y, bw, bh);
    }
  }

  async function reloadKeyed(): Promise<void> {
    const d = doc();
    if (!d || !d.sourceId) {
      L.keyed = null;
      L.keyedKey = "";
      vp.render();
      return;
    }
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

    const project = getProject();
    const list = el("div.list");
    for (const s of project.sprites) {
      list.append(
        el(
          "div.list-item" + (s.id === L.spriteId ? ".active" : ""),
          { onclick: () => selectSprite(s.id) },
          el("div.name", {}, s.name),
          el("span.meta", {}, `${s.frames.length}f`),
          button("✕", (e: Event) => { e.stopPropagation(); deleteSprite(s.id); }, "sm danger")
        )
      );
    }
    sidebar.append(
      el(
        "div.section",
        {},
        el("h3", {}, "Sprites"),
        list,
        el("div.btn-row", { style: { marginTop: "8px" } }, button("+ New sprite", newSprite, "primary"))
      )
    );
  }

  function newSprite(): void {
    const d: SpriteDoc = {
      id: uid("spr"),
      name: `sprite-${getProject().sprites.length + 1}`,
      sourceId: getProject().sources[0]?.id ?? null,
      chroma: defaultChroma(),
      anchor: { x: 0.5, y: 1.0 },
      trim: true,
      frames: [],
      clips: []
    };
    mutate((p) => p.sprites.push(d));
    selectSprite(d.id);
  }

  function deleteSprite(id: string): void {
    mutate((p) => (p.sprites = p.sprites.filter((s) => s.id !== id)));
    if (L.spriteId === id) L.spriteId = getProject().sprites[0]?.id ?? null;
    refreshAll();
  }

  function selectSprite(id: string): void {
    L.spriteId = id;
    L.selection = [];
    L.activeClipId = null;
    L.activeRowDir = null;
    refreshAll();
  }

  function bindSource(id: string): void {
    const d = doc();
    if (!d) { newSprite(); }
    const dd = doc();
    if (dd) mutate(() => (dd.sourceId = id));
    refreshAll();
  }

  // ---- Inspector ---------------------------------------------------------
  function renderInspector(): void {
    clear(inspector);
    const d = doc();
    if (!d) {
      inspector.append(el("div.hint", {}, "Create a sprite and pick a source image to begin."));
      return;
    }

    inspector.append(
      el(
        "div.section",
        {},
        el("h3", {}, "Sprite"),
        textField("Name", d.name, (v) => mutate(() => (d.name = v))),
        select<Tool>("Tool", L.tool, [
          { value: "select", label: "Select frames" },
          { value: "draw", label: "Draw box" }
        ], (v) => { L.tool = v; renderInspector(); }),
        el("div.hint", {}, "Wheel = zoom · middle/Space-drag = pan · right-click a frame to delete it.")
      )
    );

    // Chroma
    const tolRow = el("div.range-row", {},
      el("input", { type: "range", min: 0, max: 180, value: String(d.chroma.tolerance),
        oninput: (e: Event) => { mutate(() => (d.chroma.tolerance = Number((e.target as HTMLInputElement).value))); reloadKeyed().then(() => vp.render()); } }),
      el("span.tag", {}, String(d.chroma.tolerance)));
    const fringe = d.chroma.fringe ?? 24;
    const fringeRow = el("div.range-row", {},
      el("input", { type: "range", min: 0, max: 120, value: String(fringe),
        oninput: (e: Event) => { mutate(() => (d.chroma.fringe = Number((e.target as HTMLInputElement).value))); reloadKeyed().then(() => { vp.render(); renderInspector(); }); } }),
      el("span.tag", {}, String(fringe)));
    inspector.append(
      el("div.section", {},
        el("h3", {}, "Background removal (magenta)"),
        checkbox("Key out magenta", d.chroma.enabled, (b) => { mutate(() => (d.chroma.enabled = b)); reloadKeyed().then(() => vp.render()); }),
        el("div.field", {}, el("span.field-label", {}, "Tolerance"), tolRow),
        el("div.field", {}, el("span.field-label", {}, "Fringe cleanup"), fringeRow),
        el("div.hint", {}, "Tolerance removes bright magenta. Fringe cleanup removes dark anti-aliased magenta edges (hue-based) the tolerance can't reach."))
    );

    // Anchor / trim
    inspector.append(
      el("div.section", {},
        el("h3", {}, "Alignment"),
        el("div.btn-row", {},
          numberField("Anchor X", d.anchor.x, (v) => mutate(() => (d.anchor.x = v)), { min: 0, max: 1, step: 0.5, width: 56 }),
          numberField("Anchor Y", d.anchor.y, (v) => mutate(() => (d.anchor.y = v)), { min: 0, max: 1, step: 0.5, width: 56 })),
        checkbox("Trim transparent margins", d.trim, (b) => mutate(() => (d.trim = b))),
        el("div.hint", {}, "Anchor (0.5, 1.0) = feet-center for top-down. Frames are aligned to this point so the animation doesn't jitter."))
    );

    // Slicing
    const G = L.grid;
    inspector.append(
      el("div.section", {},
        el("h3", {}, "Slice into frames"),
        el("div.btn-row", {},
          numberField("Cols", G.cols, (v) => (G.cols = v), { min: 1, width: 50 }),
          numberField("Rows", G.rows, (v) => (G.rows = v), { min: 1, width: 50 })),
        el("div.btn-row", {},
          numberField("Cell W", G.cellW, (v) => (G.cellW = v), { min: 1, width: 56 }),
          numberField("Cell H", G.cellH, (v) => (G.cellH = v), { min: 1, width: 56 })),
        el("div.btn-row", {},
          numberField("Off X", G.offsetX, (v) => (G.offsetX = v), { width: 50 }),
          numberField("Off Y", G.offsetY, (v) => (G.offsetY = v), { width: 50 }),
          numberField("Gap", G.spacing, (v) => (G.spacing = v), { width: 44 })),
        el("div.btn-row", { style: { marginTop: "6px" } },
          button("Apply grid", () => applyGrid(), "primary"),
          button("＋ Add grid", () => applyGrid(true))),
        el("div.divider"),
        el("div.btn-row", {},
          numberField("Min size", L.detect.minSize, (v) => (L.detect.minSize = v), { min: 1, width: 56 }),
          numberField("Row tol", L.detect.rowTolerance, (v) => (L.detect.rowTolerance = v), { min: 1, width: 56 }),
          numberField("Pad", L.detect.pad, (v) => (L.detect.pad = v), { min: 0, width: 44 })),
        el("div.btn-row", { style: { marginTop: "6px" } },
          button("Auto-detect frames", () => autoDetect(), "primary"),
          button(`🗑 Delete selected (${L.selection.length})`, () => deleteFrames([...L.selection]), L.selection.length ? "danger" : ""),
          button("Clear frames", () => { mutate(() => { d.frames = []; }); L.selection = []; refreshCanvasInspector(); })),
        el("div.hint", {}, `${d.frames.length} frames · ${L.selection.length} selected. In Select mode: click frames to select, then Delete key or 🗑 to remove. Right-click a frame to delete it directly.`))
    );

    // Preview — kept right under slicing so it's visible the moment you have
    // (or select) frames, before the taller clip-rigging UI.
    inspector.append(renderPreviewSection(d));

    // Animations
    inspector.append(renderClipsSection(d));

    // Export
    inspector.append(
      el("div.section", {},
        el("h3", {}, "Export"),
        button("⬇ Export sprite (PNG + JSON)", () => exportSprite(d), "primary"),
        el("div.hint", {}, "Downloads a zip: aligned sheet PNG + frames manifest."))
    );
  }

  function renderClipsSection(d: SpriteDoc): HTMLElement {
    const sec = el("div.section", {}, el("h3", {}, "Animations"));
    sec.append(
      el("div.btn-row", {},
        button("+ Clip", () => addClip(d)),
        button("⚡ Quick-rig 4-dir walk", () => quickRig(d), "primary")),
      el("div.btn-row", { style: { margin: "6px 0" } },
        button(`Assign selection (${L.selection.length}) → row`, () => assignSelection(d)),
        button("🗑 Delete", () => deleteFrames([...L.selection]), "sm danger"),
        button("Clear sel", () => { L.selection = []; refreshCanvasInspector(); }, "sm"))
    );
    for (const clip of d.clips) {
      const head = el("div.list-item" + (clip.id === L.activeClipId ? ".active" : ""),
        { onclick: () => { L.activeClipId = clip.id; renderInspector(); } },
        el("div.name", {}, clip.name),
        el("span.meta", {}, `${clip.fps}fps`),
        button("✕", (e: Event) => { e.stopPropagation(); mutate(() => (d.clips = d.clips.filter((c) => c.id !== clip.id))); refreshCanvasInspector(); }, "sm danger"));
      sec.append(head);
      if (clip.id === L.activeClipId) {
        sec.append(
          el("div.btn-row", { style: { margin: "4px 0" } },
            textField("Name", clip.name, (v) => mutate(() => (clip.name = v))),
            numberField("fps", clip.fps, (v) => mutate(() => (clip.fps = v)), { min: 1, max: 60, width: 48 }),
            checkbox("loop", clip.loop, (b) => mutate(() => (clip.loop = b)))));
        for (const row of clip.rows) {
          const active = clip.id === L.activeClipId && row.dir === L.activeRowDir;
          sec.append(
            el("div.list-item" + (active ? ".active" : ""),
              { style: { marginLeft: "10px" }, onclick: () => { L.activeRowDir = row.dir; previewRow(d, clip, row.dir); renderInspector(); } },
              el("div.name", {}, row.dir),
              el("span.meta", {}, `${row.frames.length}f`),
              button("▶", (e: Event) => { e.stopPropagation(); previewRow(d, clip, row.dir); }, "sm")));
        }
        sec.append(
          el("div.btn-row", { style: { marginLeft: "10px", marginTop: "4px" } },
            ...(["up", "right", "down", "left", "all"] as const).map((dir) =>
              button(`+${dir}`, () => addRow(d, clip, dir), "sm"))));
      }
    }
    return sec;
  }

  function renderPreviewSection(d: SpriteDoc): HTMLElement {
    const stage = el("div.anim-stage");
    stage.append(animator.canvas);
    const count = L.selection.length || d.frames.length;
    const label = L.selection.length ? `selected (${L.selection.length})` : `all (${d.frames.length})`;
    return el("div.section", {},
      el("h3", {}, "Preview"),
      stage,
      el("div.btn-row", { style: { marginTop: "6px" } },
        button(`▶ Preview ${label}`, () => previewFrames(), count ? "primary" : ""),
        numberField("fps", L.previewFps, (v) => { L.previewFps = Math.max(1, v); previewFrames(); }, { min: 1, max: 60, width: 48 })),
      el("div.btn-row", { style: { marginTop: "6px" } },
        button(animator.isPlaying() ? "⏸ Pause" : "▶ Play", () => { animator.isPlaying() ? animator.pause() : animator.play(); renderInspectorSoon(); }),
        button("－", () => { L.previewZoom = Math.max(1, L.previewZoom - 1); animator.setZoom(L.previewZoom); }, "sm"),
        button("＋", () => { L.previewZoom = Math.min(10, L.previewZoom + 1); animator.setZoom(L.previewZoom); }, "sm"),
        el("span.tag", {}, `${L.previewZoom}×`)),
      el("div.hint", {}, "Preview plays your selected frames (in click order), or all frames if none are selected. Click a clip row above to preview that animation instead."));
  }

  /** Quick scratch preview: play the selected frames (in selection order) or
   * all document frames. Independent of clips — handy before rigging. */
  function previewFrames(): void {
    const d = doc();
    if (!d || !L.keyed) return;
    const ids = L.selection.length ? L.selection : d.frames.map((f) => f.id);
    const frames = ids
      .map((id) => d.frames.find((f) => f.id === id))
      .filter((f): f is FrameBox => !!f)
      .map((f) => cropCanvas(L.keyed!, f.x, f.y, f.w, f.h));
    if (!frames.length) { setStatus("No frames to preview"); return; }
    animator.setZoom(L.previewZoom);
    animator.setFrames(frames, L.previewFps, true);
    setStatus(`Previewing ${frames.length} frames at ${L.previewFps}fps`);
  }

  // ---- Actions -----------------------------------------------------------
  function applyGrid(add = false): void {
    const d = doc();
    if (!d) return;
    const frames = sliceGrid(L.grid);
    mutate(() => { d.frames = add ? [...d.frames, ...frames] : frames; });
    L.selection = [];
    setStatus(`Sliced ${frames.length} frames`);
    refreshCanvasInspector();
  }

  async function autoDetect(): Promise<void> {
    const d = doc();
    if (!d || !L.keyed) return;
    setStatus("Detecting frames…");
    const frames = detectFrames(L.keyed, L.detect);
    mutate(() => (d.frames = frames));
    L.selection = [];
    setStatus(`Detected ${frames.length} frames`);
    refreshCanvasInspector();
  }

  function addClip(d: SpriteDoc): void {
    const clip: AnimationClip = { id: uid("clip"), name: `clip-${d.clips.length + 1}`, fps: 8, loop: true, rows: [] };
    mutate(() => d.clips.push(clip));
    L.activeClipId = clip.id;
    refreshCanvasInspector();
  }

  function addRow(_d: SpriteDoc, clip: AnimationClip, dir: Direction | "all"): void {
    if (clip.rows.some((r) => r.dir === dir)) return;
    mutate(() => clip.rows.push({ dir, frames: [] }));
    L.activeRowDir = dir;
    refreshCanvasInspector();
  }

  function assignSelection(d: SpriteDoc): void {
    const clip = d.clips.find((c) => c.id === L.activeClipId);
    if (!clip || L.activeRowDir == null) { setStatus("Pick a clip row first"); return; }
    const row = clip.rows.find((r) => r.dir === L.activeRowDir);
    if (!row) return;
    mutate(() => (row.frames = [...L.selection]));
    setStatus(`Assigned ${L.selection.length} frames to ${clip.name}/${row.dir}`);
    previewRow(d, clip, row.dir);
    refreshCanvasInspector();
  }

  function quickRig(d: SpriteDoc): void {
    if (d.frames.length < 4) { setStatus("Need at least 4 frames"); return; }
    const perDir = Math.max(1, Math.floor(d.frames.length / 4));
    const clip: AnimationClip = { id: uid("clip"), name: "walk", fps: 8, loop: true, rows: [] };
    DIRECTIONS.forEach((dir, i) => {
      const start = i * perDir;
      clip.rows.push({ dir, frames: d.frames.slice(start, start + perDir).map((f) => f.id) });
    });
    mutate(() => d.clips.push(clip));
    L.activeClipId = clip.id;
    L.activeRowDir = "down";
    previewRow(d, clip, "down");
    setStatus(`Rigged walk: ${perDir} frames × 4 directions (order up,right,down,left)`);
    refreshCanvasInspector();
  }

  function previewRow(d: SpriteDoc, clip: AnimationClip, dir: Direction | "all"): void {
    if (!L.keyed) return;
    const row = clip.rows.find((r) => r.dir === dir);
    if (!row) return;
    const frames = row.frames
      .map((id) => d.frames.find((f) => f.id === id))
      .filter((f): f is FrameBox => !!f)
      .map((f) => cropCanvas(L.keyed!, f.x, f.y, f.w, f.h));
    animator.setFrames(frames, clip.fps, clip.loop);
  }

  async function exportSprite(d: SpriteDoc): Promise<void> {
    if (!L.keyed) { setStatus("No source image"); return; }
    setStatus("Packing sprite…");
    const { sheet, manifest } = packSprite(d, L.keyed);
    const name = slug(d.name);
    manifest.image = `${name}.png`;
    const png = await canvasToBlob(sheet);
    const zip = buildZip([
      await blobEntry(`${name}.png`, png),
      textEntry(`${name}.frames.json`, JSON.stringify(manifest, null, 2))
    ]);
    downloadBlob(zip, `${name}-sprite.zip`);
    setStatus(`Exported ${name}: ${manifest.frameCount} frames, ${Object.keys(manifest.animations).length} animations`);
  }

  // ---- Refresh plumbing --------------------------------------------------
  let inspectorTimer = 0;
  function renderInspectorSoon(): void {
    window.clearTimeout(inspectorTimer);
    inspectorTimer = window.setTimeout(renderInspector, 0);
  }
  function refreshCanvasInspector(): void {
    renderInspector();
    vp.render();
  }
  function refreshAll(): void {
    // A doc created before any image was imported has no source; adopt the
    // most recently imported one so the canvas isn't mysteriously blank.
    const d0 = doc();
    const srcs = getProject().sources;
    if (d0 && !d0.sourceId && srcs.length) d0.sourceId = srcs[srcs.length - 1].id;
    reloadKeyed().then(() => {
      renderSidebar();
      renderInspector();
      vp.render();
    });
  }

  refreshAll();

  return {
    refresh: () => {
      if (!getProject().sprites.some((s) => s.id === L.spriteId)) L.spriteId = getProject().sprites[0]?.id ?? null;
      refreshAll();
    },
    unmount: () => {
      window.removeEventListener("keydown", onKey);
      animator.destroy();
      vp.destroy();
      root.replaceChildren();
    }
  };
}
