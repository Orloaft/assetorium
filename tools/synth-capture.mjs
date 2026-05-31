const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
await page.click("#tabs .tab:has-text('Tile')");
await page.locator('.lib-card:has(span:text-is("Beach"))').click();
await page.waitForTimeout(1500);
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
await page.click('button:has-text("Auto-create terrains")'); await page.waitForTimeout(1500);
const names = await page.$$eval('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item .name', els=>els.map(e=>e.textContent));
console.log("terrains:", names.join(", "));
const cv = page.locator(".stage-area canvas"); const bx = await cv.boundingBox();
const cx = bx.x+bx.width/2, cy = bx.y+bx.height/2;
async function selTerr(sub){ const it=page.locator(`.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item:has-text("${sub}")`).first(); if(await it.count()){await it.click(); await page.click('.inspector button:has-text("terrain")'); return true;} return false;}
// fill base (first terrain)
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// paint water blob
await page.click('.inspector button:has-text("3²")');
if (names.some(n=>/water|shallows/i.test(n))) { await selTerr(names.find(n=>/water|shallows/i.test(n))); 
  await page.mouse.move(cx-90,cy-50); await page.mouse.down(); for(let r=0;r<5;r++){const yy=cy-50+r*22; await page.mouse.move(cx-90,yy,{steps:2}); await page.mouse.move(cx+90,yy,{steps:8});} await page.mouse.up(); await page.waitForTimeout(300); }
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(150);
await page.mouse.move(cx,cy); for(let i=0;i<3;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/15-synth-autocreate.png` });
await browser.close();
console.log(errs.length?"ERR "+errs.join(";"):"no errors");
