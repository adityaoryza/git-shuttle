import assert from "node:assert";
import { AUTO_MS, EXIT_MS, MAX_VISIBLE, createToasts } from "../../ui/shuttle_ui/static/js/toasts.js";
import { describeFetch, describeJob, fetchToast, firstProblem } from "../../ui/shuttle_ui/static/js/feedback.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };

// a clock that moves only when told to, and timers that run in order
function clock() {
  let time = 0, seq = 0, timers = [];
  return {
    now: () => time,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ id, at: time + ms, fn }); return id; },
    clearTimer: id => { timers = timers.filter(x => x.id !== id); },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter(x => x.id !== due.id); time = due.at; due.fn();
      }
      time = end;
    },
  };
}
const make = () => { const c = clock(); const seen = []; const q = createToasts({ ...c, onChange: s => seen.push(s) }); return { c, q, seen }; };
const titles = q => q.snapshot().filter(x => !x.leaving).map(x => x.title);

t("durations: success and info 4 s, warning 7 s, error stays", () => {
  assert.deepStrictEqual(AUTO_MS, { success: 4000, info: 4000, warning: 7000, error: 0 });
  const { c, q } = make();
  q.push({ variant: "success", title: "a" }); q.push({ variant: "warning", title: "b" }); q.push({ variant: "error", title: "c" });
  c.advance(3999); assert.deepStrictEqual(titles(q), ["a", "b", "c"]);
  c.advance(1 + EXIT_MS); assert.deepStrictEqual(titles(q), ["b", "c"], "success is gone after 4 s");
  c.advance(3000 + EXIT_MS); assert.deepStrictEqual(titles(q), ["c"], "warning after 7 s");
  c.advance(10 * 60 * 1000); assert.deepStrictEqual(titles(q), ["c"], "an error stays until it is dismissed");
});
t("a toast leaves in two steps: marked leaving, then removed after the exit animation", () => {
  const { c, q } = make();
  const id = q.push({ variant: "info", title: "x" });
  q.dismiss(id);
  assert.strictEqual(q.snapshot()[0].leaving, true);
  c.advance(EXIT_MS - 1); assert.strictEqual(q.snapshot().length, 1);
  c.advance(1); assert.strictEqual(q.snapshot().length, 0);
  q.dismiss(id); q.dismiss(999);        // dismissing what is gone changes nothing
});
t("the same toast again only counts up and restarts its clock", () => {
  const { c, q } = make();
  const a = q.push({ variant: "success", title: "Fetched", detail: "Already up to date" });
  c.advance(3000);
  const b = q.push({ variant: "success", title: "Fetched", detail: "Already up to date" });
  assert.strictEqual(a, b);
  assert.strictEqual(q.snapshot().length, 1); assert.strictEqual(q.snapshot()[0].count, 2);
  c.advance(3000); assert.deepStrictEqual(titles(q), ["Fetched"], "3 s after the second one it is still there");
  c.advance(1000 + EXIT_MS); assert.deepStrictEqual(titles(q), []);
  q.push({ variant: "success", title: "Fetched", detail: "3 new commits" });
  q.push({ variant: "success", title: "Fetched", detail: "Already up to date" });
  assert.strictEqual(q.snapshot().length, 2, "another detail is another toast");
});
t("at most four are shown: the oldest makes room, newest last", () => {
  const { q } = make();
  for (let i = 1; i <= 6; i++) q.push({ variant: "error", title: "e" + i });
  assert.strictEqual(MAX_VISIBLE, 4);
  assert.deepStrictEqual(titles(q), ["e3", "e4", "e5", "e6"]);
});
t("hover or focus stops the clock, leaving continues with the time that was left", () => {
  const { c, q } = make();
  const id = q.push({ variant: "success", title: "a" });
  c.advance(3000); q.pause(id);
  assert.strictEqual(q.snapshot()[0].paused, true); assert.strictEqual(q.snapshot()[0].remaining, 1000);
  c.advance(60000); assert.deepStrictEqual(titles(q), ["a"], "paused: it does not leave");
  q.pause(id); q.resume(id); q.resume(id);   // doing it twice changes nothing
  c.advance(999); assert.deepStrictEqual(titles(q), ["a"]);
  c.advance(1 + EXIT_MS); assert.deepStrictEqual(titles(q), []);
});
t("an error cannot be paused out of existence, and pausing an unknown toast is harmless", () => {
  const { c, q } = make();
  const id = q.push({ variant: "error", title: "boom" });
  q.pause(id); q.resume(id); q.pause(404); q.resume(404);
  c.advance(1e7); assert.deepStrictEqual(titles(q), ["boom"]);
});
t("unknown kinds are info; a duration can be given; clear empties it", () => {
  const { c, q } = make();
  q.push({ variant: "weird", title: "w" }); assert.strictEqual(q.snapshot()[0].variant, "info");
  q.push({ variant: "success", title: "long", duration: 20000 });
  c.advance(10000); assert.ok(titles(q).includes("long"));
  q.clear(); assert.deepStrictEqual(q.snapshot(), []); c.advance(1e6);
});
t("every change is announced to the subscriber", () => {
  const { q, seen } = make();
  const id = q.push({ variant: "info", title: "a" }); q.dismiss(id);
  assert.ok(seen.length >= 2 && seen[0][0].title === "a");
});

t("describeFetch: the real summary in words", () => {
  assert.strictEqual(describeFetch({ up_to_date: true }), "Already up to date");
  assert.strictEqual(describeFetch({ up_to_date: false, new_commits: 3, created: ["a"], updated: ["b"], pruned: ["c"] }), "3 new commits, 2 branches updated, 1 pruned");
  assert.strictEqual(describeFetch({ up_to_date: false, new_commits: 1, created: [], updated: ["b"], pruned: [] }), "1 new commit, 1 branch updated");
  assert.strictEqual(describeFetch({ up_to_date: false, new_commits: 0, created: [], updated: [], pruned: ["x", "y"] }), "2 pruned");
  assert.strictEqual(describeFetch(null), "");
});
t("fetchToast: success names the remote; failure says what to do next", () => {
  assert.deepStrictEqual(fetchToast({ ok: true, remote: "origin", summary: { up_to_date: true } }), { variant: "success", title: "Fetched origin", detail: "Already up to date" });
  const bad = fetchToast({ ok: false, output: "fatal: unable to access 'https://x/': Could not resolve host\n" });
  assert.strictEqual(bad.variant, "error"); assert.match(bad.detail, /Could not resolve host|unable to access/); assert.match(bad.next, /network/);
});
t("firstProblem picks the line that says what went wrong", () => {
  assert.strictEqual(firstProblem("repository: x\nerror: the branch 'a' already exists\nmore"), "the branch 'a' already exists");
  assert.strictEqual(firstProblem("stopped: the rebase hit a conflict.\n  Resolve"), "the rebase hit a conflict.");
  assert.strictEqual(firstProblem(""), "");
  assert.strictEqual(firstProblem("error: Your local changes would be overwritten by checkout:\n\tfile.txt\nAborting\nerror: cannot create 'b': your changes conflict; nothing was changed"), "cannot create 'b': your changes conflict; nothing was changed", "git-shuttle's own line wins over git's");
});
t("describeJob: success, stopped and failed jobs", () => {
  const job = (action, state, output, label) => ({ action, state, label, steps: [{ output }] });
  assert.deepStrictEqual(describeJob(job("start", "done", "==> on 'feature/x', cut from origin/staging")), { variant: "success", title: "Branch created", detail: "feature/x", next: "Make your changes, then use Ship." });
  assert.strictEqual(describeJob(job("ship", "done", "==> done: 'f' is in 'staging' on origin")).title, "Merged into staging");
  const pr = describeJob(job("ship", "done", "created https://example.test/pull/7\n"));
  assert.deepStrictEqual([pr.title, pr.copy], ["Pull request opened", "https://example.test/pull/7"]);
  assert.strictEqual(describeJob(job("init", "done", "")).title, "Settings saved");
  assert.deepStrictEqual(describeJob(job("push", "done", "$ git push -u origin feature/x", "Publish feature/x")), { variant: "success", title: "Published", detail: "feature/x" });
  assert.strictEqual(describeJob(job("push", "done", "$ git push origin feature/x", "Push feature/x")).title, "Pushed");
  assert.deepStrictEqual([describeJob(job("push", "done", "$ git push --force-with-lease origin feature/x", "Force push feature/x")).title, describeJob(job("push", "done", "$ git push --force-with-lease origin feature/x", "Force push feature/x")).detail], ["Force pushed", "feature/x"]);
  const stopped = describeJob(job("ship", "stopped", "stopped: the rebase hit a conflict.", "Merge"));
  assert.deepStrictEqual([stopped.variant, stopped.title, stopped.log], ["warning", "Merge stopped", true]); assert.match(stopped.next, /Resolve the conflicts/);
  const failed = describeJob(job("start", "failed", "error: the working tree has uncommitted changes", "Start"));
  assert.deepStrictEqual([failed.variant, failed.title], ["error", "Start failed"]); assert.match(failed.next, /Commit, stash/);
  assert.strictEqual(describeJob(job("whatever", "done", "", "Thing")).title, "Thing done");
  const second = describeJob({ action: "branch", state: "failed", label: "Create branch x", steps: [{ state: "stopped", output: "error: cannot create 'x' (uncommitted changes in the way?)" }, { state: "todo", output: "" }] });
  assert.match(second.detail, /cannot create 'x'/, "the message of the step that failed, not of the one that never ran");
});
console.log("  " + n + " passed, 0 failed");
