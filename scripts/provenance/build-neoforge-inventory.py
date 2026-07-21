#!/usr/bin/env python3
"""Build the deterministic NeoForge dependency/legal inventory from audited inputs."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPOSITORY_ROOT / "fixtures" / "basic-content"
METADATA = FIXTURE_ROOT / "gradle" / "verification-metadata.xml"
GRADLE_HOME = FIXTURE_ROOT / "run" / "gradle-home"
PROJECT_CACHE = FIXTURE_ROOT / "run" / "project-cache"
CACHE = GRADLE_HOME / "caches" / "modules-2" / "files-2.1"
RESOURCE_URLS = GRADLE_HOME / "caches" / "modules-2" / "metadata-2.107" / "resource-at-url.bin"
RUNTIME_RESOLVER = REPOSITORY_ROOT / "scripts" / "provenance" / "inventory-runtime.init.gradle"
LICENSE_POM_EVIDENCE = REPOSITORY_ROOT / "scripts" / "provenance" / "neoforge-license-pom-evidence.txt"
NS = {"g": "https://schema.gradle.org/dependency-verification"}
SPDX_SPEC_NONE = "https://spdx.github.io/spdx-spec/v2.3/package-information/#715-declared-license-field"
NO_LICENSE_GUIDANCE = "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository"
RUNTIME_SCOPE_COMMAND = "python3 scripts/provenance/build-neoforge-inventory.py --emit-runtime-components"
GENERATOR_COMMAND = "python3 scripts/provenance/build-neoforge-inventory.py --runtime-components fixtures/basic-content/run/inventory-runtime-components.txt"
NEOFORGED_RELEASES = "https://maven.neoforged.net/releases/"
NEOFORGED_MOJANG_META = "https://maven.neoforged.net/mojang-meta/"
GRADLE_PLUGIN_PORTAL = "https://plugins.gradle.org/m2/"
MINECRAFT_LIBRARIES = "https://libraries.minecraft.net/"

# ModDevGradle makes NeoForged Releases the default repository for the build
# graph. These reviewed coordinate exceptions record the other repository
# bases selected by the fixture. A coordinate may intentionally allow more
# than one source when Gradle resolves the same bytes through both repositories.
REPOSITORY_BASE_OVERRIDES = {
    ("at.yawk.lz4", "lz4-java", "1.10.1"): (MINECRAFT_LIBRARIES,),
    ("ca.weblite", "java-objc-bridge", "1.1"): (MINECRAFT_LIBRARIES,),
    ("com.azure", "azure-json", "1.4.0"): (MINECRAFT_LIBRARIES,),
    ("com.github.oshi", "oshi-core", "6.9.0"): (MINECRAFT_LIBRARIES,),
    ("com.google.code.gson", "gson", "2.10"): (MINECRAFT_LIBRARIES,),
    ("com.google.code.gson", "gson", "2.10.1"): (
        GRADLE_PLUGIN_PORTAL,
        MINECRAFT_LIBRARIES,
    ),
    ("com.google.code.gson", "gson", "2.13.2"): (MINECRAFT_LIBRARIES,),
    ("com.google.code.gson", "gson", "2.8.9"): (MINECRAFT_LIBRARIES,),
    ("com.google.code.gson", "gson-parent", "2.10.1"): (
        GRADLE_PLUGIN_PORTAL,
        NEOFORGED_RELEASES,
    ),
    ("com.google.guava", "failureaccess", "1.0.3"): (MINECRAFT_LIBRARIES,),
    ("com.google.guava", "guava", "31.1-jre"): (MINECRAFT_LIBRARIES,),
    ("com.google.guava", "guava", "33.5.0-jre"): (MINECRAFT_LIBRARIES,),
    ("com.ibm.icu", "icu4j", "77.1"): (MINECRAFT_LIBRARIES,),
    ("com.microsoft.azure", "msal4j", "1.23.1"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "authlib", "7.0.63"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "blocklist", "1.0.10"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "brigadier", "1.3.10"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "datafixerupper", "9.0.19"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "jtracy", "1.0.37"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "logging", "1.1.1"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "logging", "1.6.11"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "patchy", "2.2.10"): (MINECRAFT_LIBRARIES,),
    ("com.mojang", "text2speech", "1.18.11"): (MINECRAFT_LIBRARIES,),
    ("commons-codec", "commons-codec", "1.19.0"): (MINECRAFT_LIBRARIES,),
    ("commons-io", "commons-io", "2.11.0"): (MINECRAFT_LIBRARIES,),
    ("commons-io", "commons-io", "2.20.0"): (MINECRAFT_LIBRARIES,),
    ("gradle.plugin.org.jetbrains.gradle.plugin.idea-ext", "gradle-idea-ext", "1.2"): (
        GRADLE_PLUGIN_PORTAL,
    ),
    ("io.netty", "netty-buffer", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-codec-base", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-codec-compression", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-codec-http", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-common", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-handler", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-resolver", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-transport", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-transport-classes-epoll", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-transport-classes-kqueue", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-transport-native-epoll", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("io.netty", "netty-transport-native-unix-common", "4.2.7.Final"): (MINECRAFT_LIBRARIES,),
    ("it.unimi.dsi", "fastutil", "8.5.18"): (MINECRAFT_LIBRARIES,),
    ("net.java.dev.jna", "jna", "5.17.0"): (MINECRAFT_LIBRARIES,),
    ("net.java.dev.jna", "jna-platform", "5.17.0"): (MINECRAFT_LIBRARIES,),
    ("net.neoforged", "minecraft-dependencies", "26.1.2"): (NEOFORGED_MOJANG_META,),
    ("net.neoforged", "moddev-gradle", "2.0.141"): (GRADLE_PLUGIN_PORTAL,),
    ("net.neoforged.moddev", "net.neoforged.moddev.gradle.plugin", "2.0.141"): (
        GRADLE_PLUGIN_PORTAL,
    ),
    ("net.sf.jopt-simple", "jopt-simple", "5.0.4"): (MINECRAFT_LIBRARIES,),
    ("org.apache.commons", "commons-compress", "1.28.0"): (MINECRAFT_LIBRARIES,),
    ("org.apache.commons", "commons-lang3", "3.12.0"): (MINECRAFT_LIBRARIES,),
    ("org.apache.commons", "commons-lang3", "3.19.0"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-api", "2.22.1"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-api", "2.25.2"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-core", "2.22.1"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-core", "2.25.2"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-core", "2.8.1"): (MINECRAFT_LIBRARIES,),
    ("org.apache.logging.log4j", "log4j-slf4j2-impl", "2.25.2"): (MINECRAFT_LIBRARIES,),
    ("org.jcraft", "jorbis", "0.0.17"): (MINECRAFT_LIBRARIES,),
    ("org.joml", "joml", "1.10.8"): (MINECRAFT_LIBRARIES,),
    ("org.jspecify", "jspecify", "1.0.0"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-freetype", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-glfw", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-jemalloc", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-openal", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-opengl", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-stb", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.lwjgl", "lwjgl-tinyfd", "3.4.1"): (MINECRAFT_LIBRARIES,),
    ("org.slf4j", "slf4j-api", "2.0.17"): (MINECRAFT_LIBRARIES,),
    ("org.slf4j", "slf4j-api", "2.0.9"): (MINECRAFT_LIBRARIES,),
}


argument_parser = argparse.ArgumentParser(
    description="Regenerate the reviewed NeoForge dependency/provenance inventory."
)
input_mode = argument_parser.add_mutually_exclusive_group(required=True)
input_mode.add_argument(
    "--runtime-components",
    type=pathlib.Path,
    help="Sorted coordinate list emitted by inventory-runtime.init.gradle.",
)
input_mode.add_argument(
    "--emit-runtime-components",
    action="store_true",
    help=(
        "Run the reviewed resolver offline with exact Java toolchains and "
        "fixture-local Gradle caches, then emit its validated coordinate list."
    ),
)
arguments = argument_parser.parse_args()
RUNTIME_COMPONENTS = (
    arguments.runtime_components.resolve()
    if arguments.runtime_components is not None
    else None
)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_runtime_component_lines(payload: str, source: str) -> list[str]:
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    if lines != sorted(set(lines)):
        raise RuntimeError(
            f"Runtime component input from {source} must be sorted and duplicate-free"
        )
    if any(
        len(parts := coordinate.split(":")) != 3 or not all(parts)
        for coordinate in lines
    ):
        raise RuntimeError(
            f"Runtime component input from {source} contains a malformed coordinate"
        )
    if len(lines) != 85:
        raise RuntimeError(
            f"Expected exactly 85 runtime components from {source}, found {len(lines)}"
        )
    return lines


def require_exact_jdk(environment_variable: str, runtime_version: str) -> pathlib.Path:
    raw_path = os.environ.get(environment_variable)
    if not raw_path:
        raise RuntimeError(f"{environment_variable} must name an exact JDK directory")
    jdk_path = pathlib.Path(raw_path)
    if not jdk_path.is_absolute():
        raise RuntimeError(f"{environment_variable} must be an absolute path")
    try:
        resolved_path = jdk_path.resolve(strict=True)
    except OSError as error:
        raise RuntimeError(
            f"{environment_variable} cannot be resolved: {jdk_path}"
        ) from error
    if resolved_path != jdk_path or not jdk_path.is_dir():
        raise RuntimeError(
            f"{environment_variable} must be a canonical, non-symlink JDK directory"
        )
    java = jdk_path / "bin" / "java"
    release = jdk_path / "release"
    if not java.is_file() or not os.access(java, os.X_OK) or not release.is_file():
        raise RuntimeError(f"{environment_variable} is not an executable JDK")
    release_lines = set(release.read_text(encoding="utf-8").splitlines())
    if {
        'IMPLEMENTOR="Eclipse Adoptium"',
        f'JAVA_RUNTIME_VERSION="{runtime_version}"',
    } - release_lines:
        raise RuntimeError(
            f"{environment_variable} is not the required Temurin {runtime_version} runtime"
        )
    java_settings = subprocess.run(
        [str(java), "-XshowSettings:properties", "-version"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=30,
    ).stdout
    versions = re.findall(
        r"^[\t ]*java\.runtime\.version = ([^\r\n]+)$",
        java_settings,
        flags=re.MULTILINE,
    )
    vendors = re.findall(
        r"^[\t ]*java\.vendor = ([^\r\n]+)$",
        java_settings,
        flags=re.MULTILINE,
    )
    if versions != [runtime_version] or vendors != ["Eclipse Adoptium"]:
        raise RuntimeError(
            f"{environment_variable} runtime properties do not match exact Temurin "
            f"{runtime_version}"
        )
    return jdk_path


def require_fixture_local_directory(path: pathlib.Path) -> None:
    if path.is_symlink():
        raise RuntimeError(f"Refusing symlinked provenance runtime directory: {path}")
    if path.exists() and not path.is_dir():
        raise RuntimeError(f"Provenance runtime path is not a directory: {path}")
    if not path.exists():
        path.mkdir(mode=0o700)
    if path.resolve(strict=True) != path or path.stat().st_uid != os.getuid():
        raise RuntimeError(
            f"Provenance runtime directory must be canonical and owned by the current user: {path}"
        )


def emit_runtime_components() -> None:
    if pathlib.Path.cwd().resolve() != REPOSITORY_ROOT:
        raise RuntimeError("--emit-runtime-components must run from the repository root")
    java21 = require_exact_jdk("PHASE0_JAVA21_HOME", "21.0.11+10-LTS")
    java25 = require_exact_jdk("PHASE0_JAVA25_HOME", "25.0.3+9-LTS")
    if java21 == java25:
        raise RuntimeError("The Java 21 and Java 25 toolchain paths must be distinct")
    if not FIXTURE_ROOT.is_dir() or FIXTURE_ROOT.is_symlink():
        raise RuntimeError(f"Fixture root must be a real directory: {FIXTURE_ROOT}")
    if not RUNTIME_RESOLVER.is_file() or RUNTIME_RESOLVER.is_symlink():
        raise RuntimeError(f"Runtime resolver must be a tracked regular file: {RUNTIME_RESOLVER}")
    run_root = FIXTURE_ROOT / "run"
    for directory in (run_root, GRADLE_HOME, PROJECT_CACHE):
        require_fixture_local_directory(directory)

    environment = os.environ.copy()
    for ambient_override in (
        "GRADLE_OPTS",
        "JAVA_OPTS",
        "JAVA_TOOL_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "_JAVA_OPTIONS",
    ):
        environment.pop(ambient_override, None)
    environment.update(
        {
            "PHASE0_JAVA21_HOME": str(java21),
            "PHASE0_JAVA25_HOME": str(java25),
            "JAVA_HOME": str(java25),
            "GRADLE_USER_HOME": str(GRADLE_HOME),
            "GRADLE_PROJECT_CACHE_DIR": str(PROJECT_CACHE),
            "PATH": str(java25 / "bin")
            + os.pathsep
            + environment.get("PATH", ""),
        }
    )
    result = subprocess.run(
        [
            str(FIXTURE_ROOT / "gradlew"),
            "--offline",
            "--project-cache-dir",
            str(PROJECT_CACHE),
            "--dependency-verification",
            "strict",
            "-q",
            "-I",
            str(RUNTIME_RESOLVER),
            "inventoryRuntimeComponents",
        ],
        check=True,
        cwd=FIXTURE_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        text=True,
        timeout=600,
    )
    lines = validate_runtime_component_lines(
        result.stdout, "strict offline Gradle runtime resolution"
    )
    sys.stdout.write("\n".join(lines) + "\n")


if arguments.emit_runtime_components:
    emit_runtime_components()
    raise SystemExit(0)

assert RUNTIME_COMPONENTS is not None


def text(node: ET.Element, path: str) -> str | None:
    child = node.find(path)
    if child is None or child.text is None:
        return None
    value = child.text.strip()
    return value or None


for required_input in (
    METADATA,
    RUNTIME_RESOLVER,
    RUNTIME_COMPONENTS,
    LICENSE_POM_EVIDENCE,
):
    if not required_input.is_file():
        raise RuntimeError(f"Required regeneration input does not exist: {required_input}")


tree = ET.parse(METADATA)
components_xml = tree.getroot().findall(".//g:component", NS)
VERIFIED_ARTIFACTS: dict[tuple[str, str, str, str], str] = {}
for component in components_xml:
    coord = tuple(component.get(key) for key in ("group", "name", "version"))
    if not all(coord):
        raise RuntimeError("Verification-metadata component coordinate is incomplete")
    for artifact in component.findall("g:artifact", NS):
        filename = artifact.get("name")
        checksums = artifact.findall("g:sha256", NS)
        if not filename or len(checksums) != 1 or not checksums[0].get("value"):
            raise RuntimeError(
                f"Verification metadata must have exactly one SHA-256 for {':'.join(coord)}")
        key = (*coord, filename)
        if key in VERIFIED_ARTIFACTS:
            raise RuntimeError(f"Duplicate verified artifact: {':'.join(key)}")
        VERIFIED_ARTIFACTS[key] = checksums[0].get("value")  # type: ignore[assignment]


URLS = sorted(
    {
        match.decode("ascii")
        for match in re.findall(
            rb"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+",
            RESOURCE_URLS.read_bytes() if RESOURCE_URLS.is_file() else b"",
        )
    }
)


def coordinate_suffix(coord: tuple[str, str, str], filename: str) -> str:
    group, name, version = coord
    return f"/{group.replace('.', '/')}/{name}/{version}/{filename}"


def remote_urls(coord: tuple[str, str, str], filename: str) -> list[str]:
    suffix = coordinate_suffix(coord, filename)
    repository_bases = REPOSITORY_BASE_OVERRIDES.get(coord, (NEOFORGED_RELEASES,))
    reviewed_urls = sorted({base.rstrip("/") + suffix for base in repository_bases})
    observed_urls = sorted({url for url in URLS if url.endswith(suffix)})
    unexpected_urls = sorted(set(observed_urls) - set(reviewed_urls))
    if unexpected_urls:
        raise RuntimeError(
            f"Observed an unreviewed repository URL for {':'.join(coord)}/{filename}: "
            + ", ".join(unexpected_urls)
        )
    return reviewed_urls


def preferred_url(urls: list[str]) -> str:
    if not urls:
        raise RuntimeError("No remote URL available")
    priorities = (
        "https://repo.maven.apache.org/",
        "https://maven.neoforged.net/",
        "https://plugins.gradle.org/",
        "https://libraries.minecraft.net/",
    )
    return sorted(urls, key=lambda value: (next((i for i, p in enumerate(priorities) if value.startswith(p)), 99), value))[0]


license_pom_lines = [
    line.strip()
    for line in LICENSE_POM_EVIDENCE.read_text(encoding="utf-8").splitlines()
    if line.strip() and not line.lstrip().startswith("#")
]
if license_pom_lines != sorted(set(license_pom_lines)):
    raise RuntimeError("License-POM evidence coordinates must be sorted and duplicate-free")
if any(len(coordinate.split(":")) != 3 or not all(coordinate.split(":")) for coordinate in license_pom_lines):
    raise RuntimeError("License-POM evidence input contains a malformed coordinate")
LICENSE_POM_COORDINATES = {
    tuple(coordinate.split(":")) for coordinate in license_pom_lines
}
if len(LICENSE_POM_COORDINATES) != 192:
    raise RuntimeError(
        f"Expected exactly 192 reviewed license-POM coordinates, "
        f"found {len(LICENSE_POM_COORDINATES)}"
    )
USED_LICENSE_POMS: set[tuple[str, str, str]] = set()


def verified_evidence_artifact(
    coord: tuple[str, str, str], filename: str
) -> tuple[pathlib.Path, str, list[str]]:
    key = (*coord, filename)
    expected_sha256 = VERIFIED_ARTIFACTS.get(key)
    if expected_sha256 is None:
        raise RuntimeError(
            f"Evidence artifact is absent from verification metadata: {':'.join(coord)}/{filename}")
    candidates = sorted((CACHE / coord[0] / coord[1] / coord[2]).glob(f"*/{filename}"))
    if len(candidates) != 1:
        raise RuntimeError(
            f"Expected exactly one cached evidence artifact for {':'.join(coord)}/{filename}; "
            f"found {len(candidates)}")
    actual_sha256 = sha256(candidates[0])
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"Cached evidence SHA-256 mismatch for {':'.join(coord)}/{filename}: "
            f"expected {expected_sha256}, found {actual_sha256}")
    urls = remote_urls(coord, filename)
    if not urls:
        raise RuntimeError(f"No source URL for evidence artifact {':'.join(coord)}/{filename}")
    return candidates[0], expected_sha256, urls


def verified_evidence_urls(coord: tuple[str, str, str], filename: str) -> list[str]:
    _, _, urls = verified_evidence_artifact(coord, filename)
    if filename.endswith(".pom"):
        if coord not in LICENSE_POM_COORDINATES:
            raise RuntimeError(
                f"Used license POM is absent from the reviewed evidence list: {':'.join(coord)}")
        USED_LICENSE_POMS.add(coord)
    return urls


POMS: dict[tuple[str, str, str], tuple[pathlib.Path, ET.Element]] = {}
for coordinate in sorted(LICENSE_POM_COORDINATES):
    pom_filename = f"{coordinate[1]}-{coordinate[2]}.pom"
    pom_path, _, _ = verified_evidence_artifact(coordinate, pom_filename)
    POMS[coordinate] = (pom_path, ET.parse(pom_path).getroot())


def pom_parent(root: ET.Element) -> tuple[str, str, str] | None:
    parent = root.find("./{*}parent")
    if parent is None:
        return None
    result = tuple(text(parent, f"{{*}}{key}") for key in ("groupId", "artifactId", "version"))
    if not all(result):
        return None
    return result  # type: ignore[return-value]


def pom_licenses(root: ET.Element) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for node in root.findall("./{*}licenses/{*}license"):
        records.append(
            {
                "rawName": text(node, "{*}name") or "NONE",
                "rawUrl": text(node, "{*}url") or "NONE",
            }
        )
    return records


def resolve_pom_license(coord: tuple[str, str, str]) -> tuple[tuple[str, str, str], list[dict[str, str]], list[tuple[str, str, str]]] | None:
    visited: list[tuple[str, str, str]] = []
    current = coord
    while current in POMS and current not in visited:
        visited.append(current)
        USED_LICENSE_POMS.add(current)
        root = POMS[current][1]
        records = pom_licenses(root)
        if records:
            return current, records, visited
        parent = pom_parent(root)
        if parent is None:
            break
        current = parent
    return None


CANONICAL_LICENSE_URLS = {
    "0BSD": "https://spdx.org/licenses/0BSD.html",
    "Apache-2.0": "https://spdx.org/licenses/Apache-2.0.html",
    "BSD-3-Clause": "https://spdx.org/licenses/BSD-3-Clause.html",
    "EPL-1.0": "https://spdx.org/licenses/EPL-1.0.html",
    "EPL-2.0": "https://spdx.org/licenses/EPL-2.0.html",
    "GPL-2.0-only WITH Classpath-exception-2.0": "https://spdx.org/licenses/Classpath-exception-2.0.html",
    "LGPL-2.0-only": "https://spdx.org/licenses/LGPL-2.0-only.html",
    "LGPL-2.1-only": "https://spdx.org/licenses/LGPL-2.1-only.html",
    "LGPL-2.1-or-later": "https://spdx.org/licenses/LGPL-2.1-or-later.html",
    "LGPL-3.0-only": "https://spdx.org/licenses/LGPL-3.0-only.html",
    "LicenseRef-JOrbis-LGPL-Unspecified-Version": "http://www.gnu.org/copyleft/lesser.html",
    "LicenseRef-Public-Domain": "https://spdx.github.io/spdx-spec/v2.3/annexes/SPDX-license-expressions/",
    "MIT": "https://spdx.org/licenses/MIT.html",
    "NONE": SPDX_SPEC_NONE,
    "Unicode-3.0": "https://spdx.org/licenses/Unicode-3.0.html",
}


def normalize_license(raw_name: str, raw_url: str) -> str:
    apache = {
        "Apache 2.0",
        "Apache License, Version 2.0",
        "Apache License Version 2.0",
        "Apache Software License - Version 2.0",
        "Apache-2.0",
        "The Apache License, Version 2.0",
        "The Apache Software License, Version 2.0",
    }
    mit = {"MIT", "MIT License", "MIT license", "The MIT License", "The MIT License (MIT)"}
    if raw_name in apache:
        return "Apache-2.0"
    if raw_name in mit:
        return "MIT"
    if raw_name in {"BSD-3-Clause", "The BSD License"}:
        return "BSD-3-Clause"
    if raw_name in {"Eclipse Public License v. 2.0", "Eclipse Public License v2.0"}:
        return "EPL-2.0"
    if raw_name == "Eclipse Public License - Version 1.0":
        return "EPL-1.0"
    if raw_name == "GNU General Public License, version 2 with the GNU Classpath Exception":
        return "GPL-2.0-only WITH Classpath-exception-2.0"
    if raw_name in {"LGPL 2.1", "LGPL-2.1-only", "LGPLv2.1", "GNU Lesser General Public License version 2.1"}:
        return "LGPL-2.1-only"
    if raw_name == "GNU Library or Lesser General Public License version 2.0 (LGPLv2)":
        return "LGPL-2.0-only"
    if raw_name == "LGPL-2.1-or-later":
        return "LGPL-2.1-or-later"
    if raw_name == "GNU Lesser General Public License v3.0":
        return "LGPL-3.0-only"
    if raw_name == "GNU Lesser General Public License":
        return "LicenseRef-JOrbis-LGPL-Unspecified-Version"
    if raw_name == "Public Domain":
        return "LicenseRef-Public-Domain"
    if raw_name in {"0BSD", "Unicode-3.0", "NONE"}:
        return raw_name
    raise RuntimeError(f"Unmapped license declaration: {raw_name!r} ({raw_url!r})")


def finalized_record(raw_name: str, raw_url: str) -> dict[str, str]:
    spdx = normalize_license(raw_name, raw_url)
    return {
        "rawName": raw_name,
        "rawUrl": raw_url,
        "spdx": spdx,
        "canonicalUrl": CANONICAL_LICENSE_URLS[spdx],
    }


def evidence(url: str, kind: str, note: str) -> dict[str, str]:
    return {"url": url, "kind": kind, "note": note}


PINNED = {
    "brigadier": "9ba4f13c0fe82b07c08c2dc2d8043f075ffd0d98",
    "datafixerupper": "5fc0978694e996cfe68a742b67a0d506c17de3f0",
    "idea-ext": "dfb4af2a12a4acbbfaa40a33c3c5ffc9450b280a",
    "devlaunch": "857c97c49652a1c6b4bc4b3d9a5e65e54218d23f",
    "fml": "33ef217a31bc5238e4f8a7e4d337a3f6a1112794",
    "moddev": "545875049fb624ce2af2c92263ce2907342b7a76",
}


def official_license(spdx: str, raw_name: str, raw_url: str, source_url: str, source_kind: str, note: str, resolution: str = "official-project-source") -> dict:
    return {
        "resolution": resolution,
        "spdxExpression": spdx,
        "records": [finalized_record(raw_name, raw_url)],
        "evidence": [evidence(source_url, source_kind, note)],
        "note": note,
    }


def no_grant(coord: tuple[str, str, str], metadata_filename: str, note: str) -> dict:
    urls = verified_evidence_urls(coord, metadata_filename)
    return {
        "resolution": "no-license-declaration-in-consumed-upstream-metadata",
        "spdxExpression": "NONE",
        "records": [finalized_record("NONE", "NONE")],
        "evidence": [
            evidence(preferred_url(urls), "versioned-upstream-metadata-without-license", note),
            evidence(NO_LICENSE_GUIDANCE, "default-copyright-guidance", "No redistribution grant is inferred when upstream publishes no license declaration."),
        ],
        "note": note + " The fixture therefore treats the component as non-redistributable and does not vendor it.",
    }


MANUAL: dict[tuple[str, str, str], dict] = {}


def add_manual(coordinate: tuple[str, str, str], record: dict) -> None:
    if coordinate in MANUAL:
        raise RuntimeError(f"Duplicate manual provenance coordinate: {':'.join(coordinate)}")
    MANUAL[coordinate] = record


for name, version, metadata_filename in (
    ("authlib", "7.0.63", "authlib-7.0.63.pom"),
    ("blocklist", "1.0.10", "blocklist-1.0.10.pom"),
    ("logging", "1.1.1", "logging-1.1.1.pom"),
    ("logging", "1.6.11", "logging-1.6.11.pom"),
    ("patchy", "2.2.10", "patchy-2.2.10.pom"),
    ("text2speech", "1.18.11", "text2speech-1.18.11.pom"),
):
    coord = ("com.mojang", name, version)
    add_manual(coord, no_grant(coord, metadata_filename, "The versioned Mojang POM contains no licenses element."))

add_manual(("com.mojang", "brigadier", "1.3.10"), official_license(
    "MIT", "MIT License", f"https://github.com/Mojang/brigadier/blob/{PINNED['brigadier']}/LICENSE",
    f"https://github.com/Mojang/brigadier/blob/{PINNED['brigadier']}/LICENSE", "pinned-official-license-file",
    "The consumed POM omits licensing; Mojang's official Brigadier repository publishes the MIT license."
))
add_manual(("com.mojang", "datafixerupper", "9.0.19"), official_license(
    "MIT", "MIT License", f"https://github.com/Mojang/DataFixerUpper/blob/{PINNED['datafixerupper']}/LICENSE",
    f"https://github.com/Mojang/DataFixerUpper/blob/{PINNED['datafixerupper']}/LICENSE", "pinned-official-license-file",
    "The consumed POM omits licensing; Mojang's official DataFixerUpper repository publishes the MIT license."
))
jtracy_coord = ("com.mojang", "jtracy", "1.0.37")
jtracy_native_url = preferred_url(
    verified_evidence_urls(jtracy_coord, "jtracy-1.0.37-natives-linux.jar")
)
add_manual(jtracy_coord, no_grant(jtracy_coord, "jtracy-1.0.37.pom", "The versioned Mojang POM contains no licenses element for the JTracy wrapper."))
MANUAL[jtracy_coord]["bundledThirdPartyNotices"] = [
    {
        "artifact": "jtracy-1.0.37-natives-linux.jar",
        "pathInsideArtifact": "Tracy_LICENSE",
        "record": finalized_record("BSD-3-Clause", "https://github.com/wolfpld/tracy"),
        "evidence": evidence(jtracy_native_url, "verified-upstream-artifact-embedded-license", "The verified native JAR embeds Tracy_LICENSE with the complete BSD 3-Clause text."),
    }
]

add_manual(("gradle.plugin.org.jetbrains.gradle.plugin.idea-ext", "gradle-idea-ext", "1.2"), official_license(
    "Apache-2.0", "Apache License, Version 2.0", f"https://github.com/JetBrains/gradle-idea-ext-plugin/blob/{PINNED['idea-ext']}/LICENSE.txt",
    f"https://github.com/JetBrains/gradle-idea-ext-plugin/blob/{PINNED['idea-ext']}/LICENSE.txt", "version-pinned-official-license-file",
    "The plugin-portal POM omits licensing; the exact v1.2 source tag publishes Apache-2.0."
))
add_manual(("net.neoforged", "DevLaunch", "1.0.2"), official_license(
    "Apache-2.0", "Apache License, Version 2.0", "http://www.apache.org/licenses/LICENSE-2.0",
    f"https://github.com/neoforged/DevLaunch/blob/{PINNED['devlaunch']}/src/main/java/net/neoforged/devlaunch/Main.java", "pinned-official-source-header",
    "The published POM and repository root omit a license record; every program source file is represented by Main.java, whose official source header grants Apache-2.0."
))
add_manual(("net.neoforged", "minecraft-dependencies", "26.1.2"), no_grant(
    ("net.neoforged", "minecraft-dependencies", "26.1.2"), "minecraft-dependencies-26.1.2.module",
    "This is dependency-constraint metadata generated from the Mojang manifest; the versioned Gradle module contains no license declaration and no code payload."
))
for coord in (
    ("net.neoforged", "moddev-gradle", "2.0.141"),
    ("net.neoforged.moddev", "net.neoforged.moddev.gradle.plugin", "2.0.141"),
):
    add_manual(coord, official_license(
        "LGPL-2.1-only", "GNU Lesser General Public License version 2.1", f"https://github.com/neoforged/ModDevGradle/blob/{PINNED['moddev']}/LICENSE",
        f"https://github.com/neoforged/ModDevGradle/blob/{PINNED['moddev']}/LICENSE", "pinned-official-license-file",
        "ModDevGradle and its plugin marker use the license published by the official implementation repository."
    ))
for name in ("earlydisplay", "loader"):
    coord = ("net.neoforged.fancymodloader", name, "11.0.15")
    add_manual(coord, official_license(
        "LGPL-2.1-only", "GNU Lesser General Public License version 2.1", f"https://github.com/neoforged/FancyModLoader/blob/{PINNED['fml']}/LICENSE.txt",
        f"https://github.com/neoforged/FancyModLoader/blob/{PINNED['fml']}/LICENSE.txt", "major-version-pinned-official-license-file",
        "The published module POM omits licensing; the official FancyModLoader 11.0 source tag declares LGPL 2.1 for these modules."
    ))
for version in ("7", "9"):
    coord = ("org.sonatype.oss", "oss-parent", version)
    pom_url = preferred_url(verified_evidence_urls(coord, f"oss-parent-{version}.pom"))
    add_manual(coord, official_license(
        "Apache-2.0", "Apache License Version 2.0", "http://www.apache.org/licenses/LICENSE-2.0", pom_url,
        "versioned-upstream-pom-license-header", "The POM's XML comment contains the Apache-2.0 grant although it has no Maven licenses element.",
        "upstream-pom-comment"
    ))
add_manual(("trove", "trove", "1.0.2"), official_license(
    "LGPL-2.0-only", "GNU Library or Lesser General Public License version 2.0 (LGPLv2)",
    "https://sourceforge.net/projects/trove4j/", "https://sourceforge.net/projects/trove4j/", "official-project-license-record",
    "The sparse Maven POM and JAR omit a license file; the official Trove for Java project record classifies the project as LGPLv2."
))


PROJECT_SOURCE_OVERRIDES = {
    ("com.mojang", "brigadier", "1.3.10"): "https://github.com/Mojang/brigadier",
    ("com.mojang", "datafixerupper", "9.0.19"): "https://github.com/Mojang/DataFixerUpper",
    ("gradle.plugin.org.jetbrains.gradle.plugin.idea-ext", "gradle-idea-ext", "1.2"): "https://github.com/JetBrains/gradle-idea-ext-plugin",
    ("net.neoforged", "DevLaunch", "1.0.2"): "https://github.com/neoforged/DevLaunch",
    ("net.neoforged", "moddev-gradle", "2.0.141"): "https://github.com/neoforged/ModDevGradle",
    ("net.neoforged.moddev", "net.neoforged.moddev.gradle.plugin", "2.0.141"): "https://github.com/neoforged/ModDevGradle",
    ("net.neoforged.fancymodloader", "earlydisplay", "11.0.15"): "https://github.com/neoforged/FancyModLoader",
    ("net.neoforged.fancymodloader", "loader", "11.0.15"): "https://github.com/neoforged/FancyModLoader",
    ("trove", "trove", "1.0.2"): "https://sourceforge.net/projects/trove4j/",
}


def pom_project_url(coord: tuple[str, str, str]) -> str | None:
    if coord not in POMS:
        return None
    root = POMS[coord][1]
    for path in ("./{*}scm/{*}url", "./{*}url"):
        value = text(root, path)
        if value and value.startswith(("https://", "http://")) and "${" not in value:
            return value
    return None


runtime_lines = validate_runtime_component_lines(
    RUNTIME_COMPONENTS.read_text(encoding="utf-8"), str(RUNTIME_COMPONENTS)
)
runtime = set(runtime_lines)
verified_coordinates = {
    (key[0], key[1], key[2]) for key in VERIFIED_ARTIFACTS
}
unused_repository_overrides = set(REPOSITORY_BASE_OVERRIDES) - verified_coordinates
if unused_repository_overrides:
    rendered = ", ".join(
        ":".join(coord) for coord in sorted(unused_repository_overrides)
    )
    raise RuntimeError(f"Repository-base overrides are stale: {rendered}")
components: list[dict] = []
artifact_lookup: dict[tuple[str, str, str, str], str] = {}

for component in components_xml:
    coord = tuple(component.get(key) for key in ("group", "name", "version"))
    if not all(coord):
        raise RuntimeError("Component coordinate is incomplete")
    coord = coord  # type: ignore[assignment]
    coordinate = ":".join(coord)
    artifacts: list[dict] = []
    component_urls: set[str] = set()
    for artifact in sorted(component.findall("g:artifact", NS), key=lambda item: item.get("name") or ""):
        name = artifact.get("name")
        checksum = artifact.find("g:sha256", NS)
        if not name or checksum is None or not checksum.get("value"):
            raise RuntimeError(f"Incomplete verified artifact for {coordinate}")
        value = checksum.get("value")
        urls = remote_urls(coord, name)
        if not urls:
            raise RuntimeError(f"No source URL for {coordinate}/{name}")
        component_urls.update(urls)
        artifact_lookup[(*coord, name)] = value
        artifacts.append(
            {
                "name": name,
                "sha256": value,
                "sourceUrls": urls,
                "verificationMetadataSelector": f"component[@group='{coord[0]}'][@name='{coord[1]}'][@version='{coord[2]}']/artifact[@name='{name}']/sha256",
            }
        )
    if not artifacts:
        raise RuntimeError(f"No verified artifacts for {coordinate}")

    if coord in MANUAL:
        license_record = MANUAL[coord]
    else:
        resolved = resolve_pom_license(coord)
        if resolved is None:
            raise RuntimeError(f"No license resolution for {coordinate}")
        declared_by, raw_records, inheritance_path = resolved
        pom_filename = f"{declared_by[1]}-{declared_by[2]}.pom"
        evidence_urls = verified_evidence_urls(declared_by, pom_filename)
        records = [finalized_record(item["rawName"], item["rawUrl"]) for item in raw_records]
        expression = " OR ".join(dict.fromkeys(item["spdx"] for item in records))
        direct = declared_by == coord
        license_record = {
            "resolution": "declared-in-versioned-pom" if direct else "inherited-from-versioned-parent-pom",
            "spdxExpression": expression,
            "records": records,
            "declaredBy": ":".join(declared_by),
            "inheritancePath": [":".join(item) for item in inheritance_path],
            "evidence": [
                evidence(preferred_url(evidence_urls), "versioned-upstream-pom-license-declaration", "Raw license name and URL are taken from this POM's licenses element.")
            ],
            "note": "The license declaration is read from the component POM." if direct else "The component POM has no direct declaration; Maven parent inheritance resolves the license from the recorded parent chain.",
        }

    payload = any(not item["name"].endswith((".pom", ".module")) for item in artifacts)
    in_runtime = coordinate in runtime
    if in_runtime and payload:
        classification = "not-vendored-runtime"
        rationale = "The component is in the resolved runtimeClasspath graph, but its payload is downloaded only into Gradle's cache and is not embedded in the fixture JAR or committed."
    elif in_runtime:
        classification = "not-vendored-runtime-metadata"
        rationale = "The component contributes only dependency/BOM/module metadata to runtime resolution; it has no verified code payload and is not committed."
    elif payload:
        classification = "not-vendored-build-only"
        rationale = "The component is absent from the resolved runtimeClasspath graph and is used only by Gradle/plugin/tooling/transformation work; it is downloaded to cache and not committed."
    else:
        classification = "not-vendored-build-metadata"
        rationale = "Only POM/module/marker metadata was resolved outside runtimeClasspath; no code payload is vendored or committed."

    all_urls = sorted(component_urls)
    primary_artifact_url = preferred_url(all_urls)
    project_url = PROJECT_SOURCE_OVERRIDES.get(coord) or pom_project_url(coord) or primary_artifact_url.rsplit("/", 1)[0] + "/"
    components.append(
        {
            "group": coord[0],
            "name": coord[1],
            "version": coord[2],
            "coordinate": coordinate,
            "source": {
                "projectOrSourceUrl": project_url,
                "primaryArtifactUrl": primary_artifact_url,
                "resolvedRepositoryUrls": sorted({url.rsplit("/", 1)[0] + "/" for url in all_urls}),
            },
            "license": license_record,
            "redistribution": {
                "redistributed": False,
                "vendored": False,
                "classification": classification,
                "rationale": rationale,
            },
            "verifiedArtifacts": artifacts,
            "evidence": {
                "dependencyVerification": "fixtures/basic-content/gradle/verification-metadata.xml",
                "sourceUrl": primary_artifact_url,
                "licenseEvidenceUrl": license_record["evidence"][0]["url"],
                "runtimeScopeCommand": RUNTIME_SCOPE_COMMAND,
            },
        }
    )

components.sort(key=lambda item: (item["group"], item["name"], item["version"]))
unused_license_poms = LICENSE_POM_COORDINATES - USED_LICENSE_POMS
if unused_license_poms:
    rendered = ", ".join(":".join(coord) for coord in sorted(unused_license_poms))
    raise RuntimeError(f"Reviewed license-POM evidence was not used: {rendered}")
license_counts = collections.Counter(item["license"]["resolution"] for item in components)
redistribution_counts = collections.Counter(item["redistribution"]["classification"] for item in components)
artifact_count = sum(len(item["verifiedArtifacts"]) for item in components)
unique_coords = len({item["coordinate"] for item in components})
unique_artifacts = len(artifact_lookup)

document = {
    "schemaVersion": "1.0.0",
    "auditedAt": "2026-07-21",
    "scope": "Complete Gradle dependency-verification component inventory for the NeoForge 26.1.2 baseline fixture.",
    "policy": {
        "vendoring": "No component in this inventory is vendored or redistributed by the fixture; only names and SHA-256 verification records are committed.",
        "licenseAbsence": "SPDX special value NONE means the consumed upstream metadata contains no declared license. It is a completed no-grant finding, not an unresolved guess; redistribution remains prohibited until separate rights are established.",
        "licenseRefs": {
            "LicenseRef-JOrbis-LGPL-Unspecified-Version": "The upstream POM says GNU Lesser General Public License but does not identify a version; the raw declaration and URL are preserved without inventing one.",
            "LicenseRef-Public-Domain": "The upstream POM explicitly says Public Domain; a local LicenseRef preserves that raw declaration without selecting a more specific standardized instrument.",
        },
        "sourcePrecedence": "SHA-256-verified versioned Gradle-cache POM/module data first; exact official artifact repositories and pinned official project sources for manual resolutions.",
    },
    "inputs": {
        "verificationMetadata": "fixtures/basic-content/gradle/verification-metadata.xml",
        "verificationMetadataSha256": sha256(METADATA),
        "generator": "scripts/provenance/build-neoforge-inventory.py",
        "generatorSha256": sha256(pathlib.Path(__file__).resolve()),
        "generatorCommand": GENERATOR_COMMAND,
        "runtimeScopeCommand": RUNTIME_SCOPE_COMMAND,
        "runtimeScopePolicy": "The reviewed generator mode requires canonical exact Temurin 21.0.11+10-LTS and 25.0.3+9-LTS paths, removes ambient Gradle/JVM option overrides, and forces both Gradle caches under fixtures/basic-content/run before strict offline resolution.",
        "runtimeComponentResolver": "scripts/provenance/inventory-runtime.init.gradle",
        "runtimeComponentResolverSha256": sha256(RUNTIME_RESOLVER),
        "runtimeClassificationEvidence": "A deterministic sorted ModuleComponentIdentifier list emitted from the fixture runtimeClasspath by the tracked resolver, generated offline with Gradle 9.2.1 and Java 25.",
        "licensePomEvidence": "scripts/provenance/neoforge-license-pom-evidence.txt",
        "licensePomEvidenceSha256": sha256(LICENSE_POM_EVIDENCE),
        "licensePomEvidenceCount": len(LICENSE_POM_COORDINATES),
        "licensePomEvidencePolicy": "Every locally parsed license POM, including inherited parents and no-grant metadata, must be listed, source-addressable, present in Gradle verification metadata, and byte-identical to its committed SHA-256.",
    },
    "summary": {
        "complete": True,
        "componentCount": len(components),
        "uniqueCoordinateCount": unique_coords,
        "verificationMetadataArtifactCount": sum(len(component.findall("g:artifact", NS)) for component in components_xml),
        "inventoryArtifactReferenceCount": artifact_count,
        "uniqueArtifactReferenceCount": unique_artifacts,
        "redistributedComponentCount": sum(1 for item in components if item["redistribution"]["redistributed"]),
        "licenseResolutionCounts": dict(sorted(license_counts.items())),
        "redistributionClassificationCounts": dict(sorted(redistribution_counts.items())),
        "nonemptyFieldChecks": {
            "source": all(bool(item["source"]["projectOrSourceUrl"] and item["source"]["primaryArtifactUrl"]) for item in components),
            "license": all(bool(item["license"]["records"] and item["license"]["spdxExpression"]) for item in components),
            "redistribution": all(bool(item["redistribution"]["classification"] and item["redistribution"]["rationale"]) for item in components),
            "evidence": all(bool(item["evidence"]["sourceUrl"] and item["evidence"]["licenseEvidenceUrl"]) for item in components),
        },
        "unresolved": [],
    },
    "components": components,
}

assert len(components) == 202
assert unique_coords == 202
assert artifact_count == 383
assert unique_artifacts == 383
assert document["summary"]["redistributedComponentCount"] == 0
assert all(document["summary"]["nonemptyFieldChecks"].values())
assert not document["summary"]["unresolved"]
print(json.dumps(document, indent=2, ensure_ascii=False, sort_keys=False) + "\n", end="")
