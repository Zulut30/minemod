#!/usr/bin/env bash

SMOKE_GUARD_LIB_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SMOKE_GUARD_LIB_PATH="$SMOKE_GUARD_LIB_DIR/smoke-guard-lib.sh"
SMOKE_MAX_NONCE_PROCESSES=64
SMOKE_MAX_PREFLIGHT_ENTRIES=100000
SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS=30
SMOKE_OVERALL_TIMEOUT_MAX_SECONDS=180
SMOKE_OVERALL_TIMEOUT_KILL_AFTER_SECONDS=20
SMOKE_TIMEOUT_PARENT_CMDLINE_MAX_BYTES=65536
SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS=10
SMOKE_TREE_SCAN_PRODUCER_FAILURE_STATUS=20
SMOKE_TREE_SCAN_VALIDATOR_FAILURE_STATUS=21

smoke_assert_timeout_parent_argv() {
  local parent_pid=$1
  shift

  if [[ ! "$parent_pid" =~ ^[1-9][0-9]*$ ]]; then
    echo 'Smoke timeout parent PID is invalid.' >&2
    return 1
  fi
  python3 - "$parent_pid" "$SMOKE_TIMEOUT_PARENT_CMDLINE_MAX_BYTES" "$@" <<'PY'
import os
import sys
from pathlib import Path

parent_pid = sys.argv[1]
max_bytes = int(sys.argv[2])
expected = b"\0".join(os.fsencode(value) for value in sys.argv[3:]) + b"\0"
if len(expected) > max_bytes:
    raise SystemExit("Expected smoke timeout argv exceeds its review limit")
with (Path("/proc") / parent_pid / "cmdline").open("rb") as stream:
    observed = stream.read(max_bytes + 1)
if len(observed) > max_bytes:
    raise SystemExit("Smoke timeout parent argv exceeds its review limit")
if observed != expected:
    raise SystemExit("Smoke timeout parent argv does not match the exact reviewed command")
PY
}

smoke_enter_overall_timeout() {
  local requested_seconds=$1
  local script_path=$2
  shift 2
  local timeout_command
  local timeout_identity
  local parent_timeout_identity
  local parent_timeout_starttime
  local supervisor_pid
  local supervisor_starttime
  local -a expected_parent_argv

  if [[ ! "$requested_seconds" =~ ^[1-9][0-9]*$ ]] \
    || ((requested_seconds > SMOKE_OVERALL_TIMEOUT_MAX_SECONDS)); then
    echo "Smoke timeout must be between 1 and ${SMOKE_OVERALL_TIMEOUT_MAX_SECONDS} seconds." >&2
    return 64
  fi
  timeout_command=$(type -P timeout) || {
    echo 'GNU timeout is required for the overall smoke deadline.' >&2
    return 1
  }
  timeout_identity=$(stat -Lc '%d:%i' -- "$timeout_command") || return
  expected_parent_argv=(
    "$timeout_command"
    --signal=TERM
    "--kill-after=${SMOKE_OVERALL_TIMEOUT_KILL_AFTER_SECONDS}s"
    "${requested_seconds}s"
    "$script_path"
    "$@"
  )

  if [[ -z "${SMOKE_TIMEOUT_SUPERVISOR_ID:-}" ]]; then
    # Capture BASHPID before command substitution: BASHPID evaluated inside
    # $(...) identifies that subshell, not this soon-to-be-exec'd supervisor.
    supervisor_pid=$BASHPID
    supervisor_starttime=$(smoke_process_starttime "$supervisor_pid") || {
      echo 'Smoke timeout wrapper could not capture its process identity.' >&2
      return 1
    }
    export SMOKE_TIMEOUT_SUPERVISOR_ID=$timeout_identity
    export SMOKE_TIMEOUT_SUPERVISOR_PID=$supervisor_pid
    export SMOKE_TIMEOUT_SUPERVISOR_STARTTIME=$supervisor_starttime
    exec "${expected_parent_argv[@]}"
  fi

  if [[ ! "${SMOKE_TIMEOUT_SUPERVISOR_PID:-}" =~ ^[1-9][0-9]*$ \
    || ! "${SMOKE_TIMEOUT_SUPERVISOR_STARTTIME:-}" =~ ^[0-9]+$ \
    || "$PPID" != "$SMOKE_TIMEOUT_SUPERVISOR_PID" ]]; then
    echo 'Smoke timeout marker is not bound to the direct supervising process.' >&2
    return 1
  fi
  parent_timeout_identity=$(stat -Lc '%d:%i' -- "/proc/$PPID/exe") || {
    echo 'Smoke timeout child could not verify its supervising process.' >&2
    return 1
  }
  parent_timeout_starttime=$(smoke_process_starttime "$PPID") || {
    echo 'Smoke timeout child could not verify supervisor starttime.' >&2
    return 1
  }
  if [[ "$SMOKE_TIMEOUT_SUPERVISOR_ID" != "$timeout_identity" ]]; then
    echo 'Smoke timeout marker executable identity does not match reviewed timeout.' >&2
    return 1
  fi
  if [[ "$parent_timeout_identity" != "$timeout_identity" ]]; then
    echo 'Smoke timeout parent executable identity does not match reviewed timeout.' >&2
    return 1
  fi
  if [[ "$parent_timeout_starttime" != "$SMOKE_TIMEOUT_SUPERVISOR_STARTTIME" ]]; then
    echo 'Smoke timeout parent starttime changed across the supervisor exec.' >&2
    return 1
  fi
  smoke_assert_timeout_parent_argv "$PPID" "${expected_parent_argv[@]}" || return
  unset SMOKE_TIMEOUT_SUPERVISOR_ID SMOKE_TIMEOUT_SUPERVISOR_PID \
    SMOKE_TIMEOUT_SUPERVISOR_STARTTIME

  SMOKE_OVERALL_DEADLINE=$((SECONDS + requested_seconds))
}

smoke_deadline_seconds_remaining() {
  local remaining

  if [[ ! "${SMOKE_OVERALL_DEADLINE:-}" =~ ^[0-9]+$ ]]; then
    echo 'Overall smoke deadline has not been initialized.' >&2
    return 1
  fi
  remaining=$((SMOKE_OVERALL_DEADLINE - SECONDS))
  if ((remaining <= 0)); then
    echo 'Overall smoke deadline expired.' >&2
    return 1
  fi
  SMOKE_DEADLINE_SECONDS_REMAINING=$remaining
}

smoke_path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

smoke_directory_identity() {
  stat -Lc '%d:%i' -- "$1"
}

smoke_device_id() {
  stat -Lc '%d' -- "$1"
}

smoke_regular_link_count() {
  stat -Lc '%h' -- "$1"
}

smoke_process_starttime() {
  local pid=$1
  local stat_line
  local -a stat_fields

  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r stat_line 2>/dev/null <"/proc/$pid/stat" || return 1
  stat_line=${stat_line##*) }
  read -r -a stat_fields <<<"$stat_line"
  ((${#stat_fields[@]} >= 20)) || return 1
  printf '%s\n' "${stat_fields[19]}"
}

smoke_signal_pid_if_identity_matches() {
  local pid=$1
  local expected_starttime=$2
  local signal_name=$3
  local current_starttime

  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 64
  [[ "$expected_starttime" =~ ^[0-9]+$ ]] || return 64
  [[ "$signal_name" == TERM || "$signal_name" == KILL ]] || return 64
  current_starttime=$(smoke_process_starttime "$pid") || return 0
  if [[ "$current_starttime" == "$expected_starttime" ]]; then
    # This starttime re-check narrows PID reuse, but only pidfd signalling would
    # make the identity-check-to-signal transition atomic.
    kill -s "$signal_name" -- "$pid" 2>/dev/null || true
  fi
}

smoke_pid_identity_matches() {
  local pid=$1
  local expected_starttime=$2
  local current_starttime

  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$expected_starttime" =~ ^[0-9]+$ ]] || return 1
  current_starttime=$(smoke_process_starttime "$pid") || return 1
  [[ "$current_starttime" == "$expected_starttime" ]]
}

smoke_assert_no_mountpoints_in_tree() {
  local root=$1

  if [[ ! -r /proc/self/mountinfo ]]; then
    echo 'Linux mountinfo access is required for smoke path containment.' >&2
    return 1
  fi
  python3 - "$root" <<'PY'
import os
import re
import sys
from pathlib import Path

tree_root = os.path.normpath(sys.argv[1])
octal_escape = re.compile(r"\\([0-7]{3})")

def decode_mount_path(value: str) -> str:
    return octal_escape.sub(lambda match: chr(int(match.group(1), 8)), value)

for line in Path("/proc/self/mountinfo").read_text(
    encoding="utf-8", errors="surrogateescape"
).splitlines():
    fields = line.split()
    if len(fields) < 6:
        raise SystemExit("Malformed /proc/self/mountinfo record")
    mountpoint = os.path.normpath(decode_mount_path(fields[4]))
    if mountpoint == tree_root or mountpoint.startswith(tree_root + os.sep):
        raise SystemExit(f"Smoke runtime tree contains a mountpoint: {mountpoint}")
PY
}

smoke_assert_directory_chain() {
  local path=${1%/}
  local current=''
  local component
  local -a components

  if [[ "$path" != /* || "$path" == *'/../'* || "$path" == */.. \
    || "$path" == *'/./'* || "$path" == */. ]]; then
    echo "Smoke path is not canonical and absolute: $1" >&2
    return 64
  fi
  IFS='/' read -r -a components <<<"${path#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="$current/$component"
    if [[ -L "$current" ]]; then
      echo "Smoke path component must not be a symbolic link: $current" >&2
      return 1
    fi
    if [[ ! -d "$current" ]]; then
      echo "Smoke path component must be an existing directory: $current" >&2
      return 1
    fi
  done
}

smoke_assert_owned_directory() {
  local path=$1

  if [[ -L "$path" || ! -d "$path" ]]; then
    echo "Smoke directory must be a real directory: $path" >&2
    return 1
  fi
  if [[ ! -O "$path" ]]; then
    echo "Smoke directory must be owned by the current user: $path" >&2
    return 1
  fi
}

smoke_assert_contained_directory() {
  local fixture_root=$1
  local path=$2
  local canonical

  smoke_assert_directory_chain "$path" || return
  smoke_assert_owned_directory "$path" || return
  canonical=$(cd -- "$path" && pwd -P)
  if [[ "$canonical" != "$path" ]]; then
    echo "Smoke directory is not canonical: $path" >&2
    return 1
  fi
  if [[ "$canonical" != "$fixture_root" && "$canonical" != "$fixture_root"/* ]]; then
    echo "Smoke directory escaped its canonical fixture root: $path" >&2
    return 1
  fi
}

smoke_ensure_child_directory() {
  local fixture_root=$1
  local parent=$2
  local child=$3
  local path

  if [[ ! "$child" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid smoke directory name: $child" >&2
    return 64
  fi
  smoke_assert_contained_directory "$fixture_root" "$parent" || return
  path="$parent/$child"
  if smoke_path_exists "$path"; then
    if [[ -L "$path" || ! -d "$path" ]]; then
      echo "Smoke path must be a real directory: $path" >&2
      return 1
    fi
  else
    mkdir -m 0700 -- "$path" || return
  fi
  smoke_assert_contained_directory "$fixture_root" "$path"
}

smoke_validate_regular_file() {
  local path=$1

  if [[ -L "$path" || ! -f "$path" ]]; then
    echo "Smoke managed file must be a real regular file: $path" >&2
    return 1
  fi
  if [[ ! -O "$path" ]]; then
    echo "Smoke managed file must be owned by the current user: $path" >&2
    return 1
  fi
  if [[ $(smoke_regular_link_count "$path") != 1 ]]; then
    echo "Smoke managed file must not have additional hard links: $path" >&2
    return 1
  fi
}

smoke_validate_fifo() {
  local path=$1

  if [[ -L "$path" || ! -p "$path" ]]; then
    echo "Smoke managed pipe must be a real FIFO: $path" >&2
    return 1
  fi
  if [[ ! -O "$path" ]]; then
    echo "Smoke managed pipe must be owned by the current user: $path" >&2
    return 1
  fi
}

smoke_validate_tree_entry_stream() {
  local root_device=$1
  local allowed_fifo=$2
  local max_entries=$3
  local detect_non_directory=${4:-0}
  local path
  local entry_count=0

  if [[ "$detect_non_directory" != 0 && "$detect_non_directory" != 1 ]]; then
    echo 'Smoke tree scan mode is invalid.' >&2
    return 64
  fi
  while IFS= read -r -d '' path; do
    ((entry_count += 1))
    if ((entry_count > max_entries)); then
      echo "Smoke runtime tree exceeds the ${max_entries}-entry preflight limit." >&2
      return 1
    fi
    if [[ -L "$path" ]]; then
      echo "Smoke runtime tree must not contain symbolic links: $path" >&2
      return 1
    fi
    if [[ ! -O "$path" ]]; then
      echo "Smoke runtime entry must be owned by the current user: $path" >&2
      return 1
    fi
    if [[ $(smoke_device_id "$path") != "$root_device" ]]; then
      echo "Smoke runtime tree crossed a filesystem boundary: $path" >&2
      return 1
    fi
    if [[ -d "$path" ]]; then
      continue
    fi
    if [[ -f "$path" ]]; then
      if [[ $(smoke_regular_link_count "$path") != 1 ]]; then
        echo "Smoke runtime file must not have additional hard links: $path" >&2
        return 1
      fi
      if ((detect_non_directory)); then
        return "$SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS"
      fi
      continue
    fi
    if [[ -n "$allowed_fifo" && "$path" == "$allowed_fifo" && -p "$path" ]]; then
      if ((detect_non_directory)); then
        return "$SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS"
      fi
      continue
    fi
    echo "Smoke runtime tree contains an unsupported entry type: $path" >&2
    return 1
  done
}

smoke_tree_scan_worker() {
  local root=$1
  local allowed_fifo=$2
  local root_device=$3
  local max_entries=$4
  local detect_non_directory=$5
  local -a pipeline_status

  if [[ ! "$root_device" =~ ^[0-9]+$ \
    || ! "$max_entries" =~ ^[1-9][0-9]*$ ]] \
    || [[ "$detect_non_directory" != 0 && "$detect_non_directory" != 1 ]]; then
    echo 'Smoke tree-scan worker received invalid bounds.' >&2
    return "$SMOKE_TREE_SCAN_VALIDATOR_FAILURE_STATUS"
  fi
  if find -P "$root" -xdev -mindepth 1 -print0 \
    | smoke_validate_tree_entry_stream "$root_device" "$allowed_fifo" \
      "$max_entries" "$detect_non_directory"; then
    pipeline_status=("${PIPESTATUS[@]}")
  else
    pipeline_status=("${PIPESTATUS[@]}")
  fi
  if ((detect_non_directory \
    && pipeline_status[1] == SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS)); then
    return "$SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS"
  fi
  if ((pipeline_status[1] != 0)); then
    return "$SMOKE_TREE_SCAN_VALIDATOR_FAILURE_STATUS"
  fi
  if ((pipeline_status[0] != 0)); then
    return "$SMOKE_TREE_SCAN_PRODUCER_FAILURE_STATUS"
  fi
}

smoke_scan_tree_without_links() {
  local root=$1
  local allowed_fifo=${2:-}
  local detect_non_directory=${3:-0}
  local root_device
  local scan_status
  local traversal_timeout

  if [[ "$detect_non_directory" != 0 && "$detect_non_directory" != 1 ]]; then
    echo 'Smoke tree scan mode is invalid.' >&2
    return 64
  fi
  smoke_assert_directory_chain "$root" || return
  smoke_assert_owned_directory "$root" || return
  root_device=$(smoke_device_id "$root") || return
  smoke_deadline_seconds_remaining || return
  traversal_timeout=$SMOKE_PREFLIGHT_TRAVERSAL_TIMEOUT_SECONDS
  if ((traversal_timeout > SMOKE_DEADLINE_SECONDS_REMAINING)); then
    traversal_timeout=$SMOKE_DEADLINE_SECONDS_REMAINING
  fi

  # This read-only validation boundary uses one hard process-group deadline.
  # KILL prevents a TERM-ignoring producer or per-entry validator from
  # outliving a worker shell that exits while handling the soft signal.
  if timeout --signal=KILL "${traversal_timeout}s" \
    "$BASH" "$SMOKE_GUARD_LIB_PATH" --tree-scan-worker \
    "$root" "$allowed_fifo" "$root_device" \
    "$SMOKE_MAX_PREFLIGHT_ENTRIES" "$detect_non_directory"; then
    scan_status=0
  else
    scan_status=$?
  fi
  if ((detect_non_directory \
    && scan_status == SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS)); then
    return "$SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS"
  fi
  case "$scan_status" in
    0)
      return 0
      ;;
    "$SMOKE_TREE_SCAN_PRODUCER_FAILURE_STATUS")
      echo "Smoke runtime tree producer could not traverse completely: $root" >&2
      ;;
    "$SMOKE_TREE_SCAN_VALIDATOR_FAILURE_STATUS")
      echo "Smoke runtime tree validation did not complete safely: $root" >&2
      ;;
    124 | 137)
      echo "Smoke runtime tree scan exceeded its ${traversal_timeout}s deadline: $root" >&2
      ;;
    *)
      echo "Smoke runtime tree scan failed with status $scan_status: $root" >&2
      ;;
  esac
  return 1
}

smoke_validate_tree_without_links() {
  smoke_scan_tree_without_links "$1" "${2:-}" 0
}

smoke_managed_entry_type() {
  local run_kind=$1
  local basename=$2

  case "$basename" in
    phase0-console.log | .phase0-client-ready | .phase0-client-ready.tmp \
      | .phase0-server-ready | .phase0-server-ready.tmp)
      printf '%s\n' regular
      ;;
    phase0-console.pipe)
      printf '%s\n' fifo
      ;;
    logs)
      printf '%s\n' directory
      ;;
    eula.txt | server.properties)
      [[ "$run_kind" == server ]] || return 1
      printf '%s\n' regular
      ;;
    *)
      return 1
      ;;
  esac
}

smoke_validate_optional_entry() {
  local path=$1
  local expected_type=$2

  smoke_path_exists "$path" || return 0
  if [[ -L "$path" ]]; then
    echo "Smoke managed entry must not be a symbolic link: $path" >&2
    return 1
  fi
  case "$expected_type" in
    regular)
      smoke_validate_regular_file "$path"
      ;;
    fifo)
      smoke_validate_fifo "$path"
      ;;
    directory)
      smoke_assert_owned_directory "$path" \
        && smoke_validate_tree_without_links "$path"
      ;;
    *)
      echo "Unknown smoke managed-entry type: $expected_type" >&2
      return 64
      ;;
  esac
}

smoke_prepare_run_environment() {
  local fixture=${1%/}
  local run_kind=$2
  local canonical_fixture
  local run_root
  local run_dir
  local path
  local basename
  local expected_type
  local -a managed_basenames

  SMOKE_RUN_PATHS_PREPARED=0
  if [[ "$run_kind" != server && "$run_kind" != client ]]; then
    echo "Unsupported smoke run kind: $run_kind" >&2
    return 64
  fi
  smoke_assert_directory_chain "$fixture" || return
  smoke_assert_owned_directory "$fixture" || return
  smoke_assert_no_mountpoints_in_tree "$fixture" || return
  canonical_fixture=$(cd -- "$fixture" && pwd -P)
  if [[ "$canonical_fixture" != "$fixture" ]]; then
    echo "Fixture must be addressed by its canonical path: $fixture" >&2
    return 1
  fi

  run_root="$fixture/run"
  run_dir="$run_root/$run_kind"
  for path in "$run_root" "$run_root/gradle-home" \
    "$run_root/project-cache" "$run_dir"; do
    if smoke_path_exists "$path" \
      && { [[ -L "$path" ]] || [[ ! -d "$path" ]]; }; then
      echo "Smoke path must be a real directory: $path" >&2
      return 1
    fi
  done

  smoke_ensure_child_directory "$canonical_fixture" "$canonical_fixture" run || return
  smoke_ensure_child_directory "$canonical_fixture" "$run_root" gradle-home || return
  smoke_ensure_child_directory "$canonical_fixture" "$run_root" project-cache || return
  smoke_ensure_child_directory "$canonical_fixture" "$run_root" "$run_kind" || return
  smoke_validate_tree_without_links "$run_root/gradle-home" || return
  smoke_validate_tree_without_links "$run_root/project-cache" || return
  smoke_validate_tree_without_links "$run_dir" "$run_dir/phase0-console.pipe" || return

  managed_basenames=(phase0-console.log phase0-console.pipe logs)
  if [[ "$run_kind" == server ]]; then
    managed_basenames+=(eula.txt server.properties .phase0-server-ready .phase0-server-ready.tmp)
  else
    managed_basenames+=(.phase0-client-ready .phase0-client-ready.tmp)
  fi
  for basename in "${managed_basenames[@]}"; do
    expected_type=$(smoke_managed_entry_type "$run_kind" "$basename") || return
    smoke_validate_optional_entry "$run_dir/$basename" "$expected_type" || return
  done

  SMOKE_PREPARED_FIXTURE_ROOT=$canonical_fixture
  SMOKE_PREPARED_RUN_ROOT=$run_root
  SMOKE_PREPARED_RUN_DIR=$run_dir
  SMOKE_PREPARED_RUN_KIND=$run_kind
  SMOKE_PREPARED_FIXTURE_ID=$(smoke_directory_identity "$canonical_fixture")
  SMOKE_PREPARED_RUN_ROOT_ID=$(smoke_directory_identity "$run_root")
  SMOKE_PREPARED_RUN_DIR_ID=$(smoke_directory_identity "$run_dir")
  SMOKE_PREPARED_GRADLE_HOME_ID=$(smoke_directory_identity "$run_root/gradle-home")
  SMOKE_PREPARED_PROJECT_CACHE_ID=$(smoke_directory_identity "$run_root/project-cache")
  SMOKE_RUN_PATHS_PREPARED=1
}

smoke_assert_prepared_environment() {
  local path
  local expected_identity
  local -a paths
  local -a identities

  if [[ ${SMOKE_RUN_PATHS_PREPARED:-0} != 1 ]]; then
    echo 'Smoke run paths have not passed fail-closed preparation.' >&2
    return 1
  fi
  paths=(
    "$SMOKE_PREPARED_FIXTURE_ROOT"
    "$SMOKE_PREPARED_RUN_ROOT"
    "$SMOKE_PREPARED_RUN_DIR"
    "$SMOKE_PREPARED_RUN_ROOT/gradle-home"
    "$SMOKE_PREPARED_RUN_ROOT/project-cache"
  )
  identities=(
    "$SMOKE_PREPARED_FIXTURE_ID"
    "$SMOKE_PREPARED_RUN_ROOT_ID"
    "$SMOKE_PREPARED_RUN_DIR_ID"
    "$SMOKE_PREPARED_GRADLE_HOME_ID"
    "$SMOKE_PREPARED_PROJECT_CACHE_ID"
  )
  for ((index = 0; index < ${#paths[@]}; index++)); do
    path=${paths[index]}
    expected_identity=${identities[index]}
    smoke_assert_directory_chain "$path" || return
    smoke_assert_owned_directory "$path" || return
    if [[ $(smoke_directory_identity "$path") != "$expected_identity" ]]; then
      echo "Prepared smoke directory identity changed: $path" >&2
      return 1
    fi
  done
  smoke_assert_no_mountpoints_in_tree "$SMOKE_PREPARED_FIXTURE_ROOT"
}

smoke_assert_managed_path() {
  local path=$1
  local expected_type=$2
  local basename
  local actual_type

  smoke_assert_prepared_environment || return
  if [[ "${path%/*}" != "$SMOKE_PREPARED_RUN_DIR" ]]; then
    echo "Smoke managed path escaped the prepared run directory: $path" >&2
    return 1
  fi
  basename=${path##*/}
  actual_type=$(smoke_managed_entry_type "$SMOKE_PREPARED_RUN_KIND" "$basename") || {
    echo "Path is not in the smoke managed-entry allowlist: $path" >&2
    return 1
  }
  if [[ "$actual_type" != "$expected_type" ]]; then
    echo "Smoke managed-entry type mismatch for $path" >&2
    return 1
  fi
  smoke_validate_optional_entry "$path" "$expected_type"
}

smoke_remove_prepared_entry() {
  local path=$1
  local expected_type=$2

  smoke_assert_managed_path "$path" "$expected_type" || return
  smoke_path_exists "$path" || return 0
  case "$expected_type" in
    regular | fifo)
      rm -f -- "$path" || return
      ;;
    directory)
      smoke_validate_tree_without_links "$path" || return
      rm -rf -- "$path" || return
      ;;
    *)
      return 64
      ;;
  esac
  smoke_assert_prepared_environment
}

smoke_write_prepared_file() {
  local path=$1
  local restore_noclobber=0
  local status=0

  smoke_remove_prepared_entry "$path" regular || return
  smoke_assert_managed_path "$path" regular || return
  if [[ $- != *C* ]]; then
    set -C
    restore_noclobber=1
  fi
  umask 077
  if cat >"$path"; then
    status=0
  else
    status=$?
  fi
  if ((restore_noclobber)); then
    set +C
  fi
  ((status == 0)) || return "$status"
  chmod 0600 -- "$path" || return
  smoke_validate_regular_file "$path"
}

smoke_clear_runtime_diagnostics() {
  local run_dir=$1
  local logs_dir="$run_dir/logs"

  if [[ "$run_dir" != "${SMOKE_PREPARED_RUN_DIR:-}" ]]; then
    echo "Runtime diagnostic path is not the prepared run directory: $run_dir" >&2
    return 1
  fi
  smoke_remove_prepared_entry "$logs_dir" directory
}

smoke_configure_gradle_caches() {
  local fixture=$1

  smoke_assert_prepared_environment || return
  if [[ "$fixture" != "$SMOKE_PREPARED_FIXTURE_ROOT" ]]; then
    echo "Gradle cache fixture does not match the prepared fixture root: $fixture" >&2
    return 1
  fi
  GRADLE_USER_HOME="$SMOKE_PREPARED_RUN_ROOT/gradle-home"
  GRADLE_PROJECT_CACHE_DIR="$SMOKE_PREPARED_RUN_ROOT/project-cache"
  export GRADLE_USER_HOME GRADLE_PROJECT_CACHE_DIR
}

smoke_validate_capped_log_file() {
  local log_file=$1

  if [[ -n "${SMOKE_CAPPED_LOG_FILE:-}" \
    && "$log_file" == "$SMOKE_CAPPED_LOG_FILE" ]]; then
    smoke_validate_regular_file "$log_file" || return
    if [[ $(smoke_directory_identity "$log_file") != "$SMOKE_CAPPED_LOG_FILE_ID" ]]; then
      echo "Smoke capped-log identity changed: $log_file" >&2
      return 1
    fi
  fi
}

smoke_log_limit_reached() {
  local log_file=$1
  local max_bytes=$2
  local size

  if ! smoke_validate_capped_log_file "$log_file"; then
    return 0
  fi
  if ! size=$(wc -c <"$log_file"); then
    return 0
  fi
  [[ "$size" =~ ^[0-9]+$ ]] || return 0
  ((size >= max_bytes))
}

smoke_start_capped_log() {
  local pipe_file=$1
  local log_file=$2
  local max_bytes=$3
  local parent=${pipe_file%/*}
  local log_fd
  local restore_noclobber=0

  SMOKE_CAPPED_LOG_PATHS_PREPARED=0
  if ((max_bytes <= 0)); then
    echo 'Smoke log limit must be a positive byte count.' >&2
    return 64
  fi
  if [[ "$parent" != "${log_file%/*}" ]]; then
    echo 'Smoke FIFO and capped log must have the same parent directory.' >&2
    return 64
  fi
  if [[ ${SMOKE_RUN_PATHS_PREPARED:-0} == 1 \
    && "$parent" == "$SMOKE_PREPARED_RUN_DIR" ]]; then
    smoke_assert_prepared_environment || return
  fi
  smoke_assert_directory_chain "$parent" || return
  smoke_assert_owned_directory "$parent" || return
  smoke_validate_optional_entry "$pipe_file" fifo || return
  smoke_validate_optional_entry "$log_file" regular || return
  rm -f -- "$pipe_file" "$log_file" || return
  smoke_assert_directory_chain "$parent" || return
  smoke_assert_owned_directory "$parent" || return
  mkfifo -m 0600 "$pipe_file" || return
  smoke_validate_fifo "$pipe_file" || return

  if [[ $- != *C* ]]; then
    set -C
    restore_noclobber=1
  fi
  umask 077
  if ! exec {log_fd}>"$log_file"; then
    if ((restore_noclobber)); then
      set +C
    fi
    rm -f -- "$pipe_file" || true
    return 1
  fi
  if ((restore_noclobber)); then
    set +C
  fi
  smoke_validate_regular_file "$log_file" || {
    exec {log_fd}>&-
    rm -f -- "$pipe_file" "$log_file" || true
    return 1
  }

  SMOKE_CAPPED_LOG_PARENT=$parent
  SMOKE_CAPPED_LOG_PARENT_ID=$(smoke_directory_identity "$parent")
  SMOKE_CAPPED_LOG_PIPE=$pipe_file
  SMOKE_CAPPED_LOG_FILE=$log_file
  SMOKE_CAPPED_LOG_FILE_ID=$(smoke_directory_identity "$log_file")
  SMOKE_CAPPED_LOG_PATHS_PREPARED=1
  SMOKE_CAPPED_LOGGER_REAPED=0
  head -c "$max_bytes" <"$pipe_file" >&"$log_fd" &
  # Sourced API: callers own the logger lifecycle through this PID.
  # shellcheck disable=SC2034
  SMOKE_CAPPED_LOG_PID=$!
  SMOKE_CAPPED_LOGGER_STARTTIME=$(smoke_process_starttime "$SMOKE_CAPPED_LOG_PID") || {
    kill -TERM "$SMOKE_CAPPED_LOG_PID" 2>/dev/null || true
    wait "$SMOKE_CAPPED_LOG_PID" 2>/dev/null || true
    exec {log_fd}>&-
    rm -f -- "$pipe_file" "$log_file" || true
    SMOKE_CAPPED_LOG_PATHS_PREPARED=0
    return 1
  }
  exec {log_fd}>&-
}

smoke_wait_for_capped_log_exit() {
  local logger_pid=$1
  local timeout_seconds=${2:-5}
  local deadline=$((SECONDS + timeout_seconds))
  local max_attempts=$((timeout_seconds * 20 + 1))

  if [[ ${SMOKE_CAPPED_LOG_PATHS_PREPARED:-0} != 1 \
    || "$logger_pid" != "${SMOKE_CAPPED_LOG_PID:-}" ]]; then
    echo 'Refusing to wait for an unregistered capped-log process.' >&2
    return 1
  fi
  for ((attempt = 0; attempt < max_attempts && SECONDS <= deadline; attempt++)); do
    if ! smoke_pid_identity_matches "$logger_pid" "$SMOKE_CAPPED_LOGGER_STARTTIME" \
      || smoke_runner_has_exited "$logger_pid"; then
      wait "$logger_pid" 2>/dev/null || true
      SMOKE_CAPPED_LOGGER_REAPED=1
      return 0
    fi
    sleep 0.05
  done
  echo 'Capped logger did not drain after all nonce-owned writers exited.' >&2
  return 1
}

smoke_cleanup_capped_log() {
  local logger_pid=${1:-}
  local pipe_file=${2:-}

  if [[ -z "$pipe_file" ]]; then
    return 0
  fi
  if [[ ${SMOKE_CAPPED_LOG_PATHS_PREPARED:-0} != 1 \
    || "$pipe_file" != "$SMOKE_CAPPED_LOG_PIPE" ]]; then
    echo 'Refusing to clean an unprepared smoke FIFO path.' >&2
    return 1
  fi
  if [[ -z "$logger_pid" || "$logger_pid" != "$SMOKE_CAPPED_LOG_PID" ]]; then
    echo 'Refusing to signal a logger PID that was not created for this capped log.' >&2
    return 1
  fi
  if [[ ${SMOKE_CAPPED_LOGGER_REAPED:-0} != 1 ]]; then
    smoke_signal_pid_if_identity_matches "$logger_pid" \
      "$SMOKE_CAPPED_LOGGER_STARTTIME" TERM || return
    wait "$logger_pid" 2>/dev/null || true
    SMOKE_CAPPED_LOGGER_REAPED=1
  fi
  if [[ ${SMOKE_RUN_PATHS_PREPARED:-0} == 1 \
    && "$SMOKE_CAPPED_LOG_PARENT" == "$SMOKE_PREPARED_RUN_DIR" ]]; then
    smoke_assert_prepared_environment || return
  fi
  if ! smoke_assert_directory_chain "$SMOKE_CAPPED_LOG_PARENT" \
    || ! smoke_assert_owned_directory "$SMOKE_CAPPED_LOG_PARENT" \
    || [[ $(smoke_directory_identity "$SMOKE_CAPPED_LOG_PARENT") \
      != "$SMOKE_CAPPED_LOG_PARENT_ID" ]]; then
    echo 'Refusing to clean a smoke FIFO after its parent identity changed.' >&2
    return 1
  fi
  smoke_validate_optional_entry "$pipe_file" fifo || return
  rm -f -- "$pipe_file" || return
  SMOKE_CAPPED_LOG_PATHS_PREPARED=0
}

smoke_runtime_diagnostics_present() {
  local run_dir=$1
  local logs_dir="$run_dir/logs"
  local scan_status

  smoke_path_exists "$logs_dir" || return 1
  if [[ -L "$logs_dir" || ! -d "$logs_dir" ]]; then
    return 0
  fi
  if ! smoke_assert_contained_directory "$run_dir" "$logs_dir"; then
    return 0
  fi
  if smoke_scan_tree_without_links "$logs_dir" '' 1; then
    return 1
  else
    scan_status=$?
  fi
  if ((scan_status == SMOKE_TREE_SCAN_FOUND_NON_DIRECTORY_STATUS)); then
    return 0
  fi
  # Any validation, traversal, ownership, type, or deadline failure is itself
  # a fail-closed file-diagnostic finding.
  return 0
}

smoke_validate_nonce_marker() {
  local environment_name=$1
  local nonce=$2

  if [[ "$environment_name" != PHASE0_SMOKE_SERVER_NONCE \
    && "$environment_name" != PHASE0_SMOKE_CLIENT_NONCE ]]; then
    echo "Unsupported smoke lifecycle marker: $environment_name" >&2
    return 64
  fi
  if [[ ! "$nonce" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
    echo 'Invalid smoke lifecycle nonce.' >&2
    return 64
  fi
}

smoke_require_process_tracking() {
  if [[ ! -d /proc || ! -r "/proc/$$/environ" \
    || ! -r /proc/self/mountinfo ]]; then
    echo 'Linux /proc environment access is required for smoke lifecycle tracking.' >&2
    return 1
  fi
  if ! printf 'phase0-probe\0' | grep -zFqx 'phase0-probe'; then
    echo 'grep with NUL-record support is required for smoke lifecycle tracking.' >&2
    return 1
  fi
}

smoke_pid_has_nonce() {
  local pid=$1
  local environment_name=$2
  local nonce=$3

  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$pid" != "$$" && "$pid" != "$BASHPID" ]] || return 1
  [[ -d "/proc/$pid" && -O "/proc/$pid" && -r "/proc/$pid/environ" ]] || return 1
  grep -zFqx -- "$environment_name=$nonce" "/proc/$pid/environ" 2>/dev/null
}

smoke_collect_nonce_processes() {
  local environment_name=$1
  local nonce=$2
  local process_dir
  local pid

  smoke_validate_nonce_marker "$environment_name" "$nonce" || return
  SMOKE_NONCE_PIDS=()
  for process_dir in /proc/[0-9]*; do
    pid=${process_dir##*/}
    if smoke_pid_has_nonce "$pid" "$environment_name" "$nonce"; then
      SMOKE_NONCE_PIDS+=("$pid")
      if ((${#SMOKE_NONCE_PIDS[@]} > SMOKE_MAX_NONCE_PROCESSES)); then
        echo 'Smoke lifecycle marker matched too many processes; refusing broad control.' >&2
        return 1
      fi
    fi
  done
}

smoke_assert_no_nonce_processes() {
  local environment_name=$1
  local nonce=$2

  smoke_collect_nonce_processes "$environment_name" "$nonce" || return
  if ((${#SMOKE_NONCE_PIDS[@]} != 0)); then
    echo "Nonce-owned smoke processes remain: ${SMOKE_NONCE_PIDS[*]}" >&2
    return 1
  fi
}

smoke_wait_for_nonce_registration() {
  local environment_name=$1
  local nonce=$2
  local timeout_seconds=${3:-5}
  local deadline=$((SECONDS + timeout_seconds))
  local max_attempts=$((timeout_seconds * 20 + 1))

  for ((attempt = 0; attempt < max_attempts && SECONDS <= deadline; attempt++)); do
    smoke_collect_nonce_processes "$environment_name" "$nonce" || return
    if ((${#SMOKE_NONCE_PIDS[@]} > 0)); then
      return 0
    fi
    sleep 0.05
  done
  echo 'Launched smoke process never exposed its exact lifecycle nonce in /proc.' >&2
  return 1
}

smoke_runner_has_exited() {
  local runner_pid=$1
  local stat_line
  local state

  [[ -d "/proc/$runner_pid" ]] || return 0
  IFS= read -r stat_line 2>/dev/null <"/proc/$runner_pid/stat" || return 0
  stat_line=${stat_line##*) }
  state=${stat_line%% *}
  [[ "$state" == Z || "$state" == X ]]
}

smoke_wait_for_owned_run_exit() {
  local runner_pid=$1
  local environment_name=$2
  local nonce=$3
  local timeout_seconds=${4:-30}
  local deadline=$((SECONDS + timeout_seconds))
  local max_attempts=$((timeout_seconds * 10 + 1))
  local runner_reaped=0
  local runner_status=0

  SMOKE_OWNED_RUNNER_REAPED=0
  for ((attempt = 0; attempt < max_attempts && SECONDS <= deadline; attempt++)); do
    if ((runner_reaped == 0)) && smoke_runner_has_exited "$runner_pid"; then
      if wait "$runner_pid"; then
        runner_status=0
      else
        runner_status=$?
      fi
      runner_reaped=1
      # Sourced API: callers clear their direct-child PID after this becomes 1.
      # shellcheck disable=SC2034
      SMOKE_OWNED_RUNNER_REAPED=1
    fi
    smoke_collect_nonce_processes "$environment_name" "$nonce" || return
    if ((runner_reaped == 1 && ${#SMOKE_NONCE_PIDS[@]} == 0)); then
      ((runner_status == 0))
      return
    fi
    sleep 0.1
  done
  echo 'Smoke runner or a nonce-owned process did not exit within the bounded drain period.' >&2
  return 1
}

smoke_signal_nonce_processes() {
  local signal_name=$1
  local environment_name=$2
  local nonce=$3
  local pid

  smoke_collect_nonce_processes "$environment_name" "$nonce" || return
  for pid in "${SMOKE_NONCE_PIDS[@]}"; do
    # Re-read the exact marker immediately before signalling to narrow the PID
    # reuse window. Only pidfd-based signalling could make this check atomic.
    if smoke_pid_has_nonce "$pid" "$environment_name" "$nonce"; then
      kill -s "$signal_name" -- "$pid" 2>/dev/null || true
    fi
  done
}

smoke_terminate_owned_run() {
  local runner_pid=${1:-}
  local environment_name=$2
  local nonce=$3
  local grace_seconds=${4:-10}
  local deadline

  SMOKE_OWNED_RUNNER_REAPED=0
  smoke_signal_nonce_processes TERM "$environment_name" "$nonce" || return
  deadline=$((SECONDS + grace_seconds))
  for ((attempt = 0; attempt < grace_seconds * 10 + 1 && SECONDS <= deadline; attempt++)); do
    smoke_collect_nonce_processes "$environment_name" "$nonce" || return
    ((${#SMOKE_NONCE_PIDS[@]} == 0)) && break
    sleep 0.1
  done
  smoke_collect_nonce_processes "$environment_name" "$nonce" || return
  if ((${#SMOKE_NONCE_PIDS[@]} > 0)); then
    smoke_signal_nonce_processes KILL "$environment_name" "$nonce" || return
  fi
  deadline=$((SECONDS + 5))
  for ((attempt = 0; attempt < 51 && SECONDS <= deadline; attempt++)); do
    smoke_collect_nonce_processes "$environment_name" "$nonce" || return
    ((${#SMOKE_NONCE_PIDS[@]} == 0)) && break
    sleep 0.1
  done
  smoke_assert_no_nonce_processes "$environment_name" "$nonce" || return

  if [[ -n "$runner_pid" ]]; then
    for ((attempt = 0; attempt < 51; attempt++)); do
      smoke_runner_has_exited "$runner_pid" && break
      sleep 0.1
    done
    if smoke_runner_has_exited "$runner_pid"; then
      wait "$runner_pid" 2>/dev/null || true
      # Sourced API: callers clear their direct-child PID after this becomes 1.
      # shellcheck disable=SC2034
      SMOKE_OWNED_RUNNER_REAPED=1
    else
      echo 'Nonce-owned process set drained but the direct smoke runner stayed alive.' >&2
      return 1
    fi
  fi
}

smoke_sentinel_matches() {
  local readiness_sentinel=$1
  local expected_nonce=$2
  local expected_size
  local sentinel_size
  local observed_nonce

  [[ ! -L "$readiness_sentinel" && -f "$readiness_sentinel" ]] || return 1
  [[ $(smoke_regular_link_count "$readiness_sentinel") == 1 ]] || return 1
  [[ "$expected_nonce" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || return 1
  expected_size=$((${#expected_nonce} + 1))
  sentinel_size=$(wc -c <"$readiness_sentinel")
  ((sentinel_size == expected_size)) || return 1
  IFS= read -r observed_nonce <"$readiness_sentinel"
  [[ "$observed_nonce" == "$expected_nonce" ]]
}

smoke_client_ready() {
  local log_file=$1
  local readiness_sentinel=$2
  local expected_nonce=$3
  local required_init_marker=${4:-BASIC_CONTENT_FIXTURE_LOADED}
  local readiness_profile=${5:-full}

  smoke_validate_capped_log_file "$log_file" || return
  smoke_sentinel_matches "$readiness_sentinel" "$expected_nonce" || return 1
  [[ "$required_init_marker" =~ ^[A-Z0-9_]{1,64}$ ]] || return 64

  grep -Fq "$required_init_marker" "$log_file" || return 1
  grep -Eq 'Backend library: LWJGL' "$log_file" || return 1
  case "$readiness_profile" in
    full)
      grep -Eq 'OpenAL initialized' "$log_file" \
        && grep -Eq 'Sound engine started' "$log_file" \
        && grep -Eq 'Created: [0-9]+x[0-9]+x[0-9]+ .*atlas' "$log_file"
      ;;
    fabric)
      grep -Eq 'Using graphics backend' "$log_file" \
        && grep -Eq 'Using graphics device:' "$log_file"
      ;;
    *)
      echo "Unsupported smoke client readiness profile: $readiness_profile" >&2
      return 64
      ;;
  esac
}

smoke_client_fatal() {
  grep -Eiq 'Mod loading errors|FMLModLoadingException|\[[^]]+/FATAL\]|ERROR (StatusConsoleListener|StatusLogger)|ERROR DISPLAY|glfwInit failed|Failed to initialize the mod loading system|We are unable to initialize the graphics system|Failed to create (the )?window|Failed to open OpenAL device|Crash report saved to:|Minecraft has crashed|Encountered an unexpected exception' "$@"
}

smoke_server_ready() {
  local log_file=$1
  local readiness_sentinel=$2
  local expected_nonce=$3

  # Console output may remain buffered in Gradle's relay after the server has
  # started. Keep this argument for a consistent guard API, but readiness is
  # proven exclusively by the nonce-bound ServerStartedEvent sentinel.
  : "$log_file"
  smoke_sentinel_matches "$readiness_sentinel" "$expected_nonce"
}

smoke_server_fatal() {
  grep -Eiq 'Mod loading errors|FMLModLoadingException|\[[^]]+/FATAL\]|ERROR (StatusConsoleListener|StatusLogger)|Failed to start the minecraft server|Failed to load level|Crash report saved to:|Encountered an unexpected exception' "$@"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if (($# != 6)) || [[ "$1" != --tree-scan-worker ]]; then
    echo 'smoke-guard-lib.sh is a sourced library with one private worker mode.' >&2
    exit 64
  fi
  shift
  smoke_tree_scan_worker "$@"
  exit $?
fi
