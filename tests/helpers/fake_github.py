#!/usr/bin/env python3
"""A stand-in for the release pages of a GitHub repository, for the tests of `git shuttle update`.

    fake_github.py PORT_FILE VERSION [MODE]

It listens on a free port of 127.0.0.1 and writes the port to PORT_FILE once it is ready. Under /acme/git-shuttle:
  /releases/latest                      redirects to /releases/tag/vVERSION
  /releases/tag/vX                      a page
  /archive/refs/tags/vX.tar.gz          a release: bin/git-shuttle that prints its version, and lib/
MODE changes what is wrong with it: ok (default), wrong-version, corrupt, missing, no-release, not-git-shuttle.
"""
import io
import sys
import tarfile
from http.server import BaseHTTPRequestHandler, HTTPServer

BASE = "/acme/git-shuttle"


def release(version, mode):
    said = "9.9.9-not-this" if mode == "wrong-version" else version
    script = '#!/usr/bin/env bash\ncase "${1:-}" in --version) echo "git-shuttle %s" ;; *) echo "new copy" ;; esac\n' % said
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        def add(name, data, mode_bits=0o644):
            info = tarfile.TarInfo("git-shuttle-%s/%s" % (version, name))
            info.size, info.mode = len(data), mode_bits
            tar.addfile(info, io.BytesIO(data))
        if mode == "not-git-shuttle":
            add("README.md", b"something else\n")
        else:
            add("bin/git-shuttle", script.encode(), 0o755)
            add("lib/core/marker", b"new\n")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body=b"", headers=None):
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        version, mode = self.server.version, self.server.mode
        if self.path == BASE + "/releases/latest":
            if mode == "no-release":
                return self.reply(302, headers={"Location": BASE + "/releases"})
            return self.reply(302, headers={"Location": "%s/releases/tag/v%s" % (BASE, version)})
        if self.path.startswith(BASE + "/releases/tag/") or self.path == BASE + "/releases":
            return self.reply(200, b"<html>a release</html>", {"Content-Type": "text/html"})
        if self.path.startswith(BASE + "/archive/refs/tags/v") and self.path.endswith(".tar.gz"):
            tag = self.path.rsplit("/", 1)[1][1:-len(".tar.gz")]
            if mode == "missing":
                return self.reply(404)
            if mode == "corrupt":
                return self.reply(200, b"this is not a gzip file", {"Content-Type": "application/gzip"})
            return self.reply(200, release(tag, mode), {"Content-Type": "application/gzip"})
        return self.reply(404)


def main():
    port_file, version = sys.argv[1], sys.argv[2]
    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.version, server.mode = version, sys.argv[3] if len(sys.argv) > 3 else "ok"
    with open(port_file, "w") as handle:
        handle.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
