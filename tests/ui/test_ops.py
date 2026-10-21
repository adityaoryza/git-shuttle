"""The actions on branches, commits, the stash and worktrees: what the page may ask for, and what the server does with it."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_server import Base, git, write  # noqa: E402
from shuttle_ui.errors import BadRequest  # noqa: E402
from shuttle_ui.validate import build_commands  # noqa: E402

SHA = "abcdef1234567890abcdef1234567890abcdef12"
OTHER = "1234567abcdef1234567abcdef1234567abcdef1"


class TestValidation(unittest.TestCase):
    def refused(self, action, params):
        with self.assertRaises(BadRequest, msg="%s %r" % (action, params)):
            build_commands(action, params)

    def test_good_requests_become_arguments(self):
        cases = [
            ("pull", {}, [["pull", "--ff-only"]]),
            ("pull", {"mode": "merge", "branch": "feat/x"}, [["pull", "--merge", "--branch", "feat/x"]]),
            ("sync", {"onto": "origin/develop", "merge": True}, [["sync", "--onto", "origin/develop", "--merge"]]),
            ("rename", {"old": "a", "new": "b", "remote": True}, [["rename", "a", "b", "--remote"]]),
            ("delete", {"name": "a", "force": True}, [["delete", "a", "--force"]]),
            ("delete", {"name": "a", "remote": True}, [["delete", "--remote", "a"]]),
            ("upstream", {"name": "a", "set": "origin/a"}, [["upstream", "a", "--set", "origin/a"]]),
            ("upstream", {"name": "a", "unset": True}, [["upstream", "a", "--unset"]]),
            ("merge-in", {"name": "a", "mode": "no-ff"}, [["merge-in", "a", "--no-ff"]]),
            ("rebase-on", {"name": "origin/staging"}, [["rebase-on", "origin/staging"]]),
            ("undo", {}, [["undo"]]), ("redo", {}, [["redo"]]),
            ("revert", {"commit": SHA}, [["revert", SHA]]),
            ("amend", {"message": "[FIX] x"}, [["amend", "-m", "[FIX] x"]]),
            ("tag", {"name": "v1", "commit": SHA, "message": "m", "push": True}, [["tag", "v1", SHA, "-m", "m", "--push"]]),
            ("untag", {"name": "v1", "remote": True}, [["untag", "v1", "--remote"]]),
            ("reset", {"mode": "soft", "commit": SHA}, [["reset", "--soft", SHA]]),
            ("reset", {"mode": "hard", "commit": SHA, "confirm_branch": "feat/x"}, [["reset", "--hard", SHA, "--confirm-branch", "feat/x"]]),
            ("stash", {}, [["stash", "push"]]),
            ("stash", {"message": "wip", "untracked": True}, [["stash", "push", "-m", "wip", "--include-untracked"]]),
            ("stash", {"sub": "pop", "index": 2}, [["stash", "pop", "2"]]),
            ("worktree-add", {"path": "/tmp/wt", "branch": "a", "new_from": "develop"}, [["worktree", "add", "/tmp/wt", "a", "--new", "develop"]]),
            ("worktree-remove", {"path": "/tmp/wt", "force": True}, [["worktree", "remove", "/tmp/wt", "--force"]]),
            ("patch-apply", {"path": "/tmp/a.patch"}, [["patch", "apply", "/tmp/a.patch"]]),
            ("switch-detach", {"commit": SHA}, [["switch", "--detach", SHA]]),
            ("drop", {"commit": SHA}, [["drop", SHA]]),
            ("move", {"commit": SHA, "way": "up", "allow_pushed": True}, [["move", SHA, "up", "--allow-pushed"]]),
            ("rewrite", {"base": SHA, "plan": [{"action": "reword", "commit": OTHER, "message": "[FIX] y"}, {"action": "drop", "commit": SHA}]},
             [["rewrite", SHA, "reword:" + OTHER, "drop:" + SHA, "--message", OTHER + "=[FIX] y"]]),
        ]
        for action, params, expected in cases:
            self.assertEqual(build_commands(action, params), expected, action)

    def test_option_injection_and_odd_values_are_refused(self):
        for action, params in [
            ("pull", {"mode": "--force"}), ("pull", {"branch": "-x"}), ("pull", {"branch": "a..b"}),
            ("sync", {"onto": "-x"}), ("sync", {"merge": "yes"}),
            ("rename", {"old": "-x", "new": "b"}), ("rename", {"old": "a", "new": ""}), ("rename", {"old": "a", "new": "b", "remote": "true"}),
            ("delete", {"name": "--all"}), ("delete", {"name": "a", "remote": True, "force": True}), ("delete", {}),
            ("upstream", {"name": "a"}), ("upstream", {"name": "a", "set": "o/a", "unset": True}), ("upstream", {"name": "a", "set": "--x"}),
            ("merge-in", {"name": "a", "mode": "squash"}), ("merge-in", {"name": "--x"}), ("rebase-on", {"name": "a b"}),
            ("revert", {"commit": "HEAD"}), ("revert", {"commit": "--abort"}), ("revert", {"commit": SHA + "0" * 5}), ("revert", {}),
            ("amend", {}), ("amend", {"message": 5}), ("amend", {"message": "a\0b"}), ("amend", {"message": "x" * 70000}),
            ("tag", {"name": "-d"}), ("tag", {"name": "v1", "commit": "main"}), ("untag", {"name": "a..b"}),
            ("reset", {"mode": "hard", "commit": SHA}), ("reset", {"mode": "--hard", "commit": SHA}), ("reset", {"mode": "soft", "commit": "HEAD~1"}),
            ("stash", {"sub": "show"}), ("stash", {"sub": "pop"}), ("stash", {"sub": "pop", "index": "0"}), ("stash", {"sub": "pop", "index": -1}),
            ("stash", {"sub": "pop", "index": True}), ("stash", {"message": "a\nb"}),
            ("worktree-add", {"path": "relative", "branch": "a"}), ("worktree-add", {"path": "/a/../b", "branch": "a"}),
            ("worktree-add", {"path": "/tmp/x", "branch": "-a"}), ("worktree-add", {"path": "/tmp/x", "branch": "a", "new_from": "--x"}),
            ("worktree-remove", {"path": "-f"}), ("worktree-remove", {"path": "/x\ny"}), ("patch-apply", {"path": "a.patch"}),
            ("switch-detach", {"commit": "main"}), ("drop", {"commit": "-x"}), ("move", {"commit": SHA, "way": "left"}), ("move", {"commit": SHA}),
            ("rewrite", {"base": SHA}), ("rewrite", {"base": SHA, "plan": []}), ("rewrite", {"base": SHA, "plan": ["pick"]}),
            ("rewrite", {"base": SHA, "plan": [{"action": "pick;ls", "commit": SHA}]}), ("rewrite", {"base": SHA, "plan": [{"action": "pick", "commit": "main"}]}),
            ("rewrite", {"base": SHA, "plan": [{"action": "reword", "commit": SHA}]}), ("rewrite", {"base": "main", "plan": [{"action": "pick", "commit": SHA}]}),
            ("rewrite", {"base": SHA, "plan": [{"action": "pick", "commit": SHA}] * 300}),
        ]:
            self.refused(action, params)


class TestOperations(Base):
    def setUp(self):
        work = self.world.work
        git(work, "checkout", "-q", "-f", "main")
        git(work, "reset", "-q", "--hard", "origin/main")
        git(work, "clean", "-qfd")
        git(work, "stash", "clear")
        for branch in git(work, "branch", "--format=%(refname:short)").splitlines():
            if branch.startswith("ops/"):
                git(work, "branch", "-D", "-q", branch)
        for tag in git(work, "tag", "-l", "ops-*").splitlines():
            git(work, "tag", "-d", tag)

    def branch_with_commits(self, name, count=3):
        work = self.world.work
        git(work, "checkout", "-q", "-b", name, "develop")
        shas = []
        for n in range(count):
            write(os.path.join(work, "f%d.txt" % n), "%d\n" % n)
            git(work, "add", "-A"); git(work, "commit", "-q", "-m", "[ADD] f%d" % n)
            shas.append(git(work, "rev-parse", "HEAD"))
        return shas

    def job(self, action, params=None, ok=True):
        job = self.run_job(action, params)
        if ok:
            self.assertEqual(job["state"], "done", job["steps"])
        return job

    def test_stash_through_the_page(self):
        work = self.world.work
        git(work, "checkout", "-q", "-b", "ops/stash", "develop")
        write(os.path.join(work, "file.txt"), "changed\n"); write(os.path.join(work, "new.txt"), "new\n")
        self.job("stash", {"message": "wip", "untracked": True})
        self.assertEqual(git(work, "status", "--porcelain"), "")
        status, data = self.api("GET", "repos/%s/stashes" % self.rid())
        self.assertEqual((status, [(s["index"], "wip" in s["message"]) for s in data["stashes"]]), (200, [(0, True)]))
        status, data = self.api("GET", "repos/%s/stashes/0" % self.rid())
        self.assertIn("+changed", data["diff"])
        self.assertEqual(self.api("GET", "repos/%s/stashes/abc" % self.rid())[0], 400)
        self.assertEqual(self.api("GET", "repos/%s/stashes/7" % self.rid())[0], 400)
        self.job("stash", {"sub": "pop", "index": 0})
        self.assertIn("new.txt", git(work, "status", "--porcelain"))
        self.assertEqual(self.api("GET", "repos/%s/stashes" % self.rid())[1]["stashes"], [])
        self.assertEqual(self.job("stash", {"sub": "drop", "index": 0}, ok=False)["exit"], 1)

    def test_worktrees_through_the_page(self):
        work, path = self.world.work, os.path.join(self.world.root, "ops-wt")
        self.job("worktree-add", {"path": path, "branch": "ops/wt", "new_from": "develop"})
        rows = self.api("GET", "repos/%s/worktrees" % self.rid())[1]["worktrees"]
        self.assertEqual(sorted((os.path.realpath(r["path"]), r["branch"], r["main"]) for r in rows),
                         sorted([(os.path.realpath(work), "main", True), (os.path.realpath(path), "ops/wt", False)]))
        for bad in (os.path.join(work, "inside"), os.path.join(work, ".git", "wt")):
            self.assertEqual(self.job("worktree-add", {"path": bad, "branch": "ops/other", "new_from": "develop"}, ok=False)["exit"], 1, bad)
        self.assertEqual(self.job("worktree-remove", {"path": work}, ok=False)["exit"], 1)
        self.job("worktree-remove", {"path": path})
        self.assertFalse(os.path.exists(path))

    def test_tag_revert_amend_reset(self):
        work = self.world.work
        first, second, _ = self.branch_with_commits("ops/commits")
        self.job("tag", {"name": "ops-v1", "commit": first, "message": "first"})
        self.assertEqual(git(work, "cat-file", "-t", "ops-v1"), "tag")
        self.job("untag", {"name": "ops-v1"})
        self.assertEqual(git(work, "tag", "-l", "ops-v1"), "")
        self.job("revert", {"commit": second})
        self.assertFalse(os.path.exists(os.path.join(work, "f1.txt")))
        self.job("amend", {"message": "[FIX] reverted"})
        self.assertEqual(git(work, "log", "-1", "--format=%s"), "[FIX] reverted")
        tip = git(work, "rev-parse", "HEAD")
        wrong = self.job("reset", {"mode": "hard", "commit": first, "confirm_branch": "main"}, ok=False)
        self.assertEqual((wrong["exit"], git(work, "rev-parse", "HEAD")), (1, tip))
        self.job("reset", {"mode": "hard", "commit": first, "confirm_branch": "ops/commits"})
        self.assertEqual(git(work, "rev-parse", "HEAD"), first)
        self.job("undo")
        self.assertEqual(git(work, "rev-parse", "HEAD"), tip)
        entries = self.api("GET", "repos/%s/journal" % self.rid())[1]["journal"]
        self.assertEqual([e["command"] for e in entries][:3], ["reset", "amend", "revert"])
        self.assertEqual(entries[0]["state"], "undone")

    def test_rewrite_as_the_page_sends_it(self):
        work = self.world.work
        a, b, c = self.branch_with_commits("ops/rewrite")
        base = git(work, "rev-parse", "develop")
        plan = [{"action": "pick", "commit": c}, {"action": "reword", "commit": a, "message": "[FIX] first, reworded"}, {"action": "squash", "commit": b}]
        self.job("rewrite", {"base": base, "plan": plan})
        self.assertEqual(git(work, "log", "--reverse", "--format=%s", base + "..HEAD").splitlines()[0], "[ADD] f2")
        self.assertEqual(git(work, "rev-list", "--count", base + "..HEAD"), "2")
        self.assertIn("[FIX] first, reworded", git(work, "log", "-1", "--format=%B"))
        self.job("undo")
        self.assertEqual(git(work, "rev-list", "--count", base + "..HEAD"), "3")
        # a plan that leaves a commit out is refused, and nothing changes
        tip = git(work, "rev-parse", "HEAD")
        job = self.job("rewrite", {"base": base, "plan": [{"action": "pick", "commit": a}]}, ok=False)
        self.assertEqual((job["exit"], git(work, "rev-parse", "HEAD")), (1, tip))
        self.job("drop", {"commit": git(work, "rev-parse", "HEAD~1")})
        self.assertEqual(git(work, "rev-list", "--count", base + "..HEAD"), "2")
        self.job("move", {"commit": git(work, "rev-parse", "HEAD"), "way": "down"})
        self.assertEqual(git(work, "log", "--format=%s", base + "..HEAD").splitlines(), ["[ADD] f0", "[ADD] f2"])

    def test_pushed_history_is_not_rewritten_from_the_page(self):
        work = self.world.work
        a, b, c = self.branch_with_commits("ops/pushed")
        git(work, "push", "-q", "-u", "origin", "ops/pushed")
        tip = git(work, "rev-parse", "HEAD")
        for action, params in (("drop", {"commit": c}), ("amend", {"message": "[FIX] again"}), ("reset", {"mode": "soft", "commit": a})):
            job = self.job(action, params, ok=False)
            self.assertEqual((job["exit"], git(work, "rev-parse", "HEAD")), (1, tip), action)
        git(work, "push", "-q", "origin", "--delete", "ops/pushed")

    def test_compare_link_and_patch(self):
        work = self.world.work
        a, b, _ = self.branch_with_commits("ops/compare")
        status, data = self.api("POST", "repos/%s/compare" % self.rid(), {"a": "develop", "b": "ops/compare"})
        self.assertEqual((status, data["ahead"], data["behind"], len(data["ahead_commits"])), (200, 3, 0, 3))
        self.assertEqual(sorted(f["path"] for f in data["files"]), ["f0.txt", "f1.txt", "f2.txt"])
        self.assertEqual(self.api("POST", "repos/%s/compare" % self.rid(), {"a": "--evil"})[0], 400)
        self.assertEqual(self.api("POST", "repos/%s/compare" % self.rid(), {"a": "nothing-like-this"})[0], 400)
        git(work, "remote", "add", "hub", "https://user:s3cret@github.com/acme/widgets.git")
        git(work, "config", "shuttle.remote", "hub")
        try:
            status, data = self.api("GET", "repos/%s/commits/%s/link" % (self.rid(), a))
            self.assertEqual((status, data["url"]), (200, "https://github.com/acme/widgets/commit/" + a))
            self.assertNotIn("s3cret", str(data))
        finally:
            git(work, "config", "--unset", "shuttle.remote"); git(work, "remote", "remove", "hub")
        self.assertEqual(self.api("GET", "repos/%s/commits/%s/link" % (self.rid(), "zzzzzzz"))[0], 400)
        status, data = self.api("GET", "repos/%s/commits/%s/patch" % (self.rid(), b))
        self.assertEqual(status, 200)
        self.assertIn("Subject: [PATCH] [ADD] f1", data["patch"])
        patch_file = os.path.join(self.world.root, "ops.patch")
        with open(patch_file, "w") as f:
            f.write(data["patch"])
        git(work, "checkout", "-q", "-b", "ops/applied", "develop")
        self.job("patch-apply", {"path": patch_file})
        self.assertEqual(git(work, "log", "-1", "--format=%s"), "[ADD] f1")

    def test_update_a_branch_without_checking_it_out(self):
        work = self.world.work
        git(work, "branch", "-q", "ops/follow", "develop")
        git(work, "branch", "-q", "--set-upstream-to=origin/develop", "ops/follow")
        git(work, "checkout", "-q", "develop")
        write(os.path.join(work, "dev2.txt"), "2\n"); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "dev two")
        git(work, "push", "-q", "origin", "develop")
        new_tip = git(work, "rev-parse", "HEAD")
        git(work, "checkout", "-q", "main")
        self.job("pull", {"branch": "ops/follow"})
        self.assertEqual((git(work, "rev-parse", "ops/follow"), git(work, "symbolic-ref", "--short", "HEAD")), (new_tip, "main"))


class TestGraphColumns(Base):
    def test_authors_follow_the_mailmap_and_the_body_is_short(self):
        work = self.world.work
        git(work, "checkout", "-q", "-b", "ops/people", "develop")
        write(os.path.join(work, ".mailmap"), "Agung Prayogi <agung@example.com> agungprygi <agung.old@example.com>\n")
        git(work, "add", "-A"); git(work, "commit", "-q", "-m", "[ADD] mailmap")
        write(os.path.join(work, "a.txt"), "1\n"); git(work, "add", "-A")
        git(work, "commit", "-q", "-m", "[ADD] first\n\nline one\nline two\nline three\nline four\nline five\nline six", "--author", "agungprygi <agung.old@example.com>")
        status, data = self.api("POST", "repos/%s/graph" % self.rid(), {"refs": ["refs/heads/ops/people"]})
        newest = data["commits"][0]
        self.assertEqual((newest["author"], newest["email"]), ("Agung Prayogi", "agung@example.com"), "the .mailmap merges the two names")
        self.assertEqual((newest["committer"], newest["committer_email"]), ("Tester", "tester@example.com"))
        self.assertEqual(newest["subject"], "[ADD] first")
        self.assertEqual(newest["body"], "line one\nline two\nline three\nline four…", "four lines of the body, then an ellipsis")
        self.assertGreater(newest["committer_time"], 0)
        git(work, "checkout", "-q", "main"); git(work, "branch", "-D", "-q", "ops/people")


if __name__ == "__main__":
    unittest.main()
