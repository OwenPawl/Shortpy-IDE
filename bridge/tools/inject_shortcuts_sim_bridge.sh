#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DYLIB="${ROOT}/build-sim/libShortcutsIDESimBridge-v020.dylib"
DYLIBLOAD="${DYLIBLOAD:-dylibload}"
SOCKET="/tmp/shortcuts-ide-bridge-sim.sock"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

pid="${1:-}"
if [[ -z "${pid}" ]]; then
  pid="$(pgrep -f 'CoreSimulator.*RuntimeRoot/Applications/Shortcuts.app/Shortcuts' | tail -n 1 || true)"
fi
if [[ -z "${pid}" ]]; then
  echo "No iOS Simulator Shortcuts process found. Launch Shortcuts in the booted simulator first." >&2
  exit 1
fi

if [[ ! -x "${DYLIBLOAD}" ]]; then
  echo "Missing dylibload helper: ${DYLIBLOAD}" >&2
  exit 1
fi
if [[ ! -f "${DYLIB}" ]]; then
  echo "Missing simulator bridge dylib: ${DYLIB}" >&2
  echo "Run: make -C ${ROOT} all" >&2
  exit 1
fi

rm -f "${SOCKET}"
stamp="$(date +%Y%m%d-%H%M%S)"
inject_log="${LOG_DIR}/sim-inject-pid${pid}-${stamp}.out"
status_log="${LOG_DIR}/sim-status-pid${pid}-${stamp}.json"
target_tmp="$(ps eww -p "${pid}" | tr ' ' '\n' | awk -F= '$1=="TMPDIR"{print $2; exit}')"
if [[ -z "${target_tmp}" || ! -d "${target_tmp}" ]]; then
  echo "Could not resolve writable simulator TMPDIR for PID ${pid}" >&2
  exit 1
fi
stem="$(basename "${DYLIB}" .dylib)"
hash="$(shasum -a 256 "${DYLIB}" | awk '{print substr($1, 1, 32)}')"
target_stage_dir="${target_tmp}/dylibload"
target_dylib="${target_stage_dir}/${stem}-arm64-${hash}.dylib"
mkdir -p "${target_stage_dir}"
cp "${DYLIB}" "${target_dylib}"
chmod 0755 "${target_dylib}"

echo "Injecting ${target_dylib} into iOS Simulator Shortcuts PID ${pid}" | tee "${inject_log}"
echo "Loader: ${DYLIBLOAD}" | tee -a "${inject_log}"
echo "Direct target path: ${target_dylib}" | tee -a "${inject_log}"
DYLIBLOAD_DIRECT_REMOTE_PATH=1 arch -arm64 "${DYLIBLOAD}" "${pid}" "${target_dylib}" 2>&1 | tee -a "${inject_log}"

for _ in {1..30}; do
  if "${ROOT}/tools/bridgectl.py" --socket auto status >"${status_log}" 2>/dev/null; then
    cat "${status_log}"
    exit 0
  fi
  sleep 0.2
done

echo "Injected, but bridge status did not respond. See ${inject_log}" >&2
exit 2
