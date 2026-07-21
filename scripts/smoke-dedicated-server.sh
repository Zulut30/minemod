#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=smoke-guard-lib.sh
source "$script_dir/smoke-guard-lib.sh"

if (($# != 0)); then
  echo "usage: $0" >&2
  exit 64
fi

timeout_seconds=${PHASE0_SMOKE_TIMEOUT_SECONDS:-180}
smoke_enter_overall_timeout "$timeout_seconds" "$0"
unset PHASE0_SMOKE_TIMEOUT_SECONDS

repo_root=$(cd -- "$script_dir/.." && pwd -P)
fixture="$repo_root/fixtures/basic-content"
readiness_nonce="phase0-server-${BASHPID}-${RANDOM}-${RANDOM}-${SECONDS}"
lifecycle_marker=PHASE0_SMOKE_SERVER_NONCE
shutdown_timeout_seconds=30
max_log_bytes=$((8 * 1024 * 1024))
poll_interval_seconds=0.25
run_dir=''
console_log=''
console_pipe=''
readiness_sentinel=''
readiness_sentinel_temp=''
runner_pid=''
logger_pid=''

# Invoked indirectly by the EXIT trap below.
# shellcheck disable=SC2317
cleanup() {
  local status=$1

  trap - EXIT

  if [[ -n "$runner_pid" ]]; then
    if ! smoke_terminate_owned_run "$runner_pid" "$lifecycle_marker" \
      "$readiness_nonce" 10; then
      echo 'Failed to drain every nonce-owned dedicated-server process.' >&2
      status=1
    fi
    if [[ ${SMOKE_OWNED_RUNNER_REAPED:-0} == 1 ]]; then
      runner_pid=''
    fi
  fi
  if ! smoke_cleanup_capped_log "$logger_pid" "$console_pipe"; then
    status=1
  fi
  if [[ ${SMOKE_RUN_PATHS_PREPARED:-0} == 1 \
    && -n "$readiness_sentinel" && -n "$readiness_sentinel_temp" ]]; then
    smoke_remove_prepared_entry "$readiness_sentinel" regular || status=1
    smoke_remove_prepared_entry "$readiness_sentinel_temp" regular || status=1
  fi
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'exit 130' INT TERM

smoke_require_process_tracking
smoke_assert_no_nonce_processes "$lifecycle_marker" "$readiness_nonce"
smoke_prepare_run_environment "$fixture" server
fixture=$SMOKE_PREPARED_FIXTURE_ROOT
smoke_configure_gradle_caches "$fixture"
run_dir=$SMOKE_PREPARED_RUN_DIR
console_log="$run_dir/phase0-console.log"
console_pipe="$run_dir/phase0-console.pipe"
readiness_sentinel="$run_dir/.phase0-server-ready"
readiness_sentinel_temp="$run_dir/.phase0-server-ready.tmp"
smoke_clear_runtime_diagnostics "$run_dir"
smoke_remove_prepared_entry "$readiness_sentinel" regular
smoke_remove_prepared_entry "$readiness_sentinel_temp" regular
printf 'eula=true\n' | smoke_write_prepared_file "$run_dir/eula.txt"
smoke_write_prepared_file "$run_dir/server.properties" <<'PROPERTIES'
enable-query=false
enable-rcon=false
max-players=1
motd=Phase 0 NeoForge smoke test
online-mode=false
server-ip=127.0.0.1
server-port=0
PROPERTIES
smoke_start_capped_log "$console_pipe" "$console_log" "$max_log_bytes"
logger_pid=$SMOKE_CAPPED_LOG_PID

(
  cd "$fixture"
  exec setsid env PHASE0_SMOKE_SERVER_NONCE="$readiness_nonce" \
    ./gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR" \
    --dependency-verification strict runServer
) >"$console_pipe" 2>&1 &
runner_pid=$!
smoke_wait_for_nonce_registration "$lifecycle_marker" "$readiness_nonce" 5
deadline=$SMOKE_OVERALL_DEADLINE

while ((SECONDS < deadline)); do
  if smoke_log_limit_reached "$console_log" "$max_log_bytes"; then
    echo "Dedicated server reached the ${max_log_bytes}-byte console-log limit." >&2
    exit 1
  fi
  if smoke_runtime_diagnostics_present "$run_dir"; then
    tail -n 160 "$console_log" >&2
    echo 'Dedicated server created a file diagnostic despite console-only logging.' >&2
    exit 1
  fi
  if smoke_server_fatal "$console_log"; then
    tail -n 160 "$console_log" >&2
    echo 'Dedicated server reported a fatal startup error.' >&2
    exit 1
  fi

  if smoke_server_ready "$console_log" "$readiness_sentinel" "$readiness_nonce"; then
    if ! smoke_wait_for_owned_run_exit "$runner_pid" "$lifecycle_marker" \
      "$readiness_nonce" "$shutdown_timeout_seconds"; then
      if [[ ${SMOKE_OWNED_RUNNER_REAPED:-0} == 1 ]]; then
        runner_pid=''
      fi
      tail -n 160 "$console_log" >&2
      echo 'Dedicated server reached readiness but did not complete its nonce-owned shutdown.' >&2
      exit 1
    fi
    runner_pid=''
    smoke_assert_no_nonce_processes "$lifecycle_marker" "$readiness_nonce"
    sleep 1
    smoke_assert_no_nonce_processes "$lifecycle_marker" "$readiness_nonce"
    smoke_wait_for_capped_log_exit "$logger_pid" 5
    smoke_cleanup_capped_log "$logger_pid" "$console_pipe"
    console_pipe=''
    logger_pid=''
    if smoke_log_limit_reached "$console_log" "$max_log_bytes"; then
      echo "Dedicated server reached the ${max_log_bytes}-byte console-log limit during shutdown." >&2
      exit 1
    fi
    if smoke_runtime_diagnostics_present "$run_dir"; then
      tail -n 160 "$console_log" >&2
      echo 'Dedicated server created a file diagnostic during shutdown.' >&2
      exit 1
    fi
    if smoke_server_fatal "$console_log"; then
      tail -n 160 "$console_log" >&2
      echo 'Dedicated server reported a fatal shutdown error.' >&2
      exit 1
    fi
    echo "Dedicated server reached readiness, Gradle wrapper exited 0, and nonce $readiness_nonce fully stopped."
    exit 0
  fi

  if smoke_runner_has_exited "$runner_pid"; then
    wait "$runner_pid" || status=$?
    runner_pid=''
    tail -n 160 "$console_log" >&2
    echo "Dedicated server exited before readiness (status ${status:-0})." >&2
    exit 1
  fi
  sleep "$poll_interval_seconds"
done

tail -n 160 "$console_log" 2>/dev/null >&2 || true
echo "Dedicated server did not reach readiness within the ${timeout_seconds}s overall deadline." >&2
exit 1
