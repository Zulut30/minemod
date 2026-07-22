#!/usr/bin/env bash
# Literal snippets below are intentional static assertions or child-shell code.
# shellcheck disable=SC2016
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=smoke-guard-lib.sh
source "$script_dir/smoke-guard-lib.sh"
SMOKE_OVERALL_TIMEOUT_SECONDS=180
SMOKE_OVERALL_DEADLINE=$((SECONDS + SMOKE_OVERALL_TIMEOUT_SECONDS))

smoke_process_group_alive() {
  local leader_pid=$1
  kill -0 -- "-$leader_pid" 2>/dev/null
}

smoke_cleanup_process_group() {
  local leader_pid=${1:-}
  local grace_seconds=${2:-10}

  if [[ -z "$leader_pid" ]]; then
    return
  fi
  if smoke_process_group_alive "$leader_pid"; then
    kill -TERM -- "-$leader_pid" 2>/dev/null || true
    for ((attempt = 0; attempt < grace_seconds * 10; attempt++)); do
      smoke_process_group_alive "$leader_pid" || break
      sleep 0.1
    done
    if smoke_process_group_alive "$leader_pid"; then
      kill -KILL -- "-$leader_pid" 2>/dev/null || true
    fi
  elif kill -0 "$leader_pid" 2>/dev/null; then
    kill -TERM "$leader_pid" 2>/dev/null || true
  fi
  wait "$leader_pid" 2>/dev/null || true
}

repo_root=$(cd -- "$script_dir/.." && pwd -P)
fixture="$repo_root/fixtures/basic-content"
smoke_log4j_config="$fixture/config/phase0-smoke-log4j2.xml"

temporary_dir=$(mktemp -d)
cleanup_temporary_dir() {
  [[ -z "${lifecycle_pid:-}" ]] \
    || kill -KILL "$lifecycle_pid" 2>/dev/null || true
  [[ -z "${unrelated_pid:-}" ]] \
    || kill -KILL "$unrelated_pid" 2>/dev/null || true
  [[ -z "${lifecycle_pid:-}" ]] \
    || wait "$lifecycle_pid" 2>/dev/null || true
  [[ -z "${unrelated_pid:-}" ]] \
    || wait "$unrelated_pid" 2>/dev/null || true
  [[ -z "${identity_pid:-}" ]] \
    || kill -KILL "$identity_pid" 2>/dev/null || true
  [[ -z "${identity_pid:-}" ]] \
    || wait "$identity_pid" 2>/dev/null || true
  for recorded_pid_file in "${hanging_find_pids:-}" "${hanging_validator_pids:-}"; do
    if [[ -n "$recorded_pid_file" && -f "$recorded_pid_file" ]]; then
      while read -r hanging_pid hanging_starttime; do
        if smoke_pid_identity_matches "$hanging_pid" "$hanging_starttime" \
          && ! smoke_runner_has_exited "$hanging_pid"; then
          kill -KILL "$hanging_pid" 2>/dev/null || true
          wait "$hanging_pid" 2>/dev/null || true
        fi
      done <"$recorded_pid_file"
    fi
  done
  if [[ -n "${temporary_dir:-}" && -d "$temporary_dir" ]]; then
    rm -rf -- "$temporary_dir"
  fi
}
trap cleanup_temporary_dir EXIT

invalid_target_output="$temporary_dir/invalid-smoke-target.out"
if PHASE0_SMOKE_TARGET=unreviewed-loader PHASE0_SMOKE_TIMEOUT_SECONDS=10 \
  "$script_dir/smoke-dedicated-server.sh" >"$invalid_target_output" 2>&1; then
  echo 'Dedicated-server smoke accepted an unreviewed target.' >&2
  exit 1
fi
if ! grep -Fq 'Unsupported Phase 0 smoke target: unreviewed-loader' \
  "$invalid_target_output"; then
  echo 'Dedicated-server smoke did not report its rejected target.' >&2
  exit 1
fi
if [[ $(grep -Fc 'fabric-1.20.1)' "$script_dir/smoke-dedicated-server.sh") -ne 1 \
  || $(grep -Fc 'fabric-1.20.1)' "$script_dir/smoke-client-ci.sh") -ne 1 ]]; then
  echo 'Fabric 1.20.1 must remain an explicit reviewed smoke target.' >&2
  exit 1
fi

python3 - "$smoke_log4j_config" <<'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
local_name = lambda element: element.tag.rsplit("}", 1)[-1]
assert root.attrib.get("shutdownHook") == "disable"
appenders_sections = [element for element in root if local_name(element) == "Appenders"]
assert len(appenders_sections) == 1
appenders = list(appenders_sections[0])
assert len(appenders) == 1
assert local_name(appenders[0]) == "Console"
assert appenders[0].attrib.get("name") == "Phase0Console"
assert appenders[0].attrib.get("target") == "SYSTEM_OUT"
loggers_sections = [element for element in root if local_name(element) == "Loggers"]
assert len(loggers_sections) == 1
loggers = list(loggers_sections[0])
assert len(loggers) == 1
assert local_name(loggers[0]) == "Root"
references = [
    element.attrib.get("ref")
    for element in loggers[0]
    if local_name(element) == "AppenderRef"
]
assert references == ["Phase0Console"]
PY
if [[ $(grep -Fc 'loggingConfigFile.set(phase0SmokeLog4jConfig)' \
  "$fixture/build.gradle") -ne 2 ]]; then
  echo 'Both smoke run profiles must select the console-only Log4j2 configuration.' >&2
  exit 1
fi
if grep -Eq 'runtime_log|logs/latest\.log|logs/debug\.log' \
  "$script_dir/smoke-dedicated-server.sh" "$script_dir/smoke-client-ci.sh"; then
  echo 'Smoke scripts must analyze only the hard-capped console diagnostic.' >&2
  exit 1
fi

python3 - "$repo_root" <<'PY'
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1])
metadata = ET.parse(
    root / "fixtures/basic-content/gradle/verification-metadata.xml"
).getroot()
lock = json.loads((root / "packs/neoforge-26.1.2/versions.lock.json").read_text())
pack = json.loads((root / "packs/neoforge-26.1.2/pack.json").read_text())
inventory = json.loads(
    (root / "docs/provenance/neoforge-26.1.2-inventory.json").read_text()
)
dependencies = json.loads(
    (root / "docs/provenance/neoforge-26.1.2-dependencies.json").read_text()
)
workflow = (root / ".github/workflows/phase-0.yml").read_text()
fabric_build = (root / "fixtures/fabric-26.2-empty/build.gradle").read_text()
ci_counts = re.findall(r"^\s*expected_artifact_count=([0-9]+)$", workflow, re.MULTILINE)
assert workflow.count('canonical_java_home=$(realpath -- "$JAVA_HOME")') == 6
assert workflow.count('test -d "$canonical_java_home"') == 6
assert workflow.count(
    'printf \'PHASE0_JAVA21_HOME=%s\\n\' "$canonical_java_home"'
) == 2
assert workflow.count(
    'printf \'PHASE0_JAVA25_HOME=%s\\n\' "$canonical_java_home"'
) == 2
assert workflow.count(
    'printf \'MCDEV_JAVA25_HOME=%s\\n\' "$canonical_java_home"'
) == 2
assert 'printf \'PHASE0_JAVA21_HOME=%s\\n\' "$JAVA_HOME"' not in workflow
assert 'printf \'PHASE0_JAVA25_HOME=%s\\n\' "$JAVA_HOME"' not in workflow
assert 'printf \'MCDEV_JAVA25_HOME=%s\\n\' "$JAVA_HOME"' not in workflow
assert 'canonical_java21_home=$(realpath "$PHASE0_JAVA21_HOME")' in workflow
assert 'canonical_java25_home=$(realpath "$PHASE0_JAVA25_HOME")' in workflow
assert 'grep -Fc "$canonical_java21_home"' in workflow
assert 'grep -Fc "$canonical_java25_home"' in workflow
assert 'grep -Fc "$PHASE0_JAVA21_HOME"' not in workflow
assert 'grep -Fc "$PHASE0_JAVA25_HOME"' not in workflow
client_prepare = (
    './gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR"\n'
    '          --dependency-verification strict prepareClientRun'
)
assert workflow.count(client_prepare) == 1
assert workflow.index('name: Prepare verified headless client runtime') < workflow.index(
    'name: Smoke-test headless client'
)
assert workflow.count('PHASE0_SMOKE_TARGET: fabric') == 2
assert workflow.count(
    'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2'
) == 2
assert 'fabric-api.gametest.report-file' in fabric_build
assert 'fixtures/fabric-26.2-empty/build/run/gameTest/gametest-report.xml' in workflow
assert 'fixtures/fabric-26.2-empty/build/run/clientGameTest/screenshots/*.png' in workflow
assert 'fabric_expected_artifact_count=411' in workflow
assert workflow.index('name: Run Fabric client GameTest') < workflow.index(
    'name: Smoke-test Fabric headless client'
)
counts = [
    sum(element.tag.rsplit("}", 1)[-1] == "artifact" for element in metadata.iter()),
    lock["verification"]["artifacts"],
    inventory["summary"]["verificationMetadataArtifactCount"],
    inventory["summary"]["inventoryArtifactReferenceCount"],
    dependencies["dependencyInventory"]["artifactReferenceCount"],
]
assert ci_counts == ["383"]
assert counts == [int(ci_counts[0])] * len(counts), counts
assert pack["productLicense"] == "Apache-2.0"
assert lock["productLicense"] == "Apache-2.0"
assert dependencies["productLicense"] == "Apache-2.0"
assert (
    root
    / "fixtures/basic-content/src/main/resources/META-INF/neoforge.mods.toml"
).read_text().startswith('license = "Apache-2.0"\n')
PY

if smoke_assert_no_mountpoints_in_tree /proc >/dev/null 2>&1; then
  echo 'Mountpoint guard accepted /proc as an owned smoke tree.' >&2
  exit 1
fi
if smoke_assert_no_mountpoints_in_tree /dev >/dev/null 2>&1; then
  echo 'Mountpoint guard accepted /dev as an owned smoke tree.' >&2
  exit 1
fi

assert_prepare_rejected_without_external_change() {
  local fixture_path=$1
  local run_kind=$2
  local label=$3
  local external_marker=$4
  local expected_marker=$5
  local output="$temporary_dir/${label//[^A-Za-z0-9._-]/_}.out"

  if (smoke_prepare_run_environment "$fixture_path" "$run_kind") >"$output" 2>&1; then
    echo "Smoke path preparation accepted adversarial case: $label" >&2
    exit 1
  fi
  if [[ ! -f "$external_marker" || $(<"$external_marker") != "$expected_marker" ]]; then
    echo "Rejected smoke path case changed its external target: $label" >&2
    exit 1
  fi
}

external_marker_text='outside-must-remain-byte-identical'
root_target="$temporary_dir/root-target"
root_link="$temporary_dir/root-link"
mkdir -p "$root_target"
printf '%s\n' "$external_marker_text" >"$root_target/marker"
ln -s "$root_target" "$root_link"
assert_prepare_rejected_without_external_change \
  "$root_link" server fixture-root-symlink "$root_target/marker" "$external_marker_text"

run_link_fixture="$temporary_dir/run-link-fixture"
run_link_target="$temporary_dir/run-link-target"
mkdir -p "$run_link_fixture" "$run_link_target"
printf '%s\n' "$external_marker_text" >"$run_link_target/marker"
ln -s "$run_link_target" "$run_link_fixture/run"
assert_prepare_rejected_without_external_change \
  "$run_link_fixture" server run-root-symlink "$run_link_target/marker" "$external_marker_text"

profile_link_fixture="$temporary_dir/profile-link-fixture"
profile_link_target="$temporary_dir/profile-link-target"
mkdir -p "$profile_link_fixture/run" "$profile_link_target"
printf '%s\n' "$external_marker_text" >"$profile_link_target/marker"
ln -s "$profile_link_target" "$profile_link_fixture/run/server"
assert_prepare_rejected_without_external_change \
  "$profile_link_fixture" server profile-symlink \
  "$profile_link_target/marker" "$external_marker_text"

for component_case in run-file profile-file; do
  component_fixture="$temporary_dir/$component_case-fixture"
  component_external="$temporary_dir/$component_case-external"
  mkdir -p "$component_fixture" "$component_external"
  printf '%s\n' "$external_marker_text" >"$component_external/marker"
  if [[ "$component_case" == run-file ]]; then
    : >"$component_fixture/run"
  else
    mkdir -p "$component_fixture/run"
    : >"$component_fixture/run/server"
  fi
  assert_prepare_rejected_without_external_change \
    "$component_fixture" server "$component_case" \
    "$component_external/marker" "$external_marker_text"
done

for managed_name in eula.txt server.properties phase0-console.log \
  phase0-console.pipe .phase0-server-ready .phase0-server-ready.tmp logs; do
  managed_label=${managed_name//./_}
  managed_fixture="$temporary_dir/managed-$managed_label-fixture"
  managed_external="$temporary_dir/managed-$managed_label-external"
  mkdir -p "$managed_fixture/run/server" "$managed_external"
  printf '%s\n' "$external_marker_text" >"$managed_external/marker"
  ln -s "$managed_external/marker" "$managed_fixture/run/server/$managed_name"
  assert_prepare_rejected_without_external_change \
    "$managed_fixture" server "managed-$managed_label-symlink" \
    "$managed_external/marker" "$external_marker_text"
done

for managed_name in .phase0-client-ready .phase0-client-ready.tmp; do
  managed_label=${managed_name//./_}
  managed_fixture="$temporary_dir/managed-client-$managed_label-fixture"
  managed_external="$temporary_dir/managed-client-$managed_label-external"
  mkdir -p "$managed_fixture/run/client" "$managed_external"
  printf '%s\n' "$external_marker_text" >"$managed_external/marker"
  ln -s "$managed_external/marker" "$managed_fixture/run/client/$managed_name"
  assert_prepare_rejected_without_external_change \
    "$managed_fixture" client "managed-client-$managed_label-symlink" \
    "$managed_external/marker" "$external_marker_text"
done

hardlink_fixture="$temporary_dir/managed-hardlink-fixture"
hardlink_external="$temporary_dir/managed-hardlink-external"
mkdir -p "$hardlink_fixture/run/server" "$hardlink_external"
printf '%s\n' "$external_marker_text" >"$hardlink_external/marker"
ln "$hardlink_external/marker" "$hardlink_fixture/run/server/eula.txt"
assert_prepare_rejected_without_external_change \
  "$hardlink_fixture" server managed-file-hardlink \
  "$hardlink_external/marker" "$external_marker_text"

nested_link_fixture="$temporary_dir/nested-link-fixture"
nested_link_target="$temporary_dir/nested-link-target"
mkdir -p "$nested_link_fixture/run/server/config" "$nested_link_target"
printf '%s\n' "$external_marker_text" >"$nested_link_target/marker"
ln -s "$nested_link_target" "$nested_link_fixture/run/server/config/escape"
assert_prepare_rejected_without_external_change \
  "$nested_link_fixture" server nested-runtime-symlink \
  "$nested_link_target/marker" "$external_marker_text"

for cache_name in gradle-home project-cache; do
  cache_link_fixture="$temporary_dir/$cache_name-link-fixture"
  cache_link_target="$temporary_dir/$cache_name-link-target"
  mkdir -p "$cache_link_fixture/run/$cache_name/nested" "$cache_link_target"
  printf '%s\n' "$external_marker_text" >"$cache_link_target/marker"
  ln -s "$cache_link_target/marker" \
    "$cache_link_fixture/run/$cache_name/nested/escape"
  assert_prepare_rejected_without_external_change \
    "$cache_link_fixture" server "$cache_name-nested-symlink" \
    "$cache_link_target/marker" "$external_marker_text"
done

post_prepare_fixture="$temporary_dir/post-prepare-fixture"
post_prepare_external="$temporary_dir/post-prepare-external"
mkdir -p "$post_prepare_fixture" "$post_prepare_external"
printf '%s\n' "$external_marker_text" >"$post_prepare_external/marker"
smoke_prepare_run_environment "$post_prepare_fixture" server
ln -s "$post_prepare_external/marker" \
  "$SMOKE_PREPARED_RUN_DIR/.phase0-server-ready"
if smoke_remove_prepared_entry \
  "$SMOKE_PREPARED_RUN_DIR/.phase0-server-ready" regular 2>/dev/null; then
  echo 'Managed cleanup accepted a sentinel symlink installed after preparation.' >&2
  exit 1
fi
if [[ $(<"$post_prepare_external/marker") != "$external_marker_text" ]]; then
  echo 'Rejected post-preparation sentinel symlink changed its external target.' >&2
  exit 1
fi

outside_gradle_home="$temporary_dir/outside-gradle-home"
outside_project_cache="$temporary_dir/outside-project-cache"
GRADLE_USER_HOME="$outside_gradle_home"
GRADLE_PROJECT_CACHE_DIR="$outside_project_cache"
cache_fixture="$temporary_dir/cache-fixture"
mkdir -p "$cache_fixture"
smoke_prepare_run_environment "$cache_fixture" client
smoke_configure_gradle_caches "$cache_fixture"
if [[ "$GRADLE_USER_HOME" != "$cache_fixture/run/gradle-home" \
  || "$GRADLE_PROJECT_CACHE_DIR" != "$cache_fixture/run/project-cache" ]]; then
  echo 'Smoke cache configuration trusted caller-controlled paths.' >&2
  exit 1
fi

entry_cap_fixture="$temporary_dir/entry-cap-fixture"
mkdir -p "$entry_cap_fixture/run/gradle-home"
for ((entry_index = 0; entry_index < 33; entry_index++)); do
  : >"$entry_cap_fixture/run/gradle-home/entry-$entry_index"
done
entry_cap_output="$temporary_dir/entry-cap.out"
saved_entry_cap=$SMOKE_MAX_PREFLIGHT_ENTRIES
SMOKE_MAX_PREFLIGHT_ENTRIES=32
SMOKE_OVERALL_DEADLINE=$((SECONDS + 30))
if smoke_prepare_run_environment "$entry_cap_fixture" server \
  >"$entry_cap_output" 2>&1; then
  echo 'Smoke preflight accepted a runtime tree above its entry cap.' >&2
  exit 1
fi
SMOKE_MAX_PREFLIGHT_ENTRIES=$saved_entry_cap
if ! grep -Fq 'exceeds the 32-entry preflight limit' "$entry_cap_output"; then
  echo 'Smoke preflight entry-cap failure did not report its bounded rejection.' >&2
  exit 1
fi

hanging_find_bin="$temporary_dir/hanging-find-bin"
hanging_find_pids="$temporary_dir/hanging-find.pids"
hanging_find_fixture="$temporary_dir/hanging-find-fixture"
mkdir -p "$hanging_find_bin" "$hanging_find_fixture"
cat >"$hanging_find_bin/find" <<'SH'
#!/bin/sh
printf '%s %s\n' "$$" "$(awk '{ print $22 }' "/proc/$$/stat")" \
  >>"$SMOKE_HANGING_FIND_PIDS"
trap '' TERM INT
while :; do
  sleep 60
done
SH
chmod +x "$hanging_find_bin/find"
hanging_guard_bin="$temporary_dir/hanging-guard-bin"
mkdir -p "$hanging_guard_bin"
cat >"$hanging_guard_bin/grep" <<'SH'
#!/bin/sh
printf '%s %s\n' "$$" "$(awk '{ print $22 }' "/proc/$$/stat")" \
  >>"$SMOKE_HANGING_FIND_PIDS"
exec sleep 60
SH
chmod +x "$hanging_guard_bin/grep"
hanging_find_output="$temporary_dir/hanging-find.out"
saved_traversal_timeout=$SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=1
SMOKE_OVERALL_DEADLINE=$((SECONDS + 10))
hanging_find_started=$SECONDS
if PATH="$hanging_find_bin:$PATH" SMOKE_HANGING_FIND_PIDS="$hanging_find_pids" \
  smoke_prepare_run_environment "$hanging_find_fixture" server \
  >"$hanging_find_output" 2>&1; then
  echo 'Smoke preflight accepted a traversal that ignored termination.' >&2
  exit 1
fi
hanging_find_elapsed=$((SECONDS - hanging_find_started))
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=$saved_traversal_timeout
if ((hanging_find_elapsed > 3)); then
  echo "Bounded smoke traversal took ${hanging_find_elapsed}s after its 1s hard limit." >&2
  exit 1
fi
if ! grep -Fq 'tree scan exceeded its 1s deadline' "$hanging_find_output"; then
  echo 'Timed-out smoke traversal did not fail closed with a traversal error.' >&2
  exit 1
fi
while read -r hanging_find_pid hanging_find_starttime; do
  if smoke_pid_identity_matches "$hanging_find_pid" "$hanging_find_starttime" \
    && ! smoke_runner_has_exited "$hanging_find_pid"; then
    echo "Bounded smoke traversal left process $hanging_find_pid alive." >&2
    exit 1
  fi
done <"$hanging_find_pids"

hanging_validator_bin="$temporary_dir/hanging-validator-bin"
hanging_validator_counter="$temporary_dir/hanging-validator.count"
hanging_validator_pids="$temporary_dir/hanging-validator.pids"
hanging_validator_fixture="$temporary_dir/hanging-validator-fixture"
mkdir -p "$hanging_validator_bin" \
  "$hanging_validator_fixture/run/gradle-home"
: >"$hanging_validator_fixture/run/gradle-home/validator-entry"
cat >"$hanging_validator_bin/stat" <<'SH'
#!/bin/sh
invocation=0
if [ -f "$SMOKE_VALIDATOR_COUNTER" ]; then
  IFS= read -r invocation <"$SMOKE_VALIDATOR_COUNTER"
fi
invocation=$((invocation + 1))
printf '%s\n' "$invocation" >"$SMOKE_VALIDATOR_COUNTER"
if [ "$invocation" -eq 1 ]; then
  exec "$SMOKE_REAL_STAT" "$@"
fi
printf '%s %s\n' "$$" "$(awk '{ print $22 }' "/proc/$$/stat")" \
  >>"$SMOKE_VALIDATOR_PIDS"
trap '' TERM INT
while :; do
  sleep 60
done
SH
chmod +x "$hanging_validator_bin/stat"
hanging_validator_output="$temporary_dir/hanging-validator.out"
real_stat_command=$(type -P stat)
saved_traversal_timeout=$SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=1
SMOKE_OVERALL_DEADLINE=$((SECONDS + 10))
hanging_validator_started=$SECONDS
if PATH="$hanging_validator_bin:$PATH" \
  SMOKE_REAL_STAT="$real_stat_command" \
  SMOKE_VALIDATOR_COUNTER="$hanging_validator_counter" \
  SMOKE_VALIDATOR_PIDS="$hanging_validator_pids" \
  smoke_prepare_run_environment "$hanging_validator_fixture" server \
  >"$hanging_validator_output" 2>&1; then
  echo 'Smoke preflight accepted a validator that ignored termination.' >&2
  exit 1
fi
hanging_validator_elapsed=$((SECONDS - hanging_validator_started))
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=$saved_traversal_timeout
SMOKE_OVERALL_DEADLINE=$((SECONDS + SMOKE_OVERALL_TIMEOUT_SECONDS))
if ((hanging_validator_elapsed > 3)); then
  echo "Bounded smoke validator took ${hanging_validator_elapsed}s after its 1s hard limit." >&2
  exit 1
fi
if ! grep -Fq 'tree scan exceeded its 1s deadline' "$hanging_validator_output"; then
  echo 'Timed-out smoke validator did not fail closed at the complete-scan deadline.' >&2
  exit 1
fi
while read -r hanging_validator_pid hanging_validator_starttime; do
  if smoke_pid_identity_matches "$hanging_validator_pid" "$hanging_validator_starttime" \
    && ! smoke_runner_has_exited "$hanging_validator_pid"; then
    echo "Bounded smoke validator left process $hanging_validator_pid alive." >&2
    exit 1
  fi
done <"$hanging_validator_pids"

failing_find_bin="$temporary_dir/failing-find-bin"
failing_find_fixture="$temporary_dir/failing-find-fixture"
mkdir -p "$failing_find_bin" "$failing_find_fixture"
cat >"$failing_find_bin/find" <<'SH'
#!/bin/sh
exit 42
SH
chmod +x "$failing_find_bin/find"
failing_find_output="$temporary_dir/failing-find.out"
SMOKE_OVERALL_DEADLINE=$((SECONDS + 10))
if PATH="$failing_find_bin:$PATH" \
  smoke_validate_tree_without_links "$failing_find_fixture" \
  >"$failing_find_output" 2>&1; then
  echo 'Smoke tree scan accepted a producer failure.' >&2
  exit 1
fi
if ! grep -Fq 'tree producer could not traverse completely' "$failing_find_output"; then
  echo 'Smoke tree scan did not preserve producer-failure discrimination.' >&2
  exit 1
fi
SMOKE_OVERALL_DEADLINE=$((SECONDS + SMOKE_OVERALL_TIMEOUT_SECONDS))

forged_timeout_output="$temporary_dir/forged-timeout.out"
if (SMOKE_TIMEOUT_SUPERVISOR_ID=forged \
  smoke_enter_overall_timeout 1 /bin/true) >"$forged_timeout_output" 2>&1; then
  echo 'Smoke timeout entry accepted a forged ambient supervisor marker.' >&2
  exit 1
fi
if ! grep -Eq 'not bound to the direct supervising process|not backed by the expected supervisor' \
  "$forged_timeout_output"; then
  echo 'Forged smoke timeout marker did not fail closed at the trust boundary.' >&2
  exit 1
fi

wrong_duration_helper="$temporary_dir/wrong-duration-helper.sh"
cat >"$wrong_duration_helper" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
source "$SMOKE_FORGERY_LIB"
timeout_command=$(type -P timeout)
export SMOKE_TIMEOUT_SUPERVISOR_ID
SMOKE_TIMEOUT_SUPERVISOR_ID=$(stat -Lc '%d:%i' -- "$timeout_command")
export SMOKE_TIMEOUT_SUPERVISOR_PID=$PPID
export SMOKE_TIMEOUT_SUPERVISOR_STARTTIME
SMOKE_TIMEOUT_SUPERVISOR_STARTTIME=$(smoke_process_starttime "$PPID")
smoke_enter_overall_timeout 1 "$0"
echo 'WRONG_DURATION_ACCEPTED'
SH
chmod +x "$wrong_duration_helper"
wrong_duration_output="$temporary_dir/wrong-duration.out"
timeout_command=$(type -P timeout)
if SMOKE_FORGERY_LIB="$script_dir/smoke-guard-lib.sh" \
  "$timeout_command" --signal=TERM \
  --kill-after="${SMOKE_OVERALL_TIMEOUT_KILL_AFTER_SECONDS}s" \
  5s "$wrong_duration_helper" >"$wrong_duration_output" 2>&1; then
  echo 'Smoke timeout entry accepted a real supervisor with the wrong duration.' >&2
  exit 1
fi
if grep -Fq 'WRONG_DURATION_ACCEPTED' "$wrong_duration_output" \
  || ! grep -Fq 'parent argv does not match the exact reviewed command' \
    "$wrong_duration_output"; then
  echo 'Wrong-duration real timeout was not rejected by exact argv validation.' >&2
  exit 1
fi

timeout_identity_helper="$temporary_dir/timeout-identity-helper.sh"
cat >"$timeout_identity_helper" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
source "$SMOKE_FORGERY_LIB"
smoke_enter_overall_timeout 5 "$0"
echo 'TIMEOUT_IDENTITY_VERIFIED'
SH
chmod +x "$timeout_identity_helper"
for ((identity_iteration = 0; identity_iteration < 25; identity_iteration++)); do
  identity_output=$(SMOKE_FORGERY_LIB="$script_dir/smoke-guard-lib.sh" \
    "$timeout_identity_helper")
  if [[ "$identity_output" != TIMEOUT_IDENTITY_VERIFIED ]]; then
    echo "Smoke timeout PID/starttime handshake failed at iteration $identity_iteration." >&2
    exit 1
  fi
done
if ! grep -Fq 'supervisor_pid=$BASHPID' "$script_dir/smoke-guard-lib.sh" \
  || ! grep -Fq 'smoke_process_starttime "$supervisor_pid"' \
    "$script_dir/smoke-guard-lib.sh"; then
  echo 'Smoke timeout identity capture can regress to command-substitution BASHPID.' >&2
  exit 1
fi

SMOKE_OVERALL_DEADLINE=$((SECONDS + SMOKE_OVERALL_TIMEOUT_SECONDS))

fallback_bin="$temporary_dir/fallback-bin"
fake_java_home="$temporary_dir/fake-java-home"
mkdir -p "$fallback_bin" "$fake_java_home/bin"
for command_name in uname xargs sed tr; do
  ln -s "$(command -v "$command_name")" "$fallback_bin/$command_name"
done
ln -s /usr/bin/echo "$fallback_bin/echo"
ln -s "$(command -v shasum)" "$fallback_bin/shasum"
cat >"$fake_java_home/bin/java" <<'SH'
#!/bin/sh
: >"$FAKE_JAVA_MARKER"
SH
chmod +x "$fake_java_home/bin/java"
fallback_marker="$temporary_dir/fallback-java-invoked"
FAKE_JAVA_MARKER="$fallback_marker" JAVA_HOME="$fake_java_home" PATH="$fallback_bin" \
  "$fixture/gradlew" --version
if [[ ! -f "$fallback_marker" ]]; then
  echo 'POSIX wrapper did not reach Java after the shasum fallback verified its JAR.' >&2
  exit 1
fi

bad_fallback_bin="$temporary_dir/bad-fallback-bin"
mkdir -p "$bad_fallback_bin"
for command_name in uname xargs sed tr; do
  ln -s "$(command -v "$command_name")" "$bad_fallback_bin/$command_name"
done
ln -s /usr/bin/echo "$bad_fallback_bin/echo"
cat >"$bad_fallback_bin/shasum" <<'SH'
#!/bin/sh
printf '%064d  ignored\n' 0
SH
chmod +x "$bad_fallback_bin/shasum"
bad_fallback_marker="$temporary_dir/bad-fallback-java-invoked"
if bad_fallback_output=$(FAKE_JAVA_MARKER="$bad_fallback_marker" JAVA_HOME="$fake_java_home" \
  PATH="$bad_fallback_bin" "$fixture/gradlew" --version 2>&1); then
  echo 'POSIX wrapper accepted a mismatched shasum digest.' >&2
  exit 1
fi
if [[ -f "$bad_fallback_marker" ]] \
  || ! grep -Fq 'checksum is not the reviewed Gradle 9.2.1 checksum' <<<"$bad_fallback_output"; then
  echo 'POSIX wrapper checksum mismatch did not fail closed before Java.' >&2
  exit 1
fi

client_log="$temporary_dir/client.log"
client_sentinel="$temporary_dir/client.ready"
client_nonce='phase0-client-test-nonce'
cat >"$client_log" <<'LOG'
BASIC_CONTENT_FIXTURE_LOADED
Backend library: LWJGL version test
OpenAL initialized on device test
Sound engine started
Created: 1024x1024x4 minecraft:textures/atlas/blocks.png-atlas
LOG
if smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce"; then
  echo 'Client readiness accepted a missing sentinel.' >&2
  exit 1
fi
printf '%s\n' 'stale-client-nonce' >"$client_sentinel"
if smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce"; then
  echo 'Client readiness accepted a stale sentinel nonce.' >&2
  exit 1
fi
printf '%s\n' "$client_nonce" >"$client_sentinel"
smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce"
cat >"$client_log" <<'LOG'
FABRIC_EMPTY_FIXTURE_LOADED
Backend library: LWJGL version test
Using graphics backend OpenGL, using drivers: test
Using graphics device: test
LOG
smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce" \
  FABRIC_EMPTY_FIXTURE_LOADED fabric
cat >"$client_log" <<'LOG'
FABRIC_1_20_1_FIXTURE_LOADED
Backend library: LWJGL version test
OpenAL initialized test
Sound engine started test
Created: 16x16x0 test-atlas
LOG
smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce" \
  FABRIC_1_20_1_FIXTURE_LOADED full
printf '%s' "$client_nonce" >"$client_sentinel"
if smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce"; then
  echo 'Client readiness accepted a sentinel without its exact trailing newline.' >&2
  exit 1
fi
printf '%0130d\n' 0 >"$client_sentinel"
if smoke_client_ready "$client_log" "$client_sentinel" "$client_nonce"; then
  echo 'Client readiness accepted an oversized sentinel.' >&2
  exit 1
fi

server_log="$temporary_dir/server.log"
server_sentinel="$temporary_dir/server.ready"
server_nonce='phase0-server-test-nonce'
: >"$server_log"
if smoke_server_ready "$server_log" "$server_sentinel" "$server_nonce"; then
  echo 'Server readiness accepted a missing sentinel.' >&2
  exit 1
fi
printf '%s\n' 'stale-server-nonce' >"$server_sentinel"
if smoke_server_ready "$server_log" "$server_sentinel" "$server_nonce"; then
  echo 'Server readiness accepted a stale sentinel nonce.' >&2
  exit 1
fi
printf '%s\n' "$server_nonce" >"$server_sentinel"
smoke_server_ready "$server_log" "$server_sentinel" "$server_nonce"
echo 'Server sentinel readiness accepted a valid nonce with an empty console.'
printf '%s' "$server_nonce" >"$server_sentinel"
if smoke_server_ready "$server_log" "$server_sentinel" "$server_nonce"; then
  echo 'Server readiness accepted a sentinel without its exact trailing newline.' >&2
  exit 1
fi
printf '%0130d\n' 0 >"$server_sentinel"
if smoke_server_ready "$server_log" "$server_sentinel" "$server_nonce"; then
  echo 'Server readiness accepted an oversized sentinel.' >&2
  exit 1
fi

if [[ $(grep -Fc 'smoke_remove_prepared_entry "$readiness_sentinel" regular' \
  "$script_dir/smoke-dedicated-server.sh") -ne 2 \
  || $(grep -Fc 'smoke_remove_prepared_entry "$readiness_sentinel_temp" regular' \
  "$script_dir/smoke-dedicated-server.sh") -ne 2 ]]; then
  echo 'Dedicated-server smoke must safely remove both sentinels before and after its run.' >&2
  exit 1
fi
if ! grep -Fq 'PHASE0_SMOKE_SERVER_NONCE="$readiness_nonce"' \
  "$script_dir/smoke-dedicated-server.sh"; then
  echo 'Dedicated-server smoke did not bind its owned nonce to the server process.' >&2
  exit 1
fi
if ! grep -Fq 'event.getServer().halt(false);' \
  "$fixture/src/main/java/dev/mcdev/fixture/basiccontent/BasicContentMod.java"; then
  echo 'Dedicated-server fixture does not request nonce-bound graceful shutdown after readiness.' >&2
  exit 1
fi

for smoke_script in "$script_dir/smoke-dedicated-server.sh" \
  "$script_dir/smoke-client-ci.sh"; do
  supervisor_line=$(grep -n 'smoke_enter_overall_timeout' "$smoke_script" \
    | head -n 1 | cut -d: -f1)
  prepare_line=$(grep -n 'smoke_prepare_run_environment' "$smoke_script" | head -n 1 | cut -d: -f1)
  trap_line=$(grep -Fn "trap 'cleanup \$?' EXIT" "$smoke_script" | cut -d: -f1)
  if [[ -z "$supervisor_line" || -z "$prepare_line" || -z "$trap_line" \
    || "$supervisor_line" -ge "$trap_line" || "$trap_line" -ge "$prepare_line" ]]; then
    echo "Smoke supervisor and cleanup trap must precede path preparation: $smoke_script" >&2
    exit 1
  fi
  if ! grep -Fq 'deadline=$SMOKE_OVERALL_DEADLINE' "$smoke_script" \
    || grep -Fq 'deadline=$((SECONDS + timeout_seconds))' "$smoke_script"; then
    echo "Smoke runtime loop reset instead of consuming the overall deadline: $smoke_script" >&2
    exit 1
  fi
  grep -Fq 'smoke_assert_no_nonce_processes "$lifecycle_marker" "$readiness_nonce"' \
    "$smoke_script"
done

overall_timeout_output="$temporary_dir/overall-timeout.out"
overall_timeout_started=$SECONDS
overall_timeout_status=0
PATH="$hanging_guard_bin:$PATH" SMOKE_HANGING_FIND_PIDS="$hanging_find_pids" \
  PHASE0_SMOKE_TIMEOUT_SECONDS=2 "$script_dir/smoke-dedicated-server.sh" \
  >"$overall_timeout_output" 2>&1 || overall_timeout_status=$?
overall_timeout_elapsed=$((SECONDS - overall_timeout_started))
if ((overall_timeout_status != 124)); then
  sed -n '1,120p' "$overall_timeout_output" >&2
  echo "Overall smoke supervisor returned $overall_timeout_status instead of timeout status 124." >&2
  exit 1
fi
if ((overall_timeout_elapsed > 5)); then
  echo "Overall 2s smoke deadline took ${overall_timeout_elapsed}s to stop preflight." >&2
  exit 1
fi
while read -r hanging_find_pid hanging_find_starttime; do
  if smoke_pid_identity_matches "$hanging_find_pid" "$hanging_find_starttime" \
    && ! smoke_runner_has_exited "$hanging_find_pid"; then
    echo "Overall smoke timeout left preflight process $hanging_find_pid alive." >&2
    exit 1
  fi
done <"$hanging_find_pids"

benign_client_error_log="$temporary_dir/benign-client-error.log"
cat >"$benign_client_error_log" <<'LOG'
[Render thread/ERROR] [com.mojang.text2speech.Narrator/]: Error while loading the narrator
com.mojang.text2speech.Narrator$InitializeException: Failed to load library flite
Caused by: java.lang.UnsatisfiedLinkError: libflite.so: cannot open shared object file
LOG
if smoke_client_fatal "$benign_client_error_log"; then
  echo 'Client fatal-error guard rejected the known non-fatal narrator fallback.' >&2
  exit 1
fi

fatal_client_log="$temporary_dir/fatal-client.log"
printf '%s\n' 'We are unable to initialize the graphics system. glfwInit failed.' >"$fatal_client_log"
smoke_client_fatal "$fatal_client_log"
printf '%s\n' 'java.lang.IllegalStateException: Failed to open OpenAL device' >"$fatal_client_log"
smoke_client_fatal "$fatal_client_log"
printf '%s\n' 'ERROR StatusConsoleListener Unable to parse configuration' >"$fatal_client_log"
smoke_client_fatal "$fatal_client_log"

fatal_server_log="$temporary_dir/fatal-server.log"
printf '%s\n' 'Failed to start the minecraft server' >"$fatal_server_log"
smoke_server_fatal "$fatal_server_log"
printf '%s\n' 'ERROR StatusLogger No logging configuration' >"$fatal_server_log"
smoke_server_fatal "$fatal_server_log"

limit_log="$temporary_dir/limit.log"
truncate -s 4095 "$limit_log"
if smoke_log_limit_reached "$limit_log" 4096; then
  echo 'Log-size guard fired below its byte limit.' >&2
  exit 1
fi
truncate -s 4096 "$limit_log"
smoke_log_limit_reached "$limit_log" 4096

diagnostic_run_dir="$temporary_dir/diagnostic-run"
diagnostic_logs_dir="$diagnostic_run_dir/logs"
mkdir -p "$diagnostic_logs_dir/empty/nested/directories"
if smoke_runtime_diagnostics_present "$diagnostic_run_dir"; then
  echo 'Empty nested runtime log directories were treated as diagnostics.' >&2
  exit 1
fi

diagnostic_hang_output="$temporary_dir/diagnostic-hang.out"
saved_traversal_timeout=$SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=1
SMOKE_OVERALL_DEADLINE=$((SECONDS + 10))
diagnostic_hang_started=$SECONDS
if ! PATH="$hanging_find_bin:$PATH" SMOKE_HANGING_FIND_PIDS="$hanging_find_pids" \
  smoke_runtime_diagnostics_present "$diagnostic_run_dir" \
  >"$diagnostic_hang_output" 2>&1; then
  echo 'Runtime diagnostic scan did not fail closed on a hanging traversal.' >&2
  exit 1
fi
diagnostic_hang_elapsed=$((SECONDS - diagnostic_hang_started))
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=$saved_traversal_timeout
SMOKE_OVERALL_DEADLINE=$((SECONDS + SMOKE_OVERALL_TIMEOUT_SECONDS))
if ((diagnostic_hang_elapsed > 4)); then
  echo "Runtime diagnostic traversal took ${diagnostic_hang_elapsed}s after its 1s limit." >&2
  exit 1
fi
while read -r hanging_find_pid hanging_find_starttime; do
  if smoke_pid_identity_matches "$hanging_find_pid" "$hanging_find_starttime" \
    && ! smoke_runner_has_exited "$hanging_find_pid"; then
    echo "Runtime diagnostic timeout left process $hanging_find_pid alive." >&2
    exit 1
  fi
done <"$hanging_find_pids"

: >"$diagnostic_logs_dir/latest.log"
smoke_runtime_diagnostics_present "$diagnostic_run_dir"
rm -f -- "$diagnostic_logs_dir/latest.log"

diagnostic_newline_file="$diagnostic_logs_dir/line"$'\n'"break.log"
: >"$diagnostic_newline_file"
smoke_runtime_diagnostics_present "$diagnostic_run_dir"
rm -f -- "$diagnostic_newline_file"

diagnostic_external_dir="$temporary_dir/diagnostic-external"
mkdir -p "$diagnostic_external_dir"
ln -s "$diagnostic_external_dir" "$diagnostic_logs_dir/empty/nested/escape"
smoke_runtime_diagnostics_present "$diagnostic_run_dir" 2>/dev/null
rm -f -- "$diagnostic_logs_dir/empty/nested/escape"

mkfifo "$diagnostic_logs_dir/empty/nested/diagnostic.pipe"
smoke_runtime_diagnostics_present "$diagnostic_run_dir" 2>/dev/null
rm -f -- "$diagnostic_logs_dir/empty/nested/diagnostic.pipe"

diagnostic_socket="$diagnostic_logs_dir/empty/nested/diagnostic.socket"
python3 - "$diagnostic_socket" <<'PY'
import socket
import sys

with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
    listener.bind(sys.argv[1])
PY
smoke_runtime_diagnostics_present "$diagnostic_run_dir" 2>/dev/null
rm -f -- "$diagnostic_socket"

diagnostic_device="$diagnostic_logs_dir/empty/nested/diagnostic.device"
if command -v mknod >/dev/null 2>&1 \
  && mknod -m 0600 "$diagnostic_device" c 1 3 2>/dev/null; then
  smoke_runtime_diagnostics_present "$diagnostic_run_dir" 2>/dev/null
  rm -f -- "$diagnostic_device"
else
  if smoke_path_exists "$diagnostic_device"; then
    echo 'Failed device-node probe left an unexpected filesystem entry.' >&2
    exit 1
  fi
  echo 'Device-node diagnostic regression skipped: mknod capability unavailable.'
fi

mkdir -p "$diagnostic_logs_dir/hidden"
: >"$diagnostic_logs_dir/hidden/crash-report.txt"
chmod 000 "$diagnostic_logs_dir/hidden"
smoke_runtime_diagnostics_present "$diagnostic_run_dir" 2>/dev/null
chmod 700 "$diagnostic_logs_dir/hidden"
rm -rf -- "$diagnostic_logs_dir"
: >"$diagnostic_logs_dir"
smoke_runtime_diagnostics_present "$diagnostic_run_dir"
rm -f -- "$diagnostic_logs_dir"

cleanup_log="$temporary_dir/cleanup.log"
setsid bash -c 'trap "exit 0" TERM INT; sleep 60 & wait' >"$cleanup_log" 2>&1 &
cleanup_pid=$!
sleep 0.2
smoke_process_group_alive "$cleanup_pid"
smoke_cleanup_process_group "$cleanup_pid" 2
if smoke_process_group_alive "$cleanup_pid"; then
  echo 'Process-group cleanup left a child alive.' >&2
  exit 1
fi

smoke_require_process_tracking
identity_pid=''
sleep 60 &
identity_pid=$!
identity_starttime=$(smoke_process_starttime "$identity_pid")
smoke_signal_pid_if_identity_matches \
  "$identity_pid" "$((identity_starttime + 1))" TERM
if ! kill -0 "$identity_pid" 2>/dev/null; then
  echo 'Logger identity guard signalled a PID with a mismatched starttime.' >&2
  exit 1
fi
kill -TERM "$identity_pid"
wait "$identity_pid" 2>/dev/null || true
identity_pid=''

natural_nonce="phase0-server-natural-${BASHPID}-${RANDOM}"
env PHASE0_SMOKE_SERVER_NONCE="$natural_nonce" setsid bash -c 'sleep 0.3' &
natural_pid=$!
smoke_wait_for_nonce_registration PHASE0_SMOKE_SERVER_NONCE "$natural_nonce" 2
smoke_wait_for_owned_run_exit \
  "$natural_pid" PHASE0_SMOKE_SERVER_NONCE "$natural_nonce" 5
smoke_assert_no_nonce_processes PHASE0_SMOKE_SERVER_NONCE "$natural_nonce"

unrelated_pid=''
lifecycle_pid=''
lifecycle_nonce="phase0-client-escaped-${BASHPID}-${RANDOM}"
sleep 60 &
unrelated_pid=$!
env PHASE0_SMOKE_CLIENT_NONCE="$lifecycle_nonce" \
  setsid bash -c 'setsid sleep 60 & wait' &
lifecycle_pid=$!
smoke_wait_for_nonce_registration PHASE0_SMOKE_CLIENT_NONCE "$lifecycle_nonce" 2
smoke_terminate_owned_run \
  "$lifecycle_pid" PHASE0_SMOKE_CLIENT_NONCE "$lifecycle_nonce" 2
lifecycle_pid=''
smoke_assert_no_nonce_processes PHASE0_SMOKE_CLIENT_NONCE "$lifecycle_nonce"
sleep 1
smoke_assert_no_nonce_processes PHASE0_SMOKE_CLIENT_NONCE "$lifecycle_nonce"
if ! kill -0 "$unrelated_pid" 2>/dev/null; then
  echo 'Nonce lifecycle cleanup signalled an unrelated process.' >&2
  exit 1
fi
kill -TERM "$unrelated_pid"
wait "$unrelated_pid" 2>/dev/null || true
unrelated_pid=''

timeout_log="$temporary_dir/timeout.log"
setsid sleep 60 >"$timeout_log" 2>&1 &
timeout_pid=$!
deadline=$((SECONDS + 1))
while ((SECONDS < deadline)); do
  sleep 0.1
done
smoke_cleanup_process_group "$timeout_pid" 2
if smoke_process_group_alive "$timeout_pid"; then
  echo 'Hard-timeout cleanup left its process group alive.' >&2
  exit 1
fi

capped_log="$temporary_dir/capped.log"
capped_pipe="$temporary_dir/capped.pipe"
cap_bytes=8192
smoke_start_capped_log "$capped_pipe" "$capped_log" "$cap_bytes"
capped_logger_pid=$SMOKE_CAPPED_LOG_PID
(
  exec setsid bash -c 'while :; do printf "0123456789abcdef0123456789abcdef\n"; done'
) >"$capped_pipe" 2>&1 &
capped_pid=$!
for _ in {1..50}; do
  smoke_log_limit_reached "$capped_log" "$cap_bytes" && break
  smoke_process_group_alive "$capped_pid" || break
  sleep 0.1
done
smoke_cleanup_process_group "$capped_pid" 2
smoke_cleanup_capped_log "$capped_logger_pid" "$capped_pipe"
capped_size=$(wc -c <"$capped_log")
if ((capped_size > cap_bytes)); then
  echo "Capped logger allowed ${capped_size} bytes (cap ${cap_bytes})." >&2
  exit 1
fi
if ((capped_size < cap_bytes)); then
  echo "Capped logger was not exercised (${capped_size}/${cap_bytes} bytes)." >&2
  exit 1
fi
mv -- "$capped_log" "$capped_log.original"
: >"$capped_log"
smoke_log_limit_reached "$capped_log" "$cap_bytes" 2>/dev/null
rm -f -- "$capped_log"
smoke_log_limit_reached "$capped_log" "$cap_bytes" 2>/dev/null
mv -- "$capped_log.original" "$capped_log"

oversized_log="$temporary_dir/oversized-event.log"
oversized_pipe="$temporary_dir/oversized-event.pipe"
oversized_cap_bytes=4096
smoke_start_capped_log "$oversized_pipe" "$oversized_log" "$oversized_cap_bytes"
oversized_logger_pid=$SMOKE_CAPPED_LOG_PID
(
  exec setsid bash -c 'event=$(printf "%16384s" ""); printf "%s\n" "${event// /X}"'
) >"$oversized_pipe" 2>&1 &
oversized_pid=$!
for _ in {1..50}; do
  smoke_log_limit_reached "$oversized_log" "$oversized_cap_bytes" && break
  smoke_process_group_alive "$oversized_pid" || break
  sleep 0.1
done
smoke_cleanup_process_group "$oversized_pid" 2
smoke_cleanup_capped_log "$oversized_logger_pid" "$oversized_pipe"
oversized_size=$(wc -c <"$oversized_log")
if ((oversized_size != oversized_cap_bytes)); then
  echo "One oversized event produced ${oversized_size} bytes (cap ${oversized_cap_bytes})." >&2
  exit 1
fi

echo 'Smoke guard self-tests passed.'
