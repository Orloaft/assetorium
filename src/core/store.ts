// Central application state: the open Project plus the active tab. Editors
// subscribe for re-render and call `mutate` to change the project. The project
// (minus pixels) autosaves to localStorage; full save/load round-trips through
// a self-contained .afproj.json that embeds source images as base64.

import { emptyProject, PROJECT_VERSION } from "./types";
import type { Project } from "./types";
import { getSourceDataUrl, importSourceDataUrl, deleteSource } from "./image";
import { downloadText, pickFiles } from "./download";

export type TabId = "sprites" | "tiles" | "stages";

interface AppState {
  project: Project;
  tab: TabId;
}

const LS_KEY = "asset-forge:project";

type Listener = () => void;
const listeners = new Set<Listener>();

const state: AppState = {
  project: restore() ?? emptyProject(),
  tab: "sprites"
};

function restore(): Project | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    if (p && p.version === PROJECT_VERSION) return p;
  } catch {
    /* ignore corrupt autosave */
  }
  return null;
}

let saveTimer: number | undefined;
function scheduleAutosave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.project));
      flashAutosaveDot();
    } catch (err) {
      setStatus("Autosave failed (storage full?) — use Save project");
      console.warn(err);
    }
  }, 400);
}

export function getProject(): Project {
  return state.project;
}

export function getTab(): TabId {
  return state.tab;
}

export function setTab(tab: TabId): void {
  state.tab = tab;
  emit();
}

/** Apply a mutation to the project, persist, and notify subscribers. */
export function mutate(fn: (p: Project) => void): void {
  fn(state.project);
  scheduleAutosave();
  emit();
}

/** Replace the whole project (load). */
export function setProject(p: Project): void {
  state.project = p;
  scheduleAutosave();
  emit();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function setStatus(text: string): void {
  const el = document.getElementById("status-text");
  if (el) el.textContent = text;
}

let dotTimer: number | undefined;
function flashAutosaveDot(): void {
  const auto = document.getElementById("autosave-status");
  if (!auto) return;
  auto.textContent = "●";
  window.clearTimeout(dotTimer);
  dotTimer = window.setTimeout(() => (auto.textContent = ""), 800);
}

// --- Project file save/load (self-contained, portable) --------------------

export async function saveProjectFile(): Promise<void> {
  setStatus("Packing project…");
  const sources = await Promise.all(
    state.project.sources.map(async (s) => ({ ...s, dataUrl: await getSourceDataUrl(s.id) }))
  );
  const bundle = { ...state.project, sources };
  downloadText(JSON.stringify(bundle), `${slug(state.project.name)}.afproj.json`);
  setStatus("Project saved");
}

export async function loadProjectFile(): Promise<void> {
  const [file] = await pickFiles(".json,.afproj.json", false);
  if (!file) return;
  setStatus("Loading project…");
  const raw = JSON.parse(await file.text()) as Project & {
    sources: Array<{ id: string; name: string; dataUrl: string }>;
  };
  // Re-import embedded images into IndexedDB.
  const sources = [];
  for (const s of raw.sources) {
    sources.push(await importSourceDataUrl(s.id, s.name, s.dataUrl));
  }
  setProject({
    version: PROJECT_VERSION,
    name: raw.name ?? "Untitled",
    sources,
    sprites: raw.sprites ?? [],
    tilesets: raw.tilesets ?? [],
    stages: raw.stages ?? []
  });
  setStatus(`Loaded "${raw.name}"`);
}

export async function removeSource(id: string): Promise<void> {
  await deleteSource(id);
  mutate((p) => {
    p.sources = p.sources.filter((s) => s.id !== id);
  });
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}
