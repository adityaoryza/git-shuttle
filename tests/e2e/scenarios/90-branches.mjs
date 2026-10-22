import { overflowsHorizontally } from "../lib/checks.mjs";

const confirmWith = async (page, verb) => { const d = page.locator(".modal"); const b = d.getByRole("button", { name: verb, exact: true }); await b.waitFor(); await page.waitForFunction(el => !el.disabled, await b.elementHandle()); await b.click(); };
const openPicker = async page => { await page.waitForFunction(() => document.querySelector(".progress").getAttribute("aria-busy") === "false"); if (!(await page.locator(".popover").count())) await page.locator(".branch-btn").click(); await page.locator(".popover").waitFor(); };
const kebab = (page, name) => page.getByRole("button", { name: `Actions for ${name}`, exact: true });
const branches = t => t.demo.git(["branch", "--format=%(refname:short)"]).split("\n");

export const scenarios = {
  async "branch rows: markers are buttons that compare, and every row has its menu"(t) {
    const page = await t.page();
    await openPicker(page);
    const marker = page.locator(".pick-row", { hasText: "invoice_totals" }).locator(".marker-btn");
    t.ok("the branch you are on shows ↑1 as a button", (await marker.innerText()) === "↑1" && (await marker.getAttribute("aria-label")).includes("Compare"));
    await marker.click();
    const dialog = page.getByRole("dialog", { name: "Compare" });
    await dialog.waitFor();
    await dialog.getByText("1 ahead").waitFor();
    t.ok("it opens a comparison with the upstream", (await dialog.innerText()).includes("monthly invoice report"));
    t.ok("...listing the files that changed", (await dialog.innerText()).includes("billing/report.py"));
    await page.keyboard.press("Escape");
    await openPicker(page);
    await kebab(page, "feature/invoice_totals").click();
    const here = await page.getByRole("menuitem").allInnerTexts();
    t.ok("the current branch offers pull, update, rename, upstream, compare and delete", ["Pull", "Rename", "upstream", "Compare", "Delete"].every(x => here.some(i => i.includes(x))), here.join("|"));
    t.ok("...but not merging itself", !here.some(i => /Merge feature\/invoice_totals into/.test(i)));
    t.ok("deleting the branch you are on is unavailable and says why", (await page.getByRole("menuitem", { name: /Delete/ }).innerText()).includes("you are on it"));
    await page.keyboard.press("Escape");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "branch list: what is hidden and how the list was left are remembered, whatever the address of the page"(t) {
    const page = await t.page();
    await openPicker(page);
    await page.getByRole("button", { name: "Hide feature/checkout_coupon in the graph" }).click();
    await page.getByRole("button", { name: "Show feature/checkout_coupon in the graph" }).waitFor();
    await page.locator(".pick-toggle", { hasText: "feature/" }).first().click();                  // a folder is closed
    await page.getByRole("button", { name: "Show feature/checkout_coupon in the graph" }).waitFor({ state: "detached" });
    // what a new address does to the browser: nothing of its storage is there. The server has kept it.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector(".graph .row");
    await openPicker(page);
    t.ok("the list is left as it was: the folder is still closed", (await page.locator(".popover").getByRole("button", { name: /feature\/checkout_coupon in the graph/ }).count()) === 0);
    await page.locator(".pick-toggle", { hasText: "feature/" }).first().click();
    t.ok("...opened again, the branch is still hidden", (await page.getByRole("button", { name: "Show feature/checkout_coupon in the graph" }).count()) === 1);
    await page.getByRole("button", { name: "Show feature/checkout_coupon in the graph" }).click();
    await page.getByRole("button", { name: "Hide feature/checkout_coupon in the graph" }).waitFor();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector(".graph .row");
    await openPicker(page);
    t.ok("showing it again is remembered too", (await page.getByRole("button", { name: "Show feature/checkout_coupon in the graph" }).count()) === 0);
    const kept = await page.evaluate(async () => { const r = await fetch("/api/prefs", { headers: { "X-Shuttle-Token": sessionStorage.getItem("shuttle.token") } }); return r.json(); });
    t.ok("the server keeps it, as settings of the repository", Object.keys(kept.prefs).some(k => k.startsWith("hidden:")) && "picker" in kept.prefs && "repo" in kept.prefs, JSON.stringify(Object.keys(kept.prefs)));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "branch list: it stays open behind the actions menu of a branch"(t) {
    const page = await t.page();
    await openPicker(page);
    await kebab(page, "feature/invoice_totals").click();
    await page.getByRole("menu").waitFor();
    t.ok("the actions menu opens over the list, and the list is still there", (await page.locator(".popover").count()) === 1 && (await page.getByRole("menu").count()) === 1);
    t.ok("...the menu is above the list (it can be clicked)", await page.evaluate(() => { const m = document.querySelector(".ctx").getBoundingClientRect(); const e = document.elementFromPoint(m.x + m.width / 2, m.y + 12); return !!(e && e.closest(".ctx")); }));
    await page.getByRole("menuitem", { name: /Delete/ }).hover();
    await page.getByRole("menuitem", { name: /Delete/ }).click({ force: true });        // refused for the branch you are on: nothing happens
    t.ok("an action that is refused leaves both open", (await page.locator(".popover").count()) === 1 && (await page.getByRole("menu").count()) === 1);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    t.ok("the first Escape closes the menu only", (await page.locator(".popover").count()) === 1);
    await page.keyboard.press("Escape");
    await page.locator(".popover").waitFor({ state: "detached" });
    t.ok("the second Escape closes the list", true);
    await openPicker(page);
    await kebab(page, "feature/invoice_totals").click();
    await page.getByRole("menuitem", { name: "Copy branch name" }).click();
    await page.locator(".popover").waitFor({ state: "detached" });
    t.ok("choosing an action closes the menu and the list", (await page.getByRole("menu").count()) === 0);
    await openPicker(page);
    await kebab(page, "feature/invoice_totals").click();
    await page.getByRole("menu").waitFor();
    await page.locator("header, .topbar, body").first().click({ position: { x: 5, y: 5 } });
    t.ok("a click away closes both", (await page.locator(".popover").count()) === 0 && (await page.getByRole("menu").count()) === 0);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "branch rows: rename, delete and remove the upstream"(t) {
    t.demo.git(["stash", "-u"]);
    t.demo.git(["branch", "scratch_one", "staging"]);
    const page = await t.page();
    await openPicker(page);
    await kebab(page, "feature/catalog_search").click();
    await page.getByRole("menuitem", { name: /Rename/ }).click();
    const form = page.getByRole("dialog", { name: /Rename/ });
    await form.getByLabel("New name").fill("feature/catalog_lookup");
    t.ok("it offers to rename on the remote too", (await form.getByLabel(/Rename it on origin too/).count()) === 1);
    await form.getByRole("button", { name: "Continue" }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("the preview shows the command", (await page.locator(".modal").innerText()).includes("rename feature/catalog_search feature/catalog_lookup") || /branch -m feature\/catalog_search feature\/catalog_lookup/.test(await page.locator(".modal").innerText()), await page.locator(".modal").innerText());
    await confirmWith(page, "Rename");
    await page.waitForSelector(".toast-success");
    t.ok("the branch has the new name", branches(t).includes("feature/catalog_lookup") && !branches(t).includes("feature/catalog_search"));
    t.ok("...and keeps tracking the same remote branch", t.demo.git(["rev-parse", "--abbrev-ref", "feature/catalog_lookup@{upstream}"]) === "origin/feature/catalog_search");
    await page.locator(".toast-close, .toast button[aria-label]").first().click({ timeout: 1000 }).catch(() => {});
    await openPicker(page);
    await kebab(page, "scratch_one").click();
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    const del = page.getByRole("dialog", { name: /Delete/ });
    t.ok("deleting asks whether to force", (await del.getByLabel(/even if its commits are not merged/).count()) === 1);
    await del.getByRole("button", { name: "Continue" }).click();
    await confirmWith(page, "Delete");
    await page.waitForTimeout(600);
    t.ok("the branch is gone", !branches(t).includes("scratch_one"));
    await openPicker(page);
    await kebab(page, "feature/checkout_coupon").click();
    await page.getByRole("menuitem", { name: /upstream/i }).click();
    const up = page.getByRole("dialog", { name: /upstream/i });
    await up.getByRole("combobox").selectOption("");
    await up.getByRole("button", { name: "Continue" }).click();
    await confirmWith(page, "Apply");
    await page.waitForSelector(".toast");
    await page.waitForTimeout(500);
    t.ok("the upstream is removed", (() => { try { t.demo.git(["rev-parse", "--abbrev-ref", "feature/checkout_coupon@{upstream}"]); return false; } catch (e) { return true; } })());
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "branch rows: update a branch without checking it out, and an upstream that is gone"(t) {
    t.demo.git(["stash", "-u"]);
    const page = await t.page();
    t.demo.pushToRemote("feature/checkout_coupon", "checkout/news.txt", "n\n", "[ADD] checkout: news");
    t.demo.remoteGit(["branch", "-D", "feature/billing_rounding"]);
    await page.getByRole("button", { name: "Fetch" }).first().click();
    await page.waitForSelector(".toast");
    await openPicker(page);
    const row = page.locator(".pick-row", { hasText: "checkout_coupon" });
    t.ok("a branch that is behind shows ↓1", (await row.locator(".marker-btn").innerText()) === "↓1");
    t.ok("a branch whose upstream was deleted says so", (await page.locator(".pick-row", { hasText: "billing_rounding" }).innerText()).includes("upstream gone"));
    const before = t.demo.git(["rev-parse", "HEAD"]);
    await kebab(page, "feature/checkout_coupon").click();
    await page.getByRole("menuitem", { name: /^Update feature\/checkout_coupon/ }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("the preview is a fast-forward without a checkout", /fetch.*feature\/checkout_coupon:feature\/checkout_coupon|refs\/heads/.test(await page.locator(".modal").innerText()), await page.locator(".modal").innerText());
    await page.waitForTimeout(300);
    await confirmWith(page, "Update");
    await page.waitForSelector(".toast");
    await page.waitForTimeout(500);
    t.ok("the branch is at the remote", t.demo.git(["rev-parse", "feature/checkout_coupon"]) === t.demo.git(["rev-parse", "origin/feature/checkout_coupon"]), await page.locator(".toast").first().innerText());
    t.ok("...and nothing was checked out", t.demo.git(["rev-parse", "HEAD"]) === before && t.demo.git(["symbolic-ref", "--short", "HEAD"]) === "feature/invoice_totals");
    await openPicker(page);
    await kebab(page, "feature/checkout_coupon").click();
    t.ok("up to date, Update is unavailable and says so", (await page.getByRole("menuitem", { name: /^Update feature\/checkout_coupon/ }).innerText()).includes("up to date"));
    await page.keyboard.press("Escape");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "branch menu on a narrow screen"(t) {
    const page = await t.page({ viewport: { width: 390, height: 800 } });
    await openPicker(page);
    t.ok("the list and its buttons fit", !(await overflowsHorizontally(page)));
    t.ok("every row still has its menu button", (await page.getByRole("button", { name: /^Actions for / }).count()) > 3);
  },
};
