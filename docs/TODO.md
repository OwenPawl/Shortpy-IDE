# Shortpy IDE TODO

## Implemented

- Simulator bridge uses the standard `visibleForShortcuts` filter; after Shortcuts launch-time ToolKit indexing settles, the prepared-copy path repairs missing enum rows named by typed action/trigger parameter relationships and type instances, reserves the finite ShortcutsLanguage intrinsic action names used by Python literal/subscript syntax, sets DB-present actions to both `visibleForShortcuts` (`0x1`) and `approved` (`0x4`), then backs up, replaces, and WAL-primes the simulator's resolved `Tools-active` target.
- Plist-to-Python action-name canonicalization resolves named AST calls by workflow action identity, retained ToolRenderer native function names, ToolKit aliases, and accepted parameters. Global monotonic semantic alignment allows literal/control-flow gaps; ambiguous or over-capacity matches are reported and left unchanged.
- Intrinsic-backed value actions remain native Python syntax. Other assigned and unused bare values are reified only under canonical action/parameter/output consensus. A fail-closed loop recurrence pass inserts alias-only seed assignments when recursive and nonrecursive branches agree on one existing state seed.
- Ref-free source compiles with `defaultInitialCatalog` rather than an unrelated latest-import fallback. Inline parameter-state values reconstruct an ephemeral compiler catalog from the source itself, while legacy unresolved `ref(...)` source can still use its matching import catalog.
- Production `python-to-bplist` uses the native whole-workflow record serializer:
  `ShortcutsLanguage.pythonToShortcut -> WFWorkflow.saveToRecord -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:`.
- Host-side `python-to-bplist` signs `.shortcut` output by default with macOS `shortcuts sign --mode anyone` while preserving the unsigned `plist_payload`.
- Host-side `plist-data-to-python` unwraps signed AEA1 `.shortcut` files, including `anyone` and `people-who-know-me` auth-data, and sends the embedded `Shortcut.wflow` plist to the simulator bridge.
- Host-side `plist-data-to-python` imports iCloud Shortcuts links by resolving the public record API download URL before simulator conversion.
- `saveToRecord` is called on `workflow.databaseAccessQueue`, not through `WFWorkflow.save`.
- Root decorators such as `@runnable` and `@input_fallback` round trip through workflow plist.
- Native trigger decorators such as `@when_app_opened` round trip through workflow plist.
- Inline app metadata round trips without exposing `ref(...)` in editable Python for the proven app-trigger case.
- VS Code extension has native commands for bridge connect, plist import/export, Apple runtime validation, action/trigger search, and ToolRenderer metadata refresh. Bridge status is passive in the status bar rather than a separate UI command.
- `Shortcuts IDE: Connect To Bridge` can use a bundled bridge runtime from a clean VSIX install: it stages the bridge into extension global storage, builds the simulator dylib when missing, boots/opens Simulator when needed, launches Shortcuts with the bridge, and verifies status.
- The simulator bridge build discovers the installed iOS Simulator runtime dynamically and prefers iOS 27.0 instead of relying on a checked-in machine-local runtime path.
- Visible VS Code commands are centralized in `vscode-extension/src/commandRegistry.js`; package command contributions, activation events, menus, and custom editor toolbar buttons are synced from that registry.
- Visible VS Code metadata is ToolRenderer-only. Cached ToolRenderer metadata powers hovers, completions, signature help, action/trigger search, highlighting, and static Shortpy diagnostics without blocking on the bridge after activation.
- ToolRenderer cache entries preserve exact native Python definition blocks plus parsed Args/Returns sections. Function/decorator hovers show function-level material; keyword hovers show parameter docs/type/default and stable referenced type material.
- Stable ToolRenderer enum cases such as `RunSurface` and `InputFallback` are visible, while environment-specific/custom enum cases are intentionally omitted from hovers and completions.
- ToolRenderer action/trigger docs remain the visible metadata source. Prepared ToolKit copies align each tool's normalized sqlite `pythonName` with the native ToolRenderer render name through a neutral naming container; visible definitions require exact name equality and are never rewritten or synthesized.
- The selected ToolKit sqlite is also adjusted for ToolRenderer generative visibility: action rows missing either `visibleForShortcuts` (`0x1`) or `approved` (`0x4`) have both bits set before refresh, which lets native `ToolRenderer.pythonInterface` render DB-present actions such as `com_apple_shortcuts_search_shortcuts_actions` without a host-side availability overlay.
- Plist import uses workflow action identifiers to rewrite imported action calls to the current sqlite `pythonName` values while preserving inline catalog metadata.
- Static Shortpy diagnostics validate explicit action/trigger namespaces and top-level keyword parameters only when ToolRenderer proves a closed signature. Incomplete or overloaded metadata fails open, while the native compiler remains authoritative. A reusable CLI probe returns the exact VS Code ranges for arbitrary ShortPy input.
- Inline catalog expansion now goes through a binding-adapter boundary that can be replaced by native `WFParameterMetadataProvider.binding(...)` extraction; the current ToolKit-derived binding is an internal compile fallback only.
- Selected proof reports are in `docs/reports/`.

## Next

- Preserve Comment actions and native dictionary-aggrandizement/repeat-result representations without materializing equivalent extra actions during reverse compilation.

- Finish replacing legacy sidecar/ref UI paths with inline parameter-state metadata everywhere.
- Generalize inline parameter-state metadata across all catalog-like action and trigger parameters.
- Prove native `WFParameterMetadataProvider.binding(toolID:)` and `binding(triggerID:)` extraction, then remove the internal ToolKit fallback from inline catalog expansion.
- Add richer snippet generation from ToolRenderer signatures and parameter docs.
- Keep native retrieval/live entity lookup out of the compile path when inline metadata is available.
- Continue proving any remaining hidden DB-present tools by native ToolRenderer behavior rather than host overlays; the current sqlite adjustment sets the `visibleForShortcuts` and `approved` bits and leaves other visibility bits unchanged.
- Tighten VS Code custom editor behavior so plist import/export feels native and does not expose debug-only flows beyond current debug JSON commands.
- Add focused tests that run against a booted iOS 27.0 simulator bridge from this repo checkout.
- Add a clearer first-run troubleshooting surface for missing Xcode tools, missing simulator runtime, or missing private Shortcuts frameworks.

## Out Of Primary UI Scope

- Roundtrip debug JSON commands should remain debug/log paths, not primary UI actions.
- `resolve_entity` remains a bridge/debug API only and is not exposed in the VS Code command palette, editor menus, or custom editor toolbar.
- ToolKit sqlite should not appear as a user-facing VS Code metadata/documentation source.
- `submit_answer` is not part of the editor tool surface.
- Legacy custom trigger DSL should not be preserved.
- Legacy pre-AEA signed shortcut variants beyond current AEA1 import should remain explicit follow-up work.
