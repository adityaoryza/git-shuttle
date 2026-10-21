const toasts = page => page.locator(".toast");

export const scenarios = {
  async "fetch: progress, a real summary, new commits glow"(t) {
    const page = await t.page();
    t.demo.pushToRemote("staging", "catalog/new.py", "x = 1\n", "[FEAT] catalog: a new module");
    t.demo.git(["checkout", "-q", "feature/invoice_totals"]);
    let calls = 0;
    await page.route("**/api/repos/*/fetch", async route => { calls++; await new Promise(r => setTimeout(r, 700)); await route.continue(); });
    const button = page.getByRole("button", { name: "Fetch" });
    await button.click();
    await page.getByRole("button", { name: "Fetching…" }).waitFor();
    const busy = page.getByRole("button", { name: "Fetching…" });
    t.ok("the button says what it is doing, and cannot be pressed twice", (await busy.isDisabled()) && (await busy.getAttribute("aria-busy")) === "true");
    t.ok("a progress bar runs under the top bar", await page.locator(".progress.is-active").count() === 1);
    await busy.click({ force: true, timeout: 500 }).catch(() => {});
    await toasts(page).first().waitFor();
    const toast = toasts(page).first();
    t.ok("the toast names the remote", (await toast.locator(".toast-title").innerText()).includes("Fetched origin"));
    t.ok("...and what changed, computed from the refs", (await toast.locator(".toast-detail").innerText()) === "1 new commit, 1 branch updated", await toast.locator(".toast-detail").innerText());
    t.ok("the fetch ran once", calls === 1, calls);
    t.ok("a status toast is polite, not an alert", (await toast.getAttribute("role")) === "status");
    await page.waitForSelector(".row-new");
    t.ok("the new commit glows", (await page.locator(".row-new").count()) === 1);
    t.ok("...and stops glowing", await page.waitForSelector(".row-new", { state: "detached", timeout: 9000 }).then(() => true, () => false));
    await page.unroute("**/api/repos/*/fetch");
    await page.getByRole("button", { name: "Fetch" }).click();
    await page.getByText("Already up to date").first().waitFor();
    await page.getByRole("button", { name: "Fetch" }).click();
    await page.waitForSelector(".toast-count");
    t.ok("the same message again only counts up", (await page.locator(".toast-count").first().innerText()) === "×2" && (await toasts(page).count()) <= 2, await toasts(page).count());
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "toasts: pause on hover, dismiss, errors stay, reduced motion"(t) {
    const page = await t.page();
    t.demo.git(["remote", "set-url", "origin", "/nonexistent/remote.git"]);
    await page.getByRole("button", { name: "Fetch" }).click();
    const error = page.locator(".toast-error");
    await error.waitFor();
    t.ok("an error is an alert", (await error.getAttribute("role")) === "alert");
    t.ok("it says what failed and what to do next", (await error.innerText()).includes("Fetch failed") && (await error.innerText()).includes("Check the network"));
    t.ok("it has a button to copy the details", (await error.getByRole("button", { name: "Copy details" }).count()) === 1);
    await page.waitForTimeout(8000);
    t.ok("an error stays until it is dismissed", (await error.count()) === 1);
    await error.getByRole("button", { name: "Dismiss" }).click();
    await page.waitForSelector(".toast-error", { state: "detached" });
    t.ok("dismissing removes it", (await toasts(page).count()) === 0);

    // a success toast: copy a commit id from the context menu
    await page.locator(".graph .row").nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy commit SHA" }).click();
    const ok = page.locator(".toast-success");
    await ok.waitFor();
    const bar = ok.locator(".toast-bar");
    t.ok("a success toast has a progress bar that runs", (await bar.evaluate(el => getComputedStyle(el).animationPlayState)) === "running");
    await ok.hover();
    t.ok("hovering pauses it", (await bar.evaluate(el => getComputedStyle(el).animationPlayState)) === "paused");
    await page.waitForTimeout(4600);
    t.ok("...so it is still there after its time", (await ok.count()) === 1);
    await page.mouse.move(5, 5);
    await ok.waitFor({ state: "detached", timeout: 6000 });
    t.ok("it leaves once the pointer does", (await toasts(page).count()) === 0);

    await page.locator(".graph .row").nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy commit SHA" }).click();
    await ok.waitFor();
    await ok.focus();
    await page.keyboard.press("Escape");
    await ok.waitFor({ state: "detached" });
    t.ok("Escape dismisses the focused toast", true);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "toasts: reduced motion means no movement"(t) {
    const page = await t.page({ reducedMotion: "reduce" });
    await page.locator(".graph .row").nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy commit SHA" }).click();
    const toast = page.locator(".toast-success");
    await toast.waitFor();
    const style = await toast.evaluate(el => ({ name: getComputedStyle(el).animationName, bar: getComputedStyle(el.querySelector(".toast-bar")).animationName }));
    t.ok("it fades in instead of sliding", style.name === "toast-fade", JSON.stringify(style));
    t.ok("the progress bar does not animate", style.bar === "none", JSON.stringify(style));
  },
};
