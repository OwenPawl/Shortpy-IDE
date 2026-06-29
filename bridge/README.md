# Shortpy IDE Simulator Bridge

This bridge loads into the iOS Simulator Shortcuts process and exposes the native Shortcuts Python compiler, plist import/export path, ToolRenderer metadata, and related agent-style tool surfaces over a local Unix socket.

Current target:

- iOS Simulator 27.0
- `ToolVisibilityFilter.any`
- launch-time `DYLD_INSERT_LIBRARIES`
- private Apple frameworks from the selected simulator runtime

The production unsigned workflow export path is:

```text
ShortcutsLanguage.pythonToShortcut
  -> WFWorkflow.databaseAccessQueue dispatch_barrier_sync
  -> WFWorkflow.saveToRecord
  -> WFWorkflow.record
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

`saveToRecord` must run on `workflow.databaseAccessQueue`; direct off-queue calls assert in libdispatch.

## Build

```sh
make -C bridge clean all
```

The default `Makefile` expects Xcode's iPhoneSimulator SDK and the iOS 27.0 simulator runtime to be installed. Override `SDKROOT`, `SIM_RUNTIME_ROOT`, or `TARGET` if needed.

## Launch

```sh
bridge/tools/launch_shortcuts_sim_bridge.sh
```

This launches `com.apple.shortcuts` in the booted simulator with the bridge dylib loaded. It writes transient logs under `bridge/logs/`, which is intentionally ignored by git.

## Query

```sh
bridge/tools/bridgectl.py --socket auto status
bridge/tools/bridgectl.py --raw python-to-bplist --text 'def shortcut() -> None:
    com_apple_shortcuts_show_notification(title="Hello", body="World")
'
```

`python-to-bplist` signs by default with:

```sh
/usr/bin/shortcuts sign --mode anyone --input <unsigned-workflow> --output <signed-shortcut>
```

The JSON response keeps both payloads:

- `plist_payload`: unsigned workflow plist bytes from the simulator runtime.
- `shortcut_payload`: signed `.shortcut` bytes from the macOS Shortcuts CLI.

Pass `--no-sign` to skip host signing for validation or plist-preview workflows.

## Optional Live Injection

```sh
DYLIBLOAD=/path/to/dylibload bridge/tools/inject_shortcuts_sim_bridge.sh
```

Launch-time loading is the supported path. Live injection remains a debugging fallback and depends on the external `dylibload` helper.
