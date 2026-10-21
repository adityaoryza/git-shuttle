"""Text that goes into the history: whatever looks like a credential is replaced first."""
import re

_URL_USER = re.compile(r"(\b[a-z][a-z0-9+.\-]*://)[^/\s@]+@", re.I)
_ASSIGN = re.compile(r"(?i)\b((?:access[_-]?|auth[_-]?|api[_-]?|private[_-]?)?(?:token|secret|password|passwd|pwd)|authorization)(\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s'\"]+")
_KNOWN = re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_\-]{16,}|xox[abp]-[A-Za-z0-9\-]{10,}|AKIA[0-9A-Z]{16})\b")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def redact(text, limit=None):
    text = _URL_USER.sub(r"\1***@", str(text))
    text = _KNOWN.sub("***", text)
    text = _ASSIGN.sub(lambda m: m.group(1) + m.group(2) + "***", text)
    text = _CONTROL.sub("?", text)
    if limit and len(text) > limit:
        text = text[:limit] + "\n[cut: %d more characters]" % (len(text) - limit)
    return text
