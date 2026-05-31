// Image loading + canvas utilities. Source pixels are persisted as blobs in
// IndexedDB and decoded lazily; chroma-keyed full-image canvases are cached
// per tolerance so the editors can redraw cheaply.

import { idbGet, idbPut, idbDelete } from "./idb";
import { chromaKeyCanvas } from "./chroma";
import type { ChromaSettings, SourceImage } from "./types";

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  // Time-free, monotonic — fine for in-session ids; project save embeds them.
  return `${prefix}_${(performance.now() | 0).toString(36)}${idCounter.toString(36)}`;
}

const bitmapCache = new Map<string, HTMLImageElement>();
const keyedCache = new Map<string, HTMLCanvasElement>(); // key: `${id}:${tolerance}`

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D canvas context unavailable");
  g.imageSmoothingEnabled = false;
  return g;
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

/** Import a File (PNG/etc) as a source image: persist blob, return metadata. */
export async function importSourceFile(file: File): Promise<SourceImage> {
  const id = uid("src");
  const img = await blobToImage(file);
  bitmapCache.set(id, img);
  await idbPut(id, file);
  return { id, name: file.name.replace(/\.[^.]+$/, ""), width: img.naturalWidth, height: img.naturalHeight };
}

/** Import from a base64 data URL (used when loading a saved project file). */
export async function importSourceDataUrl(id: string, name: string, dataUrl: string): Promise<SourceImage> {
  const blob = await (await fetch(dataUrl)).blob();
  const img = await blobToImage(blob);
  bitmapCache.set(id, img);
  await idbPut(id, blob);
  return { id, name, width: img.naturalWidth, height: img.naturalHeight };
}

export async function getImage(id: string): Promise<HTMLImageElement> {
  const cached = bitmapCache.get(id);
  if (cached) return cached;
  const blob = await idbGet(id);
  if (!blob) throw new Error(`Source image ${id} not found`);
  const img = await blobToImage(blob);
  bitmapCache.set(id, img);
  return img;
}

export async function getSourceDataUrl(id: string): Promise<string> {
  const blob = await idbGet(id);
  if (!blob) throw new Error(`Source image ${id} not found`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function deleteSource(id: string): Promise<void> {
  bitmapCache.delete(id);
  for (const k of [...keyedCache.keys()]) if (k.startsWith(`${id}:`)) keyedCache.delete(k);
  await idbDelete(id);
}

/** A full-image canvas with chroma applied (or not), cached per tolerance. */
export async function getKeyedCanvas(id: string, chroma: ChromaSettings): Promise<HTMLCanvasElement> {
  const key = chroma.enabled ? `${id}:${chroma.tolerance}` : `${id}:raw`;
  const hit = keyedCache.get(key);
  if (hit) return hit;
  const img = await getImage(id);
  const c = newCanvas(img.naturalWidth, img.naturalHeight);
  const g = ctx2d(c);
  g.drawImage(img, 0, 0);
  if (chroma.enabled) chromaKeyCanvas(g, c.width, c.height, chroma.tolerance);
  keyedCache.set(key, c);
  return c;
}

export function invalidateKeyed(id: string): void {
  for (const k of [...keyedCache.keys()]) if (k.startsWith(`${id}:`)) keyedCache.delete(k);
}

/** Copy a sub-rectangle out of a canvas into a new canvas. */
export function cropCanvas(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = newCanvas(w, h);
  ctx2d(c).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Tight bounding box of non-transparent pixels, or null if fully empty. */
export function alphaBounds(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const g = ctx2d(c);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}
