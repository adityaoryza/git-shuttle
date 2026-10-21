import { overflowsHorizontally } from "../lib/checks.mjs";

const confirmWith = async (page, verb) => { const d = page.locator(".modal"); const b = d.getByRole("button", { name: verb, exact: true }); await b.waitFor(); await page.waitForFunction(el => !el.disabled, await b.elementHandle()); await b.click(); };
const openPicker = async page => { await page.waitForFunction(() => document.querySelector(".progress").getAttribute("aria-busy") === "false"); await page.locator(".branch-btn").click(); await page.locator(".popover").waitFor(); };
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
