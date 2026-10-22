import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const dialog = page => page.getByRole("dialog", { name: "About git-shuttle" });
const answer = (page, route, status, body, delay = 0) => page.route("**/api/update/" + route, async r => {
  if (delay) await new Promise(done => setTimeout(done, delay));
  await r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
});
const INFO = { current: "0.1.1", latest: "9.9.9", available: true, can_update: true, kind: "installed", reason: "", notes: "https://github.com/adityaoryza/git-shuttle/releases/tag/v9.9.9" };
const open = async page => { await page.locator("header .brand").click(); await dialog(page).waitFor(); await page.waitForTimeout(150); };

export const scenarios = {
  async "update: nothing is asked of the internet until the button is clicked"(t) {
    const page = await t.page();
    let asked = 0;
    await page.route("**/api/update/**", r => { asked++; r.abort(); });
    await open(page);
    await page.waitForTimeout(500);
    t.ok("opening About does not look for a release", asked === 0, asked);
    t.ok("...it offers to", (await dialog(page).getByRole("button", { name: "Check for updates" }).count()) === 1);
  },

  async "update: a newer release is found, installed, and the page says to restart"(t) {
    const page = await t.page();
    await answer(page, "check", 200, INFO, 300);
    await answer(page, "apply", 200, { ok: true, version: "9.9.9", output: "updated" }, 600);
    await open(page);
    const check = dialog(page).getByRole("button", { name: "Check for updates" });
    await check.click();
    const busy = dialog(page).getByRole("button", { name: "Looking…" });
    await busy.waitFor();
    t.ok("while it looks the button is busy and cannot be pressed twice", (await busy.isDisabled()) && (await busy.getAttribute("aria-busy")) === "true");
    await dialog(page).getByText("9.9.9 is available (you have 0.1.1)").waitFor();
    t.ok("the result says what is available", true);
    const notes = dialog(page).getByRole("link", { name: "What changed" });
    t.ok("...with a link to what changed, opened safely", (await notes.getAttribute("href")).endsWith("/releases/tag/v9.9.9") && (await notes.getAttribute("rel")) === "noopener noreferrer");
    const update = dialog(page).getByRole("button", { name: "Update to 9.9.9" });
    t.ok("an Update button names the version", (await update.count()) === 1);
    t.ok("no text under 4.5:1", (await lowContrast(page)).length === 0, JSON.stringify((await lowContrast(page)).slice(0, 3)));
    await update.click();
    await dialog(page).getByRole("button", { name: "Updating…" }).waitFor();
    t.ok("while it installs the button says so", true);
    await dialog(page).getByText("Updated to 9.9.9").first().waitFor();
    t.ok("it says it is done and what to do next", (await dialog(page).innerText()).includes("Stop git shuttle ui (Ctrl-C) and start it again"));
    t.ok("...and a toast says it too", (await page.locator(".toast").first().innerText()).includes("Updated to 9.9.9"));
    t.ok("the Update button is gone", (await dialog(page).getByRole("button", { name: /^Update to/ }).count()) === 0);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "update: when it cannot be installed from here, or there is nothing newer, or it fails"(t) {
    const page = await t.page();
    await answer(page, "check", 200, { ...INFO, can_update: false, kind: "checkout", reason: "this copy is a git checkout: update it with git pull" });
    await open(page);
    await dialog(page).getByRole("button", { name: "Check for updates" }).click();
    await dialog(page).getByText("this copy is a git checkout: update it with git pull").waitFor();
    t.ok("a checkout is told to use git pull", true);
    t.ok("...and there is no Update button", (await dialog(page).getByRole("button", { name: /^Update to/ }).count()) === 0);
    await page.unroute("**/api/update/check");
    await answer(page, "check", 200, { ...INFO, available: false, latest: "0.1.1" });
    await dialog(page).getByRole("button", { name: "Check for updates" }).click();
    await dialog(page).getByText("You have the latest release (0.1.1)").waitFor();
    t.ok("the latest release says so", (await dialog(page).getByRole("button", { name: /^Update to/ }).count()) === 0);
    await page.unroute("**/api/update/check");
    await answer(page, "check", 502, { error: "cannot reach https://github.com/adityaoryza/git-shuttle: are you online?" });
    await dialog(page).getByRole("button", { name: "Check for updates" }).click();
    await dialog(page).getByText("cannot reach https://github.com/adityaoryza/git-shuttle: are you online?").waitFor();
    t.ok("a failure says why, in the dialog", (await dialog(page).innerText()).includes("Could not update"));
    t.ok("...and the button can be pressed again", await dialog(page).getByRole("button", { name: "Check for updates" }).isEnabled());
    await page.unroute("**/api/update/check");
    await answer(page, "check", 200, INFO);
    await answer(page, "apply", 500, { error: "the download of v9.9.9 says '9.9.8', not '9.9.9': the installed copy was not touched" });
    await dialog(page).getByRole("button", { name: "Check for updates" }).click();
    await dialog(page).getByRole("button", { name: "Update to 9.9.9" }).click();
    await dialog(page).getByText("the installed copy was not touched").waitFor();
    t.ok("a failed install says why and that nothing was changed", (await dialog(page).innerText()).includes("Could not update"));
    const unexpected = page.errors.filter(e => !/Failed to load resource: the server responded with a status of 50[02]/.test(e));   // the two answers faked above
    t.ok("no page errors (but the failures that were asked for)", unexpected.length === 0, unexpected.join("\n"));
  },

  async "update: the Actions palette looks at once"(t) {
    const page = await t.page();
    await answer(page, "check", 200, INFO);
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Actions" }).waitFor();
    await page.keyboard.type("updates");
    const option = page.getByRole("option", { name: /Check for updates/ }).first();
    await option.waitFor();
    t.ok("the entry shows the command it stands for", (await option.innerText()).includes("git shuttle update --check"));
    await page.keyboard.press("Enter");
    await dialog(page).getByText("9.9.9 is available (you have 0.1.1)").waitFor();
    t.ok("About opens and has already looked", true);
  },

  async "update: small screens"(t) {
    const page = await t.page({ viewport: { width: 390, height: 800 } });
    await answer(page, "check", 200, INFO);
    await open(page);
    await dialog(page).getByRole("button", { name: "Check for updates" }).click();
    await dialog(page).getByRole("button", { name: "Update to 9.9.9" }).waitFor();
    const box = await dialog(page).boundingBox();
    t.ok("the dialog fits the window", box.x >= 0 && box.x + box.width <= 391 && box.y + box.height <= 801, JSON.stringify(box));
    t.ok("nothing overflows the page", !(await overflowsHorizontally(page)));
  },
};
