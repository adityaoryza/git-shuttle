import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const NOTICE = { enabled: true, forced_off: false, current: "0.3.4", latest: "0.3.5", available: true, can_update: true, kind: "installed", snoozed: false, notes: "https://github.com/adityaoryza/git-shuttle/releases/tag/v0.3.5" };
const INFO = { current: "0.3.4", latest: "0.3.5", available: true, can_update: true, kind: "installed", reason: "", notes: NOTICE.notes };
const dialog = page => page.getByRole("dialog", { name: "About git-shuttle" });
const banner = page => page.locator(".update-banner");
// a page whose server says what the reminder is (the server of the tests never looks: it is turned off), and keeps what the page posts
const APPLIED = { status: 200, body: { ok: true, version: "0.3.5", output: "updated" }, delay: 500 };
const withNotice = async (t, first, options = {}) => {
  const { apply = APPLIED, check = INFO, ...pageOptions } = options;
  const page = await t.page({ fresh: false, ...pageOptions });
  const posted = [];
  let current = first;
  await page.route(/\/api\/update\/notice$/, async r => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      posted.push(body);
      if ("snooze" in body) current = { ...current, snoozed: true };
      if ("enabled" in body) current = { ...current, enabled: body.enabled };
    }
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
  });
  await page.route(/\/api\/update\/apply$/, async r => { await new Promise(done => setTimeout(done, apply.delay)); await r.fulfill({ status: apply.status, contentType: "application/json", body: JSON.stringify(apply.body) }); });
  await page.route(/\/api\/update\/check$/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(check) }));
  await page.goto(t.server.url);
  await page.waitForSelector(".graph .row");
  return { page, posted };
};

export const scenarios = {
  async "notice: a newer release is reminded under the top bar, and Later puts it off for that release"(t) {
    const { page, posted } = await withNotice(t, NOTICE);
    await banner(page).waitFor();
    const text = await banner(page).innerText();
    t.ok("it says which release is out and which one you have", text.includes("git-shuttle 0.3.5 is available") && text.includes("You have 0.3.4"), text);
    t.ok("...with what changed, opened safely", (await banner(page).getByRole("link", { name: "What changed" }).getAttribute("rel")).includes("noopener"));
    t.ok("...and the button to update, with the version", (await banner(page).getByRole("button", { name: "Update to 0.3.5" }).count()) === 1);
    await banner(page).getByRole("button", { name: "Later" }).click();
    await banner(page).waitFor({ state: "detached" });
    t.ok("Later removes it, and tells the server which release it is for", posted.length === 1 && posted[0].snooze === "0.3.5", JSON.stringify(posted));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "notice: the button updates right there, and says to restart"(t) {
    const { page } = await withNotice(t, NOTICE);
    const update = banner(page).getByRole("button", { name: "Update to 0.3.5" });
    await update.click();
    await banner(page).getByRole("button", { name: "Updating…" }).waitFor();
    t.ok("while it installs the button says so and cannot be pressed twice", await banner(page).getByRole("button", { name: "Updating…" }).isDisabled());
    t.ok("...and Later waits", await banner(page).getByRole("button", { name: "Later" }).isDisabled());
    await banner(page).getByText("Updated to 0.3.5").waitFor();
    const done = await banner(page).innerText();
    t.ok("it says it is done and what to do next, in the same bar", done.includes("Updated to 0.3.5") && done.includes("Ctrl-C"), done);
    t.ok("...and a toast says it too", (await page.locator(".toast-title", { hasText: "Updated to 0.3.5" }).count()) === 1);
    await banner(page).getByRole("button", { name: "Dismiss" }).click();
    await banner(page).waitFor({ state: "detached" });
    t.ok("Dismiss removes the bar", true);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "notice: a failed update says why in the bar and can be tried again"(t) {
    const { page } = await withNotice(t, NOTICE, { apply: { status: 500, body: { error: "cannot reach github.com: are you online?" }, delay: 200 } });
    await banner(page).getByRole("button", { name: "Update to 0.3.5" }).click();
    await banner(page).getByText("cannot reach github.com").waitFor();
    t.ok("the reason is in the bar, and the bar stays", (await banner(page).count()) === 1);
    t.ok("...the button can be pressed again", await banner(page).getByRole("button", { name: "Update to 0.3.5" }).isEnabled());
  },

  async "notice: About has the switch for the reminder"(t) {
    const { page, posted } = await withNotice(t, NOTICE);
    await banner(page).waitFor();
    await page.locator("header .brand").click();
    await dialog(page).waitFor();
    const remind = dialog(page).getByLabel("Remind me when a new version is out");
    t.ok("the switch is on", await remind.isChecked());
    t.ok("...and says what is asked, once an hour, and that nothing about you is sent", (await dialog(page).innerText()).includes("At most once an hour, this server (or a git-shuttle command) asks github.com for the number of the latest release"));
    await remind.uncheck();
    await page.waitForFunction(() => !document.querySelector(".update-banner"));
    t.ok("turning it off tells the server, and the reminder goes", posted.some(b => b.enabled === false) && (await banner(page).count()) === 0, JSON.stringify(posted));
    await remind.check();
    await banner(page).waitFor();
    t.ok("turning it on again brings it back", posted.some(b => b.enabled === true));
  },

  async "notice: nothing to say when it is off, when nothing is newer, and when the environment turned it off"(t) {
    for (const [name, over] of [["nothing newer", { available: false }], ["turned off", { enabled: false }], ["put off", { snoozed: true }]]) {
      const { page } = await withNotice(t, { ...NOTICE, ...over });
      await page.waitForTimeout(400);
      t.ok(`no reminder: ${name}`, (await banner(page).count()) === 0);
      await page.close();
    }
    const { page } = await withNotice(t, { ...NOTICE, enabled: false, forced_off: true, available: false });
    await page.locator("header .brand").click();
    await dialog(page).waitFor();
    t.ok("when the environment turned it off the switch is off and cannot be changed, and says why", (await dialog(page).getByLabel("Remind me when a new version is out").isDisabled()) && (await dialog(page).innerText()).includes("GIT_SHUTTLE_NO_UPDATE_CHECK"));
  },

  async "notice: a copy that cannot be updated here is told how"(t) {
    const { page } = await withNotice(t, { ...NOTICE, can_update: false, kind: "checkout" }, { check: { ...INFO, can_update: false, kind: "checkout", reason: "this copy is a git checkout: update it with git pull" } });
    await banner(page).waitFor();
    t.ok("the button says how, it does not offer to update", (await banner(page).getByRole("button", { name: "How to update" }).count()) === 1 && (await banner(page).getByRole("button", { name: /^Update to/ }).count()) === 0);
    await banner(page).getByRole("button", { name: "How to update" }).click();
    await dialog(page).waitFor();
    await dialog(page).getByText(/git pull/).waitFor();          // About looks first
    t.ok("...and it opens About, which says why a git clone is updated with git pull", true);
  },

  async "notice: the look, in both themes and on a small screen"(t) {
    for (const scheme of ["dark", "light"]) {
      const { page } = await withNotice(t, NOTICE, { colorScheme: scheme });
      await banner(page).waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      t.ok(`no text under 4.5:1 (${scheme})`, (await lowContrast(page)).length === 0, JSON.stringify((await lowContrast(page)).slice(0, 3)));
    }
    const { page } = await withNotice(t, NOTICE, { viewport: { width: 390, height: 800 } });
    await banner(page).waitFor();
    t.ok("nothing overflows a small screen", !(await overflowsHorizontally(page)));
    t.ok("...and the banner stays inside the window", await page.evaluate(() => { const r = document.querySelector(".update-banner").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
  },
};
