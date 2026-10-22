/* A small, made-up repository for the browser tests and the screenshots: "acme-shop", with a bare remote, a staging branch,
 * merged features, release branches, a task branch in progress and uncommitted changes. Nothing here refers to a real project. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AUTHORS = {
  alex: { name: "Alex Doe", email: "alex@example.com" },
  sam: { name: "Sam Lee", email: "sam@example.com" },
  // one person under two names: the .mailmap of the demo repository makes them one author
  jordan: { name: "Jordan Kim", email: "jordan@example.com" },
  jordan_old: { name: "jkim", email: "jordan.old@example.com" },
};
const DAY = 86400;

export const gitEnv = (who = "alex", when) => {
  const a = AUTHORS[who];
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true",
    GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_COMMITTER_NAME: a.name, GIT_COMMITTER_EMAIL: a.email, NO_COLOR: "1",
  };
  if (when) { env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = String(when) + " +0000"; }
  return env;
};

export function git(cwd, args, opts = {}) {
  return execFileSync("git", args, { cwd, env: gitEnv(opts.who, opts.when), stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

export function createDemo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-e2e-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "acme-shop");
  const base = Math.floor(Date.now() / 1000) - 14 * DAY;
  let tick = 0;
  const at = days => base + Math.round(days * DAY) + (tick++);       // distinct, increasing times
  const write = (file, text) => { const f = path.join(work, file); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const commit = (message, who, days) => git(work, ["commit", "-q", "-m", message], { who, when: at(days) });
  const merge = (branch, message, who, days) => git(work, ["merge", "-q", "--no-ff", "-m", message, branch], { who, when: at(days) });

  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: gitEnv() });
  execFileSync("git", ["clone", "-q", remote, work], { env: gitEnv(), stdio: "ignore" });
  git(work, ["checkout", "-q", "-b", "main"]);
  write("README.md", "# acme-shop\n\nA small shop.\n");
  write(".mailmap", "Jordan Kim <jordan@example.com> jkim <jordan.old@example.com>\n");
  write("Makefile", "test:\n\t@echo testing $(MODULES)\n");
  write("catalog/search.py", "def search(items, term):\n    return [i for i in items if term in i]\n");
  write("billing/invoice.py", "def total(lines):\n    return sum(lines)\n");
  write("checkout/cart.py", "class Cart:\n    def __init__(self):\n        self.lines = []\n");
  git(work, ["add", "-A"]); commit("[INIT] shop: first version of the shop", "alex", 0);
  git(work, ["push", "-q", "-u", "origin", "main"]);
  git(work, ["branch", "release/260401-v1.0"]); git(work, ["push", "-q", "origin", "release/260401-v1.0"]);

  git(work, ["checkout", "-q", "-b", "staging"]);
  git(work, ["push", "-q", "-u", "origin", "staging"]);
  const feature = (name, files, subjects, who, days) => {
    git(work, ["checkout", "-q", "-b", "feature/" + name, "staging"]);
    subjects.forEach((subject, i) => {
      for (const [file, text] of files[i]) write(file, text);
      git(work, ["add", "-A"]); commit(subject, Array.isArray(who) ? who[i] : who, days + i * 0.1);
    });
    git(work, ["push", "-q", "-u", "origin", "feature/" + name]);
    git(work, ["checkout", "-q", "staging"]);
    merge("feature/" + name, "Merge branch 'feature/" + name + "' into staging", Array.isArray(who) ? who[0] : who, days + 0.5);
  };
  feature("catalog_search", [[["catalog/search.py", "def search(items, term):\n    term = term.lower()\n    return [i for i in items if term in i.lower()]\n"]], [["catalog/tests.py", "def test_search():\n    assert True\n"]]],
    ["[FEAT] catalog: search ignores the case", "[ADD] catalog: tests for the search"], ["alex", "jordan_old"], 3);
  feature("checkout_coupon", [[["checkout/coupon.py", "def apply(total, percent):\n    return total * (100 - percent) / 100\n"]], [["checkout/cart.py", "class Cart:\n    def __init__(self):\n        self.lines = []\n        self.coupon = None\n"]]],
    ["[FEAT] checkout: coupons as a percentage", "[IMP] checkout: the cart remembers its coupon"], ["sam", "jordan"], 5);
  feature("billing_rounding", [[["billing/invoice.py", "def total(lines):\n    return round(sum(lines), 2)\n"]]], ["[FIX] billing: round the invoice total to cents"], "sam", 7);
  git(work, ["push", "-q", "origin", "staging"]);

  // the task in progress: two commits on top of staging, one already pushed, and uncommitted changes
  git(work, ["checkout", "-q", "-b", "feature/invoice_totals", "staging"]);
  write("billing/invoice.py", "def total(lines, tax=0):\n    return round(sum(lines) * (1 + tax), 2)\n");
  git(work, ["add", "-A"]); commit("[FEAT] billing: invoice total with tax", "alex", 9);
  git(work, ["push", "-q", "-u", "origin", "feature/invoice_totals"]);
  write("billing/report.py", "def report(invoices):\n    return len(invoices)\n");
  git(work, ["add", "-A"]); commit("[ADD] billing: monthly invoice report", "alex", 9.2);
  write("billing/invoice.py", "def total(lines, tax=0):\n    \"\"\"Total of the lines with tax, in cents.\"\"\"\n    return round(sum(lines) * (1 + tax), 2)\n");
  write("catalog/search.py", "def search(items, term):\n    term = term.lower()\n    return sorted(i for i in items if term in i.lower())\n");
  git(work, ["add", "catalog/search.py"]);
  write("checkout/coupon_rules.py", "MAX_PERCENT = 50\n");

  const config = {
    "shuttle.base": "main", "shuttle.integration": "staging", "shuttle.release": "main", "shuttle.branchPrefix": "feature/",
    "shuttle.releasePattern": "release/{yymmdd}-v1.{n}", "shuttle.messagePattern": "^\\[[A-Z]+\\] [^:]+: .+",
    "shuttle.forbidTrailers": "Co-Authored-By", "shuttle.upgradeCommand": "make test MODULES={modules}",
  };
  for (const [key, value] of Object.entries(config)) git(work, ["config", key, value]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  // a stand-in for the GitHub CLI: prints a link and records the call
  const gh = path.join(root, "gh");
  fs.writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + path.join(root, "gh.log") + '"\necho https://example.com/acme/acme-shop/pull/42\n', { mode: 0o755 });
  // a stand-in for ssh: it logs what it was asked to run; a host that starts with "ask@" wants a sudo password first (the password is "e2e-secret")
  const ssh = path.join(root, "ssh");
  fs.writeFileSync(ssh, `#!/usr/bin/env bash
{ printf 'CALL'; printf ' [%s]' "$@"; echo; } >> "${path.join(root, "ssh.log")}"
for a in "$@"; do [[ "$a" == -O ]] && exit 0; done
last="\${*: -1}"
if [[ "$*" == *" pw@"* && " $* " == *"BatchMode=yes"* ]]; then echo "pw@host: Permission denied (publickey,password)." >&2; exit 255; fi
[[ "$last" == true ]] && exit 0
if [[ "$*" == *" nf@"* ]]; then echo "bash: line 1: staging-update: command not found" >&2; exit 127; fi
if [[ "$*" == *" ask@"* ]]; then
  printf '[sudo] password for ask: '; IFS= read -rs pw; echo
  [[ "$pw" == e2e-secret ]] || { echo "Sorry, try again."; exit 1; }
fi
echo "server ran: $last"
`, { mode: 0o755 });
  // a stand-in for `secret-tool` (the keyring): a file per key, in the folder of the demo (not in the repository)
  const secretTool = path.join(root, "secret-tool");
  fs.writeFileSync(secretTool, `#!/usr/bin/env bash
dir="${path.join(root, "keyring")}"; mkdir -p "$dir"; key="\${*: -1}"
case "$1" in
  store) cat > "$dir/$key" ;;
  lookup) [[ -f "$dir/$key" ]] && cat "$dir/$key" || exit 1 ;;
  clear) rm -f "$dir/$key" ;;
esac
`, { mode: 0o755 });
  // somebody else pushes to the remote: a commit on `branch`, made in a separate clone
  const pushToRemote = (branch, file, text, message, who = "sam") => {
    const other = fs.mkdtempSync(path.join(root, "other-"));
    execFileSync("git", ["clone", "-q", remote, other], { env: gitEnv(who), stdio: "ignore" });
    git(other, ["checkout", "-q", branch], { who });
    fs.mkdirSync(path.dirname(path.join(other, file)), { recursive: true });
    fs.writeFileSync(path.join(other, file), text);
    git(other, ["add", "-A"], { who });
    git(other, ["commit", "-q", "-m", message], { who });
    git(other, ["push", "-q", "origin", branch], { who });
    return git(other, ["rev-parse", "HEAD"]);
  };
  return { root, remote, work, gh, ssh, secretTool, pushToRemote, git: (args, opts) => git(work, args, opts), remoteGit: (args, opts) => git(remote, args, opts), at, write, commit, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
