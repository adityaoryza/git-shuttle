"""The keys and the backends of the saved passwords. The Windows backend (DPAPI, through PowerShell) is tried for real when PowerShell is
there (Windows, WSL), and skipped otherwise; the keyring backend is tried through a stand-in of secret-tool in test_deploy.py."""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui"))
from shuttle_ui import vault  # noqa: E402


class TestKeys(unittest.TestCase):
    def test_a_key_depends_on_the_repository_the_server_and_its_address(self):
        base = vault.key_of("/r", "staging", "u@h", "22")
        self.assertEqual(base, vault.key_of("/r", "staging", "u@h", "22"))
        for other in (vault.key_of("/r2", "staging", "u@h", "22"), vault.key_of("/r", "prod", "u@h", "22"),
                      vault.key_of("/r", "staging", "u@h2", "22"), vault.key_of("/r", "staging", "v@h", "22"), vault.key_of("/r", "staging", "u@h", "2323")):
            self.assertNotEqual(base, other)
        self.assertRegex(base, r"^[0-9a-f]{40}$")


@unittest.skipUnless((shutil.which("powershell.exe") and "microsoft" in os.uname().release.lower()), "needs the PowerShell of Windows (WSL)")
class TestWindowsBackend(unittest.TestCase):
    def setUp(self):
        self.config = tempfile.mkdtemp(prefix="shuttle-vault.")
        self.old = {k: os.environ.get(k) for k in ("XDG_CONFIG_HOME", "GIT_SHUTTLE_SECRET_TOOL")}
        os.environ["XDG_CONFIG_HOME"] = self.config
        os.environ["GIT_SHUTTLE_SECRET_TOOL"] = "/nonexistent"          # the backend under test is the one of Windows
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v) for k, v in self.old.items()])
        self.addCleanup(lambda: shutil.rmtree(self.config, ignore_errors=True))

    def test_a_password_is_protected_by_windows_and_comes_back_exactly(self):
        self.assertEqual(vault.backend()[0], "windows")
        key = vault.key_of("/r", "staging", "u@h", "22")
        secret = "pässw0rd!ü #'\"$x`|&;"
        vault.put(key, bytearray(secret.encode()), "staging")
        blob_path = vault._blob_path(key)
        with open(blob_path) as handle:
            blob = handle.read()
        self.assertNotIn(secret, blob)
        self.assertTrue(all(c in "0123456789abcdefABCDEF" for c in blob), "protected text, not the password")
        self.assertEqual(os.stat(blob_path).st_mode & 0o777, 0o600)
        with open(vault._index_path()) as handle:
            self.assertNotIn(secret, handle.read())
        self.assertTrue(vault.saved_at(key))
        self.assertEqual(vault.get(key).decode(), secret)
        vault.forget(key)
        self.assertIsNone(vault.get(key))
        self.assertFalse(os.path.exists(blob_path))
        self.assertEqual(vault.saved_at(key), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
