// Capture harness: drive the real app to build a tileset + world from the
// forest sheet and screenshot each stage for review. Saves to docs/shots/.
import { readFileSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const URL = process.env.URL || "http://localhost:4173/";
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const IMG = "/home/orlovboros/Downloads/foresttiles.png";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");

const b64 = readFileSync(IMG).toString("base64");
const dataUrl = "data:image/png;base64," + b64;
await page.evaluate((d) => (window.__durl = d), dataUrl);

async function importForest() {
  await page.evaluate(async () => {
    const blob = await (await fetch(window.__durl)).blob();
    const file = new File([blob], "foresttiles.png", { type: "image/png" });
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      const dt = new DataTransfer(); dt.items.add(file);
      Object.defineProperty(this, "files", { value: dt.files, configurable: true });
      this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig;
    };
  });
  await page.click("button:has-text('Import images')");
  await page.waitForTimeout(500);
}
async function setField(label, v) {
  const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first();
  await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(50);
}

// ---- Tile Studio: auto-detect ----
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importForest();
await page.waitForTimeout(300);
await page.click("button:has-text('Auto-detect tiles')");
await page.waitForTimeout(800);
// Match output tile size to the source terrain tile (~80px) so terrain = 1 cell
// and trees/rocks become multi-cell objects (what "Fit tile size → N" does).
await setField("Output tile size", 80);
await setField("Inset", 8); // trim the soft magenta fringe off terrain tiles
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/01-tile-autodetect.png` });
console.log("tile autodetect:", await page.textContent("#status-text"));

// ---- Stage: build a scene ----
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')");
await page.waitForTimeout(500);

// Fill ground with the first palette tile, then scatter a few others.
const swatches = page.locator(".sidebar .palette .swatch");
const n = await swatches.count();
console.log("palette swatches:", n);
const canvas = page.locator(".stage-area canvas");
const box = await canvas.boundingBox();

// Classify swatches: those with the ◳ badge are multi-cell objects.
const isObj = [];
for (let i = 0; i < n; i++) isObj.push((await swatches.nth(i).locator(".badge").count()) > 0);
const smallIdxs = isObj.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
const objIdxs = isObj.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
console.log("small tiles:", smallIdxs.length, "object tiles:", objIdxs.length);

// Scatter-fill the ground with a few small terrain tiles (variation).
const scatterPick = smallIdxs.slice(0, 4);
for (const idx of scatterPick) await swatches.nth(idx).click({ modifiers: ["Shift"] });
await page.click("button:has-text('fill')");
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);

// Stamp a spread of object tiles (trees/rocks/bushes) at true proportions.
let placed = 0;
for (let k = 0; k < objIdxs.length && placed < 16; k += Math.max(1, Math.floor(objIdxs.length / 16))) {
  await swatches.nth(objIdxs[k]).click(); // auto-switches to object tool
  const px = box.x + 90 + (placed % 5) * 150;
  const py = box.y + 110 + Math.floor(placed / 5) * 150;
  await page.mouse.click(px, py);
  await page.waitForTimeout(70);
  placed++;
}
console.log("objects placed:", placed);

// Clean look: hide grid + collision overlay before the screenshot.
const gridCb = page.locator('label.check:has-text("Grid") input');
if (await gridCb.isChecked()) await gridCb.click();
const colCb = page.locator('label.check:has-text("Show collision") input');
if (await colCb.isChecked()) await colCb.click();
await page.waitForTimeout(200);
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/02-stage-scene.png` });

// Zoom in on the canvas for a close-up of tile edges.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/03-stage-zoom.png` });
console.log("stage built. errors:", errors.length);

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
