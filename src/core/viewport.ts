// A reusable pan/zoom canvas surface. The owner supplies a `draw` callback
// that paints in *world* coordinates (the viewport applies the transform), and
// optional pointer callbacks that receive world-space coordinates for tools
// (painting tiles, dragging frame boxes, etc).
//
// Controls: wheel = zoom at cursor; middle-drag or space-drag = pan; left
// pointer is forwarded to the tool callbacks.

export interface VPPointer {
  worldX: number;
  worldY: number;
  buttons: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  originalEvent: PointerEvent;
}

export interface ViewportCallbacks {
  draw: (g: CanvasRenderingContext2D, vp: Viewport) => void;
  onPointerDown?: (p: VPPointer) => void;
  onPointerMove?: (p: VPPointer) => void;
  onPointerUp?: (p: VPPointer) => void;
  onHover?: (p: VPPointer | null) => void;
}

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  scale = 1;
  originX = 0; // screen px offset of world (0,0)
  originY = 0;
  private cb: ViewportCallbacks;
  private panning = false;
  private spaceHeld = false;
  private lastX = 0;
  private lastY = 0;
  private ro: ResizeObserver;
  private rafPending = false;

  constructor(cb: ViewportCallbacks) {
    this.cb = cb;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "vp-canvas";
    const g = this.canvas.getContext("2d");
    if (!g) throw new Error("no 2d context");
    this.g = g;

    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointerleave", () => this.cb.onHover?.(null));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);

    this.ro = new ResizeObserver(() => this.resize());
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.canvas);
    this.ro.observe(parent);
    this.resize();
  }

  destroy(): void {
    this.ro.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.render();
  }

  get cssWidth(): number {
    return this.canvas.clientWidth;
  }
  get cssHeight(): number {
    return this.canvas.clientHeight;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.originX) / this.scale, y: (sy - this.originY) / this.scale };
  }

  /** Center the given world rect in the viewport with some padding. */
  fit(w: number, h: number, pad = 40): void {
    const cw = this.cssWidth || 800;
    const ch = this.cssHeight || 600;
    const s = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
    this.scale = Math.max(0.05, Math.min(40, s));
    this.originX = (cw - w * this.scale) / 2;
    this.originY = (ch - h * this.scale) / 2;
    this.render();
  }

  render = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.paint();
    });
  };

  private paint(): void {
    const dpr = window.devicePixelRatio || 1;
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingEnabled = false;
    g.save();
    g.translate(this.originX, this.originY);
    g.scale(this.scale, this.scale);
    this.cb.draw(g, this);
    g.restore();
  }

  private toPointer(e: PointerEvent): VPPointer {
    const rect = this.canvas.getBoundingClientRect();
    const world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return {
      worldX: world.x,
      worldY: world.y,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      originalEvent: e
    };
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const before = this.screenToWorld(px, py);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.scale = Math.max(0.05, Math.min(64, this.scale * factor));
    // keep the cursor anchored over the same world point
    this.originX = px - before.x * this.scale;
    this.originY = py - before.y * this.scale;
    this.render();
  };

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }
    if (e.button === 0) this.cb.onPointerDown?.(this.toPointer(e));
  };

  private onMove = (e: PointerEvent): void => {
    if (this.panning) {
      this.originX += e.clientX - this.lastX;
      this.originY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.render();
      return;
    }
    const p = this.toPointer(e);
    this.cb.onHover?.(p);
    if (e.buttons & 1) this.cb.onPointerMove?.(p);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.panning) {
      this.panning = false;
      return;
    }
    if (e.button === 0) this.cb.onPointerUp?.(this.toPointer(e));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      this.spaceHeld = e.type === "keydown";
      this.canvas.style.cursor = this.spaceHeld ? "grab" : "";
    }
  };

  /** Draw a transparency checkerboard covering a world-space rect. */
  drawCheckerboard(g: CanvasRenderingContext2D, w: number, h: number, cell = 8): void {
    const size = cell;
    g.fillStyle = "#2b2f36";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#363b44";
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if (((x / size) ^ (y / size)) & 1) g.fillRect(x, y, size, size);
      }
    }
  }
}
