/* The Deploy tab: what a deploy needs before it can run, and the form of a target. Pure, tested with node. */

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const MODULES_RE = /^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/;
export const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
export const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/;
export const HOST_RE = /^([A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.:-]*$/;

// Modules typed by hand: separated by spaces, commas or semicolons → "a,b".
export const tidyModules = text => String(text || "").split(/[\s,;]+/).filter(Boolean).join(",");

// The request of a deploy. The typed name goes along only when it is right; the sudo password never is a parameter (it has its own way).
export function deployParams(target, { modules, typed }) {
  const params = { target: target.target };
  if (modules) params.modules = modules;
  if (target.confirm === "name" && typed === target.target) params.confirm = typed;
  return params;
}

// Why Run is not possible yet (empty: it is).
export function deployProblems(target, plan, { modules, typed, password }) {
  if (!target) return ["Choose a server."];
  if (!plan) return ["Reading what would be deployed…"];
  const out = [];
  if (modules && !MODULES_RE.test(modules)) out.push("Modules: names separated by commas.");
  else if (!modules && plan["needs-modules"] === "1") out.push("Name the modules to update: none changed.");
  if (target.confirm === "name" && typed !== target.target) out.push("Type “" + target.target + "” to confirm.");
  if (target.sudo === "ask" && !password) out.push("Type the password of the server.");
  return out;
}

// "2026-10-22T04:01:10Z  a1b2c3  ok" → a sentence for the card of a target.
export function lastDeployText(target) {
  if (!target || !target.last_time) return "never deployed from here";
  const when = target.last_time.replace("T", " ").replace(/:\d\dZ$/, " UTC");
  return (target.last_result === "ok" ? "last deploy " : "last try (" + target.last_result + ") ") + when + " · " + target.last_sha;
}

// A command that is an alias or a function of the login shell of the server (ssh does not load them) is run by a login shell:
// bash -ic '...'. The form has a box for it, and shows the command without the wrapper.
export const wrapLogin = command => "bash -ic '" + String(command).trim().replace(/'/g, "'\\''") + "'";
export function unwrapLogin(command) {
  const m = /^bash -ic '(.*)'$/.exec(String(command || "").trim());
  return m ? { command: m[1].replace(/'\\''/g, "'"), login: true } : { command: String(command || ""), login: false };
}

export function emptyForm(integration) {
  return { target: "", user: "", host: "", port: "", command: "", login: false, branch: integration || "", sudo: "none", detector: "none", require_name: false };
}

// "odooAdmin@203.0.113.10" → the user and the server, as two fields of the form (a user typed with the server moves to the user field).
export function splitHost(host) {
  const at = String(host || "").lastIndexOf("@");
  return at < 0 ? { user: "", host: String(host || "").trim() } : { user: host.slice(0, at).trim(), host: host.slice(at + 1).trim() };
}
const normalized = form => {
  const typed = splitHost(form.host);
  return { ...form, user: (form.user || typed.user).trim(), host: typed.host };
};

export const formOf = target => ({
  target: target.target, ...splitHost(target.host), port: target.port || "", ...unwrapLogin(target.command), branch: target.branch,
  sudo: target.sudo || "none", detector: target.detector || "none", require_name: target.confirm === "name",
});

export function setupProblems(form, { editing }) {
  const out = [];
  if (!editing && !NAME_RE.test(form.target)) out.push("Name: lowercase letters, digits, - and _ (for example staging).");
  const f = normalized(form);
  if (f.user && !USER_RE.test(f.user)) out.push("User: the name you log in with on the server (letters, digits, . _ -).");
  if (!SERVER_RE.test(f.host)) out.push("Server: the address of the server, or an alias of ~/.ssh/config.");
  if (form.port && !(/^\d{1,5}$/.test(form.port) && +form.port >= 1 && +form.port <= 65535)) out.push("Port: a number from 1 to 65535.");
  const command = form.command.trim();
  if (!command || command.startsWith("-")) out.push("Command: what the server runs, for example staging-update {modules}.");
  if (!form.branch) out.push("Branch: the one the server runs.");
  return out;
}

export function setupParams(form) {
  const f = normalized(form);
  const params = {
    target: form.target, host: f.user ? f.user + "@" + f.host : f.host, command: form.login ? wrapLogin(form.command) : form.command.trim(), branch: form.branch, sudo: form.sudo, detector: form.detector,
    require_name: !!form.require_name,
  };
  if (form.port) params.port = form.port;
  return params;
}

// A release branch (or the base) is production: its name is typed before each deploy unless it was changed on purpose.
export function suggestRequireName(branch, { integration, release, base }) {
  return branch !== integration && (branch === release || branch === base);
}
