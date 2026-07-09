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

if [[ -n "${runtime_build}" && -n "${runtime_version}" ]]; then
  sdk_name="iphoneos${runtime_version}"
  echo "shortpy-bridge-stage: selecting simulator runtime ${runtime_build} for ${sdk_name}"
  xcrun simctl runtime match set "${sdk_name}" "${runtime_build}" >/dev/null
fi

pick_booted_simulator() {
  xcrun simctl list devices booted -j | /usr/bin/python3 -c '
import json, re, sys
data = json.load(sys.stdin)
candidates = []
for runtime, devices in data.get("devices", {}).items():
    if ".iOS-" not in runtime:
        continue
    version_text = runtime.rsplit(".iOS-", 1)[-1].replace("-", ".")
    version = tuple(int(part) for part in re.findall(r"\d+", version_text))
    if version[:2] == (27, 0):
        preferred_runtime = 2
    elif version and version[0] == 27:
        preferred_runtime = 1
    else:
        preferred_runtime = 0
    for index, device in enumerate(devices):
        if device.get("isAvailable", True) and device.get("state") == "Booted":
            name = device.get("name", "")
            preferred_device = 1 if "iPhone" in name else 0
            candidates.append((preferred_runtime, version, preferred_device, -index, device.get("udid", ""), name, version_text))
if not candidates:
    raise SystemExit(1)
candidates.sort(reverse=True)
print(candidates[0][4])
'
}

list_booted_ios_simulators() {
  xcrun simctl list devices booted -j | /usr/bin/python3 -c '
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get("devices", {}).items():
    if ".iOS-" not in runtime:
        continue
    for device in devices:
        if device.get("isAvailable", True) and device.get("state") == "Booted":
            udid = device.get("udid", "")
            if udid:
                print(udid)
'
}

shutdown_other_booted_ios_simulators() {
  local keep_udid="$1"
  if [[ -z "${keep_udid}" || "${SHORTPY_IDE_SINGLE_SIMULATOR:-1}" != "1" ]]; then
    return
  fi
  while IFS= read -r booted_udid; do
    if [[ -n "${booted_udid}" && "${booted_udid}" != "${keep_udid}" ]]; then
      echo "shortpy-bridge-stage: shutting down extra booted simulator ${booted_udid}"
      xcrun simctl shutdown "${booted_udid}" >/dev/null 2>&1 || true
    fi
  done < <(list_booted_ios_simulators || true)
}

is_simulator_booted() {
  local target_udid="$1"
  xcrun simctl list devices booted -j | SIM_UDID_FOR_BOOT_CHECK="${target_udid}" /usr/bin/python3 -c '
import json, os, sys
target = os.environ.get("SIM_UDID_FOR_BOOT_CHECK")
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for device in devices:
        if device.get("udid") == target and device.get("state") == "Booted":
            raise SystemExit(0)
raise SystemExit(1)
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
    if version[:2] == (27, 0):
        preferred_runtime = 2
    elif version and version[0] == 27:
        preferred_runtime = 1
    else:
        preferred_runtime = 0
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
SIM_ALREADY_BOOTED=0
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
elif is_simulator_booted "${SIM_UDID}"; then
  SIM_ALREADY_BOOTED=1
else
  SIM_ALREADY_BOOTED=0
fi
shutdown_other_booted_ios_simulators "${SIM_UDID}"

stamp="$(date +%Y%m%d-%H%M%S)"
toolkit_source="${SHORTPY_TOOLKIT_SQLITE:-}"
toolkit_default="${HOME}/Library/Shortcuts/ToolKit/Tools-active"
toolkit_status_log="${LOG_DIR}/toolkit-activate-${stamp}.json"
toolkit_activated=0
toolkit_should_activate=0
toolkit_label=""
if [[ -n "${toolkit_source}" || -e "${toolkit_default}" || -L "${toolkit_default}" ]]; then
  toolkit_should_activate=1
  toolkit_label="${toolkit_source:-${toolkit_default}}"
  echo "shortpy-bridge-stage: toolkit will activate after launch-time indexing: ${toolkit_label}"
else
  echo "shortpy-bridge-stage: toolkit skipped; default host Tools-active not found"
fi

if [[ "${SIM_ALREADY_BOOTED}" != "1" ]]; then
  if [[ "${SHORTPY_IDE_BOOT_SIMULATOR:-1}" != "1" ]]; then
    echo "No booted iOS simulator. Set SHORTPY_IDE_BOOT_SIMULATOR=1 or boot a simulator manually." >&2
    exit 1
  fi
  echo "shortpy-bridge-stage: booting ${SIM_UDID}"
  xcrun simctl boot "${SIM_UDID}" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "${SIM_UDID}" -b
else
  echo "shortpy-bridge-stage: booting using booted simulator ${SIM_UDID}"
fi

if [[ "${SHORTPY_IDE_OPEN_SIMULATOR:-0}" == "1" ]]; then
  echo "shortpy-bridge-stage: opening Simulator app"
  open -a Simulator >/dev/null 2>&1 || true
elif [[ "${SHORTPY_IDE_QUIT_SIMULATOR_APP:-1}" == "1" ]]; then
  echo "shortpy-bridge-stage: closing Simulator app for headless launch"
  osascript -e 'if application "Simulator" is running then tell application "Simulator" to quit' >/dev/null 2>&1 || true
else
  echo "shortpy-bridge-stage: keeping Simulator app state unchanged"
fi

rm -f "${SOCKET}"
launch_log="${LOG_DIR}/sim-launch-dyldloader-${stamp}.out"
status_log="${LOG_DIR}/sim-launch-dyldloader-status-${stamp}.json"

echo "shortpy-bridge-stage: launching Shortcuts on ${SIM_UDID}" | tee "${launch_log}"
echo "Runtime build: ${runtime_build}" | tee -a "${launch_log}"
echo "Runtime root: ${runtime_root}" | tee -a "${launch_log}"
echo "Launching iOS Simulator Shortcuts with ${DYLIB}" | tee -a "${launch_log}"
sim_data_path="$(SIM_UDID_FOR_PATH="${SIM_UDID}" xcrun simctl list devices -j | /usr/bin/python3 -c '
import json, os, sys
target = os.environ.get("SIM_UDID_FOR_PATH")
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for device in devices:
        if device.get("udid") == target:
            print(device.get("dataPath") or "")
            raise SystemExit(0)
' || true)"
if [[ -z "${sim_data_path}" ]]; then
  sim_data_path="$("${ROOT}/tools/toolkitctl.py" --device "${SIM_UDID}" show 2>/dev/null | /usr/bin/python3 -c 'import json,sys; data=json.load(sys.stdin); active=data.get("active",{}).get("path",""); marker="/Library/Shortcuts/ToolKit/Tools-active"; print(active.rsplit(marker,1)[0] if marker in active else "")' || true)"
fi
generator_asset_root="${sim_data_path%/}/private/var/MobileAsset/AssetsV2/com_apple_MobileAsset_UAF_Shortcuts_Generator"
SIMCTL_CHILD_DYLD_INSERT_LIBRARIES="${DYLIB}" \
SIMCTL_CHILD_SHORTPY_GENERATOR_ASSET_ROOT="${generator_asset_root}" \
  xcrun simctl launch --terminate-running-process "${SIM_UDID}" com.apple.shortcuts 2>&1 | tee -a "${launch_log}"

bridge_ready=0
for _ in {1..50}; do
  if "${ROOT}/tools/bridgectl.py" --socket auto status >"${status_log}" 2>/dev/null; then
    bridge_ready=1
    break
  fi
  sleep 0.2
done

if [[ "${bridge_ready}" != "1" ]]; then
  echo "Shortcuts launched, but bridge status did not respond. See ${launch_log}" >&2
  exit 2
fi

if [[ "${toolkit_should_activate}" == "1" ]]; then
  toolkit_wait_log="${LOG_DIR}/toolkit-wait-idle-${stamp}.json"
  toolkit_prelaunch_snapshot_log="${LOG_DIR}/toolkit-prelaunch-snapshot-${stamp}.json"
  min_wait="${SHORTPY_TOOLKIT_POST_LAUNCH_MIN_WAIT_SECONDS:-45}"
  stable_wait="${SHORTPY_TOOLKIT_IDLE_STABLE_SECONDS:-8}"
  idle_timeout="${SHORTPY_TOOLKIT_IDLE_TIMEOUT_SECONDS:-180}"
  toolkit_wait_needed=1
  if "${ROOT}/tools/toolkitctl.py" --device "${SIM_UDID}" snapshot >"${toolkit_prelaunch_snapshot_log}" 2>/dev/null; then
    cp "${toolkit_prelaunch_snapshot_log}" "${LOG_DIR}/shortpy-toolkit-prelaunch-snapshot.json"
    if /usr/bin/python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); snap=data.get("snapshot",{}); tools=snap.get("tools"); triggers=snap.get("triggers"); raise SystemExit(0 if isinstance(tools,int) and tools > 0 and isinstance(triggers,int) and triggers >= 0 else 1)' "${toolkit_prelaunch_snapshot_log}"; then
      toolkit_wait_needed=0
    fi
  fi
  if [[ "${toolkit_wait_needed}" == "1" ]]; then
    echo "shortpy-bridge-stage: waiting for first ToolKit indexing to settle"
    if "${ROOT}/tools/toolkitctl.py" --device "${SIM_UDID}" wait-idle --min-wait "${min_wait}" --stable-seconds "${stable_wait}" --timeout "${idle_timeout}" >"${toolkit_wait_log}"; then
      cp "${toolkit_wait_log}" "${LOG_DIR}/shortpy-toolkit-wait-idle.json"
    else
      cat "${toolkit_wait_log}" >&2 || true
      echo "Timed out waiting for ToolKit indexing to settle." >&2
      exit 1
    fi
  else
    echo "shortpy-bridge-stage: skipping ToolKit indexing wait; active ToolKit is already indexed"
  fi

  toolkit_args=(--device "${SIM_UDID}" activate)
  if [[ -n "${toolkit_source}" ]]; then
    toolkit_args+=(--sqlite "${toolkit_source}")
  fi
  echo "shortpy-bridge-stage: toolkit activating ${toolkit_label}"
  if "${ROOT}/tools/toolkitctl.py" "${toolkit_args[@]}" >"${toolkit_status_log}"; then
    toolkit_activated=1
    cp "${toolkit_status_log}" "${LOG_DIR}/shortpy-toolkit-selection.json"
    /usr/bin/python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); names=data.get("duplicate_adjustment",{}).get("change_count",0); sot=data.get("duplicate_adjustment",{}).get("source_of_truth_change_count",0); vis=data.get("toolrenderer_visibility_adjustment",{}).get("changed_count",0); print("shortpy-bridge-stage: toolkit adjusted {} duplicate python names, applied {} source-of-truth metadata changes, and patched {} visibility rows".format(names, sot, vis))' "${toolkit_status_log}"
  elif [[ -n "${toolkit_source}" ]]; then
    cat "${toolkit_status_log}" >&2 || true
    echo "Could not activate custom ToolKit sqlite: ${toolkit_source}" >&2
    exit 1
  else
    cat "${toolkit_status_log}" >&2 || true
    echo "shortpy-bridge-stage: toolkit skipped; default host Tools-active could not be activated" >&2
  fi

  if [[ "${toolkit_activated}" == "1" ]]; then
    toolkit_prime_log="${LOG_DIR}/toolkit-prime-${stamp}.json"
    echo "shortpy-bridge-stage: toolkit priming active database"
    if "${ROOT}/tools/toolkitctl.py" --device "${SIM_UDID}" prime >"${toolkit_prime_log}"; then
      cp "${toolkit_prime_log}" "${LOG_DIR}/shortpy-toolkit-prime.json"
    else
      cat "${toolkit_prime_log}" >&2 || true
      echo "Could not prime active ToolKit sqlite after activation." >&2
      exit 1
    fi
  fi

  post_activation_status_log="${LOG_DIR}/sim-launch-dyldloader-status-post-toolkit-${stamp}.json"
  if "${ROOT}/tools/bridgectl.py" --socket auto status >"${post_activation_status_log}" 2>/dev/null; then
    cp "${post_activation_status_log}" "${status_log}"
  else
    echo "Bridge stopped responding after ToolKit activation." >&2
    exit 2
  fi
fi

cat "${status_log}"
exit 0

echo "Shortcuts launched, but bridge status did not respond. See ${launch_log}" >&2
exit 2
