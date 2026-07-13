# Current Proofs

## Native Unsigned Workflow Plist Export

Proven on iOS Simulator 27.0 with bridge version `sim-0.1.25-record-file-saveToRecord-production`.

The production serializer path is:

```text
ShortpyToShortcut
  -> ShortcutsLanguage.PythonToIR
  -> Shortpy native IR correction passes
  -> ShortcutsLanguage native IR passes
  -> ShortcutsLanguage.IRToShortcut
  -> captured recurrence correction on native WFAction parameters (if required)
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

The production fix is `ShortpyToShortcut`, an owned compiler pipeline rather
than a hook or source rewrite. It parses unchanged Python with
`PythonToIR`, captures statement/scope bindings before destructive native
passes, applies metadata-driven corrections, then runs Apple's control-flow
inference, variable inlining, `IRToShortcut`, and workflow serializer.
Finite/foreach/menu/conditional collision and nesting fixtures pass public
`Python -> plist -> Python -> plist` cycles with stable native action shapes.
The signed `Shortcut Debugger.shortcut` fixture additionally proved the more
general nested shape where an outer Repeat Results append contains an action
call that consumes an inner control-flow result. The owned pass transfers the
native result binding without changing the Python. Loop-carried recurrence uses
a native IR preparation to make the unchanged source lowerable, followed by a
fail-closed native `WFAction` correction that changes only the recursive
branch's captured action-output edge before `saveToRecord`. Conditional,
`elif`, and Choose from Menu recurrences pass
two independent compile cycles. Native Comment actions import as explicit
`com_apple_shortcuts_comment(...)` calls. Real Add Variable actions with direct
casts or subscripts import through
`com_apple_shortcuts_add_to_variable(...)`, preserving
`WFCoercionVariableAggrandizement` and
`WFDictionaryValueVariableAggrandizement` on the append input. The supplied
workflow compiles from 94 actions to the same 94 action identifiers in the same
order. All 64 action-output dependency edges and their aggrandizements remain
stable across the original and both independent compile cycles.

Compiled plist bytes are still not byte-identical because Shortpy does not
represent generated UUIDs, implicit defaults, or opaque per-action/root
metadata. The custom editor owns that lossless no-edit boundary: it retains
imported document bytes in session memory and writes them unchanged when the
editable Shortpy is unchanged. The real signed fixture exported byte-for-byte
with SHA-256
`47800ced59bf6c86982f19308b72b76a3c3184d34f5bb0cb118c715402e5881e`.

Proven:

- `@when_app_opened`
- `@runnable`
- `@input_fallback`

## Validation Surface

The extension and bridge expose:

- native Apple compiler diagnostics and fix-it parsing where available
- ToolRenderer metadata retrieval
- ToolRenderer-only cached metadata for live editor diagnostics
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
