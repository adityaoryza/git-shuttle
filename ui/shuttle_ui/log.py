"""What the server prints in the terminal: one line per action and per problem, never the token or any user text."""
import logging
import os
import re
import sys
import time

LOGGER = logging.getLogger("shuttle_ui")
LOGGER.addHandler(logging.NullHandler())      # silent until configure() is called (tests, embedding)
COLORS = {"job": "36", "warn": "33", "error": "31", "info": "2", "http": "2"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def clean(value, limit=120):
    """Text safe to print: control characters (a way to forge log lines) become '?', and long values are cut."""
    value = _CONTROL.sub("?", str(value))
    return value if len(value) <= limit else value[: limit - 1] + "…"


class LineFormatter(logging.Formatter):
    """`HH:MM:SS  tag   message`, the tag coloured when the stream is a terminal."""

    def __init__(self, color):
        super().__init__()
        self.color = color

    def format(self, record):
        tag = getattr(record, "tag", None) or {logging.WARNING: "warn", logging.ERROR: "error"}.get(record.levelno, "info")
        label = "%-5s" % tag
        if self.color:
            label = "\x1b[%sm%s\x1b[0m" % (COLORS.get(tag, "0"), label)
        line = "%s  %s %s" % (time.strftime("%H:%M:%S", time.localtime(record.created)), label, record.getMessage())
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def configure(verbose=False, quiet=False, stream=None):
    """Send the log to `stream` (stderr by default); --verbose adds every request, --quiet keeps only problems."""
    stream = stream or sys.stderr
    color = bool(getattr(stream, "isatty", lambda: False)()) and "NO_COLOR" not in os.environ
    handler = logging.StreamHandler(stream)
    handler.setFormatter(LineFormatter(color))
    LOGGER.handlers[:] = [handler]
    LOGGER.setLevel(logging.WARNING if quiet else logging.DEBUG if verbose else logging.INFO)
    LOGGER.propagate = False
    return handler


def job(repo, action, message):
    LOGGER.info("%s  %s  %s", clean(repo, 40), clean(action, 20), message, extra={"tag": "job"})


def request(method, path, status, millis):
    LOGGER.debug("%s %s %d %dms", clean(method, 8), clean(path), status, millis, extra={"tag": "http"})


def refused(status, reason, client, method, path):
    LOGGER.warning("%d %s  (%s %s from %s)", status, clean(reason), clean(method, 8), clean(path, 80), clean(client, 45))


def failed(method, path, error, traceback=False):
    LOGGER.error("500 %s %s  %s: %s", clean(method, 8), clean(path, 80), type(error).__name__, clean(error),
                 exc_info=(type(error), error, error.__traceback__) if traceback else None)


def summarize(commands):
    """The steps of a job as 'stage, commit x3, ship': names and counts only, never the values given."""
    names = []
    for argv in commands:
        if names and names[-1][0] == argv[0]:
            names[-1][1] += 1
        else:
            names.append([argv[0], 1])
    return ", ".join(name if count == 1 else "%s x%d" % (name, count) for name, count in names)
