# Shortpy IDE Simulator Bridge

This bridge loads into the iOS Simulator Shortcuts process and exposes the native Shortcuts Python compiler, plist import/export path, ToolRenderer metadata, and related agent-style tool surfaces over a local Unix socket.

Current target:

- iOS Simulator 27.0
- `ToolVisibilityFilter.any` for compiler validation, with typed-reference enum closure repair and ToolKit sqlite visibility/approval adjustment for ToolRenderer exposure
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

Post-import action-name canonicalization is semantic and fail-closed. Named AST
calls are matched against workflow action identities, retained ToolRenderer
native function names, ToolKit aliases, and parameter names. A global monotonic
semantic alignment permits literal/control-flow gaps without positional shifts;
ambiguous matches remain unchanged with structured diagnostics.

Python-syntax actions retain their ToolKit names during preparation; for
example, list literals are lowered internally to `com_apple_shortcuts_list`.
Other
value-rendered actions are reified only when one canonical action and one
serialized parameter agree. Loop-carried branch results receive an alias-only
seed assignment when same-call keyword recurrence identifies one existing seed;
ambiguous control flow remains unchanged.

Before native compilation, the host CLI applies a narrow owned control-flow
normalization pass. Complete menu and conditional accumulators become native
branch-result assignments, `elif` chains become nested conditionals so each
condition uses Apple's working primary lowerer, and nested control-flow values
crossing a Repeat Results boundary receive a collision-free same-line alias.
Explicit non-result list mutations lower internally through native Set/Add/Get
Variable actions and are restored to normal list syntax on import. The pass
does not patch the dylib, edit workflow plists, or replace Apple's parser,
diagnostics, variable inlining, action lowerer, or workflow serializer.

Compilation uses an imported `WFParameterStateCatalog` only while legacy source
still contains matching `ref(...)` handles. Editable inline metadata rebuilds
its catalog from the source text, and ordinary ref-free source uses
`defaultInitialCatalog` even when an import context is resident in the bridge.

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

Inline catalog metadata compilation goes through a separate binding adapter. The adapter is shaped for native `WFParameterMetadataProvider.binding(toolID:)` / `binding(triggerID:)` extraction and currently falls back internally to ToolKit-derived host/key data only when no native binding has been proven. That fallback is not a VS Code documentation or completion source.

## Optional Live Injection

```sh
DYLIBLOAD=/path/to/dylibload bridge/tools/inject_shortcuts_sim_bridge.sh
```

Launch-time loading is the supported path. Live injection remains a debugging fallback and depends on the external `dylibload` helper.
