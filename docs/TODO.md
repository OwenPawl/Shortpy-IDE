# Shortpy IDE TODO

## Implemented

- Simulator bridge uses `ToolVisibilityFilter.any`; after Shortcuts launch-time ToolKit indexing settles, the prepared-copy path repairs missing enum rows named by typed action/trigger parameter relationships and type instances, preserves ToolKit Python names used behind Python literal/subscript syntax, sets DB-present actions to both `visibleForShortcuts` (`0x1`) and `approved` (`0x4`), then backs up, replaces, and WAL-primes the simulator's resolved `Tools-active` target.
- `ShortpyToShortcut` parses unchanged source through `PythonToIR`, captures lexical control-flow bindings, applies owned native IR corrections, then runs Apple's control-flow inference, variable inlining, `IRToShortcut`, and workflow serializer. Loop-carried branch recurrences use native IR preparation plus a fail-closed native `WFAction` parameter correction before `saveToRecord`; no Python aliases or whole-workflow plist rewrites are used.
- `ShortpyEditModeContext` preserves Apple's structural control-flow Python while exporting ambiguous real Add/Set/Get Variable and Comment actions as explicit ToolKit calls through per-object adapter subclasses. It does not swizzle Apple classes or require workflow provenance during later compilation.
- All compile/import socket commands use a single explicit `RuntimePipeline` boundary. `shortpy` is the production default, `native` calls Apple's original compiler/exporter, and there is no silent fallback. `ENABLE_SHORTPY_PIPELINE=0` builds and runs a native-only bridge without the owned C IR adapter.
- Ref-free source compiles with `defaultInitialCatalog` rather than an unrelated latest-import fallback. Inline parameter-state values reconstruct an ephemeral compiler catalog from the source itself without a visible sidecar.
- Production `python-to-bplist` uses the owned compiler boundary and native whole-workflow record serializer:
  `ShortpyToShortcut -> WFWorkflow.saveToRecord -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:`.
- Host-side `python-to-bplist` signs `.shortcut` output by default with macOS `shortcuts sign --mode anyone` while preserving the unsigned `plist_payload`.
- Host-side `plist-data-to-python` unwraps signed AEA1 `.shortcut` files, including `anyone` and `people-who-know-me` auth-data, and sends the embedded `Shortcut.wflow` plist to the simulator bridge.
- Host-side `plist-data-to-python` imports iCloud Shortcuts links by resolving the public record API download URL before simulator conversion.
- `saveToRecord` is called on `workflow.databaseAccessQueue`, not through `WFWorkflow.save`.
- Root decorators such as `@runnable` and `@input_fallback` round trip through workflow plist.
- Native trigger decorators such as `@when_app_opened` round trip through workflow plist.
- Inline app metadata round trips without exposing `ref(...)` in editable Python for the proven app-trigger case.
- VS Code extension has native commands for bridge connect, plist import/export, Apple runtime validation, action/trigger search, and ToolRenderer metadata refresh. Bridge status is passive in the status bar rather than a separate UI command.
- `Shortcuts IDE: Connect To Bridge` can use a bundled bridge runtime from a clean VSIX install: it stages the bridge into extension global storage, builds the simulator dylib when missing, boots/opens Simulator when needed, launches Shortcuts with the bridge, and verifies status.
- `Shortcuts IDE: Sync With Host Shortcuts` persists a workflow ID plus canonical source/host hashes, automatically pushes or pulls one-sided changes, and presents a single conflict dialog for simultaneous edits. Internal baseline host/compiled plists preserve host-only metadata while applying structural Python deltas.
- The simulator bridge build discovers the installed iOS Simulator runtime dynamically and prefers iOS 27.0 instead of relying on a checked-in machine-local runtime path.
- Visible VS Code commands are centralized in `vscode-extension/src/commandRegistry.js`; package command contributions, activation events, menus, and custom editor toolbar buttons are synced from that registry.
- Visible VS Code metadata is ToolRenderer-only. Cached ToolRenderer metadata powers hovers, completions, signature help, action/trigger search, highlighting, and static Shortpy diagnostics without blocking on the bridge after activation.
- ToolRenderer cache entries preserve exact native Python definition blocks plus parsed Args/Returns sections. Function/decorator hovers show function-level material; keyword hovers show parameter docs/type/default and stable referenced type material.
- ToolRenderer-rendered enum/type definitions and cases remain visible. Runtime-shaped definitions receive a simulator-runtime notice rather than being hidden or treated as hard static-diagnostic failures.
- ToolRenderer action/trigger docs remain the visible metadata source. Prepared ToolKit copies align each tool's normalized sqlite `pythonName` with the native ToolRenderer render name through a neutral naming container; visible definitions require exact name equality and are never rewritten or synthesized.
- The selected ToolKit sqlite is also adjusted for ToolRenderer generative visibility: action rows missing either `visibleForShortcuts` (`0x1`) or `approved` (`0x4`) have both bits set before refresh, which lets native `ToolRenderer.pythonInterface` render DB-present actions such as `com_apple_shortcuts_search_shortcuts_actions` without a host-side availability overlay.
- Plist import preserves inline catalog metadata and obtains explicit ambiguous action representations at the native workflow-to-program export boundary, not through host AST/action-order rewriting.
- Static Shortpy diagnostics validate explicit action/trigger namespaces and top-level keyword parameters only when ToolRenderer proves a closed signature. Incomplete or overloaded metadata fails open, while the native compiler remains authoritative. A reusable CLI probe returns the exact VS Code ranges for arbitrary ShortPy input.
- Inline catalog expansion uses the native action/trigger ID and raw parameter key from the active Tool database as its catalog `hostAndKey`. Static and LLDB proof showed `ToolRenderer.ParameterMetadataProvider.binding(...)` returns annotation/default callback metadata, not a catalog entry handle, so it is not mislabeled as the host/key source.
- Owned native IR passes preserve finite Repeat and Repeat with Each results
  across nesting, connect Choose from Menu and `if`/`elif`/`else` result
  accumulators, and prepare loop-carried recurrence without changing Python.
  A native action correction uses the captured branch plan to repair only the
  recursive action-output edge and fails closed when the workflow shape is not
  unique. It reads `WFAction.serializedParameters`, reconstructs only affected
  actions, and runs before native workflow-record serialization.
  Real Set/Add/Get Variable actions and list operations use explicit ToolKit
  functions when action identity would otherwise be ambiguous; structural
  accumulators and list literals keep Apple's native syntax.
- Native Comment actions import as explicit
  `com_apple_shortcuts_comment(comment=...)` calls, including empty,
  multiline, leading-hash, and trailing-newline values.
- Real Add Variable actions use `com_apple_shortcuts_add_to_variable(...)`
  when explicit identity is required, including cast and subscript inputs.
  Structural Repeat Results appends remain `.append(...)`; the owned IR pass
  distinguishes them by lexical control scope instead of variable-name rules.
- Selected proof reports are in `docs/reports/`.

## Next

- Add fixtures for additional `Resolved[...]` and `Picked[...]` parameter-state classes beyond the proven action and trigger app cases; the adapter already treats their active Tool-database ID/key identity generically.
- Extend `ShortpyEditModeContext` only when a new minimal fixture proves another real action collides with Apple's structural program nodes.
- Add richer snippet generation from ToolRenderer signatures and parameter docs.
- Keep native retrieval/live entity lookup out of the compile path when inline metadata is available.
- Continue proving any remaining hidden DB-present tools by native ToolRenderer behavior rather than host overlays; the current sqlite adjustment sets the `visibleForShortcuts` and `approved` bits and leaves other visibility bits unchanged.
- Tighten VS Code custom editor behavior so plist import/export feels native and does not expose debug-only flows beyond current debug JSON commands.
- Keep the live `runtime_shortpy_to_shortcut.py` corpus growing as new native
  control-flow and ToolKit action representations are proven.
- Add a clearer first-run troubleshooting surface for missing Xcode tools, missing simulator runtime, or missing private Shortcuts frameworks.
- Add command-palette host-link management for intentionally unlinking or attaching an editor to an existing host workflow.

## Out Of Primary UI Scope

- Roundtrip debug JSON commands should remain debug/log paths, not primary UI actions.
- `resolve_entity` remains a bridge/debug API only and is not exposed in the VS Code command palette, editor menus, or custom editor toolbar.
- ToolKit sqlite should not appear as a user-facing VS Code metadata/documentation source.
- `submit_answer` is not part of the editor tool surface.
- Legacy custom trigger DSL should not be preserved.
- Legacy pre-AEA signed shortcut variants beyond current AEA1 import should remain explicit follow-up work.
