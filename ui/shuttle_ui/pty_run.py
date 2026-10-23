"""Running a deploy whose server asks for a password (the ssh login, or sudo): git-shuttle runs on a pseudo terminal, and the password is
typed into the prompt that asks for it, the way you would. The password is never part of a command line, of the environment, of the
history or of the answer to the page: it is a bytearray that is overwritten when the job ends, and it is cut out of the output if it
shows up in it."""
import os
import re
import select
import signal
import subprocess
import sys
import time

from .paths import SHUTTLE_ARGV
from .runner import MAX_OUTPUT, child_env

# what ssh (user@host's password:) or sudo ([sudo] password for user:) print before they wait for the password, and what they print
# when it was wrong
PROMPT = re.compile(rb"(?:^|\n)[^\n]*password[^\n]*:\s*$", re.I)
WRONG = re.compile(rb"sorry, try again|incorrect password|authentication failure|no password was provided|permission denied", re.I)
MAX_ANSWERS = 4         # the login, then sudo (and sudo again if its cache ran out); a wrong password is caught by the text it prints

# ssh reads its password from the controlling terminal: the command gets the pseudo terminal as its own (nothing else is changed).
# It is a small program of its own, so that nothing runs between the fork and the exec of a server that has threads.
_HELPER = ("import fcntl, os, sys, termios\n"
           "try:\n    fcntl.ioctl(0, termios.TIOCSCTTY, 0)\n"
           "except OSError:\n    pass\n"
           "os.execvp(sys.argv[1], sys.argv[1:])\n")


def scrub(raw, secret):
    """The output as text: the password (if the terminal echoed it) and the carriage returns removed."""
    if secret:
        raw = raw.replace(bytes(secret), b"***")
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n").decode("utf-8", "replace")


def run_with_secret(repo_path, args, secret, timeout=900, on_output=None):
    """One git-shuttle command on a pseudo terminal, with the sudo password typed when the server asks. Returns (exit status, output).

    on_output(text) gets what was printed so far (the password cut out) each time more arrives."""
    import pty
    argv = SHUTTLE_ARGV + ["-y"] + list(args)
    master, slave = pty.openpty()
    try:
        # no shell; its own session, so that only this command and what it starts are ended on a timeout
        proc = subprocess.Popen([sys.executable, "-I", "-c", _HELPER] + argv, cwd=repo_path, env=child_env({"TERM": "dumb"}), stdin=slave, stdout=slave, stderr=slave,
                                start_new_session=True, close_fds=True)
    except OSError as error:
        os.close(master)
        return 1, "cannot start git-shuttle: %s" % error
    finally:
        os.close(slave)
    out, since, answers, failure = b"", 0, 0, ""
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([master], [], [], 0.5)
            if not ready:
                if proc.poll() is not None and not select.select([master], [], [], 0)[0]:
                    break
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError:     # the child closed the terminal: it is done
                break
            if not chunk:
                break
            out += chunk
            if on_output:
                on_output(scrub(out[:MAX_OUTPUT], secret))
            tail = out[since:]
            if PROMPT.search(tail):
                if answers >= 1 and WRONG.search(tail):
                    failure = "sudo did not accept the password: it was not sent again"
                    break
                if answers >= MAX_ANSWERS:
                    failure = "sudo asked for the password too many times: stopped"
                    break
                os.write(master, bytes(secret) + b"\n")
                answers += 1
                since = len(out)
        else:
            failure = "timed out"
    finally:
        if failure:
            _stop(proc)
        try:
            os.close(master)
        except OSError:
            pass
        code = _wait(proc)
    text = scrub(out[:MAX_OUTPUT], secret)
    if failure:
        return (124 if failure == "timed out" else 1), text + "\n" + failure
    return code, text


def _stop(proc):
    """Ends the command this server started (its own session: only it and what it started)."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        pass


def _wait(proc):
    try:
        return proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        return proc.wait()


def wipe(secret):
    """Overwrites the password in place (best effort: Python may have made copies of what it read before)."""
    if isinstance(secret, bytearray):
        for i in range(len(secret)):
            secret[i] = 0
