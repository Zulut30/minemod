"""Сравнивает опубликованные module JAR с nested bytes reviewed Fabric API.

Не меняет metadata/pack и не загружает Java-классы. Все ZIP entries сравниваются
по распакованным bytes; новый checksum допустим только при полном совпадении.
"""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[2]
runtime = root / "packs/fabric-1.20.1/runtime"
namespace = {"d": "https://schema.gradle.org/dependency-verification"}
metadata = ET.parse(runtime / "templates/gradle/verification-metadata.xml").getroot()
components = {
    element.attrib["name"]: element
    for element in metadata.findall("./d:components/d:component", namespace)
    if element.attrib["group"] == "net.fabricmc.fabric-api"
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        assert response.url.startswith("https://maven.fabricmc.net/")
        data = response.read(8 * 1024 * 1024 + 1)
    assert len(data) <= 8 * 1024 * 1024
    return data


def contents(data):
    with zipfile.ZipFile(io.BytesIO(data)) as jar:
        files = [entry for entry in jar.infolist() if not entry.is_dir()]
        assert len(files) <= 16384 and sum(entry.file_size for entry in files) <= 64 * 1024 * 1024
        assert len({entry.filename for entry in files}) == len(files), "Duplicate JAR entries"
        return {entry.filename: digest(jar.read(entry)) for entry in files}


url = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.92.11+1.20.1/fabric-api-0.92.11+1.20.1.jar"
aggregate = fetch(url)
root_checksum = components["fabric-api"].find(
    "d:artifact[@name='fabric-api-0.92.11+1.20.1.jar']/d:sha256", namespace
).attrib["value"]
assert digest(aggregate) == root_checksum, "Reviewed aggregate JAR changed"
with zipfile.ZipFile(io.BytesIO(aggregate)) as jar:
    nested = {entry: jar.read(entry) for entry in jar.namelist() if entry.endswith(".jar")}
assert len(nested) == 53


def compare(entry):
    path, data = entry
    with zipfile.ZipFile(io.BytesIO(data)) as jar:
        module = json.loads(jar.read("fabric.mod.json"))["id"]
    component = components[module]
    version = component.attrib["version"]
    artifact_name = f"{module}-{version}.jar"
    expected = component.find(f"d:artifact[@name='{artifact_name}']/d:sha256", namespace).attrib["value"]
    assert digest(data) == expected, f"Nested {module} differs from old reviewed checksum"
    upstream_url = f"https://maven.fabricmc.net/net/fabricmc/fabric-api/{module}/{version}/{artifact_name}"
    published = fetch(upstream_url)
    before, after = contents(data), contents(published)
    assert before == after, f"JAR file contents differ: {module}"
    return {
        "module": module, "version": version, "artifact": artifact_name,
        "source": upstream_url, "nestedEntry": path, "nestedSha256": expected,
        "publishedSha256": digest(published), "allEntriesIdentical": True,
        "entryCount": len(before), "classCount": sum(name.endswith(".class") for name in before),
        "entriesDigest": digest(json.dumps(before, sort_keys=True, separators=(",", ":")).encode()),
    }


with ThreadPoolExecutor(max_workers=4) as pool:
    comparisons = sorted(pool.map(compare, nested.items()), key=lambda record: record["module"])

# GameTest не входит в aggregate nested JAR. Здесь проверяем первичный Maven
# checksum, прежний reviewed source JAR и version/license identity отдельно.
game_test = components["fabric-gametest-api-v1"]
game_version = game_test.attrib["version"]
game_name = f"fabric-gametest-api-v1-{game_version}"
game_url = f"https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-gametest-api-v1/{game_version}/{game_name}.jar"
game_binary = fetch(game_url)
official_digest = fetch(game_url + ".sha256").decode().strip()
assert digest(game_binary) == official_digest
source_binary = fetch(game_url.removesuffix(".jar") + "-sources.jar")
source_digest = game_test.find(f"d:artifact[@name='{game_name}-sources.jar']/d:sha256", namespace).attrib["value"]
assert digest(source_binary) == source_digest, "Reviewed GameTest sources changed"
with zipfile.ZipFile(io.BytesIO(game_binary)) as jar:
    identity = json.loads(jar.read("fabric.mod.json"))
    assert identity["id"] == "fabric-gametest-api-v1" and identity["version"] == game_version
    assert identity["license"] == "Apache-2.0"
    classes = [jar.read(name) for name in jar.namelist() if name.endswith(".class")]
    assert classes and all(data[:4] == b"\xca\xfe\xba\xbe" and int.from_bytes(data[6:8], "big") <= 61 for data in classes)
game_review = {
    "module": "fabric-gametest-api-v1", "version": game_version, "artifact": game_name + ".jar",
    "source": game_url, "publishedSha256": official_digest, "officialChecksumSource": game_url + ".sha256",
    "previousSha256": game_test.find(f"d:artifact[@name='{game_name}.jar']/d:sha256", namespace).attrib["value"],
    "reviewedSourcesSha256": source_digest, "sourcesUnchanged": True, "license": identity["license"],
    "classCount": len(classes), "java17CompatibleClassVersions": True,
    "byteEquivalenceToPreviousContainer": "unverified",
}
report = {
    "schemaVersion": 1, "status": "PASS", "scope": "Downloaded versus nested JAR bytes; not game/license acceptance",
    "source": url, "aggregateSha256": root_checksum, "moduleCount": len(comparisons),
    "differentZipContainers": sum(record["nestedSha256"] != record["publishedSha256"] for record in comparisons),
    "modules": comparisons, "gameTestModule": game_review,
}
output = root / "output/provenance/fabric-api-container-comparison.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f'PASS: {len(comparisons)} modules; {report["differentZipContainers"]} distinct ZIP containers with identical entries')
print(output)
