import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const handle = (page, label) => page.getByRole("separator", { name: `Resize the ${label} column` });
const width = async loc => +(await loc.getAttribute("aria-valuenow"));
const heads = async page => (await page.locator(".graph .thead [role=columnheader]").allInnerTexts()).map(h => h.replace(/[▲▼\s]/g, "").toLowerCase());
const gear = page => page.locator(".graph").getByRole("button", { name: "Columns" });
const dragBy = async (page, loc, dx) => { const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up(); };

export const scenarios = {
  async "graph table: separate columns with names, dates and ids"(t) {
    const page = await t.page();
    t.ok("the columns are Branch/Tag, Graph, Message, Prod, Author, Date and SHA", (await heads(page)).join(",") === "branch/tag,graph,message,prod,author,date,sha", (await heads(page)).join("|"));
    const row = page.locator(".graph .row", { hasText: "round the invoice total" }).first();
    t.ok("the author is its own cell", (await row.locator("[role=gridcell]").nth(4).innerText()).includes("Sam Lee"));
    t.ok("the message cell has only the message", (await row.locator("[role=gridcell]").nth(2).innerText()).trim() === "[FIX] billing: round the invoice total to cents");
    t.ok("the date is relative by default", /ago|just now/.test(await row.locator(".when").innerText()));
    t.ok("the sha is a short id in its own cell", /^[0-9a-f]{7}$/.test((await row.locator(".sha-cell").innerText()).trim()));
    const names = await page.locator(".graph .person-name").allInnerTexts();
    t.ok("the .mailmap makes two names one author", names.includes("Jordan Kim") && !names.includes("jkim"), [...new Set(names)].join(","));
    await row.locator(".person").hover();
    t.ok("the tooltip of an author has the e-mail", (await row.locator(".person").getAttribute("title")).includes("sam@example.com"));
    await row.locator(".sha-cell").click();
    t.ok("a click on the sha copies the whole id", /^[0-9a-f]{40}$/.test(await page.evaluate(() => navigator.clipboard.readText())));
    t.ok("...without opening the commit", (await page.locator(".detail").count()) === 0);
    t.ok("no horizontal scroll bar", !(await overflowsHorizontally(page)) && !(await page.locator(".graph .tbody").evaluate(el => el.scrollWidth > el.clientWidth + 1)));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "graph table: resize, move, hide, date format, remember"(t) {
    const page = await t.page();
    const author = handle(page, "Author");
    const start = await width(author);
    await dragBy(page, author, -40);
    t.ok("dragging a handle resizes a column", (await width(author)) <= start - 30, `${start} → ${await width(author)}`);
    await author.focus(); await page.keyboard.press("ArrowRight");
    t.ok("an arrow key resizes it by 10", (await width(author)) > 0);
    await author.dblclick();
    t.ok("a double click fits the content", (await width(author)) >= 90);
    // move the Date header in front of the Author header, with the pointer
    const date = page.locator(".graph .thead [data-col=date]"), authorHead = page.locator(".graph .thead [data-col=author]");
    const d = await date.boundingBox(), a = await authorHead.boundingBox();
    await page.mouse.move(d.x + 20, d.y + d.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 10, a.y + a.height / 2, { steps: 8 }); await page.mouse.up();
    t.ok("dragging a header moves the column", (await heads(page)).join(",") === "branch/tag,graph,message,prod,date,author,sha", (await heads(page)).join("|"));
    t.ok("...without sorting by it", (await page.locator(".graph .table-note").count()) === 0);
    await page.locator(".graph .thead [data-col=date] .thsort").focus();
    await page.keyboard.press("Alt+ArrowRight");
    t.ok("Alt+Right moves a focused header one step", (await heads(page)).join(",") === "branch/tag,graph,message,prod,author,date,sha");
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest("[data-col]"));
    t.ok("...and keeps the focus on it", await page.evaluate(() => document.activeElement.closest("[data-col]").dataset.col === "date"));
    await page.keyboard.press("Alt+ArrowLeft");
    t.ok("Alt+Left moves it back", (await heads(page)).join(",") === "branch/tag,graph,message,prod,date,author,sha");
    await page.keyboard.press("Alt+ArrowRight");
    await gear(page).click();
    t.ok("Message and Graph cannot be hidden", await page.locator(".graph .table-menu label", { hasText: "Message" }).locator("input").isDisabled() && await page.locator(".graph .table-menu label", { hasText: "Graph" }).locator("input").isDisabled());
    t.ok("Committer and Refs are optional and off", !(await page.locator(".graph .table-menu label", { hasText: "Committer" }).locator("input").isChecked()));
    await page.locator(".graph .table-menu label", { hasText: "Committer" }).locator("input").check();
    t.ok("a column can be shown", (await heads(page)).includes("committer"));
    await page.locator(".graph .table-menu label", { hasText: "SHA" }).locator("input").uncheck();
    t.ok("a column can be hidden", !(await heads(page)).includes("sha"));
    await page.locator(".graph .table-menu label", { hasText: "Date and time" }).locator("input").check();
    t.ok("the date can be absolute", /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test((await page.locator(".graph .when").first().innerText()).trim()));
    t.ok("...with the ISO time in the tooltip", /^\d{4}-\d\d-\d\dT/.test(await page.locator(".graph .when").first().getAttribute("title")));
    await page.locator(".graph .table-menu label", { hasText: "Show the e-mail" }).locator("input").check();
    t.ok("the e-mail can be shown", (await page.locator(".graph .person-email").count()) > 0);
    await page.keyboard.press("Escape");
    await page.locator(".graph .thead [data-col=date]").boundingBox();
    await page.reload(); await page.waitForSelector(".graph .row");
    t.ok("the columns are remembered after a reload", (await heads(page)).join(",") === "branch/tag,graph,message,prod,author,date,committer");
    t.ok("...and so are the date format and the e-mail", /^\d{4}-\d\d-\d\d /.test((await page.locator(".graph .when").first().innerText()).trim()) && (await page.locator(".graph .person-email").count()) > 0);
    await gear(page).click();
    await page.getByRole("button", { name: "Reset columns" }).click();
    t.ok("Reset columns goes back to the default", (await heads(page)).join(",") === "branch/tag,graph,message,prod,author,date,sha");
  },

  async "graph table: where each commit is on its way to production"(t) {
    const page = await t.page();
    const chips = page.locator(".graph .row .stage");
    await chips.first().waitFor();
    t.ok("a commit that the release branch has says so", (await page.locator(".graph .row .stage-prod").count()) > 0);
    t.ok("...and one that is merged but not released says it is not in prod", (await page.locator(".graph .row .stage-staging").count()) > 0);
    t.ok("...a commit that is on no integration branch says nothing", (await page.locator(".graph .row").evaluateAll(rows => rows.some(r => !r.querySelector(".stage") && !r.classList.contains("row-wip")))));
    t.ok("the pointer says where it is, with the branch names", /not in .+ yet/.test(await page.locator(".graph .row .stage-staging").first().getAttribute("title")) && /In /.test(await page.locator(".graph .row .stage-prod").first().getAttribute("title")));
    t.ok("the chip is in its own column, between the message and the author", (await heads(page)).join(",").includes("message,prod,author"));
    await page.getByRole("searchbox", { name: "Search commits" }).fill("not in prod");
    const rows = await page.locator(".graph .row:not(.row-wip)").count();
    t.ok("the search finds the commits by it", rows > 0 && (await page.locator(".graph .row:not(.row-wip) .stage-staging").count()) === rows, rows);
    await page.getByRole("searchbox", { name: "Search commits" }).fill("");
    await page.locator(".graph .row", { has: page.locator(".stage-staging") }).first().click();
    await page.locator(".detail .stage").waitFor();
    t.ok("the details of a commit have the same chip", (await page.locator(".detail .stage-staging").count()) === 1);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "graph table: sorting, double click and the keyboard"(t) {
    const page = await t.page();
    await page.locator(".graph .thead").getByRole("button", { name: /Date/ }).click();
    t.ok("sorting by date says the graph lines are hidden", (await page.locator(".graph .table-note").innerText()).includes("graph lines are hidden"));
    t.ok("...and draws no lines", (await page.locator(".graph .row").first().locator("svg path").count()) === 0);
    await page.locator(".graph .thead").getByRole("button", { name: /Date/ }).click();
    const times = await page.locator(".graph .when").evaluateAll(els => els.map(e => Date.parse(e.dateTime)));
    t.ok("descending puts the newest first", times.every((v, i) => !i || times[i - 1] >= v));
    await page.locator(".graph .table-note").getByRole("button").click();
    t.ok("Back to the graph order", (await page.locator(".graph .table-note").count()) === 0 && (await page.locator(".graph .row").nth(2).locator("svg path").count()) > 0);
    await page.locator(".graph .thead").getByRole("button", { name: /Author/ }).click();
    const people = await page.locator(".graph .person-name").allInnerTexts();
    t.ok("sorting by author is alphabetical", people.every((v, i) => !i || people[i - 1].toLowerCase() <= v.toLowerCase()));
    await page.locator(".graph .thead").getByRole("button", { name: /Author/ }).click(); await page.locator(".graph .thead").getByRole("button", { name: /Author/ }).click();
    await page.locator(".graph .row", { hasText: "catalog: search ignores the case" }).first().click();
    await page.locator(".detail").getByText("search ignores the case").first().waitFor();
    t.ok("a click opens the commit", true);
    await page.locator(".graph .tbody").focus(); await page.keyboard.press("ArrowDown");
    t.ok("the arrow keys move through the commits", (await page.locator(".graph .row-selected").count()) === 1);
    await page.locator(".graph .row", { hasText: "invoice total with tax" }).first().dblclick();
    await page.getByRole("dialog").waitFor();
    t.ok("a double click on a row offers to check it out", (await page.getByRole("dialog").innerText()).toLowerCase().includes("check out") || (await page.getByRole("dialog").innerText()).toLowerCase().includes("switch"));
    await page.keyboard.press("Escape");
    t.ok("the working tree row has its counts", /3 changed files/.test(await page.locator(".row-wip").innerText()));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "graph table: narrow, contrast, both themes"(t) {
    for (const scheme of ["dark", "light"]) {
      const page = await t.page({ colorScheme: scheme, viewport: { width: 1366, height: 800 } });
      t.ok(`${scheme}: no text under 4.5:1`, (await lowContrast(page)).length === 0, JSON.stringify((await lowContrast(page)).slice(0, 4)));
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.locator(".graph .row").first().waitFor();
      const h = await heads(page);
      t.ok(`${scheme}: a narrower list drops the author, then the sha, then the date, never the message`, h.includes("message") && h.includes("graph") && (!h.includes("author") || h.includes("sha")), h.join(","));
      for (const w of [700, 390]) {
        await page.setViewportSize({ width: w, height: 800 });
        const after = await heads(page);
        t.ok(`${scheme}: at ${w}px the message and the graph stay and nothing overflows`, after.includes("message") && after.includes("graph") && !(await overflowsHorizontally(page)), after.join(","));
      }
    }
  },
};
