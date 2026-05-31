const PW = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW)).default ?? (await import(PW));
const { chromium } = pw;
const SHOT = "/mnt/nxt-dev/asset-forge/docs/shots";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 880 }, acceptDownloads: true });
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
await page.click("#tabs .tab:has-text('Tile')");
await page.locator('.lib-card:has(span:text-is("Highland"))').click();
await page.waitForTimeout(1800);
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')"); await page.waitForTimeout(300);
const sw = page.locator(".sidebar .palette .swatch");
// helper to find a swatch whose avg color is green-ish (grass), tan (dirt), blue (water)
async function pickByColor(kind){
  const n = await sw.count();
  for (let i=0;i<n;i++){
    const a = await page.evaluate((k)=>{const c=document.querySelectorAll(".sidebar .palette .swatch canvas")[k]; if(!c)return null; const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data; let r=0,g=0,b=0,nn=0; for(let j=0;j<d.length;j+=4){if(d[j+3]<128)continue;r+=d[j];g+=d[j+1];b+=d[j+2];nn++;} return nn?[r/nn,g/nn,b/nn]:null;}, i);
    if(!a)continue; const [r,g,b]=a;
    if(kind==="grass" && g>r && g>b && g>70) return i;
    if(kind==="dirt" && r>120 && g>90 && b<g-10) return i;
    if(kind==="water" && b>r+15 && b>90) return i;
  }
  return -1;
}
const cv = page.locator(".stage-area canvas"); let bx = await cv.boundingBox();
const L=bx.x,T=bx.y,W=bx.width,H=bx.height;
// 1) grass base
let gi = await pickByColor("grass"); console.log("grass idx", gi);
await sw.nth(gi).click();
await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(1000);
await page.click('button:has-text("Fill active layer")'); await page.waitForTimeout(500);
// 2) water terrain + paint lake
let wi = await pickByColor("water"); console.log("water idx", wi);
if(wi>=0){ await sw.nth(wi).click(); await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(1000);
  await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click(); await page.click('.inspector button:has-text("terrain")');
  await page.click('.inspector button:has-text("5²")');
  for(const [x,y] of [[0.35,0.55],[0.42,0.5],[0.4,0.62]]){await page.mouse.click(L+W*x,T+H*y);await page.waitForTimeout(50);} }
// 3) dirt terrain + paint patch
let di = await pickByColor("dirt"); console.log("dirt idx", di);
if(di>=0){ await sw.nth(di).click(); await page.click('button:has-text("Make terrain from selected")'); await page.waitForTimeout(1000);
  await page.locator('.inspector .section:has(h3:text-is("Terrains (autotile)")) .list-item').last().click(); await page.click('.inspector button:has-text("terrain")');
  await page.click('.inspector button:has-text("3²")');
  for(const [x,y] of [[0.68,0.4],[0.72,0.45]]){await page.mouse.click(L+W*x,T+H*y);await page.waitForTimeout(50);} }
const gridCb = page.locator('label.check:has-text("Grid") input'); if (await gridCb.isChecked()) await gridCb.click();
await page.waitForTimeout(200);
await page.mouse.move(L+W/2,T+H/2); for(let i=0;i<2;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOT}/18-maketerrain.png` });
await browser.close();
console.log(errs.length?"ERR "+errs.join(";"):"no errors");
