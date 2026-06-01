import { readFileSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots"; mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1520, height: 920 } });
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const b64 = p => "data:image/png;base64," + readFileSync(p).toString("base64");
await page.evaluate(([g, w, t]) => { window.__g = g; window.__w = w; window.__t = t; }, [
  b64("/mnt/nxt-dev/tib/assetsources/newtiles1-fixed.png"),
  b64("/mnt/nxt-dev/asset-forge/docs/cliff-walls.png"),
  b64("/mnt/nxt-dev/asset-forge/docs/cliff-top.png"),
]);
const setField = async (l, v) => { const loc = page.locator(`label.field:has(span.field-label:text-is("${l}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(50); };
const importVar = async (vn, nm) => { await page.evaluate(async ([v, n]) => { const blob = await (await fetch(window[v])).blob(); const file = new File([blob], n, { type: "image/png" }); const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = o; }; }, [vn, nm]); await page.click("button:has-text('Import images')"); await page.waitForTimeout(400); };
const pickSource = async i => { await page.locator('.sidebar .section:has(h3:text-is("Source images")) .list-item').nth(i).click(); await page.waitForTimeout(250); };

await page.click("#tabs .tab:has-text('Tile')");
// import all three sources
await page.click("button:has-text('New tileset')"); await importVar("__g", "grass.png"); await importVar("__w", "walls.png"); await importVar("__t", "top.png");
// tileset A: grass (auto-detect)
await pickSource(0); await setField("Min size", 120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(500);
// tileset B: walls 9x1 grid
await page.click("button:has-text('New tileset')"); await pickSource(1);
await setField("Cols", 9); await setField("Rows", 1); await setField("Cell W", 96); await setField("Cell H", 96); await setField("Output tile size", 96);
await page.click("button:has-text('Generate from grid')"); await page.waitForTimeout(400);
// tileset C: top 1x1 grid
await page.click("button:has-text('New tileset')"); await pickSource(2);
await setField("Cols", 1); await setField("Rows", 1); await setField("Cell W", 96); await setField("Cell H", 96); await setField("Output tile size", 96);
await page.click("button:has-text('Generate from grid')"); await page.waitForTimeout(400);

// Stage
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
const sw = page.locator(".sidebar .palette .swatch");
// base grass terrain
await sw.nth(0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
await setField("Tile size", 96); await setField("Cols", 24); await setField("Rows", 16); await page.waitForTimeout(150);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// cliff: pick the sand top texture — palette group 3 (grass, walls, TOP, base-fill)
await page.locator('.sidebar .palette').nth(2).locator('.swatch').first().click();
await page.click('button:has-text("Make cliff")'); await page.waitForTimeout(1000);
await setField("Tile size", 96); await page.waitForTimeout(80);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")');
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox(); const Lx = bx.x, T = bx.y, Wd = bx.width, Hd = bx.height;
await page.click('.inspector button:has-text("1×1")').catch(() => {});
// paint a clean rectangular plateau (cols 8..15, rows 4..8) on a 24x16 grid →
// continuous south edge → one clean wall run with L/C/R ends. Reproduce the
// viewport fit transform (fit(w,h,pad=40), centered) so cells map exactly.
const COLS = 24, ROWS = 16, TS = 96;
const Wworld = COLS * TS, Hworld = ROWS * TS, pad = 40;
const scale = Math.min((Wd - 2 * pad) / Wworld, (Hd - 2 * pad) / Hworld);
const oX = (Wd - Wworld * scale) / 2, oY = (Hd - Hworld * scale) / 2;
const cell = async (cx, cy) => { await page.mouse.click(Lx + oX + (cx + 0.5) * TS * scale, T + oY + (cy + 0.5) * TS * scale); await page.waitForTimeout(20); };
for (let cy = 4; cy <= 8; cy++) for (let cx = 8; cx <= 15; cx++) await cell(cx, cy);
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/29-cliff.png` });
await page.mouse.move(Lx + Wd * 0.5, T + Hd * 0.4); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/30-cliff-zoom.png` });
await browser.close();
console.log(errs.length ? ("ERR " + errs.join(";")) : "no errors");
