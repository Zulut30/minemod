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

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo 'xvfb-run is required for the headless client gate.' >&2
  exit 1
fi

repo_root=$(cd -- "$script_dir/.." && pwd -P)
fixture="$repo_root/fixtures/basic-content"
readiness_nonce="phase0-client-${BASHPID}-${RANDOM}-${RANDOM}-${SECONDS}"
lifecycle_marker=PHASE0_SMOKE_CLIENT_NONCE
max_log_bytes=$((8 * 1024 * 1024))
poll_interval_seconds=0.25
run_dir=''
console_log=''
console_pipe=''
readiness_sentinel=''
readiness_sentinel_temp=''
runner_pid=''
logger_pid=''
ready_observations=0
required_ready_observations=20

# Invoked indirectly by the EXIT trap below.
# shellcheck disable=SC2317
cleanup() {
  local status=$1

  trap - EXIT

  if [[ -n "$runner_pid" ]]; then
    if ! smoke_terminate_owned_run "$runner_pid" "$lifecycle_marker" \
      "$readiness_nonce" 10; then
      echo 'Failed to drain every nonce-owned headless-client process.' >&2
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
smoke_prepare_run_environment "$fixture" client
fixture=$SMOKE_PREPARED_FIXTURE_ROOT
smoke_configure_gradle_caches "$fixture"
run_dir=$SMOKE_PREPARED_RUN_DIR
console_log="$run_dir/phase0-console.log"
console_pipe="$run_dir/phase0-console.pipe"
readiness_sentinel="$run_dir/.phase0-client-ready"
readiness_sentinel_temp="$run_dir/.phase0-client-ready.tmp"
smoke_clear_runtime_diagnostics "$run_dir"
smoke_remove_prepared_entry "$readiness_sentinel" regular
smoke_remove_prepared_entry "$readiness_sentinel_temp" regular
smoke_start_capped_log "$console_pipe" "$console_log" "$max_log_bytes"
logger_pid=$SMOKE_CAPPED_LOG_PID
(
  cd "$fixture"
  exec setsid env ALSOFT_DRIVERS=null PHASE0_SMOKE_CLIENT_NONCE="$readiness_nonce" \
    xvfb-run --auto-servernum --server-args='-screen 0 1280x720x24' \
    ./gradlew --project-cache-dir "$GRADLE_PROJECT_CACHE_DIR" \
    --dependency-verification strict runClient
) >"$console_pipe" 2>&1 &
runner_pid=$!
smoke_wait_for_nonce_registration "$lifecycle_marker" "$readiness_nonce" 5
deadline=$SMOKE_OVERALL_DEADLINE

while ((SECONDS < deadline)); do
  if smoke_log_limit_reached "$console_log" "$max_log_bytes"; then
    echo "Headless client reached the ${max_log_bytes}-byte console-log limit." >&2
    exit 1
  fi
  if smoke_runtime_diagnostics_present "$run_dir"; then
    tail -n 160 "$console_log" >&2
    echo 'Headless client created a file diagnostic despite console-only logging.' >&2
    exit 1
  fi
  if smoke_client_fatal "$console_log"; then
    tail -n 160 "$console_log" >&2
    echo 'Headless client reported a fatal startup error.' >&2
    exit 1
  fi

  if smoke_runner_has_exited "$runner_pid"; then
    wait "$runner_pid" || status=$?
    runner_pid=''
    tail -n 160 "$console_log" >&2
    echo "Headless client exited before readiness (status ${status:-0})." >&2
    exit 1
  fi

  if smoke_client_ready "$console_log" "$readiness_sentinel" "$readiness_nonce"; then
    ((ready_observations += 1))
    if ((ready_observations >= required_ready_observations)); then
      if ! smoke_terminate_owned_run "$runner_pid" "$lifecycle_marker" \
        "$readiness_nonce" 10; then
        if [[ ${SMOKE_OWNED_RUNNER_REAPED:-0} == 1 ]]; then
          runner_pid=''
        fi
        tail -n 160 "$console_log" >&2
        echo 'Headless client reached readiness but its nonce-owned lifecycle did not stop.' >&2
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
        echo "Headless client reached the ${max_log_bytes}-byte console-log limit during teardown." >&2
        exit 1
      fi
      if smoke_runtime_diagnostics_present "$run_dir"; then
        tail -n 160 "$console_log" >&2
        echo 'Headless client created a file diagnostic during teardown.' >&2
        exit 1
      fi
      if smoke_client_fatal "$console_log"; then
        tail -n 160 "$console_log" >&2
        echo 'Headless client reported a fatal teardown error.' >&2
        exit 1
      fi
      echo "Headless client remained ready and nonce $readiness_nonce fully stopped."
      exit 0
    fi
  else
    ready_observations=0
  fi
  sleep "$poll_interval_seconds"
done

tail -n 160 "$console_log" 2>/dev/null >&2 || true
echo "Headless client did not reach readiness within the ${timeout_seconds}s overall deadline." >&2
exit 1
