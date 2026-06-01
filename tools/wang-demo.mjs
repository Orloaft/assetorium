import { readFileSync, mkdirSync } from "node:fs";
const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const OUT = "/mnt/nxt-dev/asset-forge/docs/demo"; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
let saved=null; page.on("download", async d=>{ if(d.suggestedFilename().endsWith(".afproj.json")){saved=`${OUT}/wang-aligned-demo.afproj.json`; await d.saveAs(saved);} });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
const dataUrl = "data:image/png;base64," + readFileSync("/mnt/nxt-dev/tib/assetsources/newtiles1-fixed.png").toString("base64");
await page.evaluate((d)=>window.__durl=d, dataUrl);
async function setField(label,v){const loc=page.locator(`label.field:has(span.field-label:text-is("${label}")) input`).first();await loc.fill(String(v));await loc.dispatchEvent("input");await page.waitForTimeout(60);}
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await page.evaluate(async()=>{const blob=await(await fetch(window.__durl)).blob();const file=new File([blob],"newtiles1-fixed.png",{type:"image/png"});const o=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){const dt=new DataTransfer();dt.items.add(file);Object.defineProperty(this,"files",{value:dt.files,configurable:true});this.dispatchEvent(new Event("change"));HTMLInputElement.prototype.click=o;};});
await page.click("button:has-text('Import images')"); await page.waitForTimeout(500);
await setField("Min size", 120);
await page.click("button:has-text('Auto-detect tiles')"); await page.waitForTimeout(600);

await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
const sw = page.locator(".sidebar .palette .swatch");
// grass base from tile 0
await sw.nth(0).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(900);
// shrink cells + stage for a world feel
await setField("Tile size", 96); await page.waitForTimeout(100);
await setField("Cols", 30); await setField("Rows", 20); await page.waitForTimeout(150);
// fill grass base
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').first().click();
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(400);
// water wang from the 16-set
await sw.nth(0).click();
await page.click('button:has-text("Wang terrain from 16-tile set")'); await page.waitForTimeout(600);
await setField("Tile size", 96); await page.waitForTimeout(100); // import reset it to 256; bring back
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("Align corners")'); await page.waitForTimeout(1000);
await setField("Tile size", 96); await page.waitForTimeout(80);
await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click();
await page.click('.inspector button:has-text("terrain")');
const cv=page.locator(".stage-area canvas"); const bx=await cv.boundingBox();
const L=bx.x,T=bx.y,W=bx.width,H=bx.height;
const dab=async(fx,fy)=>{await page.mouse.click(L+W*fx,T+H*fy);await page.waitForTimeout(50);};
const stroke=async(pts)=>{await page.mouse.move(L+W*pts[0][0],T+H*pts[0][1]);await page.mouse.down();for(const[x,y]of pts.slice(1))await page.mouse.move(L+W*x,T+H*y,{steps:8});await page.mouse.up();await page.waitForTimeout(120);};
// a lake (big brush dabs)
await page.click('.inspector button:has-text("5²")');
for(const[x,y]of [[0.30,0.55],[0.37,0.5],[0.43,0.58],[0.34,0.64],[0.27,0.6]]) await dab(x,y);
// a winding river (small brush)
await page.click('.inspector button:has-text("3²")');
await stroke([[0.43,0.55],[0.55,0.45],[0.68,0.5],[0.8,0.38],[0.9,0.42]]);
const gridCb=page.locator('label.check:has-text("Grid") input'); if(await gridCb.isChecked())await gridCb.click();
const colCb=page.locator('label.check:has-text("Show collision") input'); if(await colCb.isChecked())await colCb.click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/23-wang-aligned.png` });
await page.mouse.move(L+W*0.35,T+H*0.55); for(let i=0;i<4;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/24-wang-aligned-zoom.png` });
await page.click("#btn-save-project").catch(()=>{}); await page.waitForTimeout(800);
await browser.close();
console.log("saved:", saved, errs.length?("ERR "+errs.join(";")):"no errors");
