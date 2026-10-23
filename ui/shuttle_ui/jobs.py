"""Jobs: an action runs in a thread, one at a time per repository."""
import threading
import time
import uuid

import shlex

from . import log
from .actions import rerunnable
from .errors import BadRequest
from . import vault
from .pty_run import run_with_secret, wipe
from .redact import redact
from .runner import run_shuttle

KEEP_FINISHED = 50      # older jobs are forgotten: their output can be large


class Jobs:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()
        self.jobs = {}
        self.busy = {}  # repo id -> job id

    def start(self, repo, action, commands, params=None, label="", secret=None, remember=None, saved_key=None):
        """secret: a bytearray the deploy of a server types at the prompt of sudo; it is never stored with the job, and is wiped when it ends."""
        with self.lock:
            if repo["id"] in self.busy:
                raise BadRequest("another action is running in this repository", 409)
            job_id = uuid.uuid4().hex[:12]
            job = {"id": job_id, "repo": repo["id"], "action": action, "state": "running", "exit": None,
                   "steps": [{"argv": c, "state": "todo", "exit": None, "output": ""} for c in commands],
                   "started": time.time(), "finished": None, "params": params, "label": label}
            self.jobs[job_id] = job
            self.busy[repo["id"]] = job_id
            self._forget_old()
        log.job(repo["name"], action, "started (%s)" % log.summarize(commands))
        threading.Thread(target=self._run, args=(repo, job, secret, remember, saved_key), daemon=True).start()
        return job_id

    def _run(self, repo, job, secret=None, remember=None, saved_key=None):
        exit_code = 0
        try:
            if saved_key and secret is None:
                # the password kept on this computer is read here, in the job: the page is not left waiting for a slow keychain
                step = job["steps"][0]
                step["state"] = "running"
                try:
                    secret = vault.get(saved_key)
                    problem = "" if secret is not None else "the saved password is not there any more: type it (Use another), or save it again"
                except Exception as error:
                    problem = str(error)
                if problem:
                    step["exit"], step["output"], step["state"] = 1, problem, "stopped"
                    exit_code = 1
            for step in job["steps"] if exit_code == 0 else []:
                step["state"] = "running"
                follow = lambda text, step=step: step.__setitem__("output", text)      # the page reads it while the command runs
                if secret is not None and step["argv"][:1] == ["deploy"]:
                    code, output = run_with_secret(repo["path"], step["argv"], secret, timeout=900, on_output=follow)
                else:
                    code, output = run_shuttle(repo["path"], step["argv"], dry_run=False, timeout=900, on_output=follow)
                step["exit"], step["output"] = code, output
                step["state"] = "done" if code == 0 else "stopped"
                if code != 0:
                    exit_code = code
                    break
        except Exception as error:  # a bug here must not leave the repository marked busy
            exit_code = 1
            job["steps"][-1]["output"] += "\ninternal error: %s" % error
        finally:
            if remember and secret is not None and exit_code == 0:
                # the login worked with this password: only now it is kept (a wrong one never is), when the user asked for it
                try:
                    vault.put(remember[0], secret, remember[1])
                    job["remembered"] = True
                except Exception as error:      # the job itself went well: the reason goes to the page
                    job["remember_error"] = str(error)[:300]
            wipe(secret)
            job["exit"] = exit_code
            job["finished"] = time.time()
            job["state"] = "done" if exit_code == 0 else "stopped" if exit_code == 2 else "failed"
            with self.lock:
                self.busy.pop(repo["id"], None)
            took = "%.1fs" % (job["finished"] - job["started"])
            log.job(repo["name"], job["action"], "%s  %s" % (job["state"], took) if exit_code == 0 else "%s  exit %d  %s" % (job["state"], exit_code, took))
            self.store.log(self._entry(repo, job))

    @staticmethod
    def _entry(repo, job):
        """What the log keeps of a job: redacted commands and output, the exit status, and how to run it again when that is safe."""
        entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "repo": repo["name"], "repo_id": repo["id"], "action": job["action"],
                 "label": redact(job.get("label") or job["action"], 120), "state": job["state"], "exit": job["exit"], "duration": round(job["finished"] - job["started"], 2),
                 "commands": [redact("git shuttle " + shlex.join(s["argv"]), 300) for s in job["steps"]],
                 "steps": [{"exit": s["exit"], "state": s["state"], "output": redact(s["output"], 4000)} for s in job["steps"]]}
        if rerunnable(job["action"], job.get("params")):
            entry["params"] = job["params"]
        return entry

    def _forget_old(self):
        finished = [j for j in self.jobs.values() if j["finished"]]
        for job in sorted(finished, key=lambda j: j["finished"])[:-KEEP_FINISHED]:
            del self.jobs[job["id"]]

    def get(self, job_id):
        job = self.jobs.get(job_id)
        if job is None:
            raise BadRequest("unknown job", 404)
        return job
