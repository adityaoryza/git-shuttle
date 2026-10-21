"""python3 -m shuttle_ui  (what `git shuttle ui` runs)."""
import sys

try:
    from .cli import main
    main()
except KeyboardInterrupt:       # Ctrl-C before the server could take over the signal
    sys.exit(130)
