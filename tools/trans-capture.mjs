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
async function importForest() {
  await page.evaluate(async () => { const blob = await (await fetch(window.__durl)).blob(); const file = new File([blob], "foresttiles.png", { type: "image/png" }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; }; });
  await page.click("button:has-text('Import images')"); await page.waitForTimeout(500);
}
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importForest();
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(700);
await setField("Output tile size", 80); await setField("Inset", 8); await page.waitForTimeout(200);

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(400);

const swatches = page.locator(".sidebar .palette .swatch");
const n = await swatches.count();
const isObj = []; for (let i = 0; i < n; i++) isObj.push((await swatches.nth(i).locator(".badge").count()) > 0);
const small = isObj.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
console.log("small terrain tiles:", small.length);

// Fill the ground with the base terrain tile.
const baseIdx = small[0], fillIdx = small[Math.min(6, small.length - 1)];
await swatches.nth(baseIdx).click();
await page.click("button:has-text('fill')");
const canvas = page.locator(".stage-area canvas"); const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(300);

// Set fill + base in the Terrains panel, generate the transition terrain.
await swatches.nth(fillIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set fill")');
await swatches.nth(baseIdx).click();
await page.click('.inspector .section:has(h3:text-is("Terrains (autotile)")) button:has-text("Set base")');
await page.click('button:has-text("Generate transition")');
await page.waitForTimeout(800);
console.log("after generate:", await page.textContent("#status-text"));

// Paint a grass blob with the terrain tool.
await page.click('.inspector button:has-text("terrain")');
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx - 140, cy - 110); await page.mouse.down();
for (let r = 0; r < 7; r++) { const yy = cy - 110 + r * 32; await page.mouse.move(cx - 140 + (r%2?40:0), yy, { steps: 2 }); await page.mouse.move(cx + 140 - (r%2?0:30), yy, { steps: 10 }); }
await page.mouse.up(); await page.waitForTimeout(300);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
const colCb = page.locator('label.check:has-text("Show collision") input'); if (await colCb.isChecked()) await colCb.click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/05-transition.png` });
// zoom in
await page.mouse.move(cx, cy); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/06-transition-zoom.png` });

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
