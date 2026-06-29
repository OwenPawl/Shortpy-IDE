#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DYLIB="${ROOT}/build-sim/libShortcutsIDESimBridge-v019.dylib"
SOCKET="/tmp/shortcuts-ide-bridge-sim.sock"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

if [[ ! -f "${DYLIB}" ]]; then
  echo "Missing simulator bridge dylib: ${DYLIB}" >&2
  echo "Run: make -C ${ROOT} all" >&2
  exit 1
fi

rm -f "${SOCKET}"
stamp="$(date +%Y%m%d-%H%M%S)"
launch_log="${LOG_DIR}/sim-launch-dyldloader-${stamp}.out"
status_log="${LOG_DIR}/sim-launch-dyldloader-status-${stamp}.json"

echo "Launching iOS Simulator Shortcuts with ${DYLIB}" | tee "${launch_log}"
SIMCTL_CHILD_DYLD_INSERT_LIBRARIES="${DYLIB}" \
  xcrun simctl launch --terminate-running-process booted com.apple.shortcuts 2>&1 | tee -a "${launch_log}"

for _ in {1..50}; do
  if "${ROOT}/tools/bridgectl.py" --socket auto status >"${status_log}" 2>/dev/null; then
    cat "${status_log}"
    exit 0
  fi
  sleep 0.2
done

echo "Shortcuts launched, but bridge status did not respond. See ${launch_log}" >&2
exit 2
