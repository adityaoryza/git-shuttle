import fs from "node:fs";
import path from "node:path";
import { lowContrast, overflowsHorizontally } from "../lib/checks.mjs";

const tab = page => page.getByRole("tab", { name: "Deploy" });
const sshLog = t => { try { return fs.readFileSync(path.join(t.demo.root, "ssh.log"), "utf8"); } catch (e) { return ""; } };
const addServer = async (page, values) => {
  await page.locator(".deploy").getByRole("button", { name: /^Add/ }).first().click();
  const form = page.locator(".deploy");
  await form.getByPlaceholder("staging", { exact: true }).fill(values.name);
  const [user, server] = values.host.split("@");
  await form.getByPlaceholder("deploy", { exact: true }).fill(user);
  await form.getByPlaceholder("203.0.113.10").fill(server);
  await form.getByPlaceholder("staging-update {modules}").fill(values.command);
  if (values.branch) await form.getByLabel("Branch the server runs").selectOption(values.branch);
  return form;
};
// A toast stays while the pointer is on it (the pointer is moved away first), and an error toast stays until it is dismissed: those are
// dismissed here. Without that a job that was meant to fail made the next click wait for a toast that never leaves.
const quiet = async page => {
  for (const close of await page.locator(".toast .toast-close").all()) await close.click().catch(() => {});
  await page.mouse.move(5, 5);        // after the dismissing: the pointer must not be left where the next toast appears
  await settled(page);
};
const settled = page => page.waitForFunction(() => !document.querySelector(".toast-title"), null, { timeout: 20000 }).catch(async e => { throw new Error("a toast stays: " + (await page.locator(".toast").allInnerTexts()).join(" // ")); });
// a finished job; a failed one raises its error toast a moment later: wait for it, then let the toasts go (they sit over the buttons of the panel)
const finished = async (page, label) => {
  const badge = page.locator(".result", { hasText: label }).locator(".badge", { hasText: /done|failed|stopped/ });
  await badge.waitFor();
  if (/failed|stopped/.test(await badge.innerText())) await page.locator(".toast").first().waitFor({ timeout: 5000 }).catch(() => {});
  await quiet(page);
};
const press = async (page, name) => { await quiet(page); await page.getByRole("button", { name, exact: true }).click(); };
const dismissResult = async page => { const close = page.locator(".result").getByRole("button", { name: "Dismiss" }); if (await close.count()) await close.click(); };
const resultText = page => page.locator(".result").evaluate(el => el.textContent);   // the output may be in a closed <details>

export const scenarios = {
  async "deploy tab: add a server, deploy in one click, and the last deploy is remembered"(t) {
    const page = await t.page();
    await tab(page).click();
    await page.getByText("Add the server you deploy to").waitFor();
    t.ok("with no server it says what is needed and offers to add one", (await page.locator(".deploy").getByRole("button", { name: "Add a server" }).count()) === 1);
    const form = await addServer(page, { name: "staging", host: "deploy@203.0.113.10", command: "staging-update", branch: "staging" });
    t.ok("the branch is the integration branch by default", (await form.getByLabel("Branch the server runs").inputValue()) === "staging");
    t.ok("the form does not ask for a password, and says so", (await form.innerText()).includes("The password is not asked here"));
    await form.getByPlaceholder("203.0.113.10").fill("-oProxyCommand=id");
    t.ok("a server that starts with a dash is refused in the form", (await page.getByRole("button", { name: "Save" }).isDisabled()) && (await form.innerText()).includes("Server:"));
    await form.getByPlaceholder("203.0.113.10").fill("203.0.113.10");
    await form.getByPlaceholder("deploy", { exact: true }).fill("-o");
    t.ok("a user that starts with a dash is refused", (await page.getByRole("button", { name: "Save" }).isDisabled()) && (await form.innerText()).includes("User:"));
    await form.getByPlaceholder("deploy", { exact: true }).fill("deploy");
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.locator(".deploy-facts").waitFor();
    const facts = await page.locator(".deploy-facts").innerText();
    t.ok("the server is listed with what it would run", facts.includes("staging-update") && facts.includes("deploy@203.0.113.10"), facts);
    t.ok("...and nothing connected yet", sshLog(t) === "");
    await press(page, "Show the exact command");
    await page.locator(".preview").waitFor();
    t.ok("the exact command can be shown (it is not required)", (await page.locator(".preview").innerText()).includes("staging-update"));
    t.ok("...and nothing connected", sshLog(t) === "");
    await press(page, "Deploy to staging");
    await finished(page, "Deploy to staging");
    const log = sshLog(t);
    t.ok("one click ran it on the server", log.includes("[--] [deploy@203.0.113.10] [staging-update]"), log + "\n" + (await resultText(page)));
    t.ok("without a password and without a terminal ssh never asks", log.includes("[BatchMode=yes]"));
    t.ok("the card says when it was deployed", /last deploy .* UTC/.test(await page.locator(".deploy .hint").first().innerText()));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: a production server asks for its name; the password is typed once and forgotten"(t) {
    const page = await t.page();
    await tab(page).click();
    let form = await addServer(page, { name: "production", host: "deploy@203.0.113.20", command: "production-update", branch: "main" });
    await form.getByText("More options").click();
    t.ok("a release branch asks for the typed name by default", await form.getByLabel(/Type the name of the server/).isChecked());
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.getByLabel(/Type “production”/).waitFor();
    await page.locator(".deploy-facts").waitFor();
    t.ok("without the name, Deploy is not possible", await page.getByRole("button", { name: "Deploy to production" }).isDisabled());
    await page.getByLabel(/Type “production”/).fill("prod");
    t.ok("a wrong name keeps it disabled", await page.getByRole("button", { name: "Deploy to production" }).isDisabled());
    t.ok("...and says so at the field and under the buttons", (await page.locator(".deploy").innerText()).includes("It does not match") && (await page.locator(".deploy-why").innerText()).includes("Cannot run yet"));
    t.ok("...the field is marked", (await page.getByLabel(/Type “production”/).getAttribute("aria-invalid")) === "true");
    await page.getByLabel(/Type “production”/).fill("production");
    await press(page, "Deploy to production");
    await finished(page, "Deploy to production");
    t.ok("with the name it deploys", sshLog(t).includes("[production-update]"));

    // a server that asks for a password (the stand-in asks for the one of sudo)
    await page.locator(".result").getByRole("button", { name: "Dismiss" }).click();
    form = await addServer(page, { name: "preprod", host: "ask@203.0.113.30", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    const pw = page.getByLabel("Password of the server");
    await pw.waitFor();
    t.ok("the password field hides what is typed", (await pw.getAttribute("type")) === "password");
    t.ok("...and is always there, for the login and for sudo", (await page.locator(".deploy").innerText()).includes("For the login and for sudo"));
    await pw.fill("e2e-secret");
    await press(page, "Deploy to preprod");
    await finished(page, "Deploy to preprod");
    const shown = await resultText(page);
    t.ok("the deploy worked with the password typed at the prompt", shown.includes("server ran: staging-update"), shown);
    t.ok("the password is gone from the field", (await pw.inputValue()) === "");
    t.ok("...and from the page", !(await page.locator("body").innerText()).includes("e2e-secret"));
    const history = await page.evaluate(async () => { const token = sessionStorage.getItem("shuttle.token"); const r = await fetch("/api/history?limit=50", { headers: { "X-Shuttle-Token": token } }); return r.text(); });
    t.ok("...the server's history does not have it", !history.includes("e2e-secret"));
    t.ok("...ssh was not given it as an argument", !sshLog(t).includes("e2e-secret"));
    t.ok("with a keychain the box is 'Remember on this computer' (the page-only 'keep it' is for a computer without one)", (await page.getByLabel("Keep it until I close this page").count()) === 0 && (await page.getByLabel("Remember on this computer").count()) === 1);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: typing the modules keeps the field, the focus and the page quiet"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "mods", host: "deploy@203.0.113.70", command: "staging-update {modules}", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.locator(".deploy-facts").waitFor();
    const modules = page.getByPlaceholder("sale_documents,custom_technicien");
    await modules.waitFor();
    await modules.click();
    let lostFocus = 0, skeleton = 0;
    for (const ch of "sale_documents,stock") {
      await page.keyboard.type(ch);
      if (!(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("placeholder") === "sale_documents,custom_technicien"))) lostFocus++;
      if ((await page.locator(".deploy .skeleton").count()) > 0 || (await page.locator(".deploy-facts").count()) === 0) skeleton++;
    }
    t.ok("every key goes to the field: it keeps the focus while the plan is read again", lostFocus === 0, lostFocus);
    t.ok("...the plan stays on screen meanwhile (no loading blocks)", skeleton === 0, skeleton);
    t.ok("...so no key reaches the shortcuts of the page (the command log did not open)", (await page.getByRole("dialog").count()) === 0);
    t.ok("...and the field has what was typed", (await modules.inputValue()) === "sale_documents,stock");
    await page.waitForFunction(() => /staging-update sale_documents,stock/.test(document.querySelector(".deploy-facts").innerText), null, { timeout: 8000 });
    t.ok("a moment after the last key the exact command follows what was typed", true);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: remember the password on this computer, use it without typing, and forget it"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "kept", host: "ask@203.0.113.60", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    const pw = page.getByLabel("Password of the server");
    await pw.waitFor();
    t.ok("the box is offered, and says where it is kept and what never happens", (await page.locator(".deploy").innerText()).includes("Remember on this computer"));
    await page.getByLabel("Remember on this computer").check();
    t.ok("...ticking it says how it is kept", (await page.locator(".deploy").innerText()).includes("only after the login worked"));
    await pw.fill("e2e-secret");
    await press(page, "Deploy to kept");
    await finished(page, "Deploy to kept");
    await page.getByText("The password is saved on this computer").waitFor();
    t.ok("after a login that worked it says it is saved", true);
    t.ok("the field is replaced by 'Password saved', with Forget", (await page.locator(".deploy-saved").innerText()).includes("Password saved") && (await page.getByRole("button", { name: "Forget" }).count()) === 1);
    t.ok("the password is nowhere in the page", !(await page.locator("body").innerText()).includes("e2e-secret") && !(await page.content()).includes("e2e-secret"));
    const keyring = path.join(t.demo.root, "keyring");
    t.ok("the keychain (the stand-in) has it, and no file of the demo repository does", fs.readdirSync(keyring).length === 1 && !fs.readFileSync(path.join(t.demo.work, ".git", "config"), "utf8").includes("e2e-secret"));
    await press(page, "Test the connection");
    await finished(page, "Test the connection");
    t.ok("with it saved, a test runs without typing anything", (await resultText(page)).length > 0 && (await page.locator(".result .badge").innerText()).includes("done"));
    const history = await page.evaluate(async () => { const token = sessionStorage.getItem("shuttle.token"); const r = await fetch("/api/history?limit=50", { headers: { "X-Shuttle-Token": token } }); return r.text(); });
    t.ok("the history does not have it", !history.includes("e2e-secret"));
    await press(page, "Deploy to kept");
    await finished(page, "Deploy to kept");
    t.ok("a deploy with it saved works too", (await resultText(page)).includes("server ran: staging-update"));
    await press(page, "Forget");
    const dialog = page.getByRole("dialog", { name: /Forget the saved password/ });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Forget" }).click();
    await page.getByLabel("Password of the server").waitFor();
    t.ok("forgotten: the field is back and the keychain is empty", fs.readdirSync(keyring).length === 0);
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: a saved password that cannot be read asks for the password instead of leaving the page stuck"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "stuck", host: "ask@203.0.113.80", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.getByLabel("Password of the server").fill("e2e-secret");
    await page.getByLabel("Remember on this computer").check();
    await press(page, "Deploy to stuck");
    await finished(page, "Deploy to stuck");
    await page.locator(".deploy-saved").waitFor();
    const keyring = path.join(t.demo.root, "keyring");
    fs.writeFileSync(path.join(keyring, ".broken"), "");           // the keychain stops answering
    await dismissResult(page);
    await press(page, "Deploy to stuck");
    await finished(page, "Deploy to stuck");
    await page.getByText("The saved password could not be read").waitFor();
    t.ok("the page says the saved password could not be read, and does not stay busy", true);
    t.ok("...the field to type the password is back", (await page.getByLabel("Password of the server").count()) === 1);
    t.ok("...and the buttons work again", await page.getByRole("button", { name: "Deploy to stuck" }).isEnabled());
    t.ok("nothing was run on the server for it", (sshLog(t).match(/\[staging-update\]/g) || []).length === 1);
    fs.rmSync(path.join(keyring, ".broken"));
    await dismissResult(page);          // the result of the job before has the same label: it must not be taken for the next one
    await page.getByLabel("Password of the server").fill("e2e-secret");
    await press(page, "Deploy to stuck");
    await finished(page, "Deploy to stuck");
    t.ok("typing the password works", (await resultText(page)).includes("server ran: staging-update"));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: test the connection, and a command that is an alias is run in a login shell with one click"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "alias", host: "nf@203.0.113.40", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.locator(".deploy-facts").waitFor();
    await press(page, "Test the connection");
    await finished(page, "Test the connection");
    t.ok("the test only runs `true` on the server", /\[true\]/.test(sshLog(t)) && !sshLog(t).includes("[staging-update]"), sshLog(t));
    await press(page, "Deploy to alias");
    await finished(page, "Deploy to alias");
    await page.getByText("The server does not find the command").waitFor();
    t.ok("a command that is not found says it is probably an alias", true);
    await press(page, "Run it in a login shell");
    await finished(page, "Run the command of alias in a login shell");
    await page.locator(".deploy-facts").waitFor();
    t.ok("one click saved it with a login shell", (await page.locator(".deploy-facts").innerText()).includes("bash -ic 'staging-update'"));
    await page.locator(".deploy").getByRole("button", { name: "Edit" }).click();
    t.ok("the form shows the command without the wrapper, with the box ticked", (await page.getByPlaceholder("staging-update {modules}").inputValue()) === "staging-update" && await page.getByLabel(/run it in a login shell/).isChecked());
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: a server that asks for a password says so on the page when none was typed"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "locked", host: "pw@203.0.113.50", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.locator(".deploy-facts").waitFor();
    await press(page, "Test the connection");
    await finished(page, "Test the connection");
    await page.getByText("The server asks for a password").waitFor();
    t.ok("without a password the page says the server asks for one (it is not asked anywhere else)", true);
    t.ok("...and nothing was run on the server", !sshLog(t).includes("[staging-update]"));
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },

  async "deploy tab: remove a server, and the look in both themes"(t) {
    const page = await t.page();
    await tab(page).click();
    await addServer(page, { name: "staging", host: "deploy@203.0.113.10", command: "staging-update", branch: "staging" });
    await page.getByRole("button", { name: "Save" }).click();
    await finished(page, "Save the server");
    await page.locator(".deploy-facts").waitFor();
    t.ok("nothing overflows the page", !(await overflowsHorizontally(page)));
    for (const scheme of ["dark", "light"]) {
      const themed = await t.page({ colorScheme: scheme });
      await tab(themed).click();
      await themed.locator(".deploy-facts").waitFor();
      await themed.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));    // a colour that is still fading is not measured
      t.ok(`no text under 4.5:1 (${scheme})`, (await lowContrast(themed)).length === 0, JSON.stringify((await lowContrast(themed)).slice(0, 3)));
    }
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Remove the server/ });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Remove" }).click();
    await finished(page, "Remove the server");
    await page.getByText("Add the server you deploy to").waitFor();
    t.ok("the server is gone, and the empty state is back", true);
    t.ok("...nothing was run on any server", sshLog(t) === "");
    t.ok("no page errors", page.errors.length === 0, page.errors.join("\n"));
  },
};
