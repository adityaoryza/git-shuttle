import fs from "node:fs";
import path from "node:path";
import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

// entries made by hand, as the server would have written them
const seed = (t, count) => {
  const dir = path.join(t.server.config, "git-shuttle");
  fs.mkdirSync(dir, { recursive: true });
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const state = i % 9 === 0 ? "failed" : i % 5 === 0 ? "stopped" : "done";
    lines.push(JSON.stringify({ id: i, time: day(Math.floor((count - i) / 30)) + "T10:" + String(i % 60).padStart(2, "0") + ":00", repo: i % 4 ? "acme-shop" : "other-repo", repo_id: "x", action: i % 2 ? "push" : "pull", label: "Step number " + i,
      state, exit: state === "done" ? 0 : 1, duration: 0.5, commands: ["git shuttle " + (i % 2 ? "push" : "pull --ff-only")], steps: [{ exit: 0, state: "done", output: "output of step " + i + "\nhttps://***@example.org/x.git" }], ...(i % 2 ? {} : { params: { mode: "ff" } }) }));
  }
  fs.writeFileSync(path.join(dir, "history.jsonl"), lines.join("\n") + "\n");
};
const open = async page => { await page.keyboard.press("l"); const d = page.getByRole("dialog", { name: "Command log" }); await d.waitFor(); await d.locator(".tbody .trow").first().waitFor(); return d; };

export const scenarios = {
  async "log: paged, filtered, expandable, and it stays inside the window"(t) {
    seed(t, 130);
    const page = await t.page();
    const d = await open(page);
    t.ok("the search has the focus when the log opens", await page.evaluate(() => document.activeElement.getAttribute("aria-label") === "Search the log"));
    t.ok("the first page has 50 entries", (await d.locator(".trow[data-key^=e]").count()) === 50, await d.locator(".trow[data-key^=e]").count());
    t.ok("the total is shown", (await d.innerText()).includes("130 entries"));
    t.ok("there are day separators", (await d.locator(".day-sep").count()) >= 2 && (await d.locator(".day-sep").first().innerText()) === "Today");
    const box = await page.locator(".modal-log").boundingBox();
    t.ok("the dialog is at most 85% of the window high", box.height <= 800 * 0.85 + 1, box.height);
    t.ok("only the list scrolls (the dialog body does not)", await page.locator(".modal-log .modal-body").evaluate(el => el.scrollHeight <= el.clientHeight + 1));
    await d.locator(".tbody").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length > 50);
    t.ok("scrolling to the end loads the next page", true);
    await d.locator(".tbody").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length === 130, null, { timeout: 8000 });
    const ids = await d.locator(".trow[data-key^=e]").evaluateAll(els => els.map(e => e.dataset.key));
    t.ok("all 130, each once", new Set(ids).size === 130);
    await d.getByText("End of the log").waitFor();
    t.ok("the end says so", true);
    // filters
    await d.getByRole("button", { name: /^Failed/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length < 30);
    const results = await d.locator(".trow[data-key^=e] .badge").allInnerTexts();
    t.ok("the result filter keeps only failures", results.length > 0 && results.every(r => r.includes("failed")), results.slice(0, 3).join(","));
    t.ok("the button shows how many", /Failed \d+/.test(await d.getByRole("button", { name: /^Failed/ }).innerText()));
    await d.getByLabel("Filter by repository", { exact: true }).selectOption("other-repo");
    await page.waitForFunction(() => [...document.querySelectorAll(".modal-log .trow[data-key^=e]")].every(r => r.innerText.includes("other-repo")));
    t.ok("the repository filter narrows it", true);
    t.ok("the filters can be cleared in one click", (await d.getByRole("button", { name: /Clear filters \(2\)/ }).count()) === 1);
    await d.getByRole("button", { name: /Clear filters/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length === 50);
    await d.locator(".tbody").focus();
    await page.keyboard.press("/");
    t.ok("/ moves the focus to the search from the list", await page.evaluate(() => document.activeElement.getAttribute("aria-label") === "Search the log"));
    await page.keyboard.type("number 77");
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length === 1);
    t.ok("/ focuses the search and finds one entry", (await d.locator(".trow[data-key^=e]").innerText()).includes("Step number 77"));
    // expand
    await d.locator(".trow[data-key^=e]").click();
    await d.locator(".log-detail").waitFor();
    t.ok("a click shows the commands and the output", (await d.locator(".log-detail").innerText()).includes("output of step 77"));
    t.ok("the output has no credentials", !(await d.locator(".log-detail").innerText()).includes("user:"));
    t.ok("a push can be run again... only when safe (this one is a push without params: no button)", (await d.getByRole("button", { name: /Run again/ }).count()) === 0);
    await d.getByRole("button", { name: "Copy output" }).click();
    t.ok("the output can be copied", (await page.evaluate(() => navigator.clipboard.readText())).includes("output of step 77"));
    await d.getByLabel("Search the log").fill("number 78");
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length === 1 && !document.querySelector(".modal-log .log-detail"));
    await d.locator(".trow[data-key^=e]").click();
    await d.getByRole("button", { name: /Run again/ }).click();
    await page.locator(".modal pre").waitFor();
    t.ok("Run again goes through the preview first", (await page.locator(".modal").innerText()).includes("Refused, nothing was changed") && (await page.locator(".modal pre").innerText()).includes("uncommitted changes"), await page.locator(".modal").innerText());
    await page.keyboard.press("Escape");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "log: filters are remembered, the log is live and can be cleared"(t) {
    seed(t, 12);
    const page = await t.page();
    let d = await open(page);
    await d.getByRole("button", { name: /^Done/ }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.reload(); await page.waitForSelector(".graph .row");
    d = await open(page);
    t.ok("the result filter is remembered after a reload", (await d.getByRole("button", { name: /^Done/ }).getAttribute("aria-pressed")) === "true");
    await d.getByRole("button", { name: /Clear filters/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".modal-log .trow[data-key^=e]").length === 12);
    const before = await d.locator(".trow[data-key^=e]").count();
    // an action finishes while the log is open: it joins the top
    await page.evaluate(async () => {
      const token = sessionStorage.getItem("shuttle.token"), repo = localStorage.getItem("shuttle.repo");
      await fetch("/api/repos/" + repo + "/run", { method: "POST", headers: { "X-Shuttle-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", params: { name: "no_such_branch" }, label: "Delete no_such_branch" }) });
    });
    await page.keyboard.press("Escape");
    t.ok("(the page learns about it when it next reloads)", true);
    await page.reload(); await page.waitForSelector(".graph .row");
    d = await open(page);
    t.ok("the failed action is the newest entry", (await d.locator(".trow[data-key^=e]").first().innerText()).includes("Delete no_such_branch") && (await d.locator(".trow[data-key^=e]").first().innerText()).includes("failed"));
    t.ok("one more than before", (await d.locator(".trow[data-key^=e]").count()) === before + 1);
    await d.locator(".trow[data-key^=e]").first().click();
    t.ok("its output says what went wrong", (await d.locator(".log-detail").innerText()).toLowerCase().includes("no local branch") || (await d.locator(".log-detail").innerText()).toLowerCase().includes("error"));
    await d.getByRole("button", { name: "Clear log" }).click();
    await page.getByRole("dialog", { name: /Clear the whole log/ }).getByRole("button", { name: "Clear the log" }).click();
    await d.getByText(/Nothing has been run yet/).waitFor();
    t.ok("Clear log asks first and empties the list", true);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "log: keyboard, small screens, contrast"(t) {
    seed(t, 40);
    for (const [w, h] of [[1366, 800], [1024, 700], [390, 800]]) {
      const page = await t.page({ viewport: { width: w, height: h } });
      const d = await open(page);
      const box = await page.locator(".modal-log").boundingBox();
      t.ok(`${w}px: the dialog fits the window`, box.height <= h * 0.85 + 1 && box.width <= w, JSON.stringify(box));
      t.ok(`${w}px: nothing overflows the page`, !(await overflowsHorizontally(page)));
      t.ok(`${w}px: the table does not scroll sideways`, await d.locator(".tbody").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      if (w === 1366) {
        await d.locator(".tbody").focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
        t.ok("arrows and Enter open an entry", (await d.locator(".log-detail").count()) === 1);
        await page.keyboard.press("Enter");
        t.ok("Enter closes it again", (await d.locator(".log-detail").count()) === 0);
        t.ok("the rows have roles and the result has an icon", (await d.locator("[role=grid]").count()) === 1 && (await d.locator(".badge span[aria-hidden]").count()) > 0);
        t.ok("no text under 4.5:1", (await lowContrast(page)).length === 0, JSON.stringify((await lowContrast(page)).slice(0, 3)));
      }
      await page.keyboard.press("Escape");
      t.ok(`${w}px: Escape closes the log`, (await page.getByRole("dialog", { name: "Command log" }).count()) === 0);
    }
  },
};
