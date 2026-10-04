"""Новая candidate revision с exact правилами для локальных Loom derivatives."""

import hashlib
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[2]
previous = root / "packs/fabric-1.20.1/runtime-r4"
destination = root / "packs/fabric-1.20.1/runtime-r5"
assert not destination.exists(), "Never overwrite an existing revision"
inputs = json.loads((root / "docs/provenance/minecraft-1.20.1-input-hashes-r5.json").read_text())
assert inputs["minecraft"] == "1.20.1"
assert {entry["kind"] for entry in inputs["downloads"]} == {"client", "server", "client_mappings", "server_mappings"}
shutil.copytree(previous, destination)
names = [f"minecraft-{side}-{profile}" for side in ("common", "clientOnly") for profile in ("3d2c7816d3", "b7a764897f")]
version = "1.20.1-loom.mappings.1_20_1.layered+hash.2198-v2"
rules = "\n".join(
    f'         <trust group="net.minecraft" name="{name}" version="{version}" file="{name}-{version}.jar" '
    'reason="Generated locally by pinned Loom from locked Mojang inputs; revision 5 derived artifact policy"/>'
    for name in names
)
for path in (
    destination / "templates/gradle/verification-metadata.xml",
    root / "fixtures/fabric-1.20.1-empty/gradle/verification-metadata.xml",
):
    text = path.read_text(encoding="utf-8")
    assert text.count("</trusted-artifacts>") == 1
    path.write_text(text.replace("      </trusted-artifacts>", rules + "\n      </trusted-artifacts>"), encoding="utf-8", newline="\n")
lock_path = destination / "versions.lock.json"
lock = json.loads(lock_path.read_text())
lock["verification"]["trustedArtifactRules"] = 7
lock["minecraftInputs"] = inputs
lock_path.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8", newline="\n")
manifest = json.loads((destination / "manifest.json").read_text())
manifest["revision"] = 5
for descriptor in manifest["files"]:
    data = (destination / descriptor["path"]).read_bytes()
    descriptor["size"] = len(data)
    descriptor["sha256"] = hashlib.sha256(data).hexdigest()
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
descriptors = {entry["path"]: entry for entry in manifest["files"]}
digest = hashlib.sha256(b"mcdev.compatibility-pack.tree/v1\n")
records = []
for path in sorted(destination.rglob("*"), key=lambda path: path.relative_to(destination).as_posix()):
    relative = path.relative_to(destination).as_posix()
    directory = path.is_dir()
    data = b"" if directory else path.read_bytes()
    record = {
        "path": relative, "kind": "directory" if directory else "file",
        "mode": 493 if directory else descriptors.get(relative, {"mode": 420})["mode"],
        "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
    }
    records.append(record)
    digest.update((json.dumps(record, separators=(",", ":")) + "\n").encode())
assert len(records) == 15
print(json.dumps({"revision": 5, "treeSha256": digest.hexdigest()}, indent=2))
