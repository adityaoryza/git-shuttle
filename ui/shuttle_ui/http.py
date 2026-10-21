"""The HTTP server: checks who is asking, then hands the request to the API."""
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .api import handle
from .errors import BadRequest
from .jobs import Jobs
from .paths import STATIC_DIR

MAX_BODY = 1024 * 1024
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


def static_file(url_path):
    """The file under static/ that a /static/... URL names; anything that leaves the folder or is not a known type is refused."""
    relative = url_path[len("/static/"):]
    full = os.path.realpath(os.path.join(STATIC_DIR, relative))
    root = os.path.realpath(STATIC_DIR)
    ext = os.path.splitext(full)[1]
    if not full.startswith(root + os.sep) or ext not in CONTENT_TYPES or not os.path.isfile(full):
        raise BadRequest("not found", 404)
    with open(full, "rb") as f:
        return f.read(), CONTENT_TYPES[ext]


class Handler(BaseHTTPRequestHandler):
    server_version = "git-shuttle-ui"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # the access log stays quiet unless asked for
        if self.server.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def _allowed_hosts(self):
        port = self.server.server_address[1]
        return {"127.0.0.1:%d" % port, "localhost:%d" % port}

    def _check_origin(self):
        if self.headers.get("Host", "") not in self._allowed_hosts():
            raise BadRequest("this server answers only on its own address", 403)
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {"http://" + h for h in self._allowed_hosts()}:
            raise BadRequest("cross-site request refused", 403)

    def _check_token(self):
        given = self.headers.get("X-Shuttle-Token", "")
        if not hmac.compare_digest(given.encode(), self.server.token.encode()):
            raise BadRequest("missing or wrong token", 401)

    def _json_body(self):
        if (self.headers.get("Content-Type", "").split(";")[0].strip().lower()) != "application/json":
            raise BadRequest("send JSON", 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise BadRequest("bad Content-Length")
        if length < 0 or length > MAX_BODY:
            raise BadRequest("the request is too large", 413)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise BadRequest("the body is not valid JSON")
        if not isinstance(data, dict):
            raise BadRequest("the body must be a JSON object")
        return data

    def _dispatch(self, method):
        try:
            self._check_origin()
            path = urlparse(self.path).path
            if method == "GET" and path in ("/", "/index.html"):
                body, kind = static_file("/static/index.html")
                return self._send(200, body, kind)
            if method == "GET" and path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            if method == "GET" and path.startswith("/static/"):
                body, kind = static_file(path)
                return self._send(200, body, kind)
            if not path.startswith("/api/"):
                raise BadRequest("not found", 404)
            self._check_token()
            body = self._json_body() if method == "POST" else {}
            return self._send(200, handle(self.server, method, path[len("/api/"):], body))
        except BadRequest as error:
            return self._send(error.status, {"error": str(error)})
        except Exception as error:  # never leave a request without an answer
            return self._send(500, {"error": "internal error: %s" % error})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._send(405, {"error": "method not allowed"})

    do_DELETE = do_PATCH = do_PUT


class UIServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, store, token, verbose=False):
        super().__init__(address, Handler)
        self.store = store
        self.token = token
        self.jobs = Jobs(store)
        self.verbose = verbose
