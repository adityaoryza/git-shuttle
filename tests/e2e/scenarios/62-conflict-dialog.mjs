import fs from "node:fs";
import path from "node:path";
import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const tab = (page, name) => page.getByRole("tab", { name });
const FILE = "billing/invoice.py";

export const scenarios = {
  async "conflict dialog: each change is chosen in plain words, the result is shown, and nothing is written before the preview"(t) {
    t.demo.pushToRemote("staging", FILE, "def total(lines):\n    return sum(lines) + 1\n", "[FIX] billing: somebody else changed the total");
    t.demo.git(["stash", "-u", "-q"]);
    const page = await t.page();
    await tab(page, "Ship").click();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Merge into staging" }).click();
    await page.locator(".alert-bad", { hasText: "Stopped: a rebase" }).waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Choose place by place" }).click();
    const dialog = page.getByRole("dialog", { name: "Resolve " + FILE });
    await dialog.locator(".hunk").first().waitFor({ timeout: 15000 });
    const text = await dialog.innerText();
    t.ok("the dialog explains what happened and that nothing is written yet", /Two versions changed the same lines/.test(text) && /Nothing is written until/.test(text));
    t.ok("the two versions have plain titles, not git words", text.includes("What is already there") && text.includes("Your change") && !/\bours\b|\btheirs\b|replayed/i.test(text));
    t.ok("a change asks one question and offers three answers", text.includes("Which version should the file keep?") && (await dialog.locator(".rc .choices .choice").count()) === 3);
    t.ok("an open change says it needs a choice, and the write button waits", text.includes("needs your choice") && await dialog.getByRole("button", { name: "Preview and write" }).isDisabled());
    t.ok("the result box says what to do before a choice", text.includes("Choose a version above"));
    await dialog.getByRole("button", { name: "Use “Your change”" }).click();
    t.ok("the change is decided", (await dialog.getByText("decided", { exact: true }).count()) >= 1);
    const result = await dialog.locator(".result-lines").innerText();
    t.ok("the result shows the lines of your change", result.includes("tax=0") && !result.includes("+ 1"), result);
    t.ok("the lines of the version that is kept are ticked", (await dialog.locator(".side-theirs .code-line.on").count()) === 2 && (await dialog.locator(".side-ours .code-line.on").count()) === 0);
    await dialog.getByRole("button", { name: "Keep both" }).click();
    t.ok("both can be kept, and the order is a choice", (await dialog.locator(".result-lines li").count()) === 4 && (await dialog.getByRole("button", { name: "Your change first" }).count()) === 1);
    t.ok("the code is in the colours of its language (keywords, names of functions, numbers)", (await dialog.locator(".code-line .tok-kw").count()) >= 1 && (await dialog.locator(".code-line .tok-fn").count()) >= 1 && (await dialog.locator(".result-lines .tok-kw").count()) >= 1);
    await page.screenshot({ path: "/tmp/gs-pal-dark-both.png" });
    for (const scheme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), scheme);
      await page.waitForTimeout(600);       // the colours of the page change over a moment: look when they have settled
      const low = await lowContrast(page);
      t.ok(`no text under 4.5:1 in the dialog (${scheme}), a change that keeps both`, low.length === 0, JSON.stringify(low.slice(0, 4)));
    }
    await page.screenshot({ path: "/tmp/gs-pal-light-both.png" });
    await dialog.getByRole("button", { name: "Use “What is already there”" }).click();
    for (const scheme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), scheme);
      await page.waitForTimeout(600);       // the colours of the page change over a moment: look when they have settled
      const low = await lowContrast(page);
      t.ok(`no text under 4.5:1 in the dialog (${scheme}), a change that keeps one version (the other is struck through)`, low.length === 0, JSON.stringify(low.slice(0, 4)));
    }
    await page.screenshot({ path: "/tmp/gs-pal-dark-one.png" });
    await dialog.getByRole("button", { name: "Use “Your change”" }).click();
    t.ok("nothing was written by the choices", fs.readFileSync(path.join(t.demo.work, FILE), "utf8").includes("<<<<<<<"));
    t.ok("it fits a phone", await (async () => { await page.setViewportSize({ width: 390, height: 800 }); const ok = !(await overflowsHorizontally(page)); await page.setViewportSize({ width: 1366, height: 800 }); return ok; })());
    await dialog.getByRole("button", { name: "Preview and write" }).click();
    const confirm = page.locator(".modal").last().getByRole("button", { name: "Write the choices", exact: true });
    await confirm.waitFor({ timeout: 15000 });
    await page.waitForFunction(el => !el.disabled, await confirm.elementHandle());
    await confirm.click();
    let written = "";
    for (let i = 0; i < 60; i++) {       // the write is a job: wait until the markers are gone
      written = fs.readFileSync(path.join(t.demo.work, FILE), "utf8");
      if (!written.includes("<<<<<<<")) break;
      await page.waitForTimeout(250);
    }
    t.ok("after the preview, the file has your change and no marker", written.includes("tax=0") && !written.includes("<<<<<<<") && !written.includes(">>>>>>>"), written);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },
};
