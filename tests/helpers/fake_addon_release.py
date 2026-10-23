#!/usr/bin/env python3
"""A stand-in for the releases of the GitHub repository of an add-on, for the tests of `git shuttle addon install`.

    fake_addon_release.py PORT_FILE REPO NAME VERSION [MODE]

It listens on a free port of 127.0.0.1, writes the port to PORT_FILE once it is ready, and records every path asked in PORT_FILE.log. Under /REPO:
  /releases/latest                          redirects to /releases/tag/vVERSION
  /releases/download/vX/NAME-vX.tar.gz      the add-on: NAME-vX/bin/git-shuttle-NAME (a program that answers the protocol)
  /releases/download/vX/SHA256SUMS          the checksum of the archive
MODE changes what is wrong with it: ok (default), bad-checksum, no-sums, no-program, links, traversal, no-release, other-program.
"""
import hashlib
import io
import sys
import tarfile
from http.server import BaseHTTPRequestHandler, HTTPServer


def program(name, version):
    return ('#!/usr/bin/env bash\ncase "${1:-}" in\n'
            '  --shuttle-manifest) echo \'{"protocol":1,"name":"%s","version":"%s","description":"A downloaded add-on","hooks":["status"]}\' ;;\n'
            '  hook) cat >/dev/null; echo \'{"cards":[{"title":"From the downloaded add-on %s"}]}\' ;;\nesac\n') % (name, version, version)


def archive(name, version, mode):
    buf = io.BytesIO()
    top = "%s-v%s" % (name, version)
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        def add(path, data, bits=0o644):
            info = tarfile.TarInfo(path)
            info.size, info.mode = len(data), bits
            tar.addfile(info, io.BytesIO(data))
        if mode != "no-program":
            add("%s/bin/git-shuttle-%s" % (top, name), program(name if mode != "other-program" else "somebody-else", version).encode(), 0o755)
        add("%s/README" % top, b"an add-on\n")
        if mode == "links":
            link = tarfile.TarInfo("%s/bin/evil" % top)
            link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(link)
        if mode == "traversal":
            add("%s/../escaped" % top, b"x")
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
        s = self.server
        with open(s.log_path, "a") as log:
            log.write(self.path + "\n")
        base = "/" + s.repo
        tag = "v" + s.version
        asset = "%s-%s.tar.gz" % (s.name, tag)
        if self.path == base + "/releases/latest":
            if s.mode == "no-release":
                return self.reply(302, headers={"Location": base + "/releases"})
            return self.reply(302, headers={"Location": "%s/releases/tag/%s" % (base, tag)})
        if self.path.startswith(base + "/releases/tag/") or self.path == base + "/releases":
            return self.reply(200, b"<html>a release</html>", {"Content-Type": "text/html"})
        if self.path.startswith(base + "/releases/download/"):
            wanted, _, name = self.path[len(base + "/releases/download/"):].partition("/")
            data = archive(s.name, wanted[1:], s.mode)      # any tag that is asked for exists, as on GitHub
            asset = "%s-%s.tar.gz" % (s.name, wanted)
            if name == asset:
                return self.reply(200, data, {"Content-Type": "application/gzip"})
            if name == "SHA256SUMS" and s.mode != "no-sums":
                digest = hashlib.sha256(data).hexdigest()
                if s.mode == "bad-checksum":
                    digest = "0" * 64
                return self.reply(200, ("%s  %s\n" % (digest, asset)).encode())
        return self.reply(404)


def main():
    port_file, repo, name, version = sys.argv[1:5]
    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.repo, server.name, server.version = repo, name, version
    server.mode = sys.argv[5] if len(sys.argv) > 5 else "ok"
    server.log_path = port_file + ".log"
    open(server.log_path, "w").close()
    with open(port_file, "w") as handle:
        handle.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
