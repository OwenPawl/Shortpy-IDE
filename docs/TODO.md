# Shortpy IDE TODO

## Implemented

- Simulator bridge uses `ToolVisibilityFilter.any`.
- Production `python-to-bplist` uses the native whole-workflow record serializer:
  `ShortcutsLanguage.pythonToShortcut -> WFWorkflow.saveToRecord -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:`.
- Host-side `python-to-bplist` signs `.shortcut` output by default with macOS `shortcuts sign --mode anyone` while preserving the unsigned `plist_payload`.
- `saveToRecord` is called on `workflow.databaseAccessQueue`, not through `WFWorkflow.save`.
- Root decorators such as `@runnable` and `@input_fallback` round trip through workflow plist.
- Native trigger decorators such as `@when_app_opened` round trip through workflow plist.
- Inline app metadata round trips without exposing `ref(...)` in editable Python for the proven app-trigger case.
- VS Code extension has native commands for bridge status/connect, plist import/export, Apple runtime validation, action/trigger search, entity debug flow, ToolKit metadata, and ToolRenderer metadata.
- Static diagnostics validate action/trigger names and top-level keyword parameters only.
- Selected proof reports are in `docs/reports/`.

## Next

- Finish replacing legacy sidecar/ref UI paths with inline parameter-state metadata everywhere.
- Generalize inline parameter-state metadata across all catalog-like action and trigger parameters.
- Expand structured ToolRenderer metadata use in hovers, completions, signature help, snippets, and diagnostics.
- Keep native retrieval/live entity lookup out of the compile path when inline metadata is available.
- Tighten VS Code custom editor behavior so plist import/export feels native and does not expose debug-only flows.
- Package a clean VSIX from this repository layout.
- Add focused tests that run against a booted iOS 27.0 simulator bridge from this repo checkout.

## Out Of Primary UI Scope

- Roundtrip debug JSON commands should remain debug/log paths, not primary UI actions.
- `submit_answer` is not part of the editor tool surface.
- Legacy custom trigger DSL should not be preserved.
- Signed shortcut/AES/AEA1 envelope extraction is a later import feature.
