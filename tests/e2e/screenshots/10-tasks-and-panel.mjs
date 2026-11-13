// Pictures of the README (node run.mjs --screenshots): the Release view of the Tasks dialog with a task that needs another one,
// the side panel folded, and the Deploy tab. Made-up demo data only.
import fs from "node:fs";
import path from "node:path";

// a trace as git-shuttle writes it: one task in prod, one merged only, and one built on it
function seedTrace(demo) {
  const sha = subject => demo.git(["log", "--format=%H", "-1", "--fixed-strings", "--grep", subject, "staging"]).trim();
  demo.git(["stash", "push", "-q", "-u"]);
  demo.git(["checkout", "-q", "main"]);
  for (const s of ["[FEAT] catalog: search ignores the case", "[ADD] catalog: tests for the search"]) demo.git(["cherry-pick", "-x", sha(s)]);
  demo.git(["push", "-q", "origin", "main"]);
  demo.git(["checkout", "-q", "feature/invoice_totals"]);
  demo.git(["stash", "pop", "-q", "--index"]);
  const at = days => new Date((demo.at(days)) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const lines = [];
  const task = (id, title, branch, subjects, day) => subjects.forEach((s, i) => lines.push({ time: at(day + i * 0.1), type: "commit", branch, addon: "odoo-task", task: id, title, link: "", sha: sha(s), subject: s }));
  task("1201", "Search that ignores the case", "feature/catalog_search", ["[FEAT] catalog: search ignores the case", "[ADD] catalog: tests for the search"], 3);
  task("1202", "Coupons at checkout", "feature/checkout_coupon", ["[FEAT] checkout: coupons as a percentage", "[IMP] checkout: the cart remembers its coupon"], 5);
  task("1203", "Invoice total rounded to cents", "feature/billing_rounding", ["[FIX] billing: round the invoice total to cents"], 7);
  lines.push({ time: at(8), type: "link", addon: "odoo-task", task: "1203", title: "Invoice total rounded to cents", needs: "1202" });
  const dir = path.join(demo.work, ".git", "shuttle-trace");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "events.jsonl"), lines.map(l => JSON.stringify(l)).join("\n") + "\n", { mode: 0o600 });
}

export const scenarios = {
  async "tasks: the Release view, the folded panel and Deploy"(t) {
    seedTrace(t.demo);
    for (const [key, value] of Object.entries({ host: "deploy@203.0.113.10", command: "staging-update {modules}", branch: "staging", sudo: "none", detector: "none" })) {
      t.demo.git(["config", "shuttle.deploy.staging." + key, value]);
    }
    const page = await t.page();
    await page.getByRole("button", { name: "Tasks" }).click();
    const dialog = page.getByRole("dialog", { name: "Tasks" });
    await dialog.getByRole("tab", { name: "Release" }).click();
    await dialog.getByRole("button", { name: /^1203 / }).click();
    await dialog.locator("h4.sub").waitFor();
    await dialog.screenshot({ path: path.resolve(import.meta.dirname, "..", "..", "..", "docs", "images", "22-tasks-release.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Deploy" }).click();
    await page.locator(".deploy").getByText("staging-update").first().waitFor();
    await page.locator(".deploy textarea").first().fill("billing");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await t.shot(page, "24-deploy");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("]");
    await page.locator(".strip-open").waitFor();
    await t.shot(page, "23-panel-folded");
  },
};
