"""Forced-command boundary tests. Synthetic files only; never opens SSH or HTTP."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[2] / "server/procurement-catalog/catalog-ssh-gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Boundary(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="catalog-ssh-test-")
        self.root = Path(self.temporary.name).resolve()
        self.workspace = "fixture-workspace"
        self.config = {"root": str(self.root), "adminSecret": "must-not-leave-the-fixture", "workspaces": [{"societyId": self.workspace, "folder": "Zoer/bc-bid-monitor/" + self.workspace}]}
        self.target = self.root / "staging" / self.workspace / "catalog.sqlite"

    def tearDown(self):
        self.temporary.cleanup()

    def dispatch(self, command, data=b""):
        previous = sys.stdin
        output = io.StringIO()
        try:
            sys.stdin = types.SimpleNamespace(buffer=io.BytesIO(data))
            with contextlib.redirect_stdout(output):
                gateway.dispatch(self.config, self.workspace, command)
            return json.loads(output.getvalue()) if output.getvalue() else None
        finally:
            sys.stdin = previous

    def test_cannot_run_shell_or_read_other_files(self):
        for command in ["sh", "cat /etc/passwd", "scp -t /tmp/x", "status; id", "$(id)", "activate extra"]:
            with self.assertRaises(ValueError):
                self.dispatch(command)
        with self.assertRaises(ValueError):
            self.dispatch(gateway.PREFIX + " " + gateway.BINARY + " --replica origin.sqlite /tmp/foreign.sqlite")
        with self.assertRaises(ValueError):
            gateway.dispatch(self.config, "foreign-workspace", "probe")

    def test_atomic_full_copy_and_failed_copy_preserve_previous(self):
        original, replacement = b"fixture original", b"fixture replacement"
        digest = lambda value: hashlib.sha256(value).hexdigest()
        result = self.dispatch(f"put {digest(original)} {len(original)}", original)
        self.assertEqual(result["received"], len(original))
        for framing, data in [(f"put {digest(replacement)} {len(replacement)}", replacement[:-2]), (f"put {'0'*64} {len(replacement)}", replacement), (f"put {digest(replacement)} {len(replacement)}", replacement+b"extra")]:
            with self.assertRaises(ValueError):
                self.dispatch(framing, data)
            self.assertEqual(self.target.read_bytes(), original)
            self.assertEqual(list(self.target.parent.glob(".incoming-*")), [])
        self.dispatch(f"put {digest(replacement)} {len(replacement)}", replacement)
        self.assertEqual(self.target.read_bytes(), replacement)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_foreign_operator_payload_fails_before_http(self):
        with self.assertRaises(ValueError):
            self.dispatch("activate", b'{"societyId":"foreign-workspace"}')
        with self.assertRaises(ValueError):
            self.dispatch("qualify", b"x" * 2001)

    def test_real_sqlite_initial_and_path_retry_commands_stay_scoped(self):
        for prefix in ["", gateway.PREFIX + " "]:
            for suffix in ["", " 2>/dev/null"]:
                with patch.object(gateway.subprocess, "run") as receiver:
                    self.dispatch(prefix + gateway.BINARY + " --replica origin.sqlite " + str(self.target) + suffix)
                    receiver.assert_called_once_with([gateway.BINARY, "--replica", "origin.sqlite", str(self.target)], check=True)
        for command in [gateway.BINARY + " --replica origin.sqlite " + str(self.target) + " 2>/etc/passwd", gateway.BINARY + " --replica 'origin.sqlite;id' " + str(self.target), gateway.BINARY + " --origin origin.sqlite " + str(self.target)]:
            with patch.object(gateway.subprocess, "run") as receiver:
                with self.assertRaises(ValueError):
                    self.dispatch(command)
                receiver.assert_not_called()


if __name__ == "__main__":
    unittest.main()
