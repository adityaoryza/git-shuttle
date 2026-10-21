"""The git-shuttle web UI: a local server that shows your repositories and runs git-shuttle for you.

It adds no git logic of its own: every action is a git-shuttle command, previewed with --dry-run first.
Standard library only. See docs/ui.md for the design and the security model.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
