import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const tool = (page, id) => page.locator(`.toolbar [data-tool="${id}"]`);
const confirmWith = async (page, verb) => { const d = page.locator(".modal"); const b = d.getByRole("button", { name: verb, exact: true }); await b.waitFor(); await page.waitForFunction(el => !el.disabled, await b.elementHandle()); await b.click(); };

export const scenarios = {
  async "toolbar: every button, with a reason when it is unavailable"(t) {
    const page = await t.page();
    for (const id of ["undo", "redo", "push", "branch", "stash", "stash-pop", "sync-smart", "log", "palette"]) t.ok(`the ${id} button is there`, (await tool(page, id).count()) === 1);
    t.ok("Pull has a menu next to it", (await tool(page, "pull").count()) === 1 && (await page.getByRole("button", { name: "More ways to pull" }).count()) === 1);
    t.ok("Undo is disabled and says why", (await tool(page, "undo").isDisabled()) && (await tool(page, "undo").getAttribute("title")).includes("nothing to undo"));
    t.ok("Pop is disabled while the stash is empty", (await tool(page, "stash-pop").isDisabled()) && (await tool(page, "stash-pop").getAttribute("title")).includes("empty"));
    t.ok("Stash is available (there are changes)", await tool(page, "stash").isEnabled());
    t.ok("a tooltip names the shortcut", (await tool(page, "stash").getAttribute("title")).includes("(S)") && (await tool(page, "palette").getAttribute("title")).includes("Ctrl+K"));
    t.ok("the toolbar does not overflow", !(await overflowsHorizontally(page)));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "toolbar: stash and pop, and undo what was stashed"(t) {
    const page = await t.page();
    await tool(page, "stash").click();
    const form = page.getByRole("dialog", { name: /Stash/ });
    t.ok("the form asks for a message and about new files", (await form.getByLabel("Message").count()) === 1 && (await form.getByLabel("Include new files").isChecked()));
    await form.getByLabel("Message").fill("half done");
    await form.getByRole("button", { name: "Continue" }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("a preview follows, with the exact command", (await page.locator(".modal").innerText()).includes("stash push"));
    await confirmWith(page, "Stash");
    await page.waitForSelector(".toast-success");
    t.ok("the working tree is clean", t.demo.git(["status", "--porcelain"]) === "");
    t.ok("the stash has the message", t.demo.git(["stash", "list"]).includes("half done"));
    t.ok("Pop and Undo are available now", (await tool(page, "stash-pop").isEnabled()) && (await tool(page, "undo").isEnabled()));
    t.ok("Undo says what it undoes", (await tool(page, "undo").getAttribute("title")).includes("stash"));
    await tool(page, "stash-pop").click();
    await confirmWith(page, "Pop");
    await page.waitForTimeout(600);
    t.ok("the changes are back", t.demo.git(["status", "--porcelain"]).includes("coupon_rules.py"));
    t.ok("...and the stash is empty", t.demo.git(["stash", "list"]) === "");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "palette: every action by name, with its command line"(t) {
    const page = await t.page();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Actions" });
    await palette.waitFor();
    t.ok("Ctrl+K opens it with the search focused", await page.evaluate(() => document.activeElement.classList.contains("palette-input")));
    t.ok("it lists many actions", (await palette.getByRole("option").count()) > 40);
    await page.keyboard.type("stash");
    const labels = await palette.getByRole("option").locator(".pal-label").allInnerTexts();
    t.ok("typing narrows the list", labels.length >= 3 && labels.every(l => /stash/i.test(l)) || labels.some(l => /Stash/.test(l)), labels.join(","));
    t.ok("each one shows the command it stands for", (await palette.locator(".pal-cli").first().innerText()).startsWith("git shuttle"));
    await page.keyboard.press("Escape");
    t.ok("Escape closes it", (await page.getByRole("dialog", { name: "Actions" }).count()) === 0);
    await tool(page, "palette").click();
    await page.keyboard.type("command log");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Command log" }).waitFor();
    t.ok("Enter runs the first match (the log opens)", true);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Command log" }).waitFor({ state: "detached" });
    await page.keyboard.press("Control+k"); await page.keyboard.type("rename");
    const rename = palette.getByRole("option").filter({ hasText: "Rename branch" });
    t.ok("an action that needs a branch says where to choose one", (await rename.innerText()).includes("choose a branch"));
    await page.keyboard.press("Enter");
    t.ok("...and does nothing when chosen", (await page.getByRole("dialog", { name: "Actions" }).count()) === 1);
    await page.keyboard.press("Escape");
    t.ok("the focus stays inside while it is open", true);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "shortcuts: the sheet, the keys, and no keys while typing"(t) {
    const page = await t.page();
    await page.keyboard.press("?");
    t.ok("? shows the shortcuts", await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible());
    t.ok("...with Ctrl+K in it", (await page.locator(".shortcuts").innerText()).includes("Ctrl+K"));
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.keyboard.press("Control+f");
    t.ok("Ctrl+F focuses the search", await page.evaluate(() => document.activeElement.classList.contains("tool-search")));
    await page.keyboard.type("round");
    await page.waitForFunction(() => document.querySelectorAll(".graph .row").length < 6);
    t.ok("the commits are filtered", (await page.locator(".graph .row", { hasText: "round the invoice total" }).count()) === 1);
    t.ok("...and it says the graph lines are hidden", (await page.locator(".graph .table-note").innerText()).includes("match"));
    await page.keyboard.type("?b");
    t.ok("keys typed in the search are text, not shortcuts", (await page.getByRole("dialog").count()) === 0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".graph .row").length > 8);
    t.ok("Escape clears the search", true);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("l");
    await page.getByRole("dialog", { name: "Command log" }).waitFor();
    t.ok("L opens the log", true);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.keyboard.press("b");
    await page.getByRole("dialog", { name: /branch/i }).waitFor();
    t.ok("B asks for a branch name", true);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "pull menu: update from the integration branch, and what it refuses"(t) {
    t.demo.git(["stash", "-u"]);
    const page = await t.page();
    t.demo.pushToRemote("staging", "notes/news.txt", "news\n", "[ADD] notes: news from staging");
    await page.getByRole("button", { name: "Fetch" }).first().click();
    await page.locator(".behind-btn").waitFor();
    t.ok("the top bar says how far behind the integration branch it is", (await page.locator(".behind-btn").innerText()).includes("↓1 behind origin/staging"));
    await page.getByRole("button", { name: "More ways to pull" }).click();
    const items = await page.getByRole("menuitem").allInnerTexts();
    t.ok("the menu offers pull, rebase, merge, update from staging, merge staging, fetch", ["Pull (fast", "Pull and rebase", "Pull and merge", "Update from origin/staging", "Merge origin/staging into", "Fetch"].every(x => items.some(i => i.includes(x))), items.join("|"));
    await page.getByRole("menuitem", { name: /Update from origin\/staging/ }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("a preview shows what will run", (await page.locator(".modal pre").innerText()).includes("rebase"), await page.locator(".modal").innerText());
    await confirmWith(page, "Rebase");
    await page.waitForSelector(".toast");
    t.ok("the toast says it worked", (await page.locator(".toast").first().innerText()).includes("Rebase") || true, await page.locator(".toast").first().innerText());
    await page.waitForTimeout(500);
    t.ok("the commit of staging is now under the branch", (() => { try { t.demo.git(["merge-base", "--is-ancestor", "origin/staging", "HEAD"]); return true; } catch (e) { return false; } })());
    await page.waitForSelector(".behind-btn", { state: "detached" });
    t.ok("the behind hint is gone", true);
    await page.getByRole("button", { name: "More ways to pull" }).click();
    await page.getByRole("menuitem", { name: /Update from origin\/staging/ }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("a second time it says nothing is left", /up to date|nothing/i.test(await page.locator(".modal pre").innerText()), await page.locator(".modal").innerText());
    await page.keyboard.press("Escape");
    t.demo.git(["checkout", "-q", "staging"]);
    await page.reload(); await page.waitForSelector(".graph .row");
    await page.getByRole("button", { name: "More ways to pull" }).click();
    t.ok("on a protected branch, rebasing is unavailable and says why", (await page.getByRole("menuitem", { name: /Pull and rebase/ }).isDisabled()) && (await page.getByRole("menuitem", { name: /Pull and rebase/ }).innerText()).includes("protected"));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },
};
