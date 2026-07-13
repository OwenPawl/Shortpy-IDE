# Shortpy IDE Simulator Bridge

This bridge loads into the iOS Simulator Shortcuts process and exposes the native Shortcuts Python compiler, plist import/export path, ToolRenderer metadata, and related agent-style tool surfaces over a local Unix socket.

Current target:

- iOS Simulator 27.0
- `ToolVisibilityFilter.any` for compiler validation, with typed-reference enum closure repair and ToolKit sqlite visibility/approval adjustment for ToolRenderer exposure
- launch-time `DYLD_INSERT_LIBRARIES`
- private Apple frameworks from the selected simulator runtime

The production unsigned workflow export path is:

```text
ShortpyToShortcut
  -> ShortcutsLanguage.PythonToIR
  -> Shortpy owned IR corrections
  -> ShortcutsLanguage native IR passes
  -> ShortcutsLanguage.IRToShortcut
  -> captured recurrence correction on native WFAction parameters (if required)
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

Build the Apple-native reference path without the owned C IR adapter with:

```sh
make -C bridge BUILD_DIR=build-sim-native-only ENABLE_SHORTPY_PIPELINE=0
```

The host CLI selects the runtime path with the global
`--pipeline shortpy|native` option. There is no automatic fallback.

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

Import adapts ambiguous action identity before native Python rendering. A
temporary workflow clone replaces only real Add/Set/Get Variable and Comment
objects with per-object export adapters that emit explicit ToolKit calls;
structural control flow and all unaffected actions remain on Apple's exporter.

Editable Python is not normalized before compilation. `ShortpyToShortcut`
owns the compiler pass boundary while retaining Apple's parser, diagnostics,
action lowerer, and workflow serializer. It captures lexical control-result
bindings from untouched frontend IR, applies narrow metadata-driven corrections
for nested control values and loop-carried recurrence preparation, then runs
Apple's native control-flow inference and variable-inlining passes. Because
Apple's backend cannot consume a forward reference to its enclosing control
statement, captured recurrences receive a separate fail-closed native action
correction that changes only the recursive branch's action-output attachment
before `saveToRecord`. The implementation resolves
Swift types, enum cases, fields, and protocol witnesses by name/metadata and
does not hook executable text or use framework-relative addresses.

Import rendering uses workflow Tool IDs only where Apple's Python exporter is
ambiguous or lossy. Native Comment and real Set/Get Variable actions become
their explicit ToolKit functions. Real Add Variable remains natural
`.append(...)` when that syntax is required to establish a named-variable token;
subscript/cast inputs that would materialize extra actions use the explicit
ToolKit function. Structural Repeat/If/Menu accumulators remain Apple-style
Python. List literals remain the native list structural form, while actions such
as Get Item from List retain their ToolKit definitions. The generated Python is
self-contained and recompiles without the source workflow.

Editable inline metadata rebuilds its `WFParameterStateCatalog` from the source
text. Ordinary ref-free source uses `defaultInitialCatalog`; visible editor
source does not depend on a catalog sidecar.

## Live Regression

With the simulator bridge connected, run:

```sh
python3 bridge/tests/runtime_shortpy_to_shortcut.py
```

The suite performs public `Python -> plist -> Python -> plist -> Python` cycles
for conditional, `elif`, and menu loop-carried recurrence; nested Repeat
Results; explicit variable actions; list/Get Item from List; comments; root
decorators; and inline trigger catalog metadata. It requires stable action
identifier/control-mode shapes and semantic action-output edges across both
compiled workflows.

## Metadata Boundary

`toolrenderer-structured-metadata` is the visible IDE metadata surface. It returns ToolRenderer Python-interface actions, triggers, helpers, and types with raw ToolKit keys, host/key bindings, and ToolKit source labels stripped so old caches cannot leak internal catalog details into the UI.

Prepared ToolKit copies normalize tool `pythonName` values and route tools
through a dedicated neutral naming container before ToolRenderer runs. The
host retains callable definitions only when the native rendered name exactly
matches the selected ToolKit name. It never renames a native `def` block or
synthesizes a missing definition; triggers retain their native naming metadata.

Visible parameter metadata retains compiler-facing aliases derived from the
loaded ToolKit's parameter-key closure. Matched ToolRenderer definitions merge
those aliases by exact sequence when duplicate names require positional
pairing, or by a unique parameter-name match when the native and ToolKit
surfaces differ. Ambiguous matches remain open for native compiler validation.
Filter actions use the finite ShortcutsLanguage query surface
(`query`, operators, sort order, limit, and scope) for parameter metadata while
their displayed definition block remains native ToolRenderer text.

Inline catalog metadata compilation uses the native action/trigger ID and raw
parameter key from the active Tool database as the catalog host/key. Runtime
proof showed `ToolRenderer.ParameterMetadataProvider.binding(toolID:)` and
`binding(triggerID:)` expose annotation/default callback metadata rather than a
`WFParameterStateCatalogEntryHandle`. Missing IDs or keys therefore fail with
`unsupportedInlineCatalogContext`; the bridge does not guess a mapping.

## Optional Live Injection

```sh
DYLIBLOAD=/path/to/dylibload bridge/tools/inject_shortcuts_sim_bridge.sh
```

Launch-time loading is the supported path. Live injection remains a debugging fallback and depends on the external `dylibload` helper.
