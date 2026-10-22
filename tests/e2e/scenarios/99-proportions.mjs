import fs from "node:fs";
import path from "node:path";
import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

// entries made by hand, as the server would have written them
const seed = (t, count) => {
  const dir = path.join(t.server.config, "git-shuttle");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const state = i % 9 === 0 ? "failed" : i % 5 === 0 ? "stopped" : "done";
    lines.push(JSON.stringify({ id: i, time: new Date(Date.now() - (count - i) * 3600000).toISOString().slice(0, 19), repo: i % 4 ? "acme-shop" : "other-repo", repo_id: "x", action: i % 2 ? "push" : "pull",
      label: i % 2 ? "Push" : "Pull", state, exit: state === "done" ? 0 : 1, duration: i % 3 ? 0.7 : 12.4, commands: ["git shuttle " + (i % 2 ? "push" : "pull --ff-only")], steps: [{ exit: 0, state: "done", output: "step " + i }] }));
  }
  fs.writeFileSync(path.join(dir, "history.jsonl"), lines.join("\n") + "\n");
};

const sizes = (page, selector) => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => ({ h: Math.round(e.getBoundingClientRect().height * 10) / 10, r: getComputedStyle(e).borderTopLeftRadius, tag: e.tagName.toLowerCase() + "." + String(e.className).split(" ")[0] })), selector);
const one = (list, key) => new Set(list.map(x => x[key])).size === 1;
const log = async page => { await page.keyboard.press("l"); const d = page.getByRole("dialog", { name: "Command log" }); await d.waitFor(); await d.locator(".tbody .trow").first().waitFor(); await page.waitForTimeout(150); return d; };

export const scenarios = {
  async "proportions: every row of controls has one height, and the search fields are alike"(t) {
    seed(t, 60);
    const page = await t.page({ viewport: { width: 1366, height: 800 } });
    const top = await sizes(page, ".topbar select.input, .topbar .btn");
    t.ok("the top bar: one height", one(top, "h") && top.length >= 5, JSON.stringify(top.slice(0, 4)));
    t.ok("...and one radius", one(top, "r"));
    const tool = await sizes(page, ".toolbar .btn, .toolbar .tool-search");
    t.ok("the toolbar: one height, the search included", one(tool, "h") && tool.length >= 8, JSON.stringify(tool.map(x => x.h)));
    t.ok("...equal to the top bar", tool[0].h === top[0].h);
    t.ok("the search of the toolbar has an icon and keeps its class", (await page.locator(".tool-search-wrap .search-icon").count()) === 1 && (await page.locator("input.tool-search").count()) === 1);
    await page.locator("input.tool-search").fill("billing");
    t.ok("...a clear button appears with text, and empties it", await page.locator(".tool-search-wrap .search-clear").count() === 1);
    await page.locator(".tool-search-wrap .search-clear").click();
    t.ok("...and the field is empty and focused", (await page.locator("input.tool-search").inputValue()) === "" && (await page.evaluate(() => document.activeElement.classList.contains("tool-search"))));
    t.ok("...the clear button is gone when there is nothing to clear", (await page.locator(".tool-search-wrap .search-clear").count()) === 0);

    await page.locator(".graph .row").nth(1).click();
    await page.getByLabel("Filter files").waitFor();
    const filter = await sizes(page, "input[aria-label='Filter files']");
    const tools = await sizes(page, ".files-tools .search-input, .files-tools .segmented");
    t.ok("the file filter and its List/Tree control are of one height", one(tools, "h") && tools.length === 2, JSON.stringify(tools));
    const tabs = await sizes(page, ".panel > .segmented");
    t.ok("the Start/Ship/Release tabs keep their height (they do not shrink in the panel)", tabs.length === 1 && tabs[0].h >= 36, JSON.stringify(tabs));
    await page.locator(".branch-btn").click();
    await page.locator(".popover .search-input").waitFor();
    const picker = await sizes(page, ".popover .search-input");
    await page.keyboard.press("Escape");
    const searchBoxes = [...(await sizes(page, "input.tool-search")), ...filter, ...picker];
    t.ok("search fields (toolbar, files, branches): one height and one radius", one(searchBoxes, "h") && one(searchBoxes, "r") && searchBoxes.length === 3, JSON.stringify(searchBoxes));

    const dialog = await log(page);
    const filters = await sizes(page, ".log-filters select, .log-filters .search-input, .log-filters .segmented, .log-filters .btn");
    t.ok("the log filters: selects, search, segmented control and button are of one height", one(filters, "h") && filters.length >= 5, JSON.stringify(filters));
    t.ok("...and one radius", one(filters, "r"));
    t.ok("...the same as the search fields", filters[0].h === searchBoxes[0].h);
    const wide = await sizes(page, ".log-filters .search-input");
    t.ok("the log search has an icon", (await dialog.locator(".log-search .search-icon").count()) === 1 && wide.length === 1);
    await page.keyboard.press("Escape");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "proportions: a dialog field is 36 high, in every dialog"(t) {
    const page = await t.page();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.locator(".modal").first();
    await settings.waitFor();
    await page.waitForTimeout(150);
    const fields = await sizes(page, ".modal input.input:not([type=checkbox]), .modal select.input");
    t.ok("Settings: its text fields share one height", one(fields, "h") && fields.length >= 6, JSON.stringify(fields.map(x => x.h)));
    t.ok("...36", fields[0].h === 36);
    t.ok("...and one radius", one(fields, "r"));
    await page.keyboard.press("Escape");
    await page.locator("header .brand").click();
    await page.getByRole("dialog", { name: "About git-shuttle" }).waitFor();
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    for (const [name, open] of [["Settings", async () => page.getByRole("button", { name: "Settings" }).click()], ["About", async () => page.locator("header .brand").click()], ["Shortcuts", async () => { await page.keyboard.press("?"); }]]) {
      await open();
      await page.locator(".modal").first().waitFor();
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => { const e = document.querySelector(".modal"), h = e.querySelector(".modal-head"), b = e.querySelector(".modal-body"), f = e.querySelector(".modal-foot"), cs = x => getComputedStyle(x);
        return { radius: cs(e).borderTopLeftRadius, head: cs(h).padding, body: cs(b).padding, foot: f ? cs(f).padding : null }; });
      t.ok(`${name}: radius 10, head 12/16, body 16`, m.radius === "10px" && m.head === "12px 16px" && m.body === "16px", JSON.stringify(m));
      if (m.foot) t.ok(`${name}: the footer is 12/16`, m.foot === "12px 16px", m.foot);
      await page.keyboard.press("Escape");
      await page.locator(".modal").first().waitFor({ state: "detached" });
    }
  },

  async "proportions: the Actions palette"(t) {
    const page = await t.page({ viewport: { width: 1366, height: 800 } });
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Actions" });
    await palette.waitFor();
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const p = document.querySelector(".palette"), pr = p.getBoundingClientRect(), i = document.querySelector(".palette-input"), ir = i.getBoundingClientRect(), s = getComputedStyle(i);
      const head = document.querySelector(".palette-head").getBoundingClientRect(), ul = document.querySelector(".palette ul"), ur = ul.getBoundingClientRect();
      const rows = [...document.querySelectorAll(".palette li")].map(l => l.getBoundingClientRect().height);
      const foot = [...document.querySelectorAll(".palette-foot span")].map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
      const icon = document.querySelector(".palette-head .search-icon").getBoundingClientRect();
      return { inputH: ir.height, pl: parseFloat(s.paddingLeft), headH: head.height, headTop: head.top - pr.top, inputInsideHead: ir.top >= head.top - 1 && ir.bottom <= head.bottom + 1,
        ulRight: ur.right, paletteRight: pr.right, rowSpread: Math.max(...rows) - Math.min(...rows), footSpread: Math.max(...foot) - Math.min(...foot), iconLeft: icon.left - pr.left, iconVsText: ir.left + parseFloat(s.paddingLeft) - icon.right };
    });
    t.ok("the field is at least 40 high", m.inputH >= 40, m.inputH);
    t.ok("...its text starts at least 12 from the edge, after the icon", m.pl >= 12 && m.iconVsText >= 8, JSON.stringify(m));
    t.ok("...and it sits inside its head, which touches the top of the dialog", m.inputInsideHead && m.headTop <= 1, JSON.stringify(m));
    t.ok("the list is inside the dialog (the scrollbar does not overlap the corner)", m.ulRight <= m.paletteRight, JSON.stringify(m));
    t.ok("the rows are of one height", m.rowSpread <= 2, m.rowSpread);
    t.ok("the hints at the bottom are on one line", m.footSpread <= 1, m.footSpread);
    await page.keyboard.type("push");
    await page.waitForTimeout(100);
    t.ok("typing keeps the field where it is", (await page.evaluate(() => document.querySelector(".palette-input").getBoundingClientRect().height)) >= 40);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "proportions: the command log (no header under the gear, nothing clipped, nothing scrolls sideways)"(t) {
    seed(t, 130);
    for (const width of [1366, 1024]) {
      const page = await t.page({ viewport: { width, height: 800 } });
      const dialog = await log(page);
      const m = await page.evaluate(() => {
        const d = document.querySelector("[role=dialog][aria-label='Command log']"), gear = d.querySelector(".table-gear").getBoundingClientRect();
        const heads = [...d.querySelectorAll(".thcell")].map(h => { const r = h.getBoundingClientRect(); return { l: r.left, r: r.right, t: h.textContent.trim() }; });
        const overlap = heads.filter(h => gear.left < h.r - 0.5 && gear.right > h.l + 0.5);
        const row = d.querySelector(".tbody .trow:not(.tfull)"), cells = [...row.querySelectorAll(".tcell")].map(c => c.getBoundingClientRect());
        const aligned = heads.every((h, i) => cells[i] && Math.abs(cells[i].left - h.l) <= 1.5 && Math.abs(cells[i].width - (h.r - h.l)) <= 1.5);
        const clipped = [...d.querySelectorAll(".tbody .trow:not(.tfull) .tcell")].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 14));
        const body = d.querySelector(".tbody"), mb = d.querySelector(".modal-body");
        const last = [...row.querySelectorAll(".tcell")].pop();
        return { overlap, aligned, clipped, bodyScrollsSideways: body.scrollWidth > body.clientWidth + 1, modalScrolls: mb.scrollWidth > mb.clientWidth + 1, lastAlign: getComputedStyle(last).textAlign, lastRight: last.getBoundingClientRect().right, gearLeft: gear.left,
          dialogRight: d.getBoundingClientRect().right, vw: innerWidth };
      });
      t.ok(`${width}px: no header is under the gear`, m.overlap.length === 0, JSON.stringify(m.overlap));
      t.ok(`${width}px: the header and the rows share the widths of the columns`, m.aligned);
      t.ok(`${width}px: no cell is clipped (units included)`, m.clipped.length === 0, m.clipped.join(", "));
      t.ok(`${width}px: the list does not scroll sideways`, !m.bodyScrollsSideways && !m.modalScrolls);
      t.ok(`${width}px: the last column is on the right and stays left of the gear`, m.lastAlign === "right" && m.lastRight <= m.gearLeft + 0.5, JSON.stringify(m));
      t.ok(`${width}px: the dialog is inside the window`, m.dialogRight <= m.vw);
      const text = await dialog.locator(".tbody .trow[aria-selected]").first().innerText();
      t.ok(`${width}px: the last column shows its unit`, /\d(\.\d)? ?(ms|s)\b/.test(text), text);
      t.ok(`${width}px: no page errors`, page.errors.length === 0, page.errors.join("\n"));
    }
  },

  async "proportions: contrast and no sideways scroll, in both themes and three widths"(t) {
    seed(t, 40);
    for (const scheme of ["dark", "light"]) {
      for (const [width, height] of [[1366, 800], [1024, 700], [390, 800]]) {
        const page = await t.page({ colorScheme: scheme, viewport: { width, height } });
        for (const [name, open, close] of [
          ["palette", () => page.keyboard.press("Control+k"), "Escape"],
          ["log", async () => { await page.keyboard.press("l"); await page.locator(".tbody .trow").first().waitFor(); }, "Escape"],
          ["settings", () => page.getByRole("button", { name: "Settings" }).click(), "Escape"],
        ]) {
          if (name === "settings" && width === 390) { await page.locator("header").first().waitFor(); }
          await open();
          await page.locator(name === "palette" ? ".palette" : ".modal").first().waitFor();
          await page.waitForTimeout(200);
          const low = await lowContrast(page);
          t.ok(`${scheme} ${width}: ${name}: no text under 4.5:1`, low.length === 0, JSON.stringify(low.slice(0, 3)));
          t.ok(`${scheme} ${width}: ${name}: the page does not scroll sideways`, !(await overflowsHorizontally(page)));
          await page.keyboard.press(close);
          await page.waitForTimeout(150);
        }
        t.ok(`${scheme} ${width}: no page errors`, page.errors.length === 0, page.errors.join("\n"));
      }
    }
  },
};
