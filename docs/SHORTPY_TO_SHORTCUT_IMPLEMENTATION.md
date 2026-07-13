# Shortpy Runtime Pipeline

## Purpose

Shortpy IDE keeps Apple's compiler and edit-mode exporter available, but adds a
small owned layer for native control-flow bugs that cannot be repaired by
rewriting user Python. The owned entry points are:

- `ShortpyToShortcut`: Python to `WFWorkflow`.
- `ShortpyEditModeContext`: `WFWorkflow` to independently compilable Python.

The implementation does not hook executable text, patch framework addresses,
or normalize editable Python. Native symbols and resilient Swift metadata are
resolved by name. Unsupported runtime shapes fail closed.

## Pipeline Selection

Every compile/import command carries a `RuntimePipeline` value:

- `shortpy` is the normal bridge path.
- `native` calls Apple's original `ShortcutsLanguage.pythonToShortcut` and
  `DescribeAShortcutAgent.editModeContext(for:)` behavior.

The host CLI exposes this as the global `--pipeline shortpy|native` option.
There is intentionally no VS Code setting: the editor uses the production
Shortpy path, while native mode remains a diagnostic and removal reference.
There is no silent fallback between pipelines.

The socket protocol has one command family, parameterized by pipeline:

```text
pipeline-python-to-bplist-b64-flags
pipeline-python-to-bplist-catalog-b64-flags
pipeline-plist-to-python-b64
pipeline-plist-data-to-python-b64
```

The old parallel `direct-run`, `shortpy-direct-run`, and non-pipeline
compile/import commands were removed.

## ShortpyToShortcut

```text
Editable Python
  -> inline parameterState preprocessing
  -> ShortcutsLanguage.PythonToIR
  -> Shortpy control-flow binding capture
  -> Shortpy loop-carried recurrence preparation
  -> Apple ControlFlowOutputInferencePass
  -> Apple VariableInliningPass
  -> Shortpy nested-control-result correction
  -> ShortcutsLanguage.IRToShortcut
  -> CompiledShortcut.workflow
  -> native recurrence action correction, when required
  -> WFWorkflow.saveToRecord
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
  -> unsigned workflow bplist
```

`ShortpyToShortcut` creates one native Tool database and one flags value for the
frontend and backend. It keeps `ToolVisibilityFilter.any`, compiler diagnostics,
error-policy decisions, root decorators, native trigger decorators, and the
native `WFWorkflow` model.

### Owned IR adapter

`bridge/src/shortpy/shortpy_ir_adapter.c` operates on Apple's native resilient
IR values. It discovers type metadata, enum cases, and fields by name, then uses
Swift value witnesses to copy and destroy values. It records:

- native statement identity;
- lexical control owner and branch ordinal;
- structural Repeat, If/Else, and Choose from Menu outputs;
- nested control-result transfers;
- loop-carried seed and recursive branches.

Variable spelling is not a global identity. A deliberately named user variable
inside control flow is distinguished by native statement and lexical ownership.
Direct ToolKit calls remain ordinary action calls; Python structural nodes
remain structural IR.

The adapter changes only proven control-result operations. Apple's native
passes and `IRToShortcut` still lower ordinary actions, list syntax, variable
syntax, conditions, loops, and menus.

### Recurrence correction

The iOS 27 runtime rejects a recursive IR edge that directly references its
enclosing control statement. Shortpy therefore prepares an acyclic native IR
form so `IRToShortcut` can finish, then restores the one captured recurrence
edge on the resulting native workflow.

This correction no longer parses or rewrites a whole workflow plist. It:

1. Reads `serializedParameters` from each native `WFAction`.
2. Matches the captured control kind and exact seed/target branch ordinals.
3. Requires one unique shared action-output parameter path.
4. Replaces that attachment with the enclosing close action's UUID/output name.
5. Reconstructs only affected native actions through
   `initWithIdentifier:definition:serializedParameters:`.
6. Replaces those actions on the `WFWorkflow` before `saveToRecord`.

If the native structure does not identify one edge, compilation returns
`unsupportedLoopCarriedRecurrence`; it never guesses from variable names.

## ShortpyEditModeContext

Apple's exporter represents both synthetic control-result accumulation and a
real `is.workflow.actions.appendvariable` as `WFProgramAppendNode`. A nested
control result consumed by a real append can therefore make
`editModeContext(for:)` throw before Python exists.

Shortpy keeps Apple's exporter but supplies it a temporary workflow clone:

1. Structural control-flow actions are unchanged.
2. Only ambiguous real action objects are cloned into dynamic adapter
   subclasses.
3. The adapter overrides `exportWithError:` for that cloned object only.
4. Apple's ordinary action exporter builds an explicit ToolKit call node.
5. Native `DescribeAShortcutAgent.editModeContext(for:)` renders the resulting
   program and all unaffected actions/decorators.

There is no global swizzle or process-wide hook. Current explicit action forms
cover native Add/Set/Get Variable and Comment actions. This produces forms such
as:

```python
com_apple_shortcuts_add_to_variable(
    variable="repeat_results",
    input=repeat_results1,
)
```

Synthetic Repeat/If/Menu accumulators keep Apple's normal `.append(...)`
syntax. The Python is self-contained; `ShortpyToShortcut` never needs the
source workflow or hidden provenance to compile it.

List literals and other structural Python remain structural. Actions such as
Get Item from List retain the direct ToolKit definition emitted by the native
renderer. If another native action is later proven ambiguous, it should be
added at this same per-action export boundary, not with rendered-text rewriting.

## Inline Catalog Metadata

Editable Python stores plist-compatible `parameterState` dictionaries directly:

```python
@when_app_opened(app=[{
    "Bundle Identifier": "com.apple.shortcuts",
    "Name": "Shortcuts",
}])
def shortcut() -> None:
    pass
```

The host recognizes inline values only for ToolRenderer parameters typed as
`Resolved[...]` or `Picked[...]`. Before compilation it:

1. Allocates a stable 16-bit `ref(0x....)` for a compiler-only source copy.
2. Builds the corresponding `WFParameterStateCatalogEntry`.
3. Sends the rewritten source and catalog to the selected runtime pipeline.
4. Replaces refs with decoded `parameterState` JSON during import.

No ref or catalog sidecar appears in editable Python.

Static and LLDB analysis established an important boundary:
`ToolRenderer.ParameterMetadataProvider.binding(toolID:)` and
`binding(triggerID:)` return `ParameterMetadata` callback bundles for
annotations, defaults, and dynamic options. They do not return a
`WFParameterStateCatalogEntryHandle` or `hostAndKey`.

The native catalog host identity is therefore sourced from the active Tool
database itself:

- action or trigger native ID;
- trigger variant encoded in the trigger ID;
- raw native parameter key.

The bridge labels this source `active-tool-database`. If those fields are not
present, it returns `unsupportedInlineCatalogContext` instead of inventing a
mapping. The same mechanism is used for actions and triggers.

## Native Workflow Serialization

The bridge serializes the complete native workflow. It does not manually
assemble `WFWorkflowActions`, `WFWorkflowTriggers`, or root metadata.

`saveToRecord` must run as a barrier on `workflow.databaseAccessQueue`; calling
it directly off that queue caused a libdispatch assertion during runtime proof.
The production serializer is:

```text
WFWorkflow.databaseAccessQueue
  -> WFWorkflow.saveToRecord
  -> WFWorkflow.record
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

This preserves unified automation triggers and root decorators through Apple's
own workflow-record model.

## Removal and Revert

The owned layer has two explicit removal mechanisms.

Runtime bypass:

```sh
python3 bridge/tools/bridgectl.py --pipeline native ...
```

Native-only build:

```sh
make -C bridge BUILD_DIR=build-sim-native-only ENABLE_SHORTPY_PIPELINE=0
```

The native-only binary omits `shortpy_ir_adapter.c`, accepts native pipeline
commands, and explicitly rejects a request for `shortpy`. Once Apple fixes the
native bugs, removal is localized to:

- the `shortpy` case in `RuntimePipeline`;
- `ShortpyToShortcut` and its adapter source;
- the temporary edit-export action adapters;
- recurrence action reconstruction.

The protocol, inline catalog preprocessing, ToolKit selection, workflow-record
serializer, and VS Code integration can remain unchanged.

## Runtime Proof

The live simulator regression suite performs two independent
`Python -> plist -> Python -> plist` cycles for:

- loop-carried recurrence;
- `if`/`elif`/`else` recurrence;
- Choose from Menu recurrence;
- nested Repeat Results;
- explicit variable actions;
- list and Get Item from List;
- native Comment actions;
- root decorators;
- inline trigger catalog metadata.

The signed `Minimal Repeat Results Roundtrip Bug.shortcut` now imports and
recompiles twice with identical Python and the original seven-action
identifier/control-mode shape. The action sequence includes both the synthetic
nested Repeat Results and the real `appendvariable` action.

Inline app metadata was also compiled and reimported through both `native` and
`shortpy` pipelines for an action and `@when_app_opened`; all four paths return
inline metadata with no visible `ref(...)`.

The native-only build was loaded into simulator Shortcuts. A native compile
succeeded, while a Shortpy request returned the explicit
`shortpy runtime pipeline is unavailable in this native-only bridge build`
diagnostic.

These tests prove structural and semantic round-trip stability, not byte-for-byte
plist identity. Generated UUIDs and opaque metadata are not represented in
Python; the custom editor retains original bytes separately for a no-edit
export.
