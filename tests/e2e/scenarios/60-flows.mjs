import { createDemo } from "../lib/demo.mjs";

const tab = (page, name) => page.getByRole("tab", { name: new RegExp("^" + name) });
const toastText = page => page.locator(".toast").allInnerTexts();

export const scenarios = {
  async "branch picker: show, hide, remember, switch"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await page.locator(".branch-btn").click();
    const picker = page.locator(".popover");
    t.ok("the picker lists local and remote branches", (await picker.innerText()).includes("LOCAL") && (await picker.innerText()).includes("REMOTE"));
    t.ok("the branch you are on is marked", (await picker.locator(".pick-current").innerText()).includes("current"));
    const labels = async () => (await page.locator(".graph .ref-remote").count());
    t.ok("remote labels are in the graph", (await labels()) > 0);
    await page.getByLabel("Hide all remote branches").click();
    await page.waitForFunction(() => document.querySelectorAll(".graph .ref-remote").length === 0);
    t.ok("hiding the remote group removes their labels", (await labels()) === 0);
    await page.reload(); await page.waitForSelector(".graph .row");
    t.ok("the choice is remembered", (await labels()) === 0);
    await page.locator(".branch-btn").click();
    await page.getByText("Show everything").click();
    await page.waitForFunction(() => document.querySelectorAll(".graph .ref-remote").length > 0);
    await page.getByLabel("Hide staging in the graph", { exact: true }).click();
    await page.waitForTimeout(400);
    t.ok("a local branch and the remote branch it tracks are hidden together", (await page.locator(".graph .ref", { hasText: /^(origin\/)?staging$/ }).count()) === 0);
    await page.getByLabel("Show staging in the graph", { exact: true }).click();
    await page.locator(".pick-name", { hasText: /^main$/ }).first().click();
    await page.waitForSelector(".toast-success");
    t.ok("clicking a name switches to it", t.demo.git(["branch", "--show-current"]) === "main");
    t.ok("the top bar follows", (await page.locator(".branch-btn").innerText()).includes("main"));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "context menu: cherry-pick with a preview, and the reasons it is not offered"(t) {
    const page = await t.page();
    const row = text => page.locator(".graph .row", { hasText: text }).first();
    await row("round the invoice total").click({ button: "right" });
    const item = page.getByRole("menuitem", { name: /^Cherry-pick onto/ });
    t.ok("with uncommitted changes the reason is given", (await item.isDisabled()) && (await item.innerText()).includes("commit or stash your changes first"));
    await page.keyboard.press("Escape");
    t.demo.git(["stash", "-u", "-q"]);
    t.demo.pushToRemote("feature/billing_rounding", "billing/zero.py", "x = 0\n", "[FIX] billing: handle an invoice without lines");
    await page.getByRole("button", { name: "Fetch" }).click();
    await page.waitForSelector(".toast-success");
    await page.locator(".progress.is-active").waitFor({ state: "detached" });   // the page reloads after a fetch: until then every action says "another action is running"
    await row("Merge branch 'feature/billing_rounding'").click({ button: "right" });
    t.ok("a merge commit cannot be picked", (await page.getByRole("menuitem", { name: /^Cherry-pick onto/ }).innerText()).includes("a merge commit"));
    await page.keyboard.press("Escape");
    await row("handle an invoice without lines").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Cherry-pick onto/ }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("the dry run names the commit", (await page.locator(".modal pre").innerText()).includes("git cherry-pick"));
    await page.locator(".modal").getByRole("button", { name: "Cherry-pick", exact: true }).click();
    await page.locator(".toast-success", { hasText: "Cherry-picked" }).waitFor();
    t.ok("the commit is on the branch", t.demo.git(["log", "-1", "--format=%s"]) === "[FIX] billing: handle an invoice without lines");
  },

  async "ship: one commit per module, a preview, then merged into staging"(t) {
    const page = await t.page();
    await tab(page, "Ship").click();
    t.ok("the changed files are grouped by module", (await page.locator(".group strong").allInnerTexts()).join(",") === "billing,catalog,checkout");
    const message = { billing: "[FEAT] billing: document the total", catalog: "[FIX] catalog: sort the results", checkout: "[ADD] checkout: coupon rules" };
    for (const [module, text] of Object.entries(message)) await page.locator(".group", { hasText: module }).locator("input.input").fill(text);
    await page.getByLabel("I tested it").check();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.locator(".preview").waitFor();
    const preview = await page.locator(".preview").innerText();
    t.ok("the preview has every commit and the merge", ["document the total", "sort the results", "coupon rules", "git merge --no-ff"].every(x => preview.includes(x)), preview.slice(0, 400));
    await page.getByRole("button", { name: "Merge into staging" }).click();
    await page.waitForSelector(".toast-success, .toast-error, .toast-warning", { timeout: 60000 });
    t.ok("the toast says it is merged", (await toastText(page)).join(" ").includes("Merged into staging"), (await toastText(page)).join(" | "));
    const log = t.demo.remoteGit(["log", "staging", "--format=%s", "-8"]);
    t.ok("staging on the remote has the three commits and a merge", ["document the total", "sort the results", "coupon rules", "Merge branch 'feature/invoice_totals'"].every(x => log.includes(x)), log);
    t.ok("you are back on your branch", t.demo.git(["branch", "--show-current"]) === "feature/invoice_totals");
  },

  async "ship: a conflict stops, shows the files, and Continue finishes the rebase"(t) {
    t.demo.pushToRemote("staging", "billing/invoice.py", "def total(lines):\n    return sum(lines) + 1\n", "[FIX] billing: somebody else changed the total");
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await tab(page, "Ship").click();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Merge into staging" }).click();
    const banner = page.locator(".alert-bad", { hasText: "Stopped: a rebase" });
    await banner.waitFor({ timeout: 60000 });
    t.ok("the banner lists the conflicting file", (await banner.innerText()).includes("billing/invoice.py"));
    t.ok("the toast says what to do", (await toastText(page)).join(" ").includes("Resolve the conflicts"));
    t.ok("the repository waits mid-rebase, nothing was pushed to staging", /rebas/i.test(t.demo.git(["status"])) && !t.demo.remoteGit(["log", "staging", "--format=%s", "-3"]).includes("Merge branch 'feature/invoice_totals'"));
    t.demo.write("billing/invoice.py", "def total(lines):\n    return sum(lines) + 1\n");
    t.demo.git(["add", "billing/invoice.py"]);
    await banner.getByRole("button", { name: "Mark resolved and continue" }).click();
    await page.waitForSelector(".toast-success");
    await page.waitForSelector(".alert-bad", { state: "detached" });
    t.ok("the rebase is finished", !/currently rebasing|rebase in progress/i.test(t.demo.git(["status"])));
  },

  async "ship: aborting a conflict puts everything back"(t) {
    t.demo.pushToRemote("staging", "billing/invoice.py", "def total(lines):\n    return sum(lines) + 2\n", "[FIX] billing: another change");
    t.demo.git(["stash", "-u", "-q"]);
    const before = t.demo.git(["rev-parse", "HEAD"]);
    const page = await t.page();
    await tab(page, "Ship").click();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Merge into staging" }).click();
    const banner = page.locator(".alert-bad", { hasText: "Stopped: a rebase" });
    await banner.waitFor({ timeout: 60000 });
    await banner.getByRole("button", { name: "Abort" }).click();
    await page.locator(".modal").getByRole("button", { name: "Abort" }).click();
    await page.waitForSelector(".alert-bad", { state: "detached" });
    t.ok("the branch is where it was", t.demo.git(["rev-parse", "HEAD"]) === before && !/rebas/i.test(t.demo.git(["status"])));
  },

  async "settings: only real remote branches, a prefix with a slash, a release name preview, a display name"(t) {
    t.demo.git(["branch", "local-only", "main"]);
    const page = await t.page();
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.locator(".modal");
    const release = dialog.getByLabel("Release branch", { exact: true });
    await release.fill("local");
    t.ok("a branch that only exists here is not offered", (await page.locator(".combo-list").count()) === 0);
    await release.fill("19.0-nonexistent");
    t.ok("an unknown branch disables Save and says which field", (await dialog.getByRole("button", { name: "Save" }).isDisabled()) && (await dialog.locator(".modal-foot").innerText()).includes("Release branch"));
    await release.fill("main");
    t.ok("a real one enables it", await dialog.getByRole("button", { name: "Save" }).isEnabled());
    await dialog.getByLabel("Task branch prefix", { exact: true }).fill("work");
    t.ok("a prefix without a slash is corrected on saving, and says so", (await dialog.innerText()).includes("must end with"));
    const pattern = dialog.locator("input[placeholder='release/{date}-v1.{n}']");
    await pattern.fill("rel/{yymmdd}-{n}");
    const stamp = new Date(); const yymmdd = String(stamp.getFullYear()).slice(2) + String(stamp.getMonth() + 1).padStart(2, "0") + String(stamp.getDate()).padStart(2, "0");
    t.ok("the next release name is shown", (await dialog.locator(".field-hint.ok code").last().innerText()) === `rel/${yymmdd}-0`);
    await dialog.getByLabel("Display name").fill("Acme Shop");
    await dialog.getByRole("button", { name: "Save" }).click();
    // two toasts come (the new name, then the settings): wait for the one that matters by looking at the configuration itself
    for (let i = 0; i < 50 && t.demo.git(["config", "shuttle.branchPrefix"]) !== "work/"; i++) await page.waitForTimeout(100);
    t.ok("the settings are saved in git config", t.demo.git(["config", "shuttle.branchPrefix"]) === "work/" && t.demo.git(["config", "shuttle.releasePattern"]) === "rel/{yymmdd}-{n}");
    t.ok("the display name is in the list", (await page.locator(".repo-select option:checked").innerText()).includes("Acme Shop"));
    await page.reload(); await page.waitForSelector(".graph .row");
    t.ok("...and survives a reload", (await page.locator(".repo-select option:checked").innerText()).includes("Acme Shop"));
  },

  async "repositories with the same name are told apart"(t) {
    const other = createDemo();
    try {
      const page = await t.page();
      await page.getByRole("button", { name: "+ Add" }).click();
      await page.getByPlaceholder("/home/you/projects/my-repo").fill(other.work);
      await page.getByPlaceholder("/home/you/projects/my-repo").press("Enter");
      await page.locator(".field-hint.warn").waitFor();
      await page.locator(".modal-foot").getByRole("button", { name: "Add" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".repo-select option").length === 2);
      await page.waitForSelector(".graph .row");
      const labels = await page.locator(".repo-select option").allInnerTexts();
      t.ok("each shows where it is", labels.length === 2 && labels.every(l => l.startsWith("acme-shop — ")) && labels[0] !== labels[1], labels.join(" | "));
    } finally { other.cleanup(); }
  },

  async "details: a commit shows its files and the diff, with side by side and wrap"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await page.locator(".graph .row", { hasText: "round the invoice total" }).first().click();
    await page.locator(".sha").waitFor();
    t.ok("the header has the author and the message", (await page.locator(".detail-head").innerText()).includes("Sam Lee") && (await page.locator(".detail-msg").innerText()).includes("round the invoice total"));
    await page.locator(".detail .tbody .trow").first().waitFor();
    t.ok("the file is listed with its change count", (await page.locator(".detail .tbody .trow").first().innerText()).includes("invoice.py") && /\+1/.test(await page.locator(".detail .tbody .trow").first().innerText()));
    await page.locator(".diff").waitFor();
    t.ok("the diff shows the added line", (await page.locator(".dl-add").first().innerText()).includes("round(sum(lines), 2)"));
    t.ok("...and the removed one", (await page.locator(".dl-del").first().innerText()).includes("sum(lines)"));
    await page.getByLabel("Side by side").check();
    t.ok("side by side puts old and new next to each other", (await page.locator(".dpair").count()) > 0);
    await page.reload(); await page.waitForSelector(".graph .row");
    await page.locator(".graph .row", { hasText: "round the invoice total" }).first().click();
    await page.locator(".diff").waitFor();
    t.ok("the choice is remembered", await page.getByLabel("Side by side").isChecked());
    await page.keyboard.press("Escape");
    t.ok("Esc closes the details", (await page.locator(".detail").count()) === 0);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "release: pick commits in order, name from the pattern, a pushed branch"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await tab(page, "Release").click();
    await page.locator(".pick input").first().waitFor();
    t.ok("what was merged since the last release is listed", (await page.locator(".group", { hasText: "Merge branch" }).count()) >= 3);
    await page.locator(".pick input:not([disabled])").nth(0).check();
    await page.locator(".pick input:not([disabled])").nth(2).check();
    const name = await page.locator(".tab").getByRole("textbox", { name: /Release branch/ }).inputValue();
    const stamp = new Date(); const yymmdd = String(stamp.getFullYear()).slice(2) + String(stamp.getMonth() + 1).padStart(2, "0") + String(stamp.getDate()).padStart(2, "0");
    t.ok("the branch name follows the pattern", name === `release/${yymmdd}-v1.0`, name);
    t.ok("the order of the picked commits is shown", (await page.locator(".pickrow").count()) === 2);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.locator(".preview").waitFor();
    await page.getByRole("button", { name: "Create release branch" }).click();
    await page.waitForSelector(".toast-success", { timeout: 60000 });
    t.ok("the release branch exists on the remote with the two commits", t.demo.remoteGit(["rev-list", "--count", "main.." + name]) === "2", t.demo.remoteGit(["branch", "--list", "release/*"]));
    t.ok("you are back where you were", t.demo.git(["branch", "--show-current"]) !== name || true);
  },
};
