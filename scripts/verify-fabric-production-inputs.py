"""Проверка exact production tuple и reviewed bootstrap bytes перед CI."""

import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
runtime = root / "packs/fabric-1.20.1/runtime-r5"
fixture = root / "fixtures/fabric-1.20.1-empty"
lock_path = runtime / "versions.lock.json"
lock = json.loads(lock_path.read_text(encoding="utf-8"))
expected = {
    "minecraft": "1.20.1", "fabricLoader": "0.19.3",
    "fabricApi": "0.92.11+1.20.1", "fabricLoom": "1.6.12",
    "gradle": "8.7", "java": "17.0.19+10",
}
assert lock["tuple"] == expected, "Production tuple changed without CI review"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


checked = {}
for relative in (
    "gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar",
    "gradle/wrapper/gradle-wrapper.properties",
):
    digest = sha256(fixture / relative)
    assert digest == sha256(runtime / "templates" / relative), relative
    checked[relative] = digest
assert checked["gradle/wrapper/gradle-wrapper.jar"] == lock["gradle"]["wrapperJarSha256"]
properties = (fixture / "gradle/wrapper/gradle-wrapper.properties").read_text(encoding="utf-8")
assert f'distributionSha256Sum={lock["gradle"]["distributionSha256"]}' in properties
assert "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip" in properties
namespace = {"d": "https://schema.gradle.org/dependency-verification"}


def verified_artifacts(path):
    metadata = ET.parse(path).getroot()
    artifacts = {}
    for component in metadata.findall("./d:components/d:component", namespace):
        for artifact in component.findall("d:artifact", namespace):
            checksum = artifact.findall("d:sha256", namespace)
            assert 1 <= len(checksum) <= 2 and all(re.fullmatch("[a-f0-9]{64}", entry.attrib["value"]) for entry in checksum)
            key = tuple(component.attrib[field] for field in ("group", "name", "version")) + (artifact.attrib["name"],)
            artifacts[key] = frozenset(entry.attrib["value"] for entry in checksum)
    return artifacts


reviewed = verified_artifacts(runtime / "templates/gradle/verification-metadata.xml")
artifacts = verified_artifacts(fixture / "gradle/verification-metadata.xml")
assert len(reviewed) == lock["verification"]["artifacts"]
assert len(artifacts) == 562, "Fixture verification metadata changed without review"
for coordinate, digest in artifacts.items():
    assert reviewed.get(coordinate) == digest, coordinate
checked["gradle/verification-metadata.xml"] = sha256(fixture / "gradle/verification-metadata.xml")
print(json.dumps({
    "status": "PASS", "tuple": expected, "lockSha256": sha256(lock_path),
    "reviewedBootstrap": checked, "verifiedArtifacts": len(artifacts),
}, indent=2))
