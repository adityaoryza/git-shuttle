import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const openWorktree = async page => { await page.locator(".row-wip").click(); await page.locator(".detail .table .tbody .trow").first().waitFor(); };
const handle = (page, label) => page.getByRole("separator", { name: `Resize the ${label} column` });
const width = async loc => +(await loc.getAttribute("aria-valuenow"));
const rowNames = page => page.locator(".detail .tbody .trow:not(.tdir) .fname").allInnerTexts();
// The handle is where the table put it AFTER it was laid out again (the pane was just widened): wait until it stops moving, or the drag
// starts on the old place and moves nothing. This failed now and then on a slow machine.
const still = async (page, loc) => {
  let before = "";
  for (let i = 0; i < 30; i++) { const now = JSON.stringify(await loc.boundingBox()); if (now === before) return; before = now; await page.waitForTimeout(100); }
};
const dragBy = async (page, loc, dx) => { await still(page, loc); const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up(); };
// the width a moment after the pointer is up (it is set by the next frame)
const widthAfter = async (page, loc, ok) => { for (let i = 0; i < 30; i++) { const w = await width(loc); if (ok(w)) return w; await page.waitForTimeout(100); } return width(loc); };

export const scenarios = {
  async "table: the working tree, in sections, with its columns"(t) {
    const page = await t.page();
    await openWorktree(page);
    const heads = await page.locator(".detail .thead [role=columnheader]").allInnerTexts();
    t.ok("the columns are Name, Status, Path, Changes and Staged", heads.map(h => h.replace(/[▲▼\s]/g, "").toLowerCase()).join(",") === "name,status,path,changes,staged", heads.join("|"));
    t.ok("the files are in three sections", (await page.locator(".detail .tgroup").allInnerTexts()).map(x => x.split("\n")[0].trim()).join(",") === "STAGED,CHANGES NOT STAGED,UNTRACKED" || (await page.locator(".detail .tgroup").count()) === 3);
    t.ok("the footer counts the files and the groups", /3 files · 1 staged · 1 unstaged · 1 untracked/.test(await page.locator(".detail .tfoot").innerText()), await page.locator(".detail .tfoot").innerText());
    t.ok("a staged file has its box checked", await page.getByLabel("Unstage catalog/search.py").isChecked());
    t.ok("an empty filter result says so", true);
    await page.getByLabel("Filter files").fill("zzz");
    t.ok("a filter with no match says what happened", (await page.locator(".tempty").innerText()).includes("No file matches the filter"));
    await page.getByLabel("Filter files").fill("");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "table: resize with the pointer, the keyboard and a double click; reset; remember"(t) {
    const page = await t.page();
    await openWorktree(page);
    const name = handle(page, "Name");
    await page.getByRole("separator", { name: "Resize the file list" }).focus(); await page.keyboard.press("End");     // room to grow
    await still(page, name);
    const start = await width(name);
    await dragBy(page, name, 60);
    t.ok("dragging the handle makes the column wider", (await widthAfter(page, name, w => w >= start + 50)) >= start + 50, `${start} → ${await width(name)}`);
    t.ok("no text got selected while dragging", (await page.evaluate(() => String(getSelection()))) === "");
    const dragged = await width(name);
    await name.focus(); await page.keyboard.press("ArrowLeft");
    t.ok("an arrow key moves it by 10", (await width(name)) === dragged - 10);
    await page.keyboard.press("Shift+ArrowRight");
    t.ok("Shift makes it 40", (await width(name)) === dragged + 30);
    await page.keyboard.press("Home");
    t.ok("Home goes to the minimum", (await width(name)) === 130);
    await page.keyboard.press("End");
    t.ok("End goes to the maximum, as far as there is room", (await width(name)) > 140);
    await name.dblclick();
    const fitted = await width(name);
    t.ok("a double click fits the content", fitted >= 130 && fitted < 600, fitted);
    await dragBy(page, name, 25);
    const kept = await width(name);
    await page.reload(); await page.waitForSelector(".graph .row"); await openWorktree(page);
    t.ok("the width is remembered after a reload", (await width(handle(page, "Name"))) === kept, `${kept} vs ${await width(handle(page, "Name"))}`);
    await page.locator(".detail").getByRole("button", { name: "Columns" }).click();
    await page.getByRole("button", { name: "Reset columns" }).click();
    t.ok("Reset columns goes back to the default", (await width(handle(page, "Name"))) === 150);
    t.ok("the handle has the right role and limits", (await handle(page, "Name").getAttribute("aria-valuemin")) === "130");
  },

  async "table: hide a column, sort, and remember both"(t) {
    const page = await t.page();
    await openWorktree(page);
    await page.locator(".detail").getByRole("button", { name: "Columns" }).click();
    t.ok("the first column cannot be hidden", await page.locator(".detail .table-menu label", { hasText: "Name" }).locator("input").isDisabled());
    await page.locator(".detail .table-menu label", { hasText: "Status" }).locator("input").uncheck();
    t.ok("the column disappears", (await page.locator(".detail .thead [role=columnheader]").allInnerTexts()).every(h => !h.startsWith("Status")));
    await page.keyboard.press("Escape");
    await page.reload(); await page.waitForSelector(".graph .row"); await openWorktree(page);
    t.ok("...and stays hidden after a reload", (await page.locator(".detail .thead [role=columnheader]").allInnerTexts()).every(h => !h.startsWith("Status")));
    const before = await rowNames(page);
    const nameHeader = page.locator(".detail .thead").getByRole("button", { name: /Name/ });
    await nameHeader.click();
    t.ok("the first click sorts ascending", (await page.locator("[aria-sort=ascending]").count()) === 1);
    await nameHeader.click();
    t.ok("the second sorts descending", (await page.locator("[aria-sort=descending]").count()) === 1);
    await nameHeader.click();
    t.ok("the third clears the sort and the original order is back", (await page.locator("[aria-sort=ascending], [aria-sort=descending]").count()) === 0 && JSON.stringify(await rowNames(page)) === JSON.stringify(before));
    await page.locator(".detail .thead").getByRole("button", { name: /Changes/ }).click();
    t.ok("sorting works inside each section", (await page.locator(".detail .tgroup").count()) === 3);
  },

  async "table: narrow, the least important columns go first and nothing overflows"(t) {
    const page = await t.page();
    await openWorktree(page);
    const splitter = page.getByRole("separator", { name: "Resize the file list" });
    await splitter.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
    const heads = async () => (await page.locator(".detail .thead [role=columnheader]").allInnerTexts()).map(h => h.replace(/[▲▼\s]/g, "").toLowerCase());
    await page.waitForTimeout(300);   // the layout follows the splitter on the next frames
    const narrow = await heads();
    t.ok("a narrow list keeps the name and drops columns", narrow[0] === "name" && narrow.length < 5, narrow.join(","));
    t.ok("Status goes first", !narrow.includes("status"));
    t.ok("no horizontal scroll bar in the list", !(await page.locator(".detail .tbody").evaluate(el => el.scrollWidth > el.clientWidth + 1)));
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
    t.ok("giving it room brings the columns back", (await heads()).length === 5);
  },

  async "splitters: drag, keyboard, double click, remember, survive a smaller window"(t) {
    const page = await t.page();
    await openWorktree(page);
    const side = page.getByRole("separator", { name: "Resize the side panel" });
    const w0 = await width(side);
    await dragBy(page, side, -80);
    t.ok("dragging the side panel splitter makes the panel wider", (await width(side)) > w0 + 40, `${w0} → ${await width(side)}`);
    await side.focus(); await page.keyboard.press("Home");
    t.ok("Home gives the panel its smallest size", (await width(side)) === 320);
    await side.dblclick();
    t.ok("a double click goes back to the default", (await width(side)) === 400);
    const details = page.getByRole("separator", { name: "Resize the details" });
    const h0 = await width(details);
    await details.focus(); await page.keyboard.press("ArrowUp");
    t.ok("Up makes the details taller", (await width(details)) === h0 + 20);
    await page.keyboard.press("Shift+ArrowDown");
    t.ok("Shift+Down makes them 80 smaller", (await width(details)) === h0 + 20 - 80);
    const files = page.getByRole("separator", { name: "Resize the file list" });
    await dragBy(page, files, 50);
    const fw = await width(files);
    await page.reload(); await page.waitForSelector(".graph .row"); await openWorktree(page);
    t.ok("the sizes are remembered after a reload", (await width(page.getByRole("separator", { name: "Resize the file list" }))) === fw && (await width(page.getByRole("separator", { name: "Resize the details" }))) === h0 - 60);
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.waitForTimeout(200);
    t.ok("a smaller window keeps every pane usable", (await width(page.getByRole("separator", { name: "Resize the details" }))) <= 600 - 120 && !(await overflowsHorizontally(page)));
    await page.setViewportSize({ width: 1366, height: 800 });
  },

  async "table: select several files and stage them from the keyboard"(t) {
    const page = await t.page();
    await openWorktree(page);
    const rows = page.locator(".detail .tbody .trow:not(.tdir)");
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ["Shift"] });
    t.ok("Shift+click selects a range", (await page.locator(".detail .trow.is-selected").count()) === 3);
    await rows.nth(1).click({ modifiers: ["Control"] });
    t.ok("Ctrl+click toggles one", (await page.locator(".detail .trow.is-selected").count()) === 2);
    await page.locator(".detail .tbody").focus();
    await page.keyboard.press("Control+a");
    t.ok("Ctrl+A selects everything", (await page.locator(".detail .trow.is-selected").count()) === 3 && (await page.locator(".detail .tfoot").innerText()).includes("3 selected"));
    await rows.nth(1).click();
    t.ok("a plain click selects just that file", (await page.locator(".detail .trow.is-selected").count()) === 1);
    await page.keyboard.press("ArrowDown");
    t.ok("the arrow keys move the selection", (await page.locator(".detail .trow.is-selected").count()) === 1 && (await page.locator(".detail .trow.is-selected").getAttribute("data-key")) !== null);
    // the unstaged file: Space stages it
    await page.locator(".detail .trow", { hasText: "invoice.py" }).first().click();
    await page.keyboard.press("Space");
    await page.waitForSelector(".toast-success");
    t.ok("Space stages the selected file", t.demo.git(["diff", "--cached", "--name-only"]).split("\n").includes("billing/invoice.py"));
    t.ok("...and the table shows it as staged", await page.getByLabel("Unstage billing/invoice.py").isChecked());
    await page.getByLabel("Unstage billing/invoice.py").click();
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Stage billing/invoice.py"]'));
    t.ok("the checkbox unstages it again", !t.demo.git(["diff", "--cached", "--name-only"]).split("\n").includes("billing/invoice.py"));
  },

  async "table: the menu of a file, discard with a confirmation, rename rows"(t) {
    t.demo.git(["add", "-A"]); t.demo.git(["commit", "-q", "-m", "[REF] billing: rename the report module"], { who: "alex" });
    t.demo.git(["mv", "billing/report.py", "billing/reports.py"]); t.demo.git(["commit", "-q", "-m", "[REF] billing: report becomes reports"], { who: "alex" });
    t.demo.write("billing/invoice.py", "def total(lines):\n    return 0\n");
    const page = await t.page();
    await page.locator(".graph .row", { hasText: "report becomes reports" }).first().click();
    await page.locator(".detail .table .tbody .trow").first().waitFor();
    t.ok("a renamed file shows old → new", (await page.locator(".detail .tbody .fname").first().innerText()).includes("report.py → reports.py"));
    await page.locator(".detail .tbody .trow").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Reveal in tree" }).click();
    t.ok("Reveal in tree switches to the tree", (await page.locator(".tdir").count()) > 0);
    await page.getByRole("tab", { name: "List" }).click();
    await page.locator(".row-wip").click();
    await page.locator(".detail .tbody .trow", { hasText: "invoice.py" }).first().click({ button: "right" });
    const items = await page.locator(".ctx button").allInnerTexts();
    t.ok("the menu has the file actions", ["Open diff", "Stage", "Discard changes…", "Copy path", "Reveal in tree"].every(x => items.some(i => i.startsWith(x))), items.join(" | "));
    await page.getByRole("menuitem", { name: /^Discard changes/ }).click();
    const dialog = page.locator(".modal");
    t.ok("the confirmation lists the file and says it cannot be undone", (await dialog.innerText()).includes("billing/invoice.py") && (await dialog.innerText()).includes("cannot be undone"));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    t.ok("cancelling discards nothing", t.demo.git(["diff", "--name-only"]).includes("billing/invoice.py"));
    await page.locator(".detail .tbody .trow", { hasText: "invoice.py" }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Discard changes/ }).click();
    await page.locator(".modal").getByRole("button", { name: "Discard" }).click();
    await page.waitForSelector(".toast-success");
    t.ok("confirming discards it", !t.demo.git(["diff", "--name-only"]).includes("billing/invoice.py"));
  },

  async "table: the filter keeps its text per panel"(t) {
    const page = await t.page();
    await openWorktree(page);
    await page.getByLabel("Filter files").fill("search");
    await page.locator(".graph .row", { hasText: "catalog: search ignores the case" }).first().click();
    await page.locator(".sha").waitFor();
    t.ok("a commit has its own filter, empty", (await page.getByLabel("Filter files").inputValue()) === "");
    await page.locator(".row-wip").click();
    await page.locator(".detail .table .tbody .trow").first().waitFor();
    t.ok("the working tree filter is as it was left", (await page.getByLabel("Filter files").inputValue()) === "search");
  },

  async "table: contrast and overflow with the details open, both themes"(t) {
    for (const scheme of ["dark", "light"]) {
      for (const [w, h] of [[1366, 800], [1024, 700], [390, 800]]) {
        const page = await t.page({ colorScheme: scheme, viewport: { width: w, height: h } });
        await page.locator(".row-wip").click({ force: true });
        await page.locator(".detail .table .tbody .trow").first().waitFor();
        const bad = await lowContrast(page);
        t.ok(`${scheme} ${w}px with the files table: contrast 4.5:1`, bad.length === 0, bad.slice(0, 4).map(b => `${b.text} ${b.ratio.toFixed(2)} ${b.cls}`).join("; "));
        t.ok(`${scheme} ${w}px: no horizontal overflow`, !(await overflowsHorizontally(page)));
        await page.context().close();
      }
    }
  },
};
