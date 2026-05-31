// Headless smoke test: boot the built app, exercise all three studios end to
// end (import → slice → rig → export), capture the export downloads, and
// assert they are valid non-empty zips. Fails on any console/page error.
// Playwright isn't a dependency of this repo. Point PLAYWRIGHT_CORE at any
// installation, e.g.:
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.js npm run smoke
const PW_PATH = process.env.PLAYWRIGHT_CORE || "playwright-core";
const pw = (await import(PW_PATH)).default ?? (await import(PW_PATH));
const { chromium } = pw;

const URL = process.env.URL || "http://localhost:4173/";
const errors = [];
const downloads = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true });
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("download", async (d) => {
  const stream = await d.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  downloads.push({ name: d.suggestedFilename(), size: buf.length, pk: buf.slice(0, 2).toString() === "PK" });
});

const fail = (msg) => { errors.push("ASSERT: " + msg); };
const expectStatus = async (substr, label) => {
  const s = await page.textContent("#status-text");
  if (!s.includes(substr)) fail(`${label}: expected status to contain "${substr}", got "${s}"`);
  return s;
};

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#tabs .tab");
console.log("Tabs:", (await page.$$eval("#tabs .tab", (e) => e.map((x) => x.textContent))).join(" | "));

// 128x32 image, magenta background, four distinct 28px frames on a 32px pitch.
async function makeMagentaPng() {
  return await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 32;
    const g = c.getContext("2d");
    g.fillStyle = "#ff00ff"; g.fillRect(0, 0, 128, 32);
    // Deliberately non-magenta colors (the chroma key correctly removes
    // purple/magenta-ish tones, so test frames must avoid them).
    const colors = ["#e0a040", "#40c060", "#4080e0", "#d0d040"];
    for (let i = 0; i < 4; i++) { g.fillStyle = colors[i]; g.fillRect(i * 32 + 2, 2, 28, 28); }
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  });
}

async function importImage() {
  const dataUrl = await makeMagentaPng();
  await page.evaluate(async (durl) => {
    const blob = await (await fetch(durl)).blob();
    const file = new File([blob], "test-frames.png", { type: "image/png" });
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      const dt = new DataTransfer(); dt.items.add(file);
      Object.defineProperty(this, "files", { value: dt.files, configurable: true });
      this.dispatchEvent(new Event("change"));
      HTMLInputElement.prototype.click = orig;
    };
  }, dataUrl);
  await page.click("button:has-text('Import images')");
  await page.waitForTimeout(400);
}

async function setField(labelText, value) {
  const loc = page.locator(`label.field:has(span.field-label:text-is("${labelText}")) input`).first();
  await loc.fill(String(value));
  await loc.dispatchEvent("input");
}

// ---------------- Sprite Studio ----------------
await page.click("#tabs .tab:has-text('Sprite')");
await page.click("button:has-text('New sprite')");
await importImage();
await page.click("button:has-text('Auto-detect frames')");
await page.waitForTimeout(300);
await page.click("button:has-text('Quick-rig 4-dir walk')");
await page.waitForTimeout(200);
await expectStatus("Rigged walk", "sprite/rig");
await page.click("button:has-text('Export sprite')");
await page.waitForTimeout(500);

// ---------------- Tile Studio ----------------
await page.click("#tabs .tab:has-text('Tile')");
await page.click("button:has-text('New tileset')");
await importImage();
await setField("Cols", 4);
await setField("Rows", 1);
await setField("Cell W", 32);
await setField("Cell H", 32);
await page.click("button:has-text('Generate from grid')");
await page.waitForTimeout(300);
await expectStatus("Generated 4 tiles", "tile/generate");
// Mark first tile as blocking, then export.
await page.click(".inspector .section:has(h3:text-is('All tiles')) .list-item >> nth=0");
await page.waitForTimeout(150);
await page.click("label.check:has-text('Blocks movement') input");
await page.click("button:has-text('Export tileset')");
await page.waitForTimeout(500);

// ---------------- Stage Editor ----------------
await page.click("#tabs .tab:has-text('Stage')");
await page.click("button:has-text('New stage')");
await page.waitForTimeout(400);
// Paint: pick first palette swatch, then click on the stage canvas.
const swatch = page.locator(".sidebar .palette .swatch").first();
if (await swatch.count()) {
  await swatch.click();
  const canvas = page.locator(".stage-area canvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
}
await page.click("button:has-text('Recompute from tile flags')");
await page.waitForTimeout(150);
await page.click("button:has-text('Export stage')");
await page.waitForTimeout(800);

await browser.close();

console.log("\nDownloads captured:");
for (const d of downloads) console.log(`  ${d.name}  ${d.size}B  zip=${d.pk}`);

if (downloads.length < 3) fail(`expected ≥3 export downloads, got ${downloads.length}`);
for (const d of downloads) {
  if (!d.pk) fail(`${d.name} is not a zip (no PK header)`);
  if (d.size < 200) fail(`${d.name} suspiciously small (${d.size}B)`);
}

if (errors.length) { console.error("\n❌ FAILURES:\n" + errors.join("\n")); process.exit(1); }
console.log("\n✅ Smoke test passed: import → slice → rig → export verified across all three studios.");
