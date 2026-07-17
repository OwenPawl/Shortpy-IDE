# Shortpy Runtime Ownership

## Purpose

Shortpy IDE owns two narrow runtime pipelines around Apple's ShortcutsLanguage
implementation:

- `ShortpyToShortcut`: standalone Shortpy source to a native `WFWorkflow` and
  workflow file.
- `ShortpyEditModeContext`: a native `WFWorkflow` to standalone Shortpy source.

The goal is not to replace ShortcutsLanguage. The goal is to preserve Apple's
language, ToolKit action surface, decorators, diagnostics, workflow model, and
serializer while correcting a small set of proven control-flow ambiguities.

Both owned paths are explicit and removable. The bridge retains Apple's original
compiler and edit-mode exporter as the `native` pipeline, does not silently fall
back between implementations, and can be built without the Shortpy layer.

## Why Shortpy Owns These Boundaries

Apple's native Python representation overloads a few program nodes:

- A synthetic Repeat Results accumulator is rendered as
  `repeat_results.append(value)`.
- A real Add to Variable action can also be represented by an append node.
- If, Repeat, and Choose from Menu results can be transferred through generated
  assignments or appends that look like ordinary variable operations.
- A value carried from one control-flow branch or iteration to the next can form
  a recursive IR edge that Apple's iOS 27 backend rejects or lowers incorrectly.

These collisions cannot be fixed reliably by renaming variables or rewriting
rendered Python. A user is allowed to deliberately create variables named
`repeat_results`, and nested controls can reuse generated-looking names. The
identity required to distinguish the cases exists in the native IR and workflow
objects, not in variable spelling.

Shortpy therefore owns the two boundaries where that identity is still present:

1. After Apple's Python frontend has produced native IR, but before Apple's
   backend has lowered it to workflow actions.
2. After a workflow has been materialized as native `WFAction` objects, but
   before Apple's edit-mode exporter has collapsed actions into program nodes.

## Ownership At A Glance

| Concern | Shortpy owns | Apple still owns |
| --- | --- | --- |
| Python parsing | Pass ordering and targeted native IR corrections | `PythonToIR`, syntax, types, diagnostics |
| Control flow | Lexical binding capture, nested-result correction, recurrence preparation/restoration, terminal Else If compatibility | Normal Repeat, If/Else, Choose from Menu, and variable lowering |
| Action compilation | Selection of one Tool database, backend invocation, and opaque transfer of Apple-produced Else If condition payloads | `IRToShortcut`, condition serialization, ToolKit definitions, parameters, action construction |
| Workflow export | Per-object adapters for proven ambiguous real actions | `DescribeAShortcutAgent.editModeContext(for:)`, structural rendering, decorators |
| Workflow persistence | Corrected native actions before persistence | `WFWorkflow.saveToRecord`, `WFWorkflowRecord`, `WFWorkflowFile` |
| Catalog values | Inline metadata preprocessing and ref reification | Native parameter-state catalog and compiler consumption |
| Fallback | Explicit pipeline selection and native-only build | Original `pythonToShortcut` and `editModeContext(for:)` paths |

Shortpy does not own Python grammar, general action lowering, trigger encoding,
workflow root assembly, or rendered-source postprocessing.

## Runtime Pipeline Boundary

`RuntimePipeline` is the single switch shared by compile and import commands:

```swift
private enum RuntimePipeline: UInt64 {
    case native = 0
    case shortpy = 1
}
```

- `shortpy` is the production IDE path.
- `native` calls Apple's unmodified reference behavior.

The socket protocol carries the pipeline on one command family:

```text
pipeline-python-to-bplist-b64-flags
pipeline-python-to-bplist-catalog-b64-flags
pipeline-plist-to-python-b64
pipeline-plist-data-to-python-b64
```

There are no parallel legacy compile/import command implementations and no
automatic fallback. A Shortpy failure remains visible instead of being hidden by
a native retry.

## `ShortpyToShortcut`

### Complete Data Flow

```text
Editable Shortpy
  -> inline catalog preprocessing on a compiler-only source copy
  -> ShortcutsLanguage.PythonToIR
  -> native IRProgram
  -> ShortpyControlFlowPlan (read-only)
  -> ShortpyControlFlowInputPreparation
  -> Apple ControlFlowOutputInferencePass to a fixpoint
  -> ShortpyControlFlowOutputRepair
  -> Apple VariableInliningPass to a fixpoint
  -> Apple DropCommentsPass
  -> capture canonical final IR and read-only action provenance
  -> ShortpyElseIfConditionWitnessPreparation on the terminal IR value
  -> ShortcutsLanguage.IRToShortcut backend
  -> CompiledShortcut.workflow
  -> validated Else If condition transfer and witness-marker removal
  -> targeted native recurrence action reconstruction, if required
  -> WFWorkflow.saveToRecord on databaseAccessQueue
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
  -> unsigned workflow bplist
```

The source supplied by the editor is not normalized or rewritten for control
flow. Inline catalog dictionaries are the one intentional preprocessing feature:
they are converted to compiler-only `ref(...)` values and a native catalog, then
restored to inline dictionaries during import.

### Native Frontend And Backend

Each compile creates one fresh Tool database. The same database and compiler
flags are used by `PythonToIR`, the native passes, and `IRToShortcut`. This avoids
frontend/backend disagreement about actions, triggers, names, or visibility.
`ToolVisibilityFilter.any` remains part of the compiler flags.

Shortpy does not reimplement `IRToShortcut`. It resolves the native
`IRToShortcut: Backend` conformance by inspecting Swift protocol-conformance
metadata in the loaded ShortcutsLanguage image, obtains the async backend entry
point and context size, and invokes that native backend through a narrow ABI
shim. Resolution is by loaded image metadata and names, not a fixed address.

If the expected conformance, context shape, or native metadata is unavailable,
the compile fails with an explicit diagnostic.

### Else If Backend Compatibility

The iOS 27 `IRToShortcut` backend reads the number of
`IRConditional.elseIfBranches` but does not lower their conditions. It emits
one unconditioned mode-1 marker per branch. This is an Apple backend defect,
not a parsing or IR-loss issue: the final native IR still contains every branch
condition.

After canonical final-IR text and explicit-action provenance have been
captured, Shortpy treats the `IRProgram` as terminal and ephemeral. For each
Else If branch it inserts an empty conditional witness whose mode-0 branch is
a native value-witness copy of that branch. Apple's backend then serializes the
condition through its normal mode-0 path in the same compilation.

The resulting workflow is repaired transactionally:

1. Match witness and target conditional groups by validated native traversal
   ordinal and grouping identifier.
2. Copy every opaque condition field except control mode, grouping identifier,
   and UUID from witness mode 0 to the corresponding target mode 1.
3. Preserve or add the final unconditioned mode-1 Else boundary.
4. Remove both marker actions for every empty witness.
5. Commit the complete action array with one `setActions:` call.

Real branch bodies are never copied or moved. Multiple and nested Else If
branches map in source order. Condition families, operators, inputs, and
action-output references remain Apple-owned; Shortpy does not serialize any of
them. A changed group count, mode sequence, preconditioned native mode-1 marker,
or unresolved ordinal aborts before the workflow is modified.

There is no backend IR copy. Once witnesses are inserted, Shortpy never reads
the mutated IR again; it is passed only to `IRToShortcut` and then destroyed.

### Control-Flow Compatibility Plan

`ShortpyControlFlowPlan` walks the native `IRProgram` before any pass mutates
it. The plan is read-only and records:

- native statement IDs;
- lexical control owner IDs;
- branch ordinals;
- Repeat and finite-Repeat result bindings;
- If, Else If, Else, and Choose from Menu result bindings;
- seed and recursive branches for loop-carried values;
- conflicting writes that make a structural interpretation unsafe.

The plan is keyed by native identity. It is not encoded in the
Python and is not needed after compilation. Variable names are compared only as
one local property of a binding; they are never treated as globally unique
identity.

This is what makes the path safe when a user deliberately names a variable
`repeat_results` inside a Repeat. A structural append is accepted only when its
statement, lexical owner, branch placement, and write behavior match the
captured control result.

### Owned Native IR Adapter

The adapter in `bridge/src/shortpy/shortpy_ir_adapter.c` works directly with
Swift resilient values. It discovers native type metadata, enum cases, fields,
and generic element types by name and reflection. It uses Swift value witnesses
to copy, take, and destroy values correctly.

It does not mirror complete private Swift structs in C. The adapter resolves
only the fields and enum cases needed by one input-preparation hook and one
output-repair hook, validates them before mutation, and fails closed if a
runtime no longer has the expected shape.

The assembly shims in `bridge/src/runtime_direct_shims_sim.S` handle the narrow
Swift calling-convention boundaries for:

- `PythonToIR` initialization and visitation;
- native pass initialization/application;
- `IRToShortcut` backend invocation;
- mode-0 serialization of every conditional predicate;
- native statement IDs and Swift string operations;
- `DescribeAShortcutAgent.editModeContext(for:)`.

### Loop-Carried Recurrence

A recurrence occurs when a control result from one branch or iteration feeds a
later branch of that same control. The native backend cannot consume the direct
recursive edge on the affected iOS 27 runtimes.

Shortpy handles this in two phases:

1. `ShortpyControlFlowInputPreparation` changes only the captured seed
   and recursive native IR bindings into an acyclic form that Apple's backend can
   lower.
2. After `IRToShortcut` returns a native `WFWorkflow`, Shortpy restores the
   intended edge on the affected native action parameters before persistence.

The restoration does not parse and regenerate the entire workflow plist. For
each proven recurrence plan it:

1. Reads each action's native `serializedParameters`.
2. Matches the captured control kind and exact seed/target branch ordinals.
3. Requires one unique action-output attachment path.
4. Replaces only that attachment with the enclosing control close action's UUID
   and output name.
5. Reconstructs only the affected action using
   `initWithIdentifier:definition:serializedParameters:`.
6. Replaces that action in the existing native `WFWorkflow`.

If there is no unique edge, the bridge returns
`unsupportedLoopCarriedRecurrence`. It never guesses from action order or
variable names.

### Post-Inference Output Repair

`ShortpyControlFlowOutputRepair` runs once, immediately after Apple's
`ControlFlowOutputInferencePass` and before Apple's `VariableInliningPass`. One
lexical traversal performs the structurally captured repairs:

- For an initializer-only Repeat, replace only the captured adjacent empty-list
  assignment expression with the Repeat's native `stmt_N` result reference.
- For nested Repeat result forwarding, remove a direct tail `append(stmt_N)`,
  or replace a wrapped forwarding append with its real action expression.
- Remove terminal `None` expressions that exist only as complete If/Menu output
  anchors; they are not native Nothing actions.
- For Apple's canonical one-sided empty If form, relocate the native statement
  anchor to the parent scope so `VariableInliningPass` can resolve and remove it.

Initializer repair occurs before descending into a Repeat body. Forwarding
cleanup occurs after descendants are repaired, so nested controls are handled
inner-first. Any constructor, identity, shape, or captured-repair-count mismatch
is an error.

Repeat Index and Repeat Item are not output-repair categories. Apple continues
to infer and lower them as named native variable attachments such as
`Repeat Index 2` and `Repeat Item 2`.

This preserves Apple's normal Python representation while preventing an empty
control-flow initializer from becoming a List action and a redundant nested
forwarding append from becoming Add to Variable.

### What Remains Native

Outside the two owned mutation hooks, Apple still performs the broad compilation
work:

- parsing and type checking;
- compiler diagnostics and error-policy decisions;
- action, parameter, and trigger resolution;
- list and dictionary lowering;
- normal variable inlining;
- conditions, loops, menus, and decorators;
- construction of `CompiledShortcut.workflow`;
- complete workflow-record serialization.

Shortpy reports both frontend policy decisions and backend diagnostics. It does
not replace them with an IDE-specific validation model.

## `ShortpyEditModeContext`

### The Ownership Model

`ShortpyEditModeContext` is not a second Python renderer. It is a controlled
adapter around Apple's existing edit-mode exporter:

```text
workflow file bytes
  -> WFWorkflowFile.initWithFileData:name:error:
  -> WFWorkflowFile.recordRepresentationWithError:
  -> WFWorkflow.initWithRecord:reference:storageProvider:error:
  -> temporary WFWorkflow copy
  -> per-object adapters for proven ambiguous real actions
  -> DescribeAShortcutAgent.editModeContext(for: adapted copy)
  -> WFPythonWorkflowProxy.pythonCode
  -> inline catalog ref decoding
  -> editable Shortpy
```

Apple still builds the program, renders all structural control flow, emits root
and trigger decorators, resolves ToolKit definitions, and formats the final
Python. Shortpy changes only how a small set of real actions enter that native
program.

### Why The Adapter Is Needed

Apple's exporter can represent both of these as `WFProgramAppendNode`:

```python
# Synthetic Repeat Results
repeat_results.append(value)

# Real is.workflow.actions.appendvariable
real_values.append(value)
```

In a nested control-flow workflow, the exporter can attach the real action to
the structural accumulator. `editModeContext(for:)` may then throw before any
Python is produced, or it may emit Python that recompiles to a different action
graph.

The unambiguous ToolKit representation already accepted by Apple's compiler is
an ordinary action call:

```python
com_apple_shortcuts_add_to_variable(
    variable="repeat_results",
    input=repeat_results1,
)
```

Shortpy uses this representation for proven ambiguous real actions while
leaving synthetic control-result appends in Apple's structural syntax. The
result is standalone Python: a later compile does not require the original
workflow, action-order provenance, comments, or a sidecar file.

### Temporary Workflow Clone

`bridge_shortpy_make_edit_export_workflow` begins with `[workflow copy]`, then
reconstructs the complete action array from each action's native identifier,
definition, and serialized parameters. Installing that isolated array before
export preserves Apple's UUID producer lookup while ensuring later `isa`
changes cannot leak through `WFWorkflow.copy`'s shallow action array.

For every non-control action it then:

1. Leaves actions using the base `WFAction` exporter unchanged.
2. Invokes a specialized exporter on the isolated workflow graph.
3. Preserves the specialized result when its program tree contains exactly one
   execution node owned by the source action.
4. Uses the generic explicit ToolKit exporter when the specialized result owns
   no execution node or cannot represent the action.
5. Requires that generic result to contain exactly one owned execution node.
6. Fails clearly on ambiguous counts, unknown actions, or unsupported parameter
   state instead of returning native shorthand.

No original action object, class, or method table is changed.

### Per-Object Export Adapter

Each dynamic subclass overrides `exportWithError:`. Its implementation invokes
the base `WFAction` exporter directly, bypassing only the isolated object's
shorthand specialized exporter. The returned ordinary action execution node
retains the native action object, ToolKit function name, and native parameters.

Add and Set Variable require a `variable=` argument that the generic exporter
does not include. The adapter reads `WFVariableName` from native
`serializedParameters`, constructs the native quoted/passed-parameter program
nodes, and inserts that argument into the ordinary action execution node.

The adapter also filters the specialized `WFVariableFieldParameter` from the
temporary object's parameter list where necessary. This avoids supplying the
same variable field through both the action's specialized UI parameter and the
explicit ToolKit call.

Get Variable, List, Text, Dictionary, Nothing, Comment, and other shorthand
exporters use the same classification boundary. Dictionary parameters retain
Apple's native program tree; numeric `WFItemType == 3` leaves are changed from
quoted to verbatim with `WFProgramNode.replaceContentWithVerbatim:` after an
unambiguous serialized-key/array-position match. No new Python syntax is used.

### Isolation Properties

The edit path deliberately avoids global runtime mutation:

- no Objective-C method swizzling;
- no process-wide hooks;
- no executable-text patches;
- no fixed framework addresses;
- no mutation of the source `WFWorkflow`;
- no rendered Python search/replace;
- no requirement to retain the imported workflow for recompilation.

The dynamic adapter classes are reusable after registration, but only copied
action objects have their `isa` changed. Every unrelated action and every
structural control-flow object continues through Apple's original exporter.

If cloning or adaptation cannot be completed, import fails explicitly. It does
not retry native export and return potentially ambiguous Python.

## Workflow Serialization

Both pipelines finish with Apple's native workflow-record route:

```text
WFWorkflow.databaseAccessQueue
  -> dispatch_barrier_sync
  -> WFWorkflow.saveToRecord
  -> WFWorkflow.record
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

The database queue barrier is required; calling `saveToRecord` directly from an
arbitrary queue caused a libdispatch assertion during runtime proof.

Shortpy does not assemble `WFWorkflowActions`, `WFWorkflowTriggers`, input
classes, fallback behavior, or root metadata by hand. Unified automation
triggers and decorators remain properties of the native workflow/record.

## Standalone Source Contract

Imported Shortpy must compile independently of the workflow it came from.
Accordingly:

- information inferable from Python is compiled from Python;
- opaque workflow data not representable in Python is not reconstructed from a
  hidden provenance map;
- ambiguous real actions use their explicit ToolKit function form;
- structural Python remains Apple's native syntax;
- inline catalog values remain visible dictionaries rather than `ref(...)`;
- no metadata comments or sidecar catalogs are required.

The custom editor may retain original workflow bytes for exact no-edit export,
but `ShortpyToShortcut` does not consume those bytes.

## Failure Policy

All owned corrections are fail-closed. Examples include:

- missing Swift metadata, enum cases, field layouts, or value witnesses;
- unavailable `IRToShortcut: Backend` conformance;
- control-flow plan entries that cannot be tied to one lexical owner;
- initializer-only repairs that do not match every captured candidate;
- recurrence plans without a unique native action-output path;
- edit-export action objects that cannot be safely copied or adapted;
- inline catalog parameters without a native tool/trigger ID and raw key.

The bridge returns a specific diagnostic instead of guessing, rewriting source,
or silently falling back to the native pipeline.

## Reversion And Removal

The owned implementation has two tested escape hatches.

### Runtime Reference Path

Use the native pipeline without changing the build:

```sh
python3 bridge/tools/bridgectl.py --pipeline native <command>
```

This routes compilation to `ShortcutsLanguage.pythonToShortcut` and import to
the original `DescribeAShortcutAgent.editModeContext(for:)` workflow.

### Native-Only Build

Build the bridge without the owned IR adapter:

```sh
make -C bridge \
  BUILD_DIR=build-sim-native-only \
  ENABLE_SHORTPY_PIPELINE=0
```

The resulting dylib accepts native pipeline commands and explicitly rejects a
Shortpy request. It does not compile or link
`bridge/src/shortpy/shortpy_ir_adapter.c`.

If Apple fixes the native compiler and exporter, removal is localized to:

- the `.shortpy` case in `RuntimePipeline`;
- the contiguous `ShortpyControlFlowPlan`,
  `ShortpyControlFlowInputPreparation`, and
  `ShortpyControlFlowOutputRepair` stage block;
- terminal Else If witness preparation and workflow repair;
- the four C lifecycle/mutation entry points that capture/destroy the plan and
  prepare/repair the native IR;
- `bridge_shortpy_make_edit_export_workflow` and dynamic action adapters;
- recurrence restoration on native `WFAction` parameters;
- Shortpy-only tests and reporting fields.

The socket command family, inline catalog feature, selected Tool database,
native serializer, signing/import support, and VS Code integration do not need
to change.

## Verification Contract

The live simulator suite in
`bridge/tests/runtime_shortpy_to_shortcut.py` runs two complete
`Python -> workflow -> Python -> workflow` cycles and checks:

- compile and import success on both cycles;
- stable action identifier/control-mode shape;
- stable action-output dependency edges;
- correct loop-carried recurrence edges;
- exact Shortpy pass ordering and a read-only control-flow plan;
- exact initializer-repair and nested-forwarding counts;
- nested Repeat Index and Repeat Item variable attachments;
- no visible inline catalog refs.

Its fixtures cover:

- Repeat/If loop-carried recurrence;
- `if`/`elif`/`else` recurrence;
- Choose from Menu recurrence;
- nested Repeat Results;
- nested Repeat Index and Repeat Each item consumers;
- explicit variable actions;
- list and Get Item from List behavior;
- explicit Comment actions;
- root decorators;
- inline trigger catalog metadata.

The signed `Minimal Repeat Results Roundtrip Bug.shortcut` was also exercised
through two cycles with identical Python and the original seven-action
identifier/control-mode shape.

These checks establish structural and semantic stability, not byte-for-byte
plist identity. UUIDs and opaque metadata that are not represented in Python may
change after a compile.

## Source Map

| File | Responsibility |
| --- | --- |
| `bridge/src/ShortcutsRuntimeDirectSim.swift` | Pipeline selection, `ShortpyToShortcut`, pass ordering, native backend lifecycle, edit-mode dispatch, diagnostics |
| `bridge/src/shortpy/shortpy_ir_adapter.c` | Resilient native IR reflection, control binding capture, recurrence preparation, nested-result correction |
| `bridge/src/runtime_direct_shims_sim.S` | Narrow Swift ABI adapters for private native entry points and resilient values |
| `bridge/src/runtime_objc_helpers.m` | Per-object edit-export adapters, native `WFAction` reconstruction, backend conformance discovery |
| `bridge/src/ShortcutsIDESimBridge.c` | Socket command transport and pipeline argument forwarding |
| `bridge/tools/bridgectl.py` | Host preprocessing, inline catalogs, signing, and public CLI selection |
| `bridge/tests/runtime_shortpy_to_shortcut.py` | Live semantic round-trip regression suite |
| `docs/SHORTPY_TO_SHORTCUT_IMPLEMENTATION.md` | Concise architecture and runtime-proof overview |

## Extension Rule

New owned behavior should be added only after a minimal fixture proves that
Apple's native path is ambiguous or incorrect.

- A Python-to-workflow defect should be corrected at the native IR boundary
  while statement and lexical identity are available.
- A workflow-to-Python collision should be corrected at the per-action native
  export boundary before program nodes are collapsed.
- Broad Python rewriting, action-order matching, whole-plist regeneration, and
  global hooks are not acceptable extension mechanisms.

This keeps Shortpy's ownership small enough to maintain and easy to delete when
Apple's native implementation no longer needs the corrections.
