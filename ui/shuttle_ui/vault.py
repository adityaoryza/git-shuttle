"""The password of a server, kept on this computer by the system, only when the user asks for it ("Remember on this computer").

Nothing is ever written in clear: the system keeps it, and only the user that is logged in can open it.
  - Linux: the keyring of the desktop, through `secret-tool` (libsecret). The password goes in by standard input.
  - Windows and WSL: DPAPI (the protection of the Windows user), through PowerShell. The password goes in by standard input; what is
    kept in this folder is only the protected text, which is useless on another computer or for another Windows user.
macOS is not supported yet. Without one of these the page says so and how to get one: there is no fallback to a file in clear.

The page never gets a password back. The server reads it only to answer a prompt of ssh or sudo, in the memory of a job, and wipes it.
`index.json` lists what is saved (a key, a date): no secret."""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

from .errors import BadRequest

TIMEOUT = 30
_SERVICE = "git-shuttle"

# The scripts are fixed texts (nothing of a request is in them); the data comes in by standard input.
_PS_COMMON = ("$ErrorActionPreference='Stop';"
              "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
              "$in=[Console]::In.ReadToEnd().TrimEnd(\"`r\",\"`n\");")
_PS_PROTECT = _PS_COMMON + "[Console]::Out.Write(($in | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString))"
_PS_OPEN = (_PS_COMMON + "$s=$in | ConvertTo-SecureString;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);"
            "try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}")


def _config_dir():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, "git-shuttle")
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def key_of(repo_path, target, host, port):
    """What a saved password belongs to: this repository, this server, this address. Another address is another key."""
    raw = "\0".join([_SERVICE, repo_path, target, host or "", str(port or "")])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def _is_wsl():
    try:
        return "microsoft" in os.uname().release.lower()
    except AttributeError:
        return False


def _powershell():
    override = os.environ.get("GIT_SHUTTLE_POWERSHELL")
    if override:
        return override if os.path.exists(override) else None
    return shutil.which("powershell.exe") or (shutil.which("powershell") if sys.platform == "win32" else None)


def _secret_tool():
    override = os.environ.get("GIT_SHUTTLE_SECRET_TOOL")
    if override:
        return override if os.path.exists(override) else None
    return shutil.which("secret-tool")


def backend():
    """('keyring' | 'windows' | None, how to get one)."""
    if sys.platform != "win32" and _secret_tool():
        return "keyring", ""
    if _powershell() and (sys.platform == "win32" or _is_wsl() or os.environ.get("GIT_SHUTTLE_POWERSHELL")):
        return "windows", ""
    if sys.platform == "darwin":
        return None, "The macOS keychain is not supported yet: type the password when you deploy, or use an ssh key."
    if _is_wsl():
        return None, ("PowerShell of Windows was not found from WSL. Check that powershell.exe runs here, or install a keyring: "
                      "sudo apt install libsecret-tools gnome-keyring, then log in again.")
    return None, "No keyring found. Install one (sudo apt install libsecret-tools gnome-keyring), then restart git shuttle ui."


def info():
    kind, how = backend()
    label = {"keyring": "the keyring of your desktop", "windows": "Windows (protected for your Windows user)"}.get(kind, "")
    return {"available": kind is not None, "kind": kind, "label": label, "how": how}


# -- the list of what is saved (no secret) ---------------------------------------------------------------------------------

def _index_path():
    return os.path.join(_config_dir(), "vault-index.json")


def _read_index():
    try:
        with open(_index_path(), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_index(data):
    path = _index_path()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".vault-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def saved_at(key):
    entry = _read_index().get(key)
    return entry.get("saved", "") if isinstance(entry, dict) else ""


# -- the backends ------------------------------------------------------------------------------------------------------------

def _run(argv, data=None):
    try:
        done = subprocess.run(argv, input=data, capture_output=True, timeout=TIMEOUT, stdin=None if data is not None else subprocess.DEVNULL,
                              start_new_session=True)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BadRequest("the keychain did not answer: %s" % error, 500)
    return done


def _ps(script, data):
    """PowerShell with a fixed script (as an encoded command) and the data on standard input."""
    exe = _powershell()
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return _run([exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], data)


def _blob_path(key):
    folder = os.path.join(_config_dir(), "vault")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return os.path.join(folder, key + ".dpapi")


def put(key, secret, label):
    """Keeps the password (bytes or bytearray) for the key. Raises when there is no keychain or it refuses."""
    kind, how = backend()
    if kind is None:
        raise BadRequest(how or "there is no keychain on this computer", 400)
    data = bytes(secret)
    if kind == "keyring":
        done = _run([_secret_tool(), "store", "--label=git-shuttle: %s" % label[:80], "service", _SERVICE, "key", key], data)
        if done.returncode != 0:
            raise BadRequest("the keyring refused it (is it unlocked?): %s" % done.stderr.decode("utf-8", "replace").strip()[:200], 500)
    else:
        done = _ps(_PS_PROTECT, data)
        blob = done.stdout.decode("ascii", "ignore").strip()
        if done.returncode != 0 or not blob:
            raise BadRequest("Windows did not protect the password: %s" % done.stderr.decode("utf-8", "replace").strip()[:200], 500)
        path = _blob_path(key)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as handle:
            handle.write(blob)
    index = _read_index()
    index[key] = {"saved": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind}
    _write_index(index)


def get(key):
    """The password as a bytearray (the caller wipes it), or None when there is none."""
    entry = _read_index().get(key)
    if not isinstance(entry, dict):
        return None
    kind = entry.get("kind")
    if kind == "keyring" and _secret_tool():
        done = _run([_secret_tool(), "lookup", "service", _SERVICE, "key", key])
        return bytearray(done.stdout) if done.returncode == 0 and done.stdout else None
    if kind == "windows" and _powershell():
        try:
            with open(_blob_path(key), encoding="ascii") as handle:
                blob = handle.read().strip()
        except OSError:
            return None
        done = _ps(_PS_OPEN, blob.encode("ascii"))
        return bytearray(done.stdout) if done.returncode == 0 and done.stdout else None
    return None


def forget(key):
    index = _read_index()
    entry = index.pop(key, None)
    kind = entry.get("kind") if isinstance(entry, dict) else None
    if kind == "keyring" and _secret_tool():
        _run([_secret_tool(), "clear", "service", _SERVICE, "key", key])
    if kind == "windows":
        try:
            os.remove(_blob_path(key))
        except OSError:
            pass
    _write_index(index)
