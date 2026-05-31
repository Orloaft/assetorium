import { readFileSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const dataUrl = "data:image/png;base64," + readFileSync("/mnt/nxt-dev/tib/assetsources/newtiles1.png").toString("base64");
await page.evaluate((d)=>window.__durl=d, dataUrl);
async function setField(label,v){const loc=page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first();await loc.fill(String(v));await loc.dispatchEvent("input");await page.waitForTimeout(40);}
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await page.evaluate(async()=>{const blob=await(await fetch(window.__durl)).blob();const file=new File([blob],"newtiles1.png",{type:"image/png"});const o=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){const dt=new DataTransfer();dt.items.add(file);Object.defineProperty(this,"files",{value:dt.files,configurable:true});this.dispatchEvent(new Event("change"));HTMLInputElement.prototype.click=o;};});
await page.click("button:has-text('Import images')"); await page.waitForTimeout(500);
await setField("Min size", 120);
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(600);
const tileCount = await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem("asset-forge:project"));return p.tilesets[p.tilesets.length-1].tiles.length;});
console.log("detected tiles:", tileCount, "-", await page.textContent("#status-text"));

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
const sw = page.locator(".sidebar .palette .swatch");
// grass base = tile 0 (first), water wang = whole 16-set
await sw.nth(0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
await sw.nth(0).click(); // ensure activeRef in this tileset
await page.click('button:has-text("Wang terrain from 16-tile set")'); await page.waitForTimeout(600);
// select the water wang terrain (last) + paint
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")');
await page.click('.inspector button:has-text("5²")');
const cv=page.locator(".stage-area canvas"); const bx=await cv.boundingBox();
const cx=bx.x+bx.width/2, cy=bx.y+bx.height/2;
for(const [dx,dy] of [[-60,-30],[10,-50],[60,10],[-20,40],[-90,20]]) { await page.mouse.click(cx+dx,cy+dy); await page.waitForTimeout(60); }
const gridCb=page.locator('label.check:has-text("Grid") input'); if(await gridCb.isChecked())await gridCb.click();
await page.waitForTimeout(150);
await page.mouse.move(cx,cy); for(let i=0;i<3;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/20-wang-realart.png` });
await browser.close();
console.log(errs.length?"ERR "+errs.join(";"):"no errors");
