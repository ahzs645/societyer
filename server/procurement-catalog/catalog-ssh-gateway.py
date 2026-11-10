#!/usr/bin/env python3
"""Forced SSH command: one workspace's staging copy and loopback activation only.

Install this root-owned, with a root-owned authorized_keys entry using restrict
and command=. Never give the publisher an unrestricted shell or the operator key.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.request

MAXIMUM = 2 * 1024**3
BINARY = "/usr/local/libexec/sqlite3_rsync-3.54.1"
PREFIX = "PATH=$HOME/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:$PATH"
SQLITE_SOURCE_ID = "2026-10-16 14:45:20 555e07ef33f69a0957d24d8e555b702464a131d6f1607f4c3c1e4551e8e6ca76"


def dispatch(config, workspace, original):
    binding = next((row for row in config["workspaces"] if row["societyId"] == workspace), None)
    if not binding or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,180}", workspace):
        raise ValueError("Workspace is not configured.")
    root = Path(config["root"]).resolve()
    directory = root / "staging" / workspace
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.resolve() != directory:
        raise ValueError("Staging must not be a symbolic link.")
    target = directory / "catalog.sqlite"
    if target.exists() and (target.is_symlink() or not stat.S_ISREG(target.stat().st_mode)):
        raise ValueError("Staging file must be regular.")
    words = shlex.split(original)
    if words == ["probe"]:
        version = subprocess.run([BINARY, "--version"], check=True, capture_output=True, text=True).stdout.strip()
        if version != SQLITE_SOURCE_ID:
            raise ValueError("Pinned SQLite source ID differs.")
        print(json.dumps({"schemaVersion": 1, "societyId": workspace, "folder": binding["folder"], "stagingExists": target.is_file(), "sqliteRsyncVersion": "3.54.1", "sqliteRsyncSourceId": version}))
        return
    with open(directory / ".publisher.lock", "a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if len(words) == 5 and words[:3] == [PREFIX, BINARY, "--replica"]:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.sqlite", words[3]) or words[4] != str(target):
                raise ValueError("Replica is outside this workspace's staging file.")
            subprocess.run([BINARY, "--replica", words[3], str(target)], check=True)
            return
        if len(words) == 3 and words[0] == "put":
            digest, length = words[1], int(words[2])
            if not re.fullmatch(r"[a-f0-9]{64}", digest) or not 0 < length <= MAXIMUM:
                raise ValueError("Invalid snapshot framing.")
            descriptor, name = tempfile.mkstemp(prefix=".incoming-", dir=directory)
            temporary = Path(name)
            try:
                checksum, received = hashlib.sha256(), 0
                with os.fdopen(descriptor, "wb") as output:
                    while received < length:
                        chunk = sys.stdin.buffer.read(min(1024**2, length - received))
                        if not chunk:
                            raise ValueError("Snapshot was interrupted.")
                        checksum.update(chunk)
                        output.write(chunk)
                        received += len(chunk)
                    if sys.stdin.buffer.read(1) or checksum.hexdigest() != digest:
                        raise ValueError("Snapshot checksum or length differs.")
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(temporary, 0o600)
                os.replace(temporary, target)
                print(json.dumps({"received": received, "sha256": digest}))
            finally:
                temporary.unlink(missing_ok=True)
            return
        if words not in (["activate"], ["qualify"], ["status"]):
            raise ValueError("Only the catalog publishing protocol is allowed.")
        payload = None
        if words != ["status"]:
            payload = sys.stdin.buffer.read(2001)
            if len(payload) > 2000:
                raise ValueError("Operator request exceeds the limit.")
            value = json.loads(payload)
            if value.get("societyId") != workspace:
                raise ValueError("Operator request belongs to another workspace.")
        request = urllib.request.Request("http://127.0.0.1:8789/admin/" + words[0], data=payload, headers={"Authorization": "Bearer " + config["adminSecret"], "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=660) as response:
            value = json.loads(response.read(64_001))
        if words == ["status"]:
            value = {"workspaces": [row for row in value["workspaces"] if row["societyId"] == workspace]}
        print(json.dumps(value))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args()
    try:
        with open(args.config, encoding="utf8") as stream:
            config = json.load(stream)
        dispatch(config, args.workspace, os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except Exception:
        # Never echo SSH input, configuration, credentials, or request bodies.
        print("Catalog publishing command failed validation or execution.", file=sys.stderr)
        sys.exit(1)
