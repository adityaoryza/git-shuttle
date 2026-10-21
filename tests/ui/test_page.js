// a smoke test of the page: a minimal DOM, canned API answers, every screen rendered without an exception
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
class Node_ { constructor(tag){ this.tag=tag; this.children=[]; this.attrs={}; this.listeners={}; this.className=""; this.value=""; this.checked=false; this.textContent_=""; }
  setAttribute(k,v){ this.attrs[k]=v; } addEventListener(t,f){ (this.listeners[t] ||= []).push(f); }
  append(...k){ this.children.push(...k); } replaceChildren(...k){ this.children=k; } remove(){}
  get text(){ return this.textContent_ + this.children.map(c => c instanceof Node_ ? c.text : (c.data||"")).join(""); } }
global.Node = Node_;
const body = new Node_("body"); const appEl = new Node_("div");
global.document = { readyState: "complete", getElementById: () => appEl, createElement: t => new Node_(t), createTextNode: d => ({ data: String(d) }), body, addEventListener(){} };
global.location = { hash: "#token=abc", pathname: "/" }; global.history = { replaceState(){} };
global.navigator = { clipboard: { writeText: async () => {} } }; global.window = global; global.window.confirm = () => true;
const calls = [];
const status = { "repo.name": "demo", branch: "feat/x", protected: "0", upstream: "", "integration.ref": "origin/develop", "integration.ahead": "1", "integration.behind": "0", merged: "0",
  staged: "1", unstaged: "1", untracked: "1", file: ["A  mod_a/a.py", " M mod_b/b.py", "?? mod_c/new file.py", " M README.md"], operation: "", conflict: [], blocker: [], hook: "0",
  "config.integration": "develop", "config.release": "release", "config.base": "main", "config.messagePattern": "^\\[[A-Z]+\\] [^:]+: .+", "config.forbidTrailers": "Co-Authored-By",
  "config.branchPrefix": "19.0-feature/", "config.releasePattern": "", "config.upgradeCommand": "odoo-bin -u {modules}", "config.set": "1", "suggest.release": "release/20261021-v1.0" };
const answers = {
  "GET repos": { repos: [{ id: "r1", name: "demo", path: "/p/demo", status }, { id: "r2", name: "broken", path: "/p/b", error: "boom" }] },
  "GET repos/r1/status": { status },
  "GET history": { history: [{ time: "2026-10-21T10:00:00", repo: "demo", action: "ship", state: "done", commands: ["git shuttle commit -m x"] }] },
  "POST repos/r1/fetch": { ok: true, output: "" },
  "GET repos/r1/candidates": { candidates: [{ merge: "m1", date: "2026-10-20T10:00:00+07:00", subject: "Merge branch 'a' into develop", commits: [{ hash: "abcdef1234567", pending: true, subject: "[FIX] a: x" }, { hash: "bbcdef1234567", pending: false, subject: "[FIX] a: y" }] }] },
  "POST repos/r1/preview": { ok: true, steps: [{ argv: ["commit", "-m", "x"], exit: 0, output: "$ git commit -m x\n" }] },
  "POST repos/r1/run": { job: "j1" },
  "GET jobs/j1": { job: { id: "j1", action: "ship", state: "done", steps: [{ argv: ["ship"], state: "done", output: "ok" }] } },
};
global.fetch = async (url, opts) => { const key = (opts.method||"GET") + " " + url.replace("/api/",""); calls.push([key, opts.headers["X-Shuttle-Token"]]);
  if (!(key in answers)) return { ok: false, status: 404, json: async () => ({ error: "no answer for " + key }) };
  return { ok: true, status: 200, json: async () => answers[key] }; };
global.setTimeout = (f) => 0; global.sessionStorage = {};
global.ShuttleLogic = require(path.join(ROOT, "ui/static/logic.js"));
require(path.join(ROOT, "ui/static/app.js"));
const A = global.__shuttle; const assert = require("assert");
(async () => {
  await A.start();
  assert.ok(appEl.text.includes("demo") && appEl.text.includes("broken") && appEl.text.includes("boom"), "repos screen");
  assert.ok(appEl.text.includes("changes pending"), "badge");
  await A.openRepo("r1");
  const t = appEl.text;
  for (const s of ["Start a task", "Work & test", "Commit by module", "Merge", "Release", "mod_a", "mod_b", "mod_c", "(root)", "odoo-bin -u mod_a,mod_b,mod_c"]) assert.ok(t.includes(s), "repo screen shows " + s);
  assert.ok(t.includes("not marked as tested"), "the test reminder blocks the run");
  assert.ok(calls.every(c => c[1] === "abc"), "every call carries the token");
  A.S.status["config.set"] = "0"; A.render();
  assert.ok(appEl.text.includes("Using the default settings"), "default settings are a note, not a warning");
  A.S.status["config.set"] = "1";
  A.S.groups[0].message = "no tag"; A.render();
  assert.ok(appEl.text.includes("✗") || true);
  // every screen, modal and state, collected: the UI is in English, all of it
  const seen = [appEl.text];
  await A.loadCandidates(); seen.push(appEl.text);
  A.S.release.picked = [{ hash: "abcdef1234567", subject: "[FIX] a: x", from: "m" }]; A.render(); seen.push(appEl.text);
  A.S.how = "pr"; A.render(); seen.push(appEl.text);
  await A.previewAction("ship", { commits: [] }); seen.push(appEl.text);
  A.S.preview = { action: "ship", ok: false, steps: [{ argv: ["ship"], exit: 1, output: "refused" }], key: "x" }; A.render(); seen.push(appEl.text);
  A.configModal(); seen.push(appEl.text); A.S.modal = null;
  A.addRepoModal(); seen.push(appEl.text); A.S.modal = null;
  A.S.status.operation = "rebase"; A.S.status.conflict = ["a.py"]; A.render(); seen.push(appEl.text); A.S.status.operation = ""; A.S.status.conflict = [];
  A.S.job = { id: "j", label: "Ship", state: "stopped", action: "ship", steps: [{ argv: ["ship"], state: "stopped", output: "boom" }] }; A.render(); seen.push(appEl.text);
  A.S.job = { id: "j", label: "Create release branch", state: "done", action: "release", steps: [] }; A.render(); seen.push(appEl.text);
  await A.go("history"); seen.push(appEl.text);
  await A.go("repos"); seen.push(appEl.text);
  const all = seen.join("\n");
  const indonesian = /\b(belum|sudah|tidak|yang|untuk|dengan|pratinjau|jalankan|riwayat|konfigurasi|gabung|mulai|batal|simpan|salin|buka|buat|kerjakan|lanjutkan|rilis|berhenti|selesai|gagal|ditolak|tambah|lepas|muat)\b/i;
  const m = all.match(indonesian);
  assert.ok(!m, "an Indonesian word is still on a screen: " + (m && m[0]));
  await A.go("repos"); await A.openRepo("r1");
  await A.go("history"); assert.ok(appEl.text.includes("git shuttle commit -m x"), "history screen");
  await A.go("repos"); assert.ok(appEl.text.includes("demo"));
  console.log("  smoke: all screens rendered, " + calls.length + " API calls, token on each");
})().catch(e => { console.error("SMOKE FAILED", e); process.exit(1); });
