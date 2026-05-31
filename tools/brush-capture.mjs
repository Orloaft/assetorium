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
async function importForest() { await page.evaluate(async () => { const blob = await (await fetch(window.__durl)).blob(); const file = new File([blob], "f.png", { type: "image/png" }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = orig; }; }); await page.click("button:has-text('Import images')"); await page.waitForTimeout(500); }
async function setField(label, v) { const loc = page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(40); }

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importForest();
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(700);
await setField("Output tile size", 64); await setField("Inset", 6); await page.waitForTimeout(200);

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(400);

const swatches = page.locator(".sidebar .palette .swatch");
const n = await swatches.count();
const isObj = []; for (let i = 0; i < n; i++) isObj.push((await swatches.nth(i).locator(".badge").count()) > 0);
const small = isObj.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
// fill ground with first small tile
await swatches.nth(small[0]).click();
await page.click("button:has-text('fill')");
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox();
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.waitForTimeout(200);
// big circular brush, paint a winding stroke of another tile
await swatches.nth(small[Math.min(2, small.length - 1)]).click();
await page.click("button:has-text('paint')");
await page.click('.inspector button:has-text("7²")'); // brush radius 3
await page.click('.inspector button:has-text("square")'); // -> round
const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
await page.mouse.move(cx - 180, cy - 60); await page.mouse.down();
await page.mouse.move(cx - 60, cy + 40, { steps: 8 });
await page.mouse.move(cx + 80, cy - 50, { steps: 8 });
await page.mouse.move(cx + 190, cy + 30, { steps: 8 });
await page.mouse.up(); await page.waitForTimeout(200);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
const colCb = page.locator('label.check:has-text("Show collision") input'); if (await colCb.isChecked()) await colCb.click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/09-brush.png` });
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors — brush stroke painted");
