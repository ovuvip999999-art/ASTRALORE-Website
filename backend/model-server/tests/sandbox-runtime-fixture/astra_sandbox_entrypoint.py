"""Minimal trusted test-only entrypoint for opt-in Docker host validation."""
import json
import sys
from pathlib import Path

request = json.loads(sys.stdin.buffer.read(1_000_001))
if not isinstance(request, dict) or request.get("probe") != "astra-sandbox-host-probe":
    raise SystemExit(2)
output = Path("/outputs")
output.mkdir(parents=True, exist_ok=True)
name = "sandbox-host-probe.png"
(output / name).write_bytes(b"ASTRA-SANDBOX-HOST-PROBE")
print(json.dumps({"ok": True, "filename": name}, separators=(",", ":")))
