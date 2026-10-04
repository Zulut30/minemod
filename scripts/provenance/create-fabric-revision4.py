"""Одноразовая явная миграция immutable revision 3 -> 4 по audited evidence."""

import hashlib
import json
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parents[2]
previous = root / "packs/fabric-1.20.1/runtime"
destination = root / "packs/fabric-1.20.1/runtime-r4"
report_path = root / "docs/provenance/fabric-1.20.1-container-review-r4.json"
report = json.loads(report_path.read_text(encoding="utf-8"))
assert report["status"] == "PASS" and report["differentZipContainers"] == 50
assert not destination.exists(), "Never overwrite an existing revision"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def add_checksums(text):
    changed = 0
    records = [entry for entry in report["modules"] if entry["nestedSha256"] != entry["publishedSha256"]]
    game = report["gameTestModule"]
    assert game["sourcesUnchanged"] and game["java17CompatibleClassVersions"]
    records.append({**game, "nestedSha256": game["previousSha256"]})
    for record in records:
        pattern = re.compile(
            r'(<component group="net.fabricmc.fabric-api" name="' + re.escape(record["module"]) +
            r'" version="' + re.escape(record["version"]) + r'">.*?<artifact name="' +
            re.escape(record["artifact"]) + r'">\s*<sha256 value="' + record["nestedSha256"] + r'"[^>]*/>)',
            re.DOTALL,
        )
        text, count = pattern.subn(
            lambda match: match[1] + '\n            <sha256 value="' + record["publishedSha256"] +
            '" origin="Reviewed official Fabric Maven container; revision 4 provenance report"/>', text,
        )
        assert count == 1, record["module"]
        changed += count
    assert changed == 51
    return text


old_manifest = json.loads((previous / "manifest.json").read_text(encoding="utf-8"))
for descriptor in old_manifest["files"]:
    data = (previous / descriptor["path"]).read_bytes()
    assert len(data) == descriptor["size"] and sha256(data) == descriptor["sha256"]
shutil.copytree(previous, destination)
metadata_path = destination / "templates/gradle/verification-metadata.xml"
metadata_path.write_text(add_checksums(metadata_path.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
fixture_metadata = root / "fixtures/fabric-1.20.1-empty/gradle/verification-metadata.xml"
fixture_metadata.write_text(add_checksums(fixture_metadata.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
manifest = json.loads(json.dumps(old_manifest))
manifest["revision"] = 4
for descriptor in manifest["files"]:
    data = (destination / descriptor["path"]).read_bytes()
    descriptor["size"] = len(data)
    descriptor["sha256"] = sha256(data)
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

# Здесь mode является определением нового pack, не runtime proof Windows.
# Hosted Linux verifier затем сверяет реальные executable bits с этим digest.
records = []
descriptors = {entry["path"]: entry for entry in manifest["files"]}
for path in sorted(destination.rglob("*"), key=lambda path: path.relative_to(destination).as_posix()):
    relative = path.relative_to(destination).as_posix()
    directory = path.is_dir()
    data = b"" if directory else path.read_bytes()
    records.append({
        "path": relative, "kind": "directory" if directory else "file",
        "mode": 493 if directory else descriptors.get(relative, {"mode": 420})["mode"],
        "size": len(data), "sha256": sha256(data),
    })
assert len(records) == 15
tree_digest = sha256(("mcdev.compatibility-pack.tree/v1\n" + "".join(
    json.dumps(record, separators=(",", ":")) + "\n" for record in records
)).encode())
print(json.dumps({"revision": 4, "treeEntries": len(records), "treeSha256": tree_digest}, indent=2))
