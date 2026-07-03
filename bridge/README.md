# Shortpy IDE Simulator Bridge

This bridge loads into the iOS Simulator Shortcuts process and exposes the native Shortcuts Python compiler, plist import/export path, ToolRenderer metadata, and related agent-style tool surfaces over a local Unix socket.

Current target:

- iOS Simulator 27.0
- `ToolVisibilityFilter.any` for compiler validation, with launch-time ToolKit sqlite visibility/approval adjustment for ToolRenderer exposure
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

## Signed Import

`plist-data-to-python` accepts signed `.shortcut` files, iCloud Shortcuts links, and raw workflow plist bytes:

```sh
bridge/tools/bridgectl.py --raw plist-data-to-python --file Example.shortcut
bridge/tools/bridgectl.py --raw plist-data-to-python --text 'https://www.icloud.com/shortcuts/00000000-0000-0000-0000-000000000000'
```

The host CLI unwraps AEA1 envelopes with the macOS `aea`, `aa`, and `openssl` tools, then sends the extracted `Shortcut.wflow` bytes to the simulator bridge. Both `shortcuts sign --mode anyone` and `--mode people-who-know-me` auth-data forms are supported.

For iCloud links, the host CLI calls `https://www.icloud.com/shortcuts/api/records/<UUID>`, handles `{"error":true,"reason":"..."}` as an import diagnostic, downloads `fields.shortcut.value.downloadURL`, and sends those unsigned workflow plist bytes to the simulator bridge.

## Metadata Boundary

`toolrenderer-structured-metadata` is the visible IDE metadata surface. It returns ToolRenderer Python-interface actions, triggers, helpers, and types with raw ToolKit keys, host/key bindings, and ToolKit source labels stripped so old caches cannot leak internal catalog details into the UI.

Inline catalog metadata compilation goes through a separate binding adapter. The adapter is shaped for native `WFParameterMetadataProvider.binding(toolID:)` / `binding(triggerID:)` extraction and currently falls back internally to ToolKit-derived host/key data only when no native binding has been proven. That fallback is not a VS Code documentation or completion source.

## Optional Live Injection

```sh
DYLIBLOAD=/path/to/dylibload bridge/tools/inject_shortcuts_sim_bridge.sh
```

Launch-time loading is the supported path. Live injection remains a debugging fallback and depends on the external `dylibload` helper.
