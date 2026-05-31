// Shared "source images" UI: import button + selectable list. Every studio
// binds a document to one source image through this.

import { el, button } from "./dom";
import { getProject, mutate, removeSource, setStatus } from "./store";
import { importSourceFile, getImage } from "./image";
import { pickFiles } from "./download";

export async function importSourcesDialog(): Promise<string[]> {
  const files = await pickFiles("image/*", true);
  const added: string[] = [];
  for (const f of files) {
    try {
      const src = await importSourceFile(f);
      mutate((p) => p.sources.push(src));
      added.push(src.id);
    } catch (e) {
      setStatus(`Failed to import ${f.name}`);
      console.error(e);
    }
  }
  if (added.length) setStatus(`Imported ${added.length} image(s)`);
  return added;
}

/** Render a thumbnail of a source into a 40px swatch. */
async function paintSwatch(canvas: HTMLCanvasElement, sourceId: string): Promise<void> {
  const img = await getImage(sourceId);
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

export function sourcePicker(selectedId: string | null, onPick: (id: string) => void): HTMLElement {
  const project = getProject();
  const list = el("div.list");
  for (const src of project.sources) {
    const sw = el("canvas", { width: 36, height: 36 }) as HTMLCanvasElement;
    paintSwatch(sw, src.id);
    const item = el(
      "div.list-item" + (src.id === selectedId ? ".active" : ""),
      { onclick: () => onPick(src.id) },
      el("div.swatch", { style: { width: "36px", height: "36px" } }, sw),
      el("div.name", {}, src.name),
      el("span.meta", {}, `${src.width}×${src.height}`),
      button(
        "✕",
        (e: Event) => {
          e?.stopPropagation?.();
          if (confirm(`Remove source "${src.name}"? Documents using it will lose their image.`)) {
            removeSource(src.id);
          }
        },
        "sm danger"
      )
    );
    list.appendChild(item);
  }
  return el(
    "div.section",
    {},
    el("h3", {}, "Source images"),
    list,
    el("div.btn-row", { style: { marginTop: "8px" } }, button("+ Import images", () => importSourcesDialog(), "primary"))
  );
}
