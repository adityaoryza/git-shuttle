import assert from "node:assert";
import { unwrapLogin, wrapLogin, deployParams, deployProblems, emptyForm, formOf, lastDeployText, setupParams, setupProblems, splitHost, suggestRequireName, tidyModules } from "../../ui/shuttle_ui/static/js/deploy.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const target = over => ({ target: "staging", host: "u@h", port: "", command: "x {modules}", branch: "develop", sudo: "none", detector: "odoo", confirm: "none", ...over });
const plan = over => ({ modules: "a,b", "needs-modules": "0", ...over });

t("modules typed by hand are tidied", () => {
  assert.strictEqual(tidyModules(" a, b;c  d,, "), "a,b,c,d");
  assert.strictEqual(tidyModules(""), "");
});
t("the request carries the modules only when they were changed, and the name only when it is right", () => {
  assert.deepStrictEqual(deployParams(target(), { modules: "", typed: "" }), { target: "staging" });
  assert.deepStrictEqual(deployParams(target(), { modules: "a", typed: "" }), { target: "staging", modules: "a" });
  const prod = target({ target: "production", confirm: "name" });
  assert.deepStrictEqual(deployParams(prod, { modules: "", typed: "prod" }), { target: "production" });
  assert.deepStrictEqual(deployParams(prod, { modules: "", typed: "production" }), { target: "production", confirm: "production" });
});
t("the sudo password is never a parameter", () => {
  assert.ok(!("sudo_password" in deployParams(target({ sudo: "ask" }), { modules: "", typed: "", password: "x" })));
});
t("a deploy with nothing in the way has no problem", () => {
  assert.deepStrictEqual(deployProblems(target(), plan(), { modules: "", typed: "", password: "" }), []);
});
t("each thing that is missing is said", () => {
  assert.match(deployProblems(null, null, {})[0], /Choose/);
  assert.match(deployProblems(target(), null, {})[0], /Reading/);
  assert.match(deployProblems(target(), plan({ modules: "", "needs-modules": "1" }), { modules: "", typed: "" })[0], /Name the modules/);
  assert.deepStrictEqual(deployProblems(target(), plan({ modules: "", "needs-modules": "1" }), { modules: "a", typed: "" }), []);
  assert.match(deployProblems(target(), plan(), { modules: "a b", typed: "" })[0], /separated by commas/);
  assert.match(deployProblems(target({ confirm: "name" }), plan(), { modules: "", typed: "stag" })[0], /Type “staging”/);
  assert.match(deployProblems(target({ sudo: "ask" }), plan(), { modules: "", typed: "", password: "" })[0], /password of the server/);
  assert.deepStrictEqual(deployProblems(target({ sudo: "ask", confirm: "name" }), plan(), { modules: "", typed: "staging", password: "pw" }), []);
});
t("the last deploy is a sentence", () => {
  assert.strictEqual(lastDeployText(target()), "never deployed from here");
  assert.match(lastDeployText(target({ last_time: "2026-10-22T04:01:10Z", last_sha: "a1b2c3", last_result: "ok" })), /^last deploy 2026-10-22 04:01 UTC · a1b2c3$/);
  assert.match(lastDeployText(target({ last_time: "2026-10-22T04:01:10Z", last_sha: "a1b2c3", last_result: "failed(7)" })), /^last try \(failed\(7\)\)/);
});
t("the form of a target, from empty and from a saved one", () => {
  assert.deepStrictEqual(emptyForm("develop"), { target: "", user: "", host: "", port: "", command: "", login: false, branch: "develop", sudo: "none", detector: "none", require_name: false });
  const form = formOf(target({ confirm: "name", port: "2222" }));
  assert.deepStrictEqual([form.port, form.require_name, form.sudo], ["2222", true, "none"]);
});
t("the form says what is wrong with it", () => {
  const ok = { ...emptyForm("develop"), target: "staging", host: "deploy@203.0.113.10", command: "staging-update {modules}" };
  assert.deepStrictEqual(setupProblems(ok, { editing: false }), []);
  assert.strictEqual(setupProblems({ ...ok, target: "Bad Name" }, { editing: false }).length, 1);
  assert.deepStrictEqual(setupProblems({ ...ok, target: "" }, { editing: true }), []);
  for (const host of ["-oProxyCommand=x", "a b", "h;id", "", "$(id)"]) assert.strictEqual(setupProblems({ ...ok, host }, { editing: false }).length, 1, host);
  assert.strictEqual(setupProblems({ ...ok, port: "70000" }, { editing: false }).length, 1);
  assert.strictEqual(setupProblems({ ...ok, command: "-rf" }, { editing: false }).length, 1);
  assert.strictEqual(setupProblems({ ...ok, branch: "" }, { editing: false }).length, 1);
});
t("a server is split into its user and its address, and put back together", () => {
  assert.deepStrictEqual(splitHost("odooAdmin@203.0.113.10"), { user: "odooAdmin", host: "203.0.113.10" });
  assert.deepStrictEqual(splitHost("203.0.113.10"), { user: "", host: "203.0.113.10" });
  assert.deepStrictEqual(splitHost("a@b@c"), { user: "a@b", host: "c" });
  const form = formOf(target({ host: "odooAdmin@203.0.113.10" }));
  assert.deepStrictEqual([form.user, form.host], ["odooAdmin", "203.0.113.10"]);
  assert.strictEqual(setupParams({ ...form, command: "x" }).host, "odooAdmin@203.0.113.10");
  assert.strictEqual(setupParams({ ...form, user: "", host: "203.0.113.10", command: "x" }).host, "203.0.113.10", "no user: the server as it is");
  assert.strictEqual(setupParams({ ...form, user: "", host: "odooAdmin@203.0.113.10", command: "x" }).host, "odooAdmin@203.0.113.10", "a user typed with the server goes to the user field");
  const ok = { ...emptyForm("develop"), target: "s", host: "203.0.113.10", command: "x" };
  for (const user of ["-o", "a b", "a;id", "$(id)"]) assert.strictEqual(setupProblems({ ...ok, user }, { editing: false }).length, 1, user);
  assert.deepStrictEqual(setupProblems({ ...ok, user: "odooAdmin" }, { editing: false }), []);
});
t("a command for a login shell is wrapped in bash -ic and shown without it", () => {
  assert.strictEqual(wrapLogin("preprod-update {modules}"), "bash -ic 'preprod-update {modules}'");
  assert.deepStrictEqual(unwrapLogin("bash -ic 'preprod-update {modules}'"), { command: "preprod-update {modules}", login: true });
  assert.deepStrictEqual(unwrapLogin("preprod-update {modules}"), { command: "preprod-update {modules}", login: false });
  const tricky = "echo 'a b' {modules}";
  assert.deepStrictEqual(unwrapLogin(wrapLogin(tricky)), { command: tricky, login: true }, "quotes survive the round trip");
  const form = formOf(target({ command: "bash -ic 'x {modules}'" }));
  assert.deepStrictEqual([form.command, form.login], ["x {modules}", true]);
  assert.strictEqual(setupParams({ ...form }).command, "bash -ic 'x {modules}'", "saved again as it was");
  assert.strictEqual(setupParams({ ...form, login: false }).command, "x {modules}");
});
t("the request of a form is trimmed, and has a port only when one was given", () => {
  const p = setupParams({ ...emptyForm("develop"), target: "staging", host: " u@h ", command: " x {modules} " });
  assert.deepStrictEqual([p.host, p.command, "port" in p, p.require_name], ["u@h", "x {modules}", false, false]);
  assert.strictEqual(setupParams({ ...emptyForm("develop"), target: "s", host: "h", command: "c", port: "22" }).port, "22");
});
t("a release branch or the base asks for the name by default; the integration branch does not", () => {
  const s = { integration: "19.0-staging", release: "19.0", base: "19.0" };
  assert.strictEqual(suggestRequireName("19.0", s), true);
  assert.strictEqual(suggestRequireName("19.0-staging", s), false);
  assert.strictEqual(suggestRequireName("other", s), false);
  assert.strictEqual(suggestRequireName("main", { integration: "main", release: "main", base: "main" }), false);
});
console.log("  " + n + " passed, 0 failed");
