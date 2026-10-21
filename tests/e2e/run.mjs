/* Browser tests of the web UI: each scenario gets its own made-up repository and its own server.
 *
 *   node run.mjs                  every scenario
 *   node run.mjs --only toasts    the scenarios whose name contains the text
 *   node run.mjs --screenshots    regenerate docs/images from the demo repository (no tests)
 *   node run.mjs --headed         show the browser
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDemo } from "./lib/demo.mjs";
import { startServer } from "./lib/server.mjs";
import { collectErrors } from "./lib/checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const screenshots = args.includes("--screenshots");
const headed = args.includes("--headed");

let playwright;
try { playwright = await import("playwright"); } catch (e) {
  console.log("SKIPPED: Playwright is not installed. Run `npm install` in tests/e2e (or `make e2e`).");
  process.exit(0);
}
let browser;
try { browser = await playwright.chromium.launch({ headless: !headed }); } catch (e) {
  console.log("SKIPPED: Chromium is not available (" + String(e.message).split("\n")[0] + "). Run `npx playwright install chromium` in tests/e2e.");
  process.exit(0);
}

const results = [];
function context(demo, server) {
  const pages = [];
  const t = {
    demo, server,
    async page(options = {}) {
      const { fresh, ...contextOptions } = options;
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"], ...contextOptions });
      const page = await ctx.newPage();
      page.errors = collectErrors(page);
      page.on("dialog", d => d.dismiss());
      pages.push(ctx);
      if (fresh !== false) { await page.goto(server.url); await page.waitForSelector(".graph .row"); }
      return page;
    },
    ok(name, condition, detail) { results.push({ name: current + " · " + name, ok: !!condition, detail }); },
    async shot(page, name) {
      const dir = path.resolve(here, "..", "..", "docs", "images");
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, name + ".png") });
    },
  };
  t.close = () => Promise.all(pages.map(c => c.close()));
  return t;
}

let current = "";
const folder = path.join(here, screenshots ? "screenshots" : "scenarios");
const files = fs.readdirSync(folder).filter(f => f.endsWith(".mjs")).sort();
for (const file of files) {
  const scenario = await import(pathToFileURL(path.join(folder, file)).href);
  for (const [name, run] of Object.entries(scenario.scenarios)) {
    if (only && !(file + " " + name).includes(only)) continue;
    current = name;
    const demo = createDemo();
    const server = await startServer(demo, scenario.serverArgs || []);
    const t = context(demo, server);
    try { await run(t); } catch (e) { results.push({ name: name + " · crashed", ok: false, detail: String(e.stack || e).split("\n").slice(0, 6).join("\n") }); }
    await t.close();
    await server.stop();
    demo.cleanup();
  }
}
await browser.close();

for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok || !r.detail ? "" : "\n     " + String(r.detail).replace(/\n/g, "\n     ")));
const failed = results.filter(r => !r.ok).length;
console.log("\n" + (results.length - failed) + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
