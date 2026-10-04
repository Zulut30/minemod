"""Проверяет raw Mojang inputs по locked SHA-1/SHA-256, без их публикации."""

import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent
lock = json.loads((root / "packs/fabric-1.20.1/runtime-r5/versions.lock.json").read_text())
inputs = lock["minecraftInputs"]
assert inputs["minecraft"] == "1.20.1"
checked = []
for entry in inputs["downloads"]:
    assert entry["url"].startswith("https://piston-data.mojang.com/v1/objects/")
    sha1, sha256, size = hashlib.sha1(), hashlib.sha256(), 0
    with urllib.request.urlopen(entry["url"], timeout=60) as response:
        assert response.url.startswith("https://piston-data.mojang.com/")
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            assert size <= entry["size"] <= 128 * 1024 * 1024
            sha1.update(chunk)
            sha256.update(chunk)
    assert size == entry["size"] and sha1.hexdigest() == entry["sha1"] and sha256.hexdigest() == entry["sha256"]
    checked.append({"kind": entry["kind"], "bytes": size, "sha256": sha256.hexdigest()})
print(json.dumps({"status": "PASS", "minecraft": "1.20.1", "inputs": checked}, indent=2))
