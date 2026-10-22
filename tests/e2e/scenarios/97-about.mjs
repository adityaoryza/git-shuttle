import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const LINKS = ["https://adityaoryza.my.id/en", "https://github.com/adityaoryza", "https://linkedin.com/in/adityaoryza"];
const dialog = page => page.getByRole("dialog", { name: "About git-shuttle" });

export const scenarios = {
  async "about: the logo, the credit line and the dialog"(t) {
    for (const scheme of ["dark", "light"]) {
      const page = await t.page({ colorScheme: scheme, viewport: { width: 1366, height: 800 } });
      const brand = page.locator("header .brand");
      t.ok(`the top bar has the logo and the name (${scheme})`, (await brand.locator("img").count()) === 1 && (await brand.innerText()).includes("shuttle"));
      t.ok("...with an accessible name", (await brand.getAttribute("aria-label")) === "About git-shuttle");
      const credit = page.locator("footer.credit");
      t.ok("the footer says who made it, with the version", /git-shuttle \d+\.\d+\.\d+/.test(await credit.innerText()) && (await credit.innerText()).includes("by Aditya Oryza"));
      t.ok("...and links to the website, safely", (await credit.locator("a").getAttribute("href")) === LINKS[0] && (await credit.locator("a").getAttribute("rel")) === "noopener noreferrer");

      await brand.click();
      await dialog(page).waitFor();
      const focusIn = await page.waitForFunction(() => !!document.activeElement.closest("[role=dialog]"), null, { timeout: 3000 }).then(() => true, () => false);
      t.ok("the focus moves into the dialog", focusIn, await page.evaluate(() => document.activeElement.outerHTML.slice(0, 100)));
      const links = dialog(page).locator("a[target=_blank]");
      const hrefs = await links.evaluateAll(list => list.map(a => a.getAttribute("href")));
      t.ok(`the dialog links to the website, GitHub and LinkedIn (${scheme})`, LINKS.every(l => hrefs.includes(l)), hrefs.join(", "));
      t.ok("...and to the project", hrefs.some(h => h.endsWith("/git-shuttle")) && hrefs.some(h => h.endsWith("/issues/new")));
      t.ok("every link opens a new tab without opener or referrer", await links.evaluateAll(list => list.every(a => a.rel.includes("noopener") && a.rel.includes("noreferrer"))));
      t.ok("the version is the server's", /Version \d+\.\d+\.\d+/.test(await dialog(page).innerText()), await dialog(page).innerText());
      t.ok("no text under 4.5:1", (await lowContrast(page)).length === 0, JSON.stringify((await lowContrast(page)).slice(0, 3)));
      await page.waitForTimeout(150);
      await page.keyboard.press("Escape");
      t.ok("Escape closes it", (await dialog(page).count()) === 0);

      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Actions" }).waitFor();
      await page.keyboard.type("about");
      await page.getByRole("option", { name: /About git-shuttle/ }).first().waitFor();
      await page.keyboard.press("Enter");
      await dialog(page).waitFor();
      t.ok("the Actions palette opens it too", (await dialog(page).count()) === 1);
      await page.waitForTimeout(150);
      await page.keyboard.press("Escape");

      const requests = [];
      page.on("request", r => { if (!r.url().startsWith("http://127.0.0.1")) requests.push(r.url()); });
      await brand.click(); await dialog(page).waitFor(); await page.waitForTimeout(150); await page.keyboard.press("Escape");
      t.ok("nothing is fetched from the internet", requests.length === 0, requests.join(", "));
      t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
    }
  },

  async "about: small screens"(t) {
    const page = await t.page({ viewport: { width: 390, height: 800 } });
    t.ok("the top bar does not overflow with the logo", !(await overflowsHorizontally(page)));
    t.ok("the credit line stays inside the window", await page.evaluate(() => { const r = document.querySelector("footer.credit").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
    await page.locator("header .brand").click();
    await dialog(page).waitFor();
    const box = await dialog(page).boundingBox();
    t.ok("the dialog fits the window", box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 801, JSON.stringify(box));
    t.ok("nothing overflows the page", !(await overflowsHorizontally(page)));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "about: the first-run screen has the logo"(t) {
    const page = await t.page({ fresh: false });
    await page.route("**/api/repos", route => (route.request().method() === "GET" ? route.fulfill({ json: { repos: [] } }) : route.continue()));
    await page.goto(t.server.url);
    await page.waitForSelector(".onboarding");
    t.ok("the empty state shows the mark", (await page.locator(".onboarding img.onboarding-mark").count()) === 1);
    t.ok("...and the brand and credit are still there", (await page.locator("header .brand").count()) === 1 && (await page.locator("footer.credit").count()) === 1);
  },
};
