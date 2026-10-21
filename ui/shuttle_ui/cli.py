"""Command line: start the server, register repositories, open the browser."""
import argparse
import os
import secrets
import subprocess
import sys

from .http import UIServer
from .runner import child_env
from .store import Store, config_dir


def make_server(port=0, store=None, token=None, verbose=False):
    """A server on 127.0.0.1 (never another interface); port 0 picks a free one."""
    return UIServer(("127.0.0.1", port), store or Store(config_dir()), token or secrets.token_urlsafe(32), verbose)


def open_browser(url):
    for opener in (["wslview", url], ["xdg-open", url], ["open", url], ["explorer.exe", url]):
        try:
            if subprocess.run(["which", opener[0]], capture_output=True).returncode == 0:
                subprocess.Popen(opener, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
        except OSError:
            continue
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(prog="git shuttle ui", description="the git-shuttle web UI (local, 127.0.0.1 only)")
    parser.add_argument("--port", type=int, default=7788, help="default 7788; another free port is used when it is taken")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    parser.add_argument("--repo", action="append", default=[], help="register a repository (repeatable)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    store = Store(config_dir())
    for path in args.repo:
        real = os.path.realpath(path)
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=real, env=child_env(), capture_output=True)
        if done.returncode != 0:
            sys.exit("not a git repository: %s" % path)
        store.add_repo(os.path.realpath(done.stdout.decode().strip()))
    try:
        server = make_server(args.port, store, verbose=args.verbose)
    except OSError:
        server = make_server(0, store, verbose=args.verbose)
    url = "http://127.0.0.1:%d/#token=%s" % (server.server_address[1], server.token)
    print("git-shuttle UI: %s" % url, flush=True)
    print("It listens on 127.0.0.1 only. Keep this link private: it holds the token. Stop with Ctrl-C.", flush=True)
    if not args.no_open:
        open_browser(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        server.server_close()
