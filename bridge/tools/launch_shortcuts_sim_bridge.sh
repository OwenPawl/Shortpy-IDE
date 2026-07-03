#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOLVER="${ROOT}/tools/resolve_sim_runtime_root.py"
DYLIB="${ROOT}/build-sim/libShortcutsIDESimBridge-v019.dylib"
SOCKET="/tmp/shortcuts-ide-bridge-sim.sock"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

if [[ ! -f "${DYLIB}" ]]; then
  echo "Missing simulator bridge dylib: ${DYLIB}" >&2
  echo "Run: make -C ${ROOT} all" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "Missing xcrun. Install Xcode or Xcode Command Line Tools before launching the simulator bridge." >&2
  exit 1
fi

if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  DEVELOPER_DIR="$("${RESOLVER}" --developer-dir)"
  export DEVELOPER_DIR
fi

resolver_args=()
if [[ -n "${SIM_RUNTIME_BUILD:-}" ]]; then
  resolver_args+=(--build "${SIM_RUNTIME_BUILD}")
fi
if [[ ${#resolver_args[@]} -gt 0 ]]; then
  runtime_json="$("${RESOLVER}" "${resolver_args[@]}" --json)"
else
  runtime_json="$("${RESOLVER}" --json)"
fi
runtime_build="$(/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("buildversion") or "")' <<<"${runtime_json}")"
runtime_version="$(/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("targetVersion") or "")' <<<"${runtime_json}")"
runtime_root="$(/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("runtimeRoot") or "")' <<<"${runtime_json}")"

if [[ -n "${SIM_RUNTIME_BUILD:-}" ]]; then
  sdk_name="iphoneos${runtime_version}"
  echo "shortpy-bridge-stage: selecting simulator runtime ${runtime_build} for ${sdk_name}"
  xcrun simctl runtime match set "${sdk_name}" "${runtime_build}" >/dev/null
fi

pick_booted_simulator() {
  xcrun simctl list devices booted -j | /usr/bin/python3 -c '
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get("devices", {}).items():
    if ".iOS-" not in runtime:
        continue
    for device in devices:
        if device.get("isAvailable", True) and device.get("state") == "Booted":
            print(device.get("udid", ""))
            raise SystemExit(0)
'
}

pick_available_simulator() {
  xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, re, sys
data = json.load(sys.stdin)
candidates = []
for runtime, devices in data.get("devices", {}).items():
    if ".iOS-" not in runtime:
        continue
    version_text = runtime.rsplit(".iOS-", 1)[-1].replace("-", ".")
    version = tuple(int(part) for part in re.findall(r"\d+", version_text))
    preferred_runtime = 1 if version and version[0] == 27 else 0
    for index, device in enumerate(devices):
        if not device.get("isAvailable", True):
            continue
        name = device.get("name", "")
        preferred_device = 1 if "iPhone" in name else 0
        candidates.append((preferred_runtime, version, preferred_device, -index, device.get("udid", ""), name, version_text))
if not candidates:
    raise SystemExit(1)
candidates.sort(reverse=True)
print(candidates[0][4])
'
}

SIM_UDID="${SIMULATOR_UDID:-}"
if [[ -z "${SIM_UDID}" && -z "${SIM_RUNTIME_BUILD:-}" ]]; then
  SIM_UDID="$(pick_booted_simulator || true)"
fi
if [[ -z "${SIM_UDID}" ]]; then
  if [[ "${SHORTPY_IDE_BOOT_SIMULATOR:-1}" != "1" ]]; then
    echo "No booted iOS simulator. Set SHORTPY_IDE_BOOT_SIMULATOR=1 or boot a simulator manually." >&2
    exit 1
  fi
  SIM_UDID="$(pick_available_simulator || true)"
  if [[ -z "${SIM_UDID}" ]]; then
    echo "No available iOS simulator runtime was found. Install an iOS Simulator runtime, preferably iOS 27.0." >&2
    exit 1
  fi
  echo "shortpy-bridge-stage: booting ${SIM_UDID}"
  xcrun simctl boot "${SIM_UDID}" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "${SIM_UDID}" -b
else
  echo "shortpy-bridge-stage: booting using booted simulator ${SIM_UDID}"
fi

stamp="$(date +%Y%m%d-%H%M%S)"
toolkit_source="${SHORTPY_TOOLKIT_SQLITE:-}"
toolkit_default="${HOME}/Library/Shortcuts/ToolKit/Tools-active"
toolkit_status_log="${LOG_DIR}/toolkit-activate-${stamp}.json"
if [[ -n "${toolkit_source}" || -e "${toolkit_default}" || -L "${toolkit_default}" ]]; then
  toolkit_args=(--device "${SIM_UDID}" activate)
  if [[ -n "${toolkit_source}" ]]; then
    toolkit_args+=(--sqlite "${toolkit_source}")
  fi
  echo "shortpy-bridge-stage: toolkit activating ${toolkit_source:-${toolkit_default}}"
  if "${ROOT}/tools/toolkitctl.py" "${toolkit_args[@]}" >"${toolkit_status_log}"; then
    cp "${toolkit_status_log}" "${LOG_DIR}/shortpy-toolkit-selection.json"
    /usr/bin/python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); names=data.get("duplicate_adjustment",{}).get("change_count",0); vis=data.get("toolrenderer_visibility_adjustment",{}).get("changed_count",0); print("shortpy-bridge-stage: toolkit adjusted {} duplicate python names and {} ToolRenderer visibility rows".format(names, vis))' "${toolkit_status_log}"
  elif [[ -n "${toolkit_source}" ]]; then
    cat "${toolkit_status_log}" >&2 || true
    echo "Could not activate custom ToolKit sqlite: ${toolkit_source}" >&2
    exit 1
  else
    cat "${toolkit_status_log}" >&2 || true
    echo "shortpy-bridge-stage: toolkit skipped; default host Tools-active could not be activated" >&2
  fi
else
  echo "shortpy-bridge-stage: toolkit skipped; default host Tools-active not found"
fi

open -a Simulator >/dev/null 2>&1 || true

rm -f "${SOCKET}"
launch_log="${LOG_DIR}/sim-launch-dyldloader-${stamp}.out"
status_log="${LOG_DIR}/sim-launch-dyldloader-status-${stamp}.json"

echo "shortpy-bridge-stage: launching Shortcuts on ${SIM_UDID}" | tee "${launch_log}"
echo "Runtime build: ${runtime_build}" | tee -a "${launch_log}"
echo "Runtime root: ${runtime_root}" | tee -a "${launch_log}"
echo "Launching iOS Simulator Shortcuts with ${DYLIB}" | tee -a "${launch_log}"
SIMCTL_CHILD_DYLD_INSERT_LIBRARIES="${DYLIB}" \
  xcrun simctl launch --terminate-running-process "${SIM_UDID}" com.apple.shortcuts 2>&1 | tee -a "${launch_log}"

for _ in {1..50}; do
  if "${ROOT}/tools/bridgectl.py" --socket auto status >"${status_log}" 2>/dev/null; then
    cat "${status_log}"
    exit 0
  fi
  sleep 0.2
done

echo "Shortcuts launched, but bridge status did not respond. See ${launch_log}" >&2
exit 2
