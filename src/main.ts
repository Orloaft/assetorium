import "./style.css";
import { getTab, setTab, subscribe, saveProjectFile, loadProjectFile, setStatus } from "./core/store";
import type { TabId } from "./core/store";
import { mountSpriteStudio } from "./sprite/sprite-studio";
import { mountTileStudio } from "./tile/tile-studio";
import { mountStageEditor } from "./stage/stage-editor";

export interface Editor {
  unmount(): void;
  /** Re-render in response to store changes (cheap; editors keep local state). */
  refresh(): void;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "sprites", label: "Sprite Studio" },
  { id: "tiles", label: "Tile Studio" },
  { id: "stages", label: "Stage Editor" }
];

const view = document.getElementById("view")!;
const tabsNav = document.getElementById("tabs")!;
let current: Editor | null = null;
let currentTab: TabId | null = null;

function renderTabs(): void {
  tabsNav.replaceChildren();
  for (const t of TABS) {
    const btn = document.createElement("button");
    btn.className = "tab" + (getTab() === t.id ? " active" : "");
    btn.textContent = t.label;
    btn.onclick = () => setTab(t.id);
    tabsNav.appendChild(btn);
  }
}

function mountActive(): void {
  const tab = getTab();
  if (tab === currentTab && current) {
    current.refresh();
    return;
  }
  current?.unmount();
  view.replaceChildren();
  currentTab = tab;
  if (tab === "sprites") current = mountSpriteStudio(view);
  else if (tab === "tiles") current = mountTileStudio(view);
  else current = mountStageEditor(view);
}

subscribe(() => {
  renderTabs();
  mountActive();
});

document.getElementById("btn-save-project")!.addEventListener("click", () => {
  saveProjectFile().catch((e) => setStatus("Save failed: " + e.message));
});
document.getElementById("btn-load-project")!.addEventListener("click", () => {
  loadProjectFile().catch((e) => setStatus("Load failed: " + e.message));
});

renderTabs();
mountActive();
setStatus("Ready. Import a source image to begin.");
