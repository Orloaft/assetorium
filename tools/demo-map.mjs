// Build a polished blended demo world end-to-end and screenshot it. Also saves
// the project (.afproj.json) so it can be opened in the app.
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const OUT = "/mnt/nxt-dev/asset-forge/docs/demo";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
const errs = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
let savedProject = null;
page.on("download", async (d) => { if (d.suggestedFilename().endsWith(".afproj.json")) { savedProject = `${OUT}/${d.suggestedFilename()}`; await d.saveAs(savedProject); } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");

// 1) Load Highland from the built-in library.
await page.click("#tabs .tab:has-text('Tile')");
await page.locator('.lib-card:has(span:text-is("Highland"))').click();
await page.waitForTimeout(1800);

// 2) Stage + auto-create terrains.
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
await page.click('button:has-text("Auto-create terrains")'); await page.waitForTimeout(1800);
const names = await page.$$eval('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item .name', els => els.map(e => e.textContent));
console.log("terrains:", names.join(", "));

const cv = page.locator(".stage-area canvas"); let bx = await cv.boundingBox();
const W = bx.width, H = bx.height, L = bx.x, T = bx.y;
async function pickTerrain(sub) { const it = page.locator(`.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item:has-text("${sub}")`).first(); if (await it.count()) { await it.click(); await page.click('.inspector button:has-text("terrain")'); return true; } return false; }
async function setBrush(label) { await page.click(`.inspector button:has-text("${label}")`); }
async function dab(fx, fy) { await page.mouse.click(L + W * fx, T + H * fy); await page.waitForTimeout(40); }
async function stroke(pts) { await page.mouse.move(L + W * pts[0][0], T + H * pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(L + W * x, T + H * y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(120); }

// 3) Fill the base (first terrain).
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(500);

// 4) Paint a blended lake (water/shallows) as overlapping big-brush dabs.
const water = names.find(n => /water|shallows/i.test(n));
if (water) { await pickTerrain(water); await setBrush("5²"); await page.click('.inspector button:has-text("● round"), .inspector button:has-text("■ square")').catch(()=>{});
  for (const [x, y] of [[0.32,0.55],[0.4,0.5],[0.46,0.58],[0.38,0.64],[0.3,0.62]]) await dab(x, y); }

// 5) Paint a dirt clearing + a winding path.
const dirt = names.find(n => /dirt|clay/i.test(n));
if (dirt) { await pickTerrain(dirt); await setBrush("3²"); for (const [x,y] of [[0.7,0.35],[0.75,0.4],[0.72,0.46]]) await dab(x,y);
  await setBrush("1×1"); await stroke([[0.55,0.6],[0.6,0.5],[0.66,0.42],[0.7,0.4]]); }
// a grass-2/other surface patch if present
const other = names.find(n => /grass|sand/i.test(n) && n !== names[0]);
if (other) { await pickTerrain(other); await setBrush("3²"); for (const [x,y] of [[0.6,0.75],[0.66,0.78]]) await dab(x,y); }

// 6) Scatter object decorations (◳ tiles from Highland).
await page.click("#tabs .tab:has-text('Stage')");
const objSwatches = [];
const sw = page.locator(".sidebar .palette .swatch");
const n = await sw.count();
for (let i = 0; i < n && objSwatches.length < 30; i++) { if (await sw.nth(i).locator(".badge").filter({ hasText: "◳" }).count()) objSwatches.push(i); }
console.log("object tiles available:", objSwatches.length);
const spots = [[0.18,0.3],[0.24,0.7],[0.5,0.25],[0.82,0.6],[0.88,0.3],[0.14,0.5],[0.6,0.2],[0.85,0.78],[0.28,0.42],[0.7,0.66],[0.45,0.8],[0.55,0.35]];
let si = 0;
for (const [x, y] of spots) { if (!objSwatches.length) break; await sw.nth(objSwatches[si % objSwatches.length]).click(); si++; await page.mouse.click(L + W * x, T + H * y); await page.waitForTimeout(40); }

// 7) Clean view + screenshots.
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
const colCb = page.locator('label.check:has-text("Show collision") input'); if (await colCb.isChecked()) await colCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/16-demo-map.png` });
// zoom in for detail
const cx = L + W / 2, cy = T + H / 2;
await page.mouse.move(cx, cy); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/17-demo-zoom.png` });

// 8) Save the project so it can be opened.
await page.click("#btn-save-project").catch(()=>{});
await page.waitForTimeout(800);
await browser.close();
console.log("saved project:", savedProject || "(none)");
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no errors");
