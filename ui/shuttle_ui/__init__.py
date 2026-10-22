"""The git-shuttle web UI: a local server that shows your repositories and runs git-shuttle for you.

It adds no git logic of its own: every action is a git-shuttle command, previewed with --dry-run first.
Standard library only. See docs/ui.md for the design and the security model.
"""

__all__ = ["__version__", "__author__", "API_LEVEL"]
__version__ = "0.4.0"
__author__ = "Aditya Oryza Mahendra"
# Raised whenever the page needs a route a server may not have yet (the page checks it at start: GET /api/version).
API_LEVEL = 7
