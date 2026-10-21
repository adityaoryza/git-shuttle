const pushButton = page => page.locator(".push-btn, .push-diverged");

export const scenarios = {
  async "push: commits ahead of the upstream"(t) {
    const page = await t.page();
    const button = pushButton(page);
    t.ok("the control says how many commits go", (await button.innerText()) === "Push ↑1");
    t.ok("its tooltip names the upstream", (await button.getAttribute("title")).includes("origin/feature/invoice_totals"));
    await button.click();
    await page.locator(".modal pre").waitFor();
    t.ok("the dry run is shown first", (await page.locator(".modal pre").innerText()).includes("git push origin feature/invoice_totals"));
    await page.locator(".modal").getByRole("button", { name: "Push", exact: true }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the toast says what was pushed", (await page.locator(".toast-success").first().innerText()).includes("Pushed"));
    t.ok("the remote has the commit", t.demo.remoteGit(["rev-parse", "feature/invoice_totals"]) === t.demo.git(["rev-parse", "feature/invoice_totals"]));
    await page.waitForSelector(".push-btn", { state: "detached" });
    t.ok("when in sync the control is gone", (await pushButton(page).count()) === 0);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "push: a branch that was never pushed is published"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    t.demo.git(["checkout", "-q", "-b", "feature/only_here", "staging"]);
    t.demo.write("catalog/only_here.py", "x = 1\n"); t.demo.git(["add", "-A"]); t.demo.commit("[ADD] catalog: only here", "alex", 10);
    const page = await t.page();
    const button = pushButton(page);
    t.ok("the control says Publish", (await button.innerText()) === "Publish");
    await page.locator(".branch-btn").click();
    t.ok("the picker marks it as not pushed", (await page.locator(".pick-row", { hasText: "only_here" }).first().innerText()).includes("not pushed"));
    await page.keyboard.press("Escape");
    await button.click();
    await page.locator(".modal pre").waitFor();
    t.ok("the dry run sets the upstream", (await page.locator(".modal pre").innerText()).includes("git push -u origin feature/only_here"));
    await page.locator(".modal").getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the toast says Published", (await page.locator(".toast-success").first().innerText()).includes("Published"));
    t.ok("the branch exists on the remote with an upstream", t.demo.remoteGit(["rev-parse", "feature/only_here"]) === t.demo.git(["rev-parse", "HEAD"]) && t.demo.git(["rev-parse", "--abbrev-ref", "feature/only_here@{upstream}"]) === "origin/feature/only_here");
  },

  async "push: a diverged branch needs an explicit force"(t) {
    t.demo.pushToRemote("feature/invoice_totals", "billing/other.py", "y = 2\n", "[ADD] billing: somebody else's work");
    t.demo.git(["fetch", "-q", "origin"]);
    const page = await t.page();
    const button = pushButton(page);
    t.ok("the control shows both counts, as a warning", (await button.innerText()) === "Push ↑1 ↓1" && (await button.getAttribute("class")).includes("push-diverged"));
    await button.click();
    const dialog = page.locator(".modal");
    await dialog.locator("pre").waitFor();
    t.ok("the dialog explains the divergence", (await dialog.innerText()).includes("have diverged") && (await dialog.innerText()).includes("replaces the 1 commit"));
    t.ok("the preview is the forced command", (await dialog.locator("pre").innerText()).includes("git push --force-with-lease origin feature/invoice_totals"));
    t.ok("forcing is its own button, not the default", (await dialog.getByRole("button", { name: "Force push (with lease)" }).count()) === 1 && (await dialog.getByRole("button", { name: "Push", exact: true }).count()) === 0);
    const before = t.demo.remoteGit(["rev-parse", "feature/invoice_totals"]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    t.ok("cancelling changes nothing", t.demo.remoteGit(["rev-parse", "feature/invoice_totals"]) === before);
    await button.click();
    await dialog.locator("pre").waitFor();
    await dialog.getByRole("button", { name: "Force push (with lease)" }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the toast says Force pushed", (await page.locator(".toast-success").first().innerText()).includes("Force pushed"), await page.locator(".toast").allInnerTexts());
    t.ok("the remote now has your commits", t.demo.remoteGit(["rev-parse", "feature/invoice_totals"]) === t.demo.git(["rev-parse", "feature/invoice_totals"]));
  },

  async "push: disabled, with the reason, on a protected branch"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    t.demo.git(["checkout", "-q", "staging"]);
    t.demo.write("README.md", "# acme-shop\n\nlocal edit\n"); t.demo.git(["add", "-A"]); t.demo.commit("[DOC] shop: a local commit on staging", "alex", 10);
    const page = await t.page();
    const button = pushButton(page);
    t.ok("the control is there but disabled", (await button.isDisabled()) && (await button.innerText()) === "Push ↑1");
    t.ok("the tooltip says why", (await button.getAttribute("title")).includes("protected branch"));
  },

  async "branch here: publish it in the same step"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await page.locator(".graph .row", { hasText: "billing: round the invoice total" }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Create a branch here…" }).click();
    const dialog = page.locator(".modal");
    t.ok("the dialog offers to push, off the first time", !(await dialog.getByLabel(/Push to the remote/).isChecked()));
    await dialog.getByPlaceholder("feature/my_task").fill("feature/rounding_followup");
    await dialog.getByLabel(/Push to the remote/).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await page.locator(".modal pre").waitFor();
    const text = await page.locator(".modal pre").innerText();
    t.ok("the preview has both steps", text.includes("git checkout --no-track -b feature/rounding_followup") && text.includes("git push -u origin feature/rounding_followup"), text);
    await page.getByRole("button", { name: "Create and push" }).click();
    await page.waitForSelector(".toast");
    await page.waitForFunction(() => document.querySelectorAll(".toast-success, .toast-error").length > 0);
    t.ok("the branch exists locally and on the remote", t.demo.git(["branch", "--show-current"]) === "feature/rounding_followup" && t.demo.remoteGit(["branch", "--list", "feature/rounding_followup"]).includes("rounding_followup"), (await page.locator(".toast").allInnerTexts()).join(" | ") + " :: " + t.demo.git(["branch", "--show-current"]));
    await page.reload(); await page.waitForSelector(".graph .row");
    await page.locator(".graph .row").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Create a branch here…" }).click();
    t.ok("the choice is remembered", await page.locator(".modal").getByLabel(/Push to the remote/).isChecked());
  },
};
