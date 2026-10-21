"""Where things are: derived from the location of this package, so that the UI runs from a checkout or an install."""
import os
import shutil

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(PACKAGE_DIR, "static")
# <root>/ui/shuttle_ui -> <root>/bin/git-shuttle
SHUTTLE = os.path.join(os.path.dirname(os.path.dirname(PACKAGE_DIR)), "bin", "git-shuttle")


def _git_bash():
    """The bash that comes with Git for Windows (found next to git), never the WSL stub that may be first in PATH."""
    git = shutil.which("git")
    if not git:
        return None
    root = os.path.dirname(os.path.realpath(git))
    for _ in range(3):                                                  # ...\Git\cmd, ...\Git\mingw64\bin: the folder above holds bin\bash.exe
        root = os.path.dirname(root)
        for sub in ("bin", os.path.join("usr", "bin")):
            candidate = os.path.join(root, sub, "bash.exe")
            if os.path.isfile(candidate):
                return candidate
    return None


def _shuttle_argv():
    """What starts git-shuttle: the script itself, or on Windows bash with the script (Windows cannot run a script by itself)."""
    if os.name != "nt":
        return [SHUTTLE]
    bash = os.environ.get("GIT_SHUTTLE_BASH") or _git_bash() or shutil.which("bash") or "bash"
    return [bash, SHUTTLE.replace("\\", "/")]


SHUTTLE_ARGV = _shuttle_argv()
