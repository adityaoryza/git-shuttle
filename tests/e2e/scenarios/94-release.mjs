import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const release = page => page.getByRole("tab", { name: "Release" });
const picks = page => page.locator(".release .pick input:not([disabled])");
const showAll = page => page.locator(".release-tools .segmented").getByRole("tab", { name: /^All/ }).click();
const showOpen = page => page.locator(".release-tools .segmented").getByRole("tab", { name: /^Not released/ }).click();
const open = async page => { await release(page).click(); await page.locator(".release-groups .group").first().waitFor(); };
const run = async (page, label) => {
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator(".preview").waitFor();
  const text = await page.locator(".preview").innerText();
  if (text.includes("Refused")) throw new Error("the preview was refused: " + text.slice(0, 300));
  await page.getByRole("button", { name: label }).click();
};

export const scenarios = {
  async "release tab: how it works, the name from the pattern, a search, hide released, select all"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await open(page);
    const how = (await page.locator(".how").innerText());
    t.ok("four steps are said at the top", ["Pick the commits", "Order them", "Name the branch", "Create it"].every(s => how.includes(s)));
    const name = await page.locator(".next-name-text").innerText();
    t.ok("the next branch name comes from the pattern", /^release\/\d{6}-v1\.\d+$/.test(name), name);
    t.ok("...and the pattern can be changed from here", (await page.getByRole("button", { name: "Change the pattern" }).count()) === 1);
    await page.getByRole("button", { name: "Change the pattern" }).click();
    await page.getByRole("dialog", { name: /Settings/ }).waitFor();
    t.ok("...it opens Settings", true);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: /Settings/ }).waitFor({ state: "detached" });

    const all = await page.locator(".release .pick").count();
    const counter = page.locator(".release-count .hint").first();
    t.ok("released commits are hidden by default", (await page.locator(".release .pick .stage").count()) === 0);
    t.ok("...the two choices say how many commits each lists", /Not released · \d+/.test(await page.locator(".release-tools .segmented").innerText()) && /All · \d+/.test(await page.locator(".release-tools .segmented").innerText()));
    await showAll(page);
    t.ok("...and can be shown, each with where it is", (await page.locator(".release .pick").count()) >= all && (await page.locator(".release .pick .stage").count()) === (await page.locator(".release .pick").count()));
    await showOpen(page);
    t.ok("every commit says who made it", (await page.locator(".release .pick .pick-author").allInnerTexts()).every(name => name.trim().length > 0));

    await page.getByRole("searchbox", { name: "Search the commits" }).fill("coupon");
    t.ok("the search narrows the list", (await page.locator(".release .pick").count()) >= 1 && (await page.locator(".release .pick").count()) < all, await counter.innerText());
    t.ok("...every commit left matches the search or its merge does", (await page.locator(".release .group").allInnerTexts()).every(text => /coupon/i.test(text)));
    t.ok("...and the counter says how many of how many", /\d+ of \d+ commits/.test(await counter.innerText()), await counter.innerText());
    await page.getByRole("searchbox", { name: "Search the commits" }).fill("zzzzzz-nothing");
    t.ok("a search with no match says so", (await page.locator(".release-groups").innerText()).includes("No commit matches"));
    await page.getByRole("searchbox", { name: "Search the commits" }).fill("");

    await page.getByRole("button", { name: /Select all unreleased/ }).click();
    const pickedCount = await picks(page).evaluateAll(list => list.filter(i => i.checked).length);
    t.ok("Select all picks every unreleased commit", pickedCount === (await picks(page).count()) && pickedCount > 0, pickedCount);
    t.ok("...the counter says how many are picked", (await counter.innerText()).includes(pickedCount + " picked"));
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    t.ok("Clear unpicks them", (await picks(page).evaluateAll(list => list.filter(i => i.checked).length)) === 0);
    await page.locator(".release .group").first().getByRole("button", { name: "Select all" }).click();
    t.ok("a merge has its own Select all", (await page.locator(".pickrow").count()) >= 1);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "release tab: order, remove, the notes for the pull request"(t) {
    const page = await t.page();
    await open(page);
    await picks(page).nth(0).check();
    await picks(page).nth(1).check();
    await picks(page).nth(2).check();
    const first = await page.locator(".pickrow code").first().innerText();
    await page.locator(".pickrow").nth(0).getByRole("button", { name: /down/ }).click();
    t.ok("a commit can be moved down", (await page.locator(".pickrow code").nth(1).innerText()) === first);
    await page.locator(".pickrow").nth(2).getByRole("button", { name: /^Remove/ }).click();
    t.ok("...or removed from the order", (await page.locator(".pickrow").count()) === 2 && (await picks(page).evaluateAll(list => list.filter(i => i.checked).length)) === 2);
    await page.getByRole("button", { name: "Copy release notes" }).click();
    const notes = await page.evaluate(() => navigator.clipboard.readText());
    t.ok("the release notes are Markdown, by module", notes.startsWith("## Release release/") && /### `[a-z_]+`\n- /.test(notes), notes.slice(0, 120));
    t.ok("...with short hashes in the order picked", (notes.match(/\([0-9a-f]{7}\)/g) || []).length === 2);
  },

  async "release tab: an empty release branch now, commits added to it later"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await open(page);
    const name = await page.locator(".next-name-text").innerText();
    t.ok("with nothing picked the button makes the branch with no commit yet", (await page.getByRole("button", { name: "Preview" }).count()) === 1 && (await page.locator(".release .actions .hint").last().innerText()).includes("Preview"));
    await run(page, "Create the release branch (no commits yet)");
    await page.waitForSelector(".toast-success", { timeout: 60000 });
    t.ok("the branch is on the remote at the release branch", t.demo.remoteGit(["rev-list", "--count", "main.." + name]) === "0", t.demo.remoteGit(["branch", "--list", "release/*"]));

    await page.reload(); await page.waitForSelector(".graph .row");
    await open(page);
    await page.getByRole("tab", { name: /Add to existing/ }).click();
    t.ok("the release branches that exist are offered, newest first", (await page.getByLabel("Release branch to add to").locator("option").first().innerText()) === name, await page.getByLabel("Release branch to add to").innerText());
    t.ok("...and the button waits for commits", await page.getByRole("button", { name: /^Add commits to / }).isDisabled());
    await picks(page).nth(0).check();
    const label = "Add 1 commit to " + name;
    await run(page, label);
    await page.waitForSelector(".toast-success", { timeout: 60000 });
    t.ok("the commit is on the branch, on the remote too", t.demo.remoteGit(["rev-list", "--count", "main.." + name]) === "1", t.demo.remoteGit(["rev-list", "--count", "main.." + name]));
    await page.getByText("Done:", { exact: false }).first().waitFor();
    t.ok("the tab says it is done and what comes next", (await page.locator(".release").innerText()).includes("until its pull request is merged") && (await page.getByRole("button", { name: "Open the pull request" }).count()) >= 1);
    t.ok("what was picked is cleared", (await page.locator(".pickrow").count()) === 0 && (await picks(page).evaluateAll(list => list.filter(i => i.checked).length)) === 0);
    await showAll(page);
    const queued = page.locator(".release .pick .stage-queued", { hasText: name });
    await queued.first().waitFor();
    t.ok("the commit shows the release branch it is in, not \"released\"", (await queued.count()) === 1, await page.locator(".release .pick .stage").allInnerTexts());
    t.ok("...and cannot be picked again", await page.locator(".release .pick", { has: page.locator(".stage-queued", { hasText: name }) }).locator("input").isDisabled());
    await showOpen(page);
    t.ok("...and \"Not released\" hides it", (await page.locator(".release .pick .stage-queued", { hasText: name }).count()) === 0);
  },

  async "release tab: small screens and contrast"(t) {
    const page = await t.page({ viewport: { width: 390, height: 800 } });
    await open(page);
    t.ok("nothing overflows the page", !(await overflowsHorizontally(page)));
    t.ok("the steps wrap inside the panel", await page.evaluate(() => { const r = document.querySelector(".how").getBoundingClientRect(); return r.right <= innerWidth + 1; }));
    for (const scheme of ["dark", "light"]) {
      const themed = await t.page({ colorScheme: scheme });
      await open(themed);
      t.ok(`no text under 4.5:1 (${scheme})`, (await lowContrast(themed)).length === 0, JSON.stringify((await lowContrast(themed)).slice(0, 3)));
    }
  },
};
