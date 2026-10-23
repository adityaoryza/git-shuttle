#!/usr/bin/env python3
"""The add-on protocol of git-shuttle, version 1: what an add-on may say, checked before git-shuttle uses any of it.

An add-on is a program named git-shuttle-NAME. git-shuttle talks to it with JSON on standard input and output, and never trusts it: every
answer goes through this file, which keeps the fields that are known, cuts them to a size, removes control characters, and refuses the rest.

    protocol.py validate manifest NAME < answer    the answer of `git-shuttle-NAME --shuttle-manifest`
    protocol.py validate start|pr|status < answer  the answer of a hook
    protocol.py input HOOK key=value ...           the JSON that a hook receives (built here so that nothing needs escaping in shell)

`validate` prints NUL-separated key=value records (status: one line of JSON), or an error on standard error and exit status 1.
Standard library only; run with -I.
"""
import json
import re
import sys

PROTOCOL = 1
HOOKS = ("start", "pr", "status", "tasks", "setup")
SETUP_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
SETUP_KINDS = ("text", "secret", "path", "url")
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
FLAG_RE = re.compile(r"^--[a-z][a-z0-9-]{0,30}$")
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,40}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.#:/-]{0,59}$")
# a name to be made into a branch (git-shuttle turns it into snake_case): a title like "[Sales] Keep the order date" is fine; shell characters are not
BRANCH_RE = re.compile(r"^[\w\[\]() .,:#'&/-]{1,120}$")
URL_RE = re.compile(r"^https?://[^\s<>\"'`]{1,500}$")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
# flags that git-shuttle itself reads: an add-on cannot take them over
RESERVED = {
    "start": {"--from", "--stash", "--carry", "--yes", "--dry-run", "--help", "--version"},
    "pr": {"--base", "--title", "--body", "--body-file", "--draft", "--yes", "--dry-run", "--help", "--version"},
}
LIMITS = {"cards": 5, "fields": 12, "tasks": 60, "details": 12}
REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,60}/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$")


class Refused(Exception):
    pass


def text(value, field, limit, single_line=True, required=False):
    if value is None or value == "":
        if required:
            raise Refused("%s is missing" % field)
        return ""
    if not isinstance(value, str):
        raise Refused("%s must be a text" % field)
    value = CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n")) if not single_line else CONTROL.sub("", value.replace("\n", " ").replace("\t", " "))
    value = value.strip()
    if len(value) > limit:
        raise Refused("%s is longer than %d characters" % (field, limit))
    if required and not value:
        raise Refused("%s is empty" % field)
    return value


def url(value, field):
    value = text(value, field, 500)
    if value and not URL_RE.match(value):
        raise Refused("%s must be an http or https address" % field)
    return value


def load(raw):
    try:
        data = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except (ValueError, UnicodeDecodeError):
        raise Refused("the answer is not JSON")
    if not isinstance(data, dict):
        raise Refused("the answer must be a JSON object")
    return data


def records(pairs):
    return "".join("%s=%s\0" % pair for pair in pairs).encode("utf-8")


def manifest(raw, expected):
    data = load(raw)
    if data.get("protocol") != PROTOCOL or isinstance(data.get("protocol"), bool):
        raise Refused("it speaks protocol %r: this git-shuttle speaks %d" % (data.get("protocol"), PROTOCOL))
    name = text(data.get("name"), "name", 31, required=True)
    if not NAME_RE.match(name) or name != expected:
        raise Refused("its name is '%s', and the program is git-shuttle-%s" % (name, expected))
    out = [("name", name), ("version", text(data.get("version"), "version", 40)), ("description", text(data.get("description"), "description", 200))]
    hooks = data.get("hooks", [])
    if not isinstance(hooks, list) or any(h not in HOOKS for h in hooks) or len(set(hooks)) != len(hooks):
        raise Refused("hooks must be a list of: %s" % ", ".join(HOOKS))
    out += [("hook", h) for h in hooks]
    flags = data.get("flags", {})
    if not isinstance(flags, dict):
        raise Refused("flags must be an object: the hook, then its flags")
    for hook, names in flags.items():
        if hook not in RESERVED:
            raise Refused("flags can be added to: %s" % ", ".join(sorted(RESERVED)))
        if hook not in hooks:
            raise Refused("flags for '%s' need the hook '%s'" % (hook, hook))
        if not isinstance(names, list) or len(names) > 5:
            raise Refused("the flags of '%s' must be a list of at most 5" % hook)
        for flag in names:
            if not isinstance(flag, str) or not FLAG_RE.match(flag):
                raise Refused("'%s' is not a flag (like --task)" % flag)
            if flag in RESERVED[hook]:
                raise Refused("%s is a flag of git-shuttle itself" % flag)
            out.append(("flag", "%s:%s" % (hook, flag)))
    env = data.get("env", [])
    if not isinstance(env, list) or len(env) > 10 or any(not isinstance(v, str) or not ENV_RE.match(v) for v in env):
        raise Refused("env must be a list of at most 10 variable names (like ODOO_API_KEY): the only ones it receives")
    out += [("env", v) for v in env]
    return records(out)


def reference(data):
    ref = data.get("reference")
    if ref is None:
        return []
    if not isinstance(ref, dict):
        raise Refused("reference must be an object")
    ident = text(ref.get("id"), "reference.id", 60, required=True)
    if not ID_RE.match(ident):
        raise Refused("reference.id has characters that are not allowed")
    out = [("ref-id", ident), ("ref-title", text(ref.get("title"), "reference.title", 200)), ("ref-link", url(ref.get("link"), "reference.link"))]
    # what the add-on knows of the task when the branch starts (the stage, the project, the dates...): kept in the trace of the task
    details = ref.get("details", [])
    if not isinstance(details, list) or len(details) > LIMITS["details"]:
        raise Refused("reference.details must be a list of at most %d" % LIMITS["details"])
    for d in details:
        if not isinstance(d, dict):
            raise Refused("a detail must be an object (label, value)")
        out.append(("ref-detail", "%s\x1f%s" % (text(d.get("label"), "detail label", 40, required=True), text(d.get("value"), "detail value", 300))))
    return out


def start(raw):
    data = load(raw)
    out = []
    branch = text(data.get("branch"), "branch", 120)
    if branch:
        # a task title has quotes, question marks, dollar signs...: what is not simple text is dropped (the name is turned into a branch name by
        # git-shuttle anyway); a path ("..") or nothing left is refused
        if ".." in branch:
            raise Refused("branch has characters that are not allowed")
        branch = re.sub(r"\s+", " ", re.sub(r"[^\w\[\]() .,:#'&/-]", " ", branch)).strip()
        if not BRANCH_RE.match(branch) or not any(c.isalnum() for c in branch):
            raise Refused("branch has characters that are not allowed")
        out.append(("branch", branch))
    out += reference(data)
    if data.get("note") is not None:
        out.append(("note", text(data.get("note"), "note", 500)))
    return records(out)


def pr(raw):
    data = load(raw)
    out = []
    if data.get("title"):
        out.append(("title", text(data.get("title"), "title", 200)))
    if data.get("body"):
        out.append(("body", text(data.get("body"), "body", 20000, single_line=False)))
    return records(out)


def status(raw):
    data = load(raw)
    cards = data.get("cards", [])
    if not isinstance(cards, list) or len(cards) > LIMITS["cards"]:
        raise Refused("cards must be a list of at most %d" % LIMITS["cards"])
    clean = []
    for i, card in enumerate(cards):
        if not isinstance(card, dict):
            raise Refused("a card must be an object")
        fields = card.get("fields", [])
        if not isinstance(fields, list) or len(fields) > LIMITS["fields"]:
            raise Refused("a card has at most %d fields" % LIMITS["fields"])
        clean.append({
            "title": text(card.get("title"), "cards[%d].title" % i, 120, required=True),
            "subtitle": text(card.get("subtitle"), "cards[%d].subtitle" % i, 200),
            "link": url(card.get("link"), "cards[%d].link" % i),
            "text": text(card.get("text"), "cards[%d].text" % i, 5000, single_line=False),
            "fields": [{"label": text(f.get("label"), "label", 40, required=True), "value": text(f.get("value"), "value", 300)}
                       for f in fields if isinstance(f, dict)],
        })
    return (json.dumps({"cards": clean}, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def tasks(raw):
    """The tasks the user can start from: a short list, each with an identifier, a title and a few lines of detail."""
    data = load(raw)
    items = data.get("tasks", [])
    if not isinstance(items, list) or len(items) > LIMITS["tasks"]:
        raise Refused("tasks must be a list of at most %d" % LIMITS["tasks"])
    clean = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise Refused("a task must be an object")
        ident = text(item.get("id"), "tasks[%d].id" % i, 60, required=True)
        if not ID_RE.match(ident):
            raise Refused("tasks[%d].id has characters that are not allowed" % i)
        fields = item.get("fields", [])
        if not isinstance(fields, list) or len(fields) > 8:
            raise Refused("a task has at most 8 fields")
        clean.append({
            "id": ident, "title": text(item.get("title"), "tasks[%d].title" % i, 200, required=True),
            "subtitle": text(item.get("subtitle"), "tasks[%d].subtitle" % i, 200), "link": url(item.get("link"), "tasks[%d].link" % i),
            "fields": [{"label": text(f.get("label"), "label", 40, required=True), "value": text(f.get("value"), "value", 300)} for f in fields if isinstance(f, dict)],
        })
    note = text(data.get("note"), "note", 300)
    return (json.dumps({"tasks": clean, "note": note}, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def registry(path):
    """The add-ons that git-shuttle knows where to get: name, title, description, repository, asset, program (the file in the archive)."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        raise Refused("the list of add-ons cannot be read: %s" % path)
    entries = data.get("addons") if isinstance(data, dict) else None
    if not isinstance(entries, list) or len(entries) > 50:
        raise Refused("the list of add-ons is not valid")
    out, seen = [], set()
    for e in entries:
        if not isinstance(e, dict):
            raise Refused("an entry of the list is not an object")
        name = text(e.get("name"), "name", 31, required=True)
        repo = text(e.get("repo"), "repo", 160, required=True)
        asset = text(e.get("asset"), "asset", 120, required=True)
        program = text(e.get("program"), "program", 120, required=True)
        if not NAME_RE.match(name) or name in seen:
            raise Refused("'%s' is not a valid name, or is listed twice" % name)
        if not REPO_RE.match(repo) or ".." in repo:
            raise Refused("'%s' is not a repository (owner/name)" % repo)
        if "{tag}" not in asset or "/" in asset or ".." in asset or not re.match(r"^[A-Za-z0-9._{}-]+$", asset):
            raise Refused("the asset of '%s' must be a file name that holds {tag}" % name)
        if program.startswith("/") or ".." in program.split("/") or not re.match(r"^[A-Za-z0-9._/-]+$", program):
            raise Refused("the program of '%s' must be a path inside the archive" % name)
        if e.get("protocol") != PROTOCOL:
            raise Refused("'%s' speaks another protocol" % name)
        seen.add(name)
        out.append(("entry", "\x1f".join([name, text(e.get("title"), "title", 60), text(e.get("description"), "description", 300), repo, asset, program])))
    return records(out)


def setup_status(raw):
    """What an add-on needs from the user (a login, a key): the fields to fill in, and whether it is ready. A secret is never shown back."""
    data = load(raw)
    items = data.get("fields", [])
    if not isinstance(items, list) or len(items) > 10:
        raise Refused("fields must be a list of at most 10")
    clean, seen = [], set()
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise Refused("a field must be an object")
        key = text(item.get("key"), "fields[%d].key" % i, 31, required=True)
        kind = item.get("kind", "text")
        if not SETUP_KEY_RE.match(key) or key in seen or kind not in SETUP_KINDS:
            raise Refused("fields[%d]: the key is lowercase letters, digits and _ (once each); the kind is one of: %s" % (i, ", ".join(SETUP_KINDS)))
        seen.add(key)
        clean.append({
            "key": key, "kind": kind, "label": text(item.get("label"), "fields[%d].label" % i, 60, required=True),
            "help": text(item.get("help"), "fields[%d].help" % i, 300), "required": item.get("required") is True,
            "set": item.get("set") is True,
            "value": "" if kind == "secret" else text(item.get("value"), "fields[%d].value" % i, 300),
        })
    return (json.dumps({"fields": clean, "ready": data.get("ready") is True, "note": text(data.get("note"), "note", 300)},
                       ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def setup_save(raw):
    data = load(raw)
    return (json.dumps({"ok": data.get("ok") is True, "message": text(data.get("message"), "message", 300)},
                       ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def setup_input(action, raw):
    """The JSON of the setup hook. The values come on standard input (never on a command line, where a key could be read by others)."""
    doc = {"protocol": PROTOCOL, "hook": "setup", "repo": {}, "args": {}, "action": action}
    if action == "save":
        values = load(raw)
        if len(values) > 10 or any(not SETUP_KEY_RE.match(k) or not isinstance(v, str) or len(v) > 2000 for k, v in values.items()):
            raise Refused("the values are an object of at most 10 texts, each under 2000 characters")
        doc["values"] = values
    return (json.dumps(doc, ensure_ascii=False) + "\n").encode("utf-8")


def build_input(hook, pairs):
    """The JSON a hook receives. key=value pairs: repo.NAME and arg.NAME go in their own objects, the rest at the top."""
    doc = {"protocol": PROTOCOL, "hook": hook, "repo": {}, "args": {}}
    for pair in pairs:
        key, _, value = pair.partition("=")
        if key.startswith("repo."):
            doc["repo"][key[5:]] = value
        elif key.startswith("arg."):
            doc["args"][key[4:]] = value
        else:
            doc[key] = value
    return (json.dumps(doc, ensure_ascii=False) + "\n").encode("utf-8")


def main(argv):
    try:
        if len(argv) >= 3 and argv[1] == "validate" and argv[2] == "manifest" and len(argv) == 4:
            sys.stdout.buffer.write(manifest(sys.stdin.buffer.read(), argv[3]))
        elif len(argv) == 3 and argv[1] == "validate" and argv[2] in ("start", "pr", "status", "tasks", "setup", "setup-save"):
            sys.stdout.buffer.write({"start": start, "pr": pr, "status": status, "tasks": tasks, "setup": setup_status, "setup-save": setup_save}[argv[2]](sys.stdin.buffer.read()))
        elif len(argv) == 4 and argv[1] == "input-setup" and argv[2] in ("status", "save"):
            sys.stdout.buffer.write(setup_input(argv[2], sys.stdin.buffer.read() if argv[3] == "-" else b"{}"))
        elif len(argv) == 3 and argv[1] == "registry":
            sys.stdout.buffer.write(registry(argv[2]))
        elif len(argv) >= 3 and argv[1] == "input" and argv[2] in HOOKS:
            sys.stdout.buffer.write(build_input(argv[2], argv[3:]))
        else:
            sys.stderr.write("usage: protocol.py validate manifest NAME | validate start|pr|status | input HOOK key=value...\n")
            return 2
    except Refused as error:
        sys.stderr.write("%s\n" % error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
