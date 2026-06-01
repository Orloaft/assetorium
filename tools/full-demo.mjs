import { readFileSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT="/mnt/nxt-dev/asset-forge/docs/shots", OUT="/mnt/nxt-dev/asset-forge/docs/demo"; mkdirSync(OUT,{recursive:true});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1520, height: 920 }, acceptDownloads: true });
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
let saved=null; page.on("download",async d=>{if(d.suggestedFilename().endsWith(".afproj.json")){saved=`${OUT}/grass-water-roads-demo.afproj.json`;await d.saveAs(saved);}});
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const b64=(p)=>"data:image/png;base64,"+readFileSync(p).toString("base64");
await page.evaluate(([a,b])=>{window.__t=a;window.__r=b;}, [b64("/mnt/nxt-dev/tib/assetsources/newtiles1-fixed.png"), b64("/mnt/nxt-dev/tib/assetsources/newtiles2.png")]);
async function setField(l,v){const loc=page.locator(`label.field:has(span.field-label:text-is("${l}")) input`).first();await loc.fill(String(v));await loc.dispatchEvent("input");await page.waitForTimeout(50);}
async function importVar(varName,name){await page.evaluate(async([vn,nm])=>{const blob=await(await fetch(window[vn])).blob();const file=new File([blob],nm,{type:"image/png"});const o=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){const dt=new DataTransfer();dt.items.add(file);Object.defineProperty(this,"files",{value:dt.files,configurable:true});this.dispatchEvent(new Event("change"));HTMLInputElement.prototype.click=o;};},[varName,name]);await page.click("button:has-text('Import images')");await page.waitForTimeout(500);}
// Tilesets
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')"); await importVar("__t","terrain.png"); await setField("Min size",120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(600);
await page.click("button:has-text('New tileset')"); await importVar("__r","road.png"); await page.locator('.sidebar .section:has(h3:text-is("Source images")) .list-item').nth(1).click(); await page.waitForTimeout(250); await setField("Min size",120); await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(600);
// Stage
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
const sw=page.locator(".sidebar .palette .swatch");
// grass base from terrain tile 0
await sw.nth(0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
await setField("Tile size",96); await setField("Cols",34); await setField("Rows",22); await page.waitForTimeout(150);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// water wang from terrain 16-set + align
await sw.nth(0).click();
await page.click('button:has-text("Wang terrain from 16-tile set")'); await page.waitForTimeout(500);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("Align corners")'); await page.waitForTimeout(900);
await setField("Tile size",96); await page.waitForTimeout(80);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")');
const cv=page.locator(".stage-area canvas"); const bx=await cv.boundingBox(); const L=bx.x,T=bx.y,Wd=bx.width,Hd=bx.height;
await page.click('.inspector button:has-text("5²")');
for(const[x,y]of[[0.28,0.6],[0.34,0.55],[0.4,0.62]]){await page.mouse.click(L+Wd*x,T+Hd*y);await page.waitForTimeout(50);}
// roads on overlay layer, road terrain from road 16-set
await page.locator('.inspector .section:has(h3:text-is("Layers")) .list-item').nth(1).click();
await sw.nth(16).click();
await page.click('button:has-text("Road from 16-tile set")'); await page.waitForTimeout(500);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")');
await page.click('.inspector button:has-text("1×1")');
// a winding road + a crossing → junctions
const stroke=async(pts)=>{await page.mouse.move(L+Wd*pts[0][0],T+Hd*pts[0][1]);await page.mouse.down();for(const[x,y]of pts.slice(1))await page.mouse.move(L+Wd*x,T+Hd*y,{steps:10});await page.mouse.up();await page.waitForTimeout(120);};
await stroke([[0.1,0.3],[0.4,0.3],[0.6,0.3],[0.85,0.3]]); // horizontal
await stroke([[0.55,0.12],[0.55,0.3],[0.55,0.5],[0.55,0.8]]); // vertical crossing it
const gridCb=page.locator('label.check:has-text("Grid") input'); if(await gridCb.isChecked())await gridCb.click();
const colCb=page.locator('label.check:has-text("Show collision") input'); if(await colCb.isChecked())await colCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/25-full-demo.png` });
await page.mouse.move(L+Wd*0.55,T+Hd*0.3); for(let i=0;i<3;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/26-full-demo-zoom.png` });
await page.click("#btn-save-project").catch(()=>{}); await page.waitForTimeout(800);
await browser.close();
console.log("saved",saved, errs.length?("ERR "+errs.join(";")):"no errors");
