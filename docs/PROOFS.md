# Current Proofs

## Native Unsigned Workflow Plist Export

Proven on iOS Simulator 27.0 with bridge version `sim-0.1.25-record-file-saveToRecord-production`.

The production serializer path is:

```text
ShortcutsLanguage.pythonToShortcut
  -> WFWorkflow.databaseAccessQueue dispatch_barrier_sync
  -> WFWorkflow.saveToRecord
  -> WFWorkflow.record
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

The important runtime constraint is that `saveToRecord` must be called on `workflow.databaseAccessQueue`. Calling it directly off that queue asserts in libdispatch.

Validated cases:

- action-only notification: `python -> bplist -> python -> bplist`
- `@runnable(surface=RunSurface.SHARE_SHEET)` plus `@input_fallback(behavior=InputFallback.GET_CLIPBOARD)`
- `@when_app_opened(...)` with inline app metadata

All generated workflow plists passed `plutil -lint` in the source run, and the trigger case preserved `WFWorkflowTriggers`.

## Inline Metadata

Editable Python should use inline parameter-state metadata for catalog-like values. `ref(...)` is an internal compiler representation, not the intended editor-facing abstraction.

Proven app trigger shape:

```python
@when_app_opened(app=[{"Bundle Identifier": "com.apple.shortcuts", "Name": "Shortcuts"}])
def shortcut() -> None:
    com_apple_shortcuts_show_notification(title="Inline metadata", body="Bridge compile")
```

The bridge rewrites inline metadata to compiler refs and catalog metadata before compile, then replaces refs with inline metadata on plist import.

## Native Decorators

The bridge sends native ToolRenderer/ShortcutAgent decorator syntax directly to Apple's compiler. It should not preserve the old custom trigger DSL.

Proven:

- `@when_app_opened`
- `@runnable`
- `@input_fallback`

## Validation Surface

The extension and bridge expose:

- native Apple compiler diagnostics and fix-it parsing where available
- ToolRenderer metadata retrieval
- ToolKit-backed fallback metadata for live editor diagnostics
- top-level action/trigger parameter checks only, leaving nested payload validation to Apple runtime diagnostics
