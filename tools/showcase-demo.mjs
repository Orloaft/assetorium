// Combined showcase: grass base + water lake (corner-Wang) + aligned crossroad
// + a cliff (synth plateau top + auto wall) — everything in one stage.
import { readFileSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots"; mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1520, height: 920 }, acceptDownloads: true });
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
let saved = null; page.on("download", async d => { if (d.suggestedFilename().endsWith(".afproj.json")) { saved = "/home/orlovboros/Downloads/asset-forge-showcase.afproj.json"; await d.saveAs(saved); } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const b64 = p => "data:image/png;base64," + readFileSync(p).toString("base64");
await page.evaluate(([t, r, w, c]) => { window.__t = t; window.__r = r; window.__w = w; window.__c = c; }, [
  b64("/mnt/nxt-dev/tib/assetsources/newtiles1-fixed.png"),
  b64("/mnt/nxt-dev/tib/assetsources/newtiles2.png"),
  b64("/mnt/nxt-dev/asset-forge/docs/cliff-walls.png"),
  b64("/mnt/nxt-dev/asset-forge/docs/cliff-top.png"),
]);
const setField = async (l, v) => { const loc = page.locator(`label.field:has(span.field-label:text-is("${l}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(50); };
const importVar = async (vn, nm) => { await page.evaluate(async ([v, n]) => { const blob = await (await fetch(window[v])).blob(); const file = new File([blob], n, { type: "image/png" }); const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = o; }; }, [vn, nm]); await page.click("button:has-text('Import images')"); await page.waitForTimeout(400); };
const pickSource = async i => { await page.locator('.sidebar .section:has(h3:text-is("Source images")) .list-item').nth(i).click(); await page.waitForTimeout(250); };
const grp = i => page.locator('.sidebar .palette').nth(i).locator('.swatch').first(); // initial tilesets stay at fixed group index
const lastTerrain = () => page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last();

// --- Tile Studio: 4 source tilesets (terrain, road, walls, top) ---
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')"); await importVar("__t", "terrain.png"); await importVar("__r", "road.png"); await importVar("__w", "walls.png"); await importVar("__c", "top.png");
await pickSource(0); await setField("Min size", 120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(500); // A terrain
await page.click("button:has-text('New tileset')"); await pickSource(1); await setField("Min size", 120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(500); // B road
await page.click("button:has-text('New tileset')"); await pickSource(2); await setField("Cols", 9); await setField("Rows", 1); await setField("Cell W", 96); await setField("Cell H", 96); await setField("Output tile size", 96); await page.click("button:has-text('Generate from grid')"); await page.waitForTimeout(300); // C walls
await page.click("button:has-text('New tileset')"); await pickSource(3); await setField("Cols", 1); await setField("Rows", 1); await setField("Cell W", 96); await setField("Cell H", 96); await setField("Output tile size", 96); await page.click("button:has-text('Generate from grid')"); await page.waitForTimeout(300); // D top

// --- Stage ---
const COLS = 30, ROWS = 20, TS = 96, pad = 40;
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
// grass base + fill
await grp(0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
await setField("Tile size", 96); await setField("Cols", COLS); await setField("Rows", ROWS); await page.waitForTimeout(150);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// water wang + align
await grp(0).click();
await page.click('button:has-text("Wang terrain from 16-tile set")'); await page.waitForTimeout(500);
await lastTerrain().click(); await page.click('.inspector button:has-text("Align corners")'); await page.waitForTimeout(900);
await setField("Tile size", 96); await page.waitForTimeout(80);
// cliff
await grp(3).click();
await page.click('button:has-text("Make cliff")'); await page.waitForTimeout(1000);
await setField("Tile size", 96); await page.waitForTimeout(80);

// compute exact fit transform (no zoom yet) → cell→screen
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox(); const Lx = bx.x, T = bx.y, Wd = bx.width, Hd = bx.height;
const scale = Math.min((Wd - 2 * pad) / (COLS * TS), (Hd - 2 * pad) / (ROWS * TS));
const oX = (Wd - COLS * TS * scale) / 2, oY = (Hd - ROWS * TS * scale) / 2;
const sx = cx => Lx + oX + (cx + 0.5) * TS * scale, sy = cy => T + oY + (cy + 0.5) * TS * scale;
const cell = async (cx, cy) => { await page.mouse.click(sx(cx), sy(cy)); await page.waitForTimeout(18); };
const rect = async (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) await cell(x, y); };

// paint water lake (bottom-left), then cliff plateau (top-right)
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').filter({ hasText: "water" }).first().click().catch(() => {});
// select water terrain (2nd in list: grass, water, cliff) and paint
const terrItems = page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item');
await terrItems.nth(1).click(); await page.click('.inspector button:has-text("terrain")'); await page.click('.inspector button:has-text("1×1")');
await rect(3, 10, 13, 17);
// cliff plateau (3rd terrain)
await terrItems.nth(2).click(); await page.click('.inspector button:has-text("terrain")'); await page.click('.inspector button:has-text("1×1")');
await rect(19, 26, 3, 7);

// roads on overlay layer: aligned crossroad in the middle
await page.locator('.inspector .section:has(h3:text-is("Layers")) .list-item').nth(1).click();
await grp(1).click();
await page.click('button:has-text("Road from 16-tile set")'); await page.waitForTimeout(500);
await lastTerrain().click(); await page.click('.inspector button:has-text("Align road")'); await page.waitForTimeout(900);
await setField("Tile size", 96); await page.waitForTimeout(80);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")'); await page.click('.inspector button:has-text("1×1")');
for (let x = 2; x <= 27; x++) await cell(x, 10);      // horizontal road
for (let y = 2; y <= 18; y++) await cell(14, y);       // vertical road → crossroad at (14,10)

const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/31-showcase.png` });
await page.click("#btn-save-project").catch(() => {}); await page.waitForTimeout(1200);
console.log("saved:", saved, errs.length ? ("ERR " + errs.join(";")) : "no errors");
await browser.close();
