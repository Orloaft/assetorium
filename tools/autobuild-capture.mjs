import { readFileSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const URL = process.env.URL || "http://localhost:4173/";
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const dataUrl = "data:image/png;base64," + readFileSync("/home/orlovboros/Downloads/foresttiles.png").toString("base64");
await page.evaluate((d) => (window.__durl = d), dataUrl);
async function importForest() { await page.evaluate(async () => { const blob = await (await fetch(window.__durl)).blob(); const file = new File([blob], "foresttiles.png", { type: "image/png" }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; }; }); await page.click("button:has-text('Import images')"); await page.waitForTimeout(500); }
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importForest();
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(700);
await setField("Output tile size", 88); await setField("Inset", 0); await page.waitForTimeout(200);

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(400);

const swatches = page.locator(".sidebar .palette .swatch");
const n = await swatches.count();
const isObj = []; for (let i = 0; i < n; i++) isObj.push((await swatches.nth(i).locator(".badge").count()) > 0);
const small = isObj.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);

// Identify a grass fill and a dirt fill among the first several small tiles by
// reading their swatch canvas average colour.
async function swatchAvg(idx) {
  return await page.evaluate((i) => {
    const c = document.querySelectorAll(".sidebar .palette .swatch canvas")[i];
    if (!c) return null; const g = c.getContext("2d"); const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0, nn = 0; for (let k = 0; k < d.length; k += 4) { if (d[k + 3] < 128) continue; r += d[k]; gg += d[k + 1]; b += d[k + 2]; nn++; }
    return nn ? [r / nn, gg / nn, b / nn] : null;
  }, idx);
}
let grassIdx = -1, dirtIdx = -1;
for (const i of small.slice(0, 12)) {
  const a = await swatchAvg(i); if (!a) continue;
  const [r, g, b] = a;
  if (grassIdx < 0 && g > r && g > b) grassIdx = i;          // green dominant
  if (dirtIdx < 0 && r > g && g > b && r > 90) dirtIdx = i;   // brown
}
console.log("grassIdx", grassIdx, "dirtIdx", dirtIdx);

// Fill ground with dirt, then auto-build a grass terrain and paint it over.
if (dirtIdx >= 0) { await swatches.nth(dirtIdx).click(); await page.click("button:has-text('fill')"); const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox(); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.waitForTimeout(300); }
await swatches.nth(grassIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set fill")');
await swatches.nth(dirtIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set base")');
await page.click('button:has-text("Auto-build from sheet")');
await page.waitForTimeout(500);
console.log("auto-build:", await page.textContent("#status-text"));

await page.click('.inspector button:has-text("terrain")');
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox();
const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
// paint a solid blob
await page.mouse.move(cx - 120, cy - 90); await page.mouse.down();
for (let r = 0; r < 8; r++) { const yy = cy - 90 + r * 24; await page.mouse.move(cx - 120, yy, { steps: 2 }); await page.mouse.move(cx + 120, yy, { steps: 12 }); }
await page.mouse.up(); await page.waitForTimeout(300);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
const colCb = page.locator('label.check:has-text("Show collision") input'); if (await colCb.isChecked()) await colCb.click();
await page.waitForTimeout(150);
await page.mouse.move(cx, cy); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/07-autobuild.png` });
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
