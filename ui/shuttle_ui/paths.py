"""Where things are: derived from the location of this package, so that the UI runs from a checkout or an install."""
import os

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(PACKAGE_DIR, "static")
# <root>/ui/shuttle_ui -> <root>/bin/git-shuttle
SHUTTLE = os.path.join(os.path.dirname(os.path.dirname(PACKAGE_DIR)), "bin", "git-shuttle")
