export const scenarios = {
  async "theme: light or dark, the system decides only on the first visit"(t) {
    for (const scheme of ["dark", "light"]) {
      const page = await t.page({ colorScheme: scheme });
      t.ok(`first visit follows the system (${scheme})`, (await page.getAttribute("html", "data-theme")) === scheme);
      t.ok(`...and saves nothing (${scheme})`, (await page.evaluate(() => localStorage.getItem("shuttle.theme"))) === null);
      const other = scheme === "dark" ? "light" : "dark";
      const button = page.locator(".theme-btn");
      t.ok(`the button offers the other theme (${scheme})`, (await button.getAttribute("aria-label")) === `Switch to ${other} theme`);
      await button.click();
      t.ok(`the first click switches to ${other}`, (await page.getAttribute("html", "data-theme")) === other);
      t.ok(`...and saves it`, (await page.evaluate(() => localStorage.getItem("shuttle.theme"))) === other);
      await page.reload(); await page.waitForSelector(".graph .row");
      t.ok(`a saved choice wins over the system after a reload (${scheme})`, (await page.getAttribute("html", "data-theme")) === other);
      await button.click();
      t.ok("the second click goes back", (await page.getAttribute("html", "data-theme")) === scheme);
      t.ok("there is no third state", (await page.locator(".theme-btn").count()) === 1 && !(await button.getAttribute("aria-label")).includes("system"));
      t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
      // the choice is kept by the server for every address: the next visitor of this test must be a first visit again
      await page.waitForTimeout(500);
      await page.evaluate(() => fetch("/api/prefs", { method: "POST", headers: { "X-Shuttle-Token": sessionStorage.getItem("shuttle.token"), "Content-Type": "application/json" }, body: JSON.stringify({ key: "ls:shuttle.theme", value: null }) }));
    }
  },
};
