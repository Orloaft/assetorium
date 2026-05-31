import { readFileSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const URL = process.env.URL || "http://localhost:4173/";
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const IMG = "/mnt/nxt-dev/asset-forge/assets/biomes/highland.png";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const dataUrl = "data:image/png;base64," + readFileSync(IMG).toString("base64");
await page.evaluate((d) => (window.__durl = d), dataUrl);
async function importImg() { await page.evaluate(async () => { const blob = await (await fetch(window.__durl)).blob(); const file = new File([blob], "highland.png", { type: "image/png" }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; }; }); await page.click("button:has-text('Import images')"); await page.waitForTimeout(500); }
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importImg();
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(900);
await setField("Inset", 0); await page.waitForTimeout(150);
console.log("detect:", await page.textContent("#status-text"));

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(400);
await page.click('button:has-text("Auto-create terrains")'); await page.waitForTimeout(700);
console.log("auto-create:", await page.textContent("#status-text"));
const terrainNames = await page.$$eval('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item .name', els => els.map(e => e.textContent));
console.log("terrains:", terrainNames.join(", "));

const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox();
const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
async function selectTerrain(substr) {
  const item = page.locator(`.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item:has-text("${substr}")`).first();
  if (await item.count()) { await item.click(); await page.click('.inspector button:has-text("terrain")'); return true; }
  return false;
}
async function paintBlob(ox, oy) {
  await page.mouse.move(cx + ox - 110, cy + oy - 50); await page.mouse.down();
  for (let r = 0; r < 5; r++) { const yy = cy + oy - 50 + r * 24; await page.mouse.move(cx + ox - 110, yy, { steps: 2 }); await page.mouse.move(cx + ox + 110, yy, { steps: 10 }); }
  await page.mouse.up(); await page.waitForTimeout(250);
}
await page.click('.inspector button:has-text("5²")');
// base ground first terrain (p0), paint a big area
if (terrainNames[0]) { await selectTerrain(terrainNames[0]); await paintBlob(-30, -90); }
// water if present
if (terrainNames.some(t => /water/i.test(t))) { await selectTerrain("water"); await paintBlob(20, 60); }
// a second ground (dirt) patch
const dirt = terrainNames.find(t => /dirt|sand/i.test(t)); if (dirt) { await selectTerrain(dirt); await paintBlob(-140, 70); }

const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(150);
await page.mouse.move(cx, cy); for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/11-autocreate.png` });
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
