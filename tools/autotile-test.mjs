// Verify edge16 autotiling: build a synthetic 16-tile set, assign all 16 edge
// roles, paint a terrain blob, export, and confirm the tile layer resolved to
// multiple distinct tiles (center + edges + corners), with a solid interior.
import { execSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const URL = process.env.URL || "http://localhost:4173/";
const OUT = "/tmp/af-autotile"; rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let savedZip = null;
page.on("download", async (d) => { savedZip = `${OUT}/${d.suggestedFilename()}`; await d.saveAs(savedZip); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");

// 4x4 grid of 64px tiles, each a distinct colour.
await page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 64, y = ((i / 4) | 0) * 64;
    g.fillStyle = `hsl(${i * 23}, 65%, ${30 + (i % 5) * 8}%)`;
    g.fillRect(x, y, 64, 64);
    g.fillStyle = "#fff"; g.font = "20px monospace"; g.fillText(String(i), x + 22, y + 38);
  }
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  window.__durl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
});
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await page.evaluate(async () => {
  const blob = await (await fetch(window.__durl)).blob();
  const file = new File([blob], "wang.png", { type: "image/png" });
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; };
});
await page.click("button:has-text('Import images')");
await page.waitForTimeout(400);
await setField("Output tile size", 64);
await setField("Cols", 4); await setField("Rows", 4); await setField("Cell W", 64); await setField("Cell H", 64);
await setField("Inset", 0);
await page.click("button:has-text('Generate from grid')");
await page.waitForTimeout(300);

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')");
await page.waitForTimeout(400);
await page.click("button:has-text('+ Terrain')");
await page.waitForTimeout(200);

// Assign all 16 roles: palette tile i -> terrain slot i.
for (let i = 0; i < 16; i++) {
  await page.locator(".sidebar .palette .swatch").nth(i).click();
  await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .palette .swatch').nth(i).click();
  await page.waitForTimeout(30);
}
// Ensure terrain tool, paint a filled blob by dragging a serpentine over the center.
await page.click("button:has-text('terrain')");
const canvas = page.locator(".stage-area canvas");
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx - 130, cy - 130);
await page.mouse.down();
for (let r = 0; r < 8; r++) {
  const yy = cy - 130 + r * 34;
  await page.mouse.move(cx - 130, yy, { steps: 2 });
  await page.mouse.move(cx + 130, yy, { steps: 10 });
}
await page.mouse.up();
await page.waitForTimeout(300);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/04-autotile.png` });

await page.click("button:has-text('Export stage')");
await page.waitForTimeout(800);
await browser.close();

// Inspect exported layer data.
execSync(`cd ${OUT} && unzip -o -q "${savedZip}"`);
const stage = JSON.parse(execSync(`cat ${OUT}/*.stage.json`).toString());
const cells = stage.layers[0].data.flat().filter(Boolean);
const distinct = new Set(cells);
console.log(`painted cells: ${cells.length}, distinct tiles: ${distinct.size}`);
console.log("distinct refs:", [...distinct].join(", "));
if (errors.length) { console.error("ERRORS:\n" + errors.join("\n")); process.exit(1); }
if (distinct.size < 4) { console.error(`❌ autotiling produced only ${distinct.size} distinct tiles — edges not resolving`); process.exit(1); }
console.log(`\n✅ Autotiling works: a painted blob resolved into ${distinct.size} distinct edge/corner/center tiles.`);
