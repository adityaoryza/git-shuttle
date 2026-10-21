"""The page makes no request to anybody else, and the only addresses in the project are the author's and the repository's."""
import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
URL = re.compile(r"https?://[^\s\"'<>)\]`]+")
# the addresses the project is allowed to name
ALLOWED = (
    "https://adityaoryza.my.id/en", "https://github.com/adityaoryza", "https://linkedin.com/in/adityaoryza",   # the author
    "https://github.com/adityaoryza/git-shuttle",                                                              # the repository (and its pages)
    "http://127.0.0.1", "http://127\\.0\\.0\\.1",                                                                # the local server (and the pattern that recognises its link)
    "http://www.w3.org/2000/svg",                                                                               # the XML namespace of an SVG file: never requested
)
# not scanned: third-party files, and the one script whose comments and case patterns spell out the shape of a remote URL
SKIP = ("ui/shuttle_ui/static/vendor/", "THIRD_PARTY_NOTICES.md", "lib/commands/link.sh", "tests/", "node_modules/", ".git/")
TEXT = (".md", ".py", ".js", ".mjs", ".css", ".html", ".svg", ".sh", ".yml", ".yaml", ".json", ".txt")


def files():
    for folder, dirs, names in os.walk(ROOT):
        rel = os.path.relpath(folder, ROOT) + "/"
        dirs[:] = [d for d in dirs if not any((rel + d + "/").lstrip("./").startswith(s) for s in SKIP) and d != "__pycache__"]
        for name in names:
            path = os.path.relpath(os.path.join(folder, name), ROOT)
            if path.endswith(TEXT) or name in ("LICENSE", "git-shuttle", "Makefile"):
                if not any(path.startswith(s) or path == s for s in SKIP):
                    yield path


class TestAddresses(unittest.TestCase):
    def test_only_the_authors_and_the_repositorys_addresses_appear(self):
        found = []
        for path in files():
            with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as f:
                for n, line in enumerate(f, 1):
                    for url in URL.findall(line):
                        if not url.startswith(ALLOWED):
                            found.append("%s:%d %s" % (path, n, url))
        self.assertEqual(found, [], "an address outside the allowed list (see ALLOWED in this test)")

    def test_the_page_loads_nothing_from_elsewhere(self):
        """No <script src>, <link href>, <img src>, @import or url() that is not the same server."""
        base = os.path.join(ROOT, "ui", "shuttle_ui", "static")
        for name in ("index.html",):
            html = open(os.path.join(base, name), encoding="utf-8").read()
            for ref in re.findall(r"(?:src|href)=\"([^\"]+)\"", html):
                self.assertTrue(ref.startswith("/static/") or ref.startswith("/"), ref)
        for folder, _, names in os.walk(base):
            if "vendor" in folder:
                continue
            for name in names:
                if name.endswith((".css", ".js")):
                    text = open(os.path.join(folder, name), encoding="utf-8").read()
                    self.assertNotRegex(text, r"@import\s+url\(\s*['\"]?https?:", name)
                    self.assertNotRegex(text, r"url\(\s*['\"]?https?:", name)
                    self.assertNotRegex(text, r"\b(?:fetch|import|new WebSocket|new EventSource)\(\s*['\"`]https?:", name)

    def test_the_policy_allows_nothing_external(self):
        from shuttle_ui.http import CSP
        self.assertIn("default-src 'self'", CSP)
        self.assertNotRegex(CSP, r"https?:")
        self.assertNotIn("*", CSP)

    def test_the_author_is_the_same_everywhere(self):
        import sys
        sys.path.insert(0, os.path.join(ROOT, "ui"))
        from shuttle_ui import __author__
        self.assertEqual(__author__, "Aditya Oryza Mahendra")
        self.assertIn("Copyright (c) 2026 Aditya Oryza Mahendra", open(os.path.join(ROOT, "LICENSE")).read())
        readme = open(os.path.join(ROOT, "README.md")).read()
        for url in ("https://adityaoryza.my.id/en", "https://github.com/adityaoryza", "https://linkedin.com/in/adityaoryza"):
            self.assertIn(url, readme)
        for path in files():
            with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as f:
                self.assertNotIn("@gmail.com", f.read(), path + " must not carry an e-mail address")


if __name__ == "__main__":
    unittest.main()
