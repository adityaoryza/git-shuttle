"""Jobs: an action runs in a thread, one at a time per repository."""
import threading
import time
import uuid

from .errors import BadRequest
from .runner import run_shuttle


class Jobs:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()
        self.jobs = {}
        self.busy = {}  # repo id -> job id

    def start(self, repo, action, commands):
        with self.lock:
            if repo["id"] in self.busy:
                raise BadRequest("another action is running in this repository", 409)
            job_id = uuid.uuid4().hex[:12]
            job = {"id": job_id, "repo": repo["id"], "action": action, "state": "running", "exit": None,
                   "steps": [{"argv": c, "state": "todo", "exit": None, "output": ""} for c in commands],
                   "started": time.time(), "finished": None}
            self.jobs[job_id] = job
            self.busy[repo["id"]] = job_id
        threading.Thread(target=self._run, args=(repo, job), daemon=True).start()
        return job_id

    def _run(self, repo, job):
        exit_code = 0
        try:
            for step in job["steps"]:
                step["state"] = "running"
                code, output = run_shuttle(repo["path"], step["argv"], dry_run=False, timeout=900)
                step["exit"], step["output"] = code, output
                step["state"] = "done" if code == 0 else "stopped"
                if code != 0:
                    exit_code = code
                    break
        except Exception as error:  # a bug here must not leave the repository marked busy
            exit_code = 1
            job["steps"][-1]["output"] += "\ninternal error: %s" % error
        finally:
            job["exit"] = exit_code
            job["finished"] = time.time()
            job["state"] = "done" if exit_code == 0 else "stopped" if exit_code == 2 else "failed"
            with self.lock:
                self.busy.pop(repo["id"], None)
            self.store.log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "repo": repo["name"], "action": job["action"],
                            "state": job["state"], "exit": exit_code,
                            "commands": ["git shuttle " + " ".join(s["argv"][:3]) for s in job["steps"]]})

    def get(self, job_id):
        job = self.jobs.get(job_id)
        if job is None:
            raise BadRequest("unknown job", 404)
        return job
