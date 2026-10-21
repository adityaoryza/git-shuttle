const startTab = page => page.getByRole("tab", { name: "Start" });

export const scenarios = {
  async "start: on a task branch with changes, a way forward (stash)"(t) {
    const page = await t.page();
    t.demo.git(["checkout", "-q", "feature/invoice_totals"]);
    await page.reload(); await page.waitForSelector(".graph .row");
    t.ok("a task with work opens on Ship", (await page.getByRole("tab", { name: /^Ship/ }).getAttribute("aria-selected")) === "true");
    await startTab(page).click();
    const line = await page.locator(".state-line").innerText();
    t.ok("the state line says where you are", line.startsWith("You are on feature/invoice_totals") && line.includes("↑2 ↓0 vs origin/staging") && line.includes("uncommitted change"), line);
    t.ok("a card offers to continue here", (await page.locator(".continue-card").innerText()).includes("You are working on feature/invoice_totals"));
    t.ok("the form is called Start another task", (await page.locator(".section", { hasText: "Start another task" }).count()) === 1);
    await page.getByPlaceholder("e.g. keep manual order date").fill("Coupon rules");
    t.ok("a choice for the uncommitted changes appears, with stash as the safe default", await page.getByLabel(/Stash them first/).isChecked());
    await page.getByRole("button", { name: "Preview" }).click();
    await page.locator(".preview").waitFor();
    const text = await page.locator(".preview").innerText();
    t.ok("the preview shows the stash and the branch", text.includes("git stash push") && text.includes("git checkout --no-track -b feature/coupon_rules"), text);
    await page.getByRole("button", { name: "Create branch" }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the branch is created", t.demo.git(["branch", "--show-current"]) === "feature/coupon_rules");
    t.ok("the changes are in the stash, named after the branch", t.demo.git(["stash", "list"]).includes("feature/invoice_totals"));
    t.ok("the toast says what to do next", (await page.locator(".toast-success").first().innerText()).includes("Make your changes, then use Ship."));
    t.ok("the page moves to Ship", (await page.getByRole("tab", { name: /^Ship/ }).getAttribute("aria-selected")) === "true");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "start: take the changes along"(t) {
    t.demo.git(["checkout", "--", "billing/invoice.py"]);      // that file differs on staging: it would conflict (see the next scenario)
    const page = await t.page();
    await startTab(page).click();
    await page.getByPlaceholder("e.g. keep manual order date").fill("Carry on");
    await page.getByLabel(/Take them along/).check();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.locator(".preview").waitFor();
    t.ok("the preview shows the checkout and no stash", !(await page.locator(".preview").innerText()).includes("git stash"));
    await page.getByRole("button", { name: "Create branch" }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the branch is created with the changes", t.demo.git(["branch", "--show-current"]) === "feature/carry_on" && t.demo.git(["status", "--porcelain", "--untracked-files=no"]).includes("catalog/search.py"));
    t.ok("there is no stash", t.demo.git(["stash", "list"]) === "");
  },

  async "start: taking changes along that conflict stops cleanly"(t) {
    const page = await t.page();
    await startTab(page).click();
    await page.getByPlaceholder("e.g. keep manual order date").fill("Conflicting carry");
    await page.getByLabel(/Take them along/).check();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Create branch" }).click();
    const toast = page.locator(".toast-error, .toast-warning");
    await toast.first().waitFor();
    t.ok("the toast says the changes conflict and that nothing changed", /conflict/.test(await toast.first().innerText()) && (await toast.first().innerText()).includes("nothing was changed"));
    t.ok("you are still on your branch, with your changes", t.demo.git(["branch", "--show-current"]) === "feature/invoice_totals" && t.demo.git(["status", "--porcelain", "--untracked-files=no"]).includes("billing/invoice.py"));
    t.ok("no branch and no stash were made", t.demo.git(["branch", "--list", "feature/conflicting_carry"]) === "" && t.demo.git(["stash", "list"]) === "");
  },

  async "start: a refused preview offers the two ways out"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    t.demo.git(["checkout", "-q", "staging"]);
    const page = await t.page();
    t.demo.write("README.md", "# acme-shop\n\nEdited after the page loaded.\n");      // the state changes under the page
    await page.getByPlaceholder("e.g. keep manual order date").fill("Late change");
    t.ok("the page still believes the tree is clean", (await page.locator(".choice").count()) === 0);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.locator(".preview").waitFor();
    t.ok("the preview is refused because of the changes", (await page.locator(".preview").innerText()).includes("uncommitted changes"));
    t.ok("Stash and start / Take changes along appear under the refusal", (await page.getByRole("button", { name: "Stash and start" }).count()) === 1 && (await page.getByRole("button", { name: "Take changes along" }).count()) === 1);
    await page.getByRole("button", { name: "Stash and start" }).click();
    await page.waitForFunction(() => document.querySelector(".preview") && document.querySelector(".preview").innerText.includes("git stash push"));
    t.ok("choosing one previews the command it stands for", true);
  },

  async "start: a name that is taken offers to switch to it"(t) {
    const page = await t.page();
    await startTab(page).click();
    await page.getByPlaceholder("e.g. keep manual order date").fill("catalog search");
    t.ok("it says the branch exists", (await page.locator(".alert").innerText()).includes("feature/catalog_search already exists here"));
    t.ok("Create branch cannot be previewed", await page.getByRole("button", { name: "Preview" }).isDisabled());
    await page.getByRole("button", { name: "Switch to it" }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("the switch is previewed in a dialog", (await page.locator(".modal pre").innerText()).includes("git checkout"));
  },

  async "start: from the integration branch with a clean tree it stays simple"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    t.demo.git(["checkout", "-q", "staging"]);
    const page = await t.page();
    t.ok("it opens on Start", (await page.getByRole("tab", { name: "Start" }).getAttribute("aria-selected")) === "true");
    t.ok("there is no continue card and no choice", (await page.locator(".continue-card").count()) === 0 && (await page.locator(".choice").count()) === 0);
    t.ok("the form is called Start a task", (await page.locator(".section", { hasText: "Start a task" }).count()) === 1);
    await page.getByPlaceholder("e.g. keep manual order date").fill("From staging");
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Create branch" }).click();
    await page.waitForSelector(".toast-success");
    t.ok("the branch is created", t.demo.git(["branch", "--show-current"]) === "feature/from_staging");
  },
};
