// A small animation previewer: cycles a list of frame canvases at a given fps
// on a dark stage, scaled up with nearest-neighbour. Mirrors the "dark-
// background GIF preview" review step from the tib asset workflow.

export class Animator {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private frames: HTMLCanvasElement[] = [];
  private fps = 8;
  private loop = true;
  private index = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private playing = false;
  private zoom = 3;
  bg = "#0c0e12";

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 160;
    this.canvas.height = 160;
    this.g = this.canvas.getContext("2d")!;
    this.g.imageSmoothingEnabled = false;
  }

  setFrames(frames: HTMLCanvasElement[], fps: number, loop: boolean): void {
    this.frames = frames;
    this.fps = Math.max(1, fps);
    this.loop = loop;
    this.index = 0;
    this.acc = 0;
    this.fit();
    if (frames.length > 1) this.play();
    else {
      this.pause();
      this.paint();
    }
  }

  setZoom(z: number): void {
    this.zoom = z;
    this.fit();
    this.paint();
  }

  private fit(): void {
    const fw = this.frames[0]?.width ?? 32;
    const fh = this.frames[0]?.height ?? 32;
    this.canvas.width = Math.max(48, Math.ceil(fw * this.zoom));
    this.canvas.height = Math.max(48, Math.ceil(fh * this.zoom));
    this.g.imageSmoothingEnabled = false;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    const tick = (t: number): void => {
      if (!this.playing) return;
      const dt = (t - this.last) / 1000;
      this.last = t;
      this.acc += dt;
      const step = 1 / this.fps;
      while (this.acc >= step) {
        this.acc -= step;
        this.index += 1;
        if (this.index >= this.frames.length) {
          if (this.loop) this.index = 0;
          else {
            this.index = this.frames.length - 1;
            this.playing = false;
          }
        }
      }
      this.paint();
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  showFrame(i: number): void {
    this.pause();
    this.index = Math.max(0, Math.min(this.frames.length - 1, i));
    this.paint();
  }

  private paint(): void {
    const g = this.g;
    g.fillStyle = this.bg;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const f = this.frames[this.index];
    if (!f) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(f, 0, 0, f.width, f.height, 0, 0, f.width * this.zoom, f.height * this.zoom);
  }

  destroy(): void {
    this.pause();
  }
}
