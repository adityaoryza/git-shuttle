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
// (a toast stays while the pointer is on it: the pointer is moved away first)
const quiet = async page => { await page.mouse.move(5, 5); await settled(page); };
const settled = page => page.waitForFunction(() => !document.querySelector(".toast-title"), null, { timeout: 20000 }).catch(async e => { throw new Error("a toast stays: " + (await page.locator(".toast").allInnerTexts()).join(" // ")); });
// a finished job; then the toast that says so is let go (it sits over the buttons of the panel while it shows)
const finished = async (page, label) => {
  await page.locator(".result", { hasText: label }).locator(".badge", { hasText: /done|failed|stopped/ }).waitFor();
  await quiet(page);
};
const press = async (page, name) => { await quiet(page); await page.getByRole("button", { name, exact: true }).click(); };
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
    // "keep it until I close this page"
    await pw.fill("e2e-secret");
    await page.getByLabel("Keep it until I close this page").check();
    await press(page, "Deploy to preprod");
    await finished(page, "Deploy to preprod");
    t.ok("with 'keep it' the password stays for the next deploy", (await pw.inputValue()) === "e2e-secret");
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
