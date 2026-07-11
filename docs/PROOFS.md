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

## Control-flow compiler adapter

Static and live IR captures proved that Apple's unconditional
`ControlFlowOutputInferencePass` removes the outer Repeat accumulator but can
leave its append action when the appended value is another control-flow output.
Direct `elif` lowering also omitted later conditions, while menu/conditional
list accumulators remained disconnected named-variable actions.

The production fix is an owned host AST normalization pass, not a hook or plist
rewrite. It converts only proven complete output shapes before
`ShortcutsLanguage.pythonToShortcut`, then keeps Apple's parser, diagnostics,
variable inlining, action lowerer, and workflow serializer authoritative.
Nine finite/foreach/menu/conditional collision and nesting fixtures pass
`Python -> plist -> Python -> plist` with stable native action shapes.

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

## Host Shortcuts Record Sync

Proven on macOS with the host Shortcuts process already running:

```text
Shortpy source
  -> simulator ShortcutsLanguage compiler
  -> unsigned workflow bplist
  -> WFWorkflowFile.recordRepresentationWithError:
  -> WFWorkflowRecord
  -> WFDatabaseProxy.createWorkflowWithWorkflowRecord:... (first sync)
  -> WFDatabaseWorkflowStorage.saveRecord:withReference:error: (later syncs)
```

The edit path preserves the workflow ID and name while saving the complete
replacement record. A copied-database comparison matched actions, icon,
unified trigger data including `WFSelectedApps`, input/output classes,
fallback state, and import questions. The live Shortcuts AppleScript surface
reported the same workflow ID changing from one to two actions without an app
relaunch; the disposable test record was then deleted and database integrity
remained `ok`.

Host records can also be exported without mutation through
`WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:`.
Repeated binary encodings can differ in object-table order, but canonical XML
hashes are stable. Two-way sync stores the last host plist and the plist
compiled from its generated Python. A recursive plist delta applies editor
changes to the current host record, preserving values not represented by
Shortpy. `WFWorkflowIcon` is explicitly host-owned because identical compiler
runs generate different default icon colors and Shortpy has no editable icon
syntax.
