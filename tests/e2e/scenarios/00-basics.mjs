import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

export const scenarios = {
  async "load: the page opens with its token, hides it and draws the graph"(t) {
    const page = await t.page();
    t.ok("the token is not left in the address bar", !page.url().includes("token"), page.url());
    t.ok("the repository is listed", (await page.locator(".repo-select option").first().innerText()).includes("acme-shop"));
    t.ok("the branch you are on is in the top bar", (await page.locator(".branch-btn").innerText()).includes("feature/invoice_totals"));
    t.ok("commits are drawn", (await page.locator(".graph .row").count()) > 8);
    await page.reload(); await page.waitForSelector(".graph .row");
    t.ok("a refresh keeps working (the token stays for this tab)", (await page.locator(".graph .row").count()) > 8);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "old server: a banner explains it"(t) {
    const page = await t.page({ fresh: false });
    await page.route("**/api/version", route => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }));
    await page.goto(t.server.url);
    await page.waitForSelector(".banner");
    t.ok("the banner says to restart", (await page.locator(".banner").innerText()).includes("stop it (Ctrl-C) and run git shuttle ui again"));
  },

  async "contrast and overflow: both themes, three widths"(t) {
    for (const scheme of ["dark", "light"]) {
      for (const [w, h] of [[1366, 800], [1024, 700], [390, 800]]) {
        const page = await t.page({ colorScheme: scheme, viewport: { width: w, height: h } });
        const bad = await lowContrast(page);
        t.ok(`${scheme} ${w}px: every text has 4.5:1 contrast`, bad.length === 0, bad.slice(0, 4).map(b => `${b.text} ${b.ratio.toFixed(2)}`).join("; "));
        t.ok(`${scheme} ${w}px: nothing makes the page wider than the window`, !(await overflowsHorizontally(page)));
        await page.context().close();
      }
    }
  },
};
