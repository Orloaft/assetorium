// In-app validation of "Cliff set from face tile": import newcliff2, pick the
// south-face tile, generate the set, paint a 2-tier plateau.
import { readFileSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots"; mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1520, height: 920 }, acceptDownloads: true });
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
let saved = null; page.on("download", async d => { if (d.suggestedFilename().endsWith(".afproj.json")) { saved = "/home/orlovboros/Downloads/asset-forge-cliffs.afproj.json"; await d.saveAs(saved); } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const b64 = p => "data:image/png;base64," + readFileSync(p).toString("base64");
await page.evaluate(([g, c]) => { window.__g = g; window.__c = c; }, [b64("/mnt/nxt-dev/tib/assetsources/newtiles1-fixed.png"), b64("/mnt/nxt-dev/tib/assetsources/newcliff2.png")]);
const setField = async (l, v) => { const loc = page.locator(`label.field:has(span.field-label:text-is("${l}")) input`).first(); await loc.fill(String(v)); await loc.dispatchEvent("input"); await page.waitForTimeout(50); };
const importVar = async (vn, nm) => { await page.evaluate(async ([v, n]) => { const blob = await (await fetch(window[v])).blob(); const file = new File([blob], n, { type: "image/png" }); const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { const dt = new DataTransfer(); dt.items.add(file); Object.defineProperty(this, "files", { value: dt.files, configurable: true }); this.dispatchEvent(new Event("change")); HTMLInputElement.prototype.click = o; }; }, [vn, nm]); await page.click("button:has-text('Import images')"); await page.waitForTimeout(400); };
const pickSource = async i => { await page.locator('.sidebar .section:has(h3:text-is("Source images")) .list-item').nth(i).click(); await page.waitForTimeout(250); };
const grp = (i, n) => page.locator('.sidebar .palette').nth(i).locator('.swatch').nth(n);
const lastTerrain = () => page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last();

await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')"); await importVar("__g", "grass.png"); await importVar("__c", "cliff.png");
await pickSource(0); await setField("Min size", 120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(500);
await page.click("button:has-text('New tileset')"); await pickSource(1);
const skip = page.locator('label.check:has-text("Skip empty") input'); if (await skip.isChecked()) await skip.click();
await setField("Cols", 4); await setField("Rows", 4); await setField("Cell W", 256); await setField("Cell H", 256); await setField("Output tile size", 96);
await page.click("button:has-text('Generate from grid')"); await page.waitForTimeout(400);

const COLS = 24, ROWS = 16, TS = 96, pad = 40;
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
await grp(0, 0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
await setField("Tile size", 96); await setField("Cols", COLS); await setField("Rows", ROWS); await page.waitForTimeout(150);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// pick the south-face tile (cliff tileset = palette group 1, idx 4) → generate set
await grp(1, 4).click();
await page.click('button:has-text("Cliff set from face tile")'); await page.waitForTimeout(900);

const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox(); const Lx = bx.x, T = bx.y, Wd = bx.width, Hd = bx.height;
const scale = Math.min((Wd - 2 * pad) / (COLS * TS), (Hd - 2 * pad) / (ROWS * TS));
const oX = (Wd - COLS * TS * scale) / 2, oY = (Hd - ROWS * TS * scale) / 2;
const cell = async (cx, cy) => { await page.mouse.click(Lx + oX + (cx + 0.5) * TS * scale, T + oY + (cy + 0.5) * TS * scale); await page.waitForTimeout(16); };
const rect = async (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) await cell(x, y); };
await lastTerrain().click(); await page.click('.inspector button:has-text("terrain")'); await page.click('.inspector button:has-text("1×1")');
await rect(6, 17, 4, 11);
await grp(1, 4).click();
await page.click('button:has-text("Cliff set from face tile")'); await page.waitForTimeout(900);
await lastTerrain().click(); await page.click('.inspector button:has-text("terrain")'); await page.click('.inspector button:has-text("1×1")');
await rect(9, 14, 6, 9);

const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/43-cliff-face.png` });
await page.mouse.move(Lx + Wd * 0.5, T + Hd * 0.45); for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/44-cliff-face-zoom.png` });
await page.click("#btn-save-project").catch(() => {}); await page.waitForTimeout(900);
console.log("saved:", saved, errs.length ? ("ERR " + errs.join(";")) : "no errors");
await browser.close();
