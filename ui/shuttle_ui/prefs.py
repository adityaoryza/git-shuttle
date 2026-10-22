"""What the page remembers about how you use it: the branches hidden from the graph (per repository), how the branch list was left, and the
repository you were on.

It is kept here, in a file of the settings folder, and not in the browser: the browser keeps its storage per address (a port included), and
`git shuttle ui` takes another port when 7788 is busy, which made everything look forgotten. Only the keys below are accepted, each with the
shape it has, so that the page cannot put anything else in the file."""
import json
import os
import re
import tempfile
import threading

from .errors import BadRequest

MAX_ITEMS = 5000
MAX_STORED = 200            # the other settings of the page (theme, column widths, sizes of the panes...), one text each
MAX_STORED_TEXT = 20000
MAX_TEXT = 400
_LOCK = threading.Lock()
_ID = r"[A-Za-z0-9_-]{1,64}"
_HIDDEN = re.compile(r"^hidden:" + _ID + "$")
_STORED = re.compile(r"^ls:shuttle\.[A-Za-z0-9._:-]{1,80}$")       # a setting that the page keeps in its storage: a copy is kept here


def _path():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    folder = os.path.join(base, "git-shuttle")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return os.path.join(folder, "prefs.json")


def _strings(value, what):
    if not isinstance(value, list) or len(value) > MAX_ITEMS or not all(isinstance(x, str) and 0 < len(x) <= MAX_TEXT and "\0" not in x for x in value):
        raise BadRequest("%s must be a list of names" % what)
    return sorted(set(value))


def _check(key, value):
    """The value as it is kept, or a refusal."""
    if not isinstance(key, str):
        raise BadRequest("the key is not valid")
    if _HIDDEN.match(key):                      # the references hidden from the graph of one repository
        return _strings(value, "the hidden branches")
    if key == "picker":                         # how the branch list was left: its sections and the folders that are closed
        if not isinstance(value, dict) or set(value) - {"sections", "closed"}:
            raise BadRequest("the branch list state is not valid")
        sections = value.get("sections", {})
        if not isinstance(sections, dict) or set(sections) - {"Local", "Remote"} or not all(isinstance(v, bool) for v in sections.values()):
            raise BadRequest("the sections are not valid")
        return {"sections": sections, "closed": _strings(value.get("closed", []), "the closed folders")}
    if _STORED.match(key):                      # any other setting of the page, as the text the page keeps
        if not isinstance(value, str) or len(value) > MAX_STORED_TEXT or "\0" in value:
            raise BadRequest("the setting is not valid")
        return value
    if key == "repo":                           # the repository you were on
        if not isinstance(value, str) or not re.match("^" + _ID + "$", value):
            raise BadRequest("the repository is not valid")
        return value
    raise BadRequest("unknown setting '%s'" % key[:40])


def read():
    try:
        with open(_path(), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def set_pref(key, value):
    """Keeps one value (null forgets it); the answer is everything that is kept."""
    with _LOCK:
        data = read()
        if value is None:
            _check(key, [] if key.startswith("hidden:") else {} if key == "picker" else "a")     # the key must be a known one
            data.pop(key, None)
        else:
            checked = _check(key, value)
            if key.startswith("ls:") and key not in data and sum(1 for k in data if k.startswith("ls:")) >= MAX_STORED:
                raise BadRequest("too many settings are kept")
            data[key] = checked
        path = _path()
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".prefs-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except OSError:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise BadRequest("the settings could not be saved", 500)
        return data
