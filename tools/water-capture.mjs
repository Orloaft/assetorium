import { readFileSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const URL = process.env.URL || "http://localhost:4173/";
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const IMG = "/mnt/nxt-dev/asset-forge/assets/biomes/beach.png";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const dataUrl = "data:image/png;base64," + readFileSync(IMG).toString("base64");
await page.evaluate((d) => (window.__durl = d), dataUrl);
async function importImg() { await page.evaluate(async () => { const blob = await (await fetch(window.__durl)).blob(); const file = new File([blob], "beach.png", { type: "image/png" }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; }; }); await page.click("button:has-text('Import images')"); await page.waitForTimeout(500); }
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importImg();
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(800);
await setField("Output tile size", 64); await setField("Inset", 0); await page.waitForTimeout(200);
console.log("detect:", await page.textContent("#status-text"));

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(400);

const swatches = page.locator(".sidebar .palette .swatch");
const n = await swatches.count();
const isObj = []; for (let i = 0; i < n; i++) isObj.push((await swatches.nth(i).locator(".badge").count()) > 0);
const small = isObj.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
async function avg(i) { return await page.evaluate((k) => { const c = document.querySelectorAll(".sidebar .palette .swatch canvas")[k]; if (!c) return null; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, nn = 0; for (let j = 0; j < d.length; j += 4) { if (d[j + 3] < 128) continue; r += d[j]; g += d[j + 1]; b += d[j + 2]; nn++; } return nn ? [r / nn, g / nn, b / nn] : null; }, i); }
let waterIdx = -1, sandIdx = -1;
for (const i of small) { const a = await avg(i); if (!a) continue; const [r, g, b] = a;
  if (waterIdx < 0 && b > r + 15 && b > 90) waterIdx = i;            // blue
  if (sandIdx < 0 && r > 140 && g > 110 && b < g && b < 150) sandIdx = i; // tan/sand
}
console.log("waterIdx", waterIdx, "sandIdx", sandIdx);
if (waterIdx < 0 || sandIdx < 0) { console.log("could not pick water/sand"); }

// fill ground with sand
await swatches.nth(sandIdx).click();
await page.click("button:has-text('fill')");
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox();
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.waitForTimeout(200);
// auto-build water terrain (water over sand)
await swatches.nth(waterIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set fill")');
await swatches.nth(sandIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set base")');
await page.click('button:has-text("Auto-build from sheet")'); await page.waitForTimeout(500);
console.log("autobuild:", await page.textContent("#status-text"));
// paint a solid water blob with the terrain tool + a big brush
await page.click('.inspector button:has-text("terrain")');
await page.click('.inspector button:has-text("5²")');
const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
await page.mouse.move(cx - 120, cy - 70); await page.mouse.down();
for (let r = 0; r < 6; r++) { const yy = cy - 70 + r * 26; await page.mouse.move(cx - 120, yy, { steps: 2 }); await page.mouse.move(cx + 120, yy, { steps: 10 }); }
await page.mouse.up(); await page.waitForTimeout(300);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(150);
await page.mouse.move(cx, cy); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/10-water-terrain.png` });
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
