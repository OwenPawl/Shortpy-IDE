# Shortpy IDE

Shortpy IDE is a local bridge between **Visual Studio Code** and the **iOS
Simulator** for Apple's Shortcuts Python interface. It uses the same native
compiler, workflow model, and ToolRenderer surfaces used by the built-in
Shortcuts agent wherever those surfaces have been proven.

> [!NOTE]
> Shortpy IDE is a macOS development tool. It requires Xcode, an iOS Simulator
> runtime, private Apple frameworks, and the macOS `/usr/bin/shortcuts` command.

This repository intentionally contains the current bridge and editor source,
not long-run reverse-engineering logs, crash dumps, generated VSIX packages, or
captured prompts.

## Table of Contents

- [Repository Layout](#repository-layout)
- [Runtime Architecture](#runtime-architecture)
  - [Python to Workflow](#python-to-workflow)
  - [Workflow to Python](#workflow-to-python)
  - [Inline Catalog Metadata](#inline-catalog-metadata)
  - [ToolRenderer Metadata](#toolrenderer-metadata)
  - [ToolKit SQLite](#toolkit-sqlite)
- [Quick Start](#quick-start)
  - [Install](#install)
  - [Connect](#connect)
  - [Edit Shortcuts](#edit-shortcuts)
  - [Sync With Host Shortcuts](#sync-with-host-shortcuts)
  - [Load Another ToolKit](#load-another-toolkit)
- [Command-Line Development](#command-line-development)
- [Static Diagnostics](#static-diagnostics)
- [Development Commands](#development-commands)
- [Scope and License](#scope-and-license)

## Repository Layout

```text
Shortpy-IDE/
|-- bridge/             Injected simulator dylib and bridge CLI
|-- vscode-extension/   Custom editor and VS Code language tooling
`-- docs/               Architecture, TODO, and selected proof reports
```

Start with
[`docs/SHORTPY_TO_SHORTCUT_IMPLEMENTATION.md`](docs/SHORTPY_TO_SHORTCUT_IMPLEMENTATION.md)
for the compiler architecture and removal path.

## Runtime Architecture

Shortpy IDE has explicit `shortpy` and `native` runtime pipelines. `shortpy` is
the production default. `native` retains Apple's original monolithic compiler
and edit-mode exporter as a reference path. The bridge never silently falls
back between them.

### Python to Workflow

```text
Editable Shortpy
  -> inline parameterState preprocessing
  -> ShortcutsLanguage.PythonToIR
  -> Shortpy native IR corrections
  -> Apple's native IR passes
  -> ShortcutsLanguage.IRToShortcut
  -> captured recurrence correction on native WFAction parameters, if needed
  -> WFWorkflow.databaseAccessQueue barrier
  -> WFWorkflow.saveToRecord
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
  -> unsigned workflow plist
```

The owned `ShortpyToShortcut` layer fixes proven control-flow collisions without
rewriting editable Python. It preserves Repeat Results, nested control outputs,
`if`/`elif`/`else`, Choose from Menu, loop-carried branch values, variable
aggrandizements, root decorators, and native trigger decorators. Ordinary
actions still use Apple's frontend, native passes, backend, and workflow model.

Captured recurrence edges are corrected on native
`WFAction.serializedParameters` before `saveToRecord`. The bridge does not
rebuild the workflow root or rewrite a serialized whole-workflow plist.

Host-side `.shortcut` export signs the native workflow plist with:

```sh
/usr/bin/shortcuts sign --mode anyone
```

Saving as `.plist` writes the raw workflow plist bytes.

### Workflow to Python

Apple's exporter represents both synthetic control-result accumulation and real
variable mutation with the same append program node. `ShortpyEditModeContext`
avoids that collision by adapting only ambiguous real Add/Set/Get Variable and
Comment actions in a temporary workflow clone. Structural Repeat, If, and Menu
nodes remain on Apple's native exporter.

The result is independently compilable Python. It does not require the source
workflow, hidden action provenance, or a sidecar. Native Comment actions and
ambiguous variable actions use their explicit ToolKit definitions; structural
control flow keeps Apple's normal Python form.

The custom editor also retains imported document bytes in memory. Exporting an
unchanged document returns the exact original `.shortcut` or `.plist`, including
opaque metadata that Python does not represent.

### Inline Catalog Metadata

Editable Python contains inline plist-compatible parameter-state dictionaries,
not visible `ref(...)` handles:

```python
@when_app_opened(app=[{
    "Bundle Identifier": "com.apple.shortcuts",
    "Name": "Shortcuts",
}])
def shortcut() -> None:
    pass
```

For ToolRenderer parameters typed as `Resolved[...]` or `Picked[...]`, the host
creates stable compiler-only refs and an ephemeral
`WFParameterStateCatalog`. Import performs the reverse replacement, so no ref
or catalog sidecar appears in editable Python.

Catalog host identity comes from the active Tool database's native action or
trigger ID and raw parameter key. If those fields are unavailable, compilation
returns `unsupportedInlineCatalogContext` rather than guessing.

### ToolRenderer Metadata

Apple's `ToolRenderer.pythonInterface` is the visible IDE metadata source. Its
definitions power:

- function, decorator, parameter, enum, and type hovers;
- completions and signature help;
- command highlighting;
- action and trigger search;
- static Shortpy diagnostics.

Function hovers show native definition blocks. Parameter hovers show the
specific type, default, documentation, and referenced type material.
Runtime-shaped definitions and enum cases remain visible; the IDE adds a notice
that dynamic cases came from the current simulator and may differ elsewhere.

Metadata is cached locally after refresh so hover, completion, search, and
static diagnostics do not make a bridge call on every interaction. A live
native refresh remains explicit because a full ToolRenderer render can be
large.

### ToolKit SQLite

ToolKit SQLite is the compiler and naming source of truth, not the visible
documentation source. The prepared-copy path:

1. Repairs missing enum rows still referenced by typed relationships.
2. Deduplicates action and trigger Python names using native identifiers.
3. Aligns each non-empty SQLite `pythonName` with ToolRenderer through a neutral
   naming container.
4. Sets `visibleForShortcuts` (`0x1`) and `approved` (`0x4`) on DB-present
   actions before ToolRenderer refresh.
5. Backs up and replaces the simulator's resolved `Tools-active` target.
6. Primes the SQLite WAL and refreshes bridge metadata.

Empty Python names remain empty. The bridge does not synthesize ToolRenderer
definition text; visible definitions are accepted only when native rendered
names match the prepared ToolKit names exactly.

## Quick Start

### Install

Prerequisites:

- macOS with Xcode command-line tools;
- an iOS Simulator runtime, with iOS 27.0 preferred;
- Visual Studio Code;
- Python 3 and Node.js/npm;
- `/usr/bin/shortcuts` for signed export.

From a fresh checkout:

```sh
npm run install-extension
```

The installer packages the VSIX and installs it using `code` from `PATH` or the
standard macOS Visual Studio Code app bundle.

### Connect

In VS Code, run **Shortcuts IDE: Connect To Bridge** or click the Shortcuts
status-bar item. Connect:

1. Stages the bundled bridge in extension global storage.
2. Builds the simulator dylib when needed.
3. Selects the newest compatible iOS 27.0 runtime.
4. Boots one simulator and launches Shortcuts with the dylib.
5. Waits for first-boot ToolKit indexing only when needed.
6. Activates the prepared ToolKit and refreshes metadata.
7. Reports passive connection state in the status bar.

Connect is headless by default. It closes the visible Simulator app and shuts
down other booted iOS simulators to reduce memory use. Set
`shortcutsRuntimeIDE.openSimulatorOnConnect` to show Simulator, or disable
`shortcutsRuntimeIDE.singleSimulatorOnConnect` to keep other devices booted.

### Edit Shortcuts

Opening a raw `.shortcut` or workflow `.plist` starts the **Shortcuts Workflow
Python** custom editor and opens the generated Python in a native VS Code editor.
The controller remains usable while disconnected and exposes Connect directly.

Primary commands include:

- **Validate With Apple Runtime**
- **Export Python To Shortcut**
- **Write Sibling Shortcut**
- **Open Workflow Plist From Python**
- **Import Plist As Python**
- **Import iCloud Link As Python**
- **Open Shortcut Editor**
- **Toggle Live Sync**
- **Retrieve Relevant Actions**
- **Retrieve Relevant Triggers**
- **Refresh ToolRenderer Metadata**
- **Load ToolKit SQLite**

Apple diagnostics appear in Problems with source ranges, hints, and supported
fix-its as VS Code Quick Fixes. Bridge activity is also written to the
**Shortcuts Runtime IDE** output channel and, where available, the Debug Console.

### Sync With Host Shortcuts

**Sync With Host Shortcuts** creates and links a host Mac shortcut on first use.
Later syncs push editor-only changes or pull Shortcuts-only changes. If both
sides changed, the extension offers the editor version, the Shortcuts version,
or a comparison.

**Open Shortcut Editor** opens the linked shortcut directly with
`shortcuts://open-shortcut`. A valid workflow UUID is preferred; the linked or
filename-derived shortcut name is used as the fallback.

**Toggle Live Sync** persists automatic sync for the linked editor. Editor
changes propagate after save, and Shortcuts changes are polled while the Python
editor is open. Host operations are serialized per document. If both sides
change, Live Sync pauses without overwriting either version; run the normal Sync
command to compare or choose a side, after which Live Sync resumes.

![Shortpy IDE Live Sync demonstration](docs/assets/live-sync-demo.gif)

[Open the full-quality MOV recording](docs/assets/live-sync-demo.mov).

The VSIX bundles the small Headless Shortcuts source runtime used for native
`WFWorkflowRecord` creation, update, and export. It is built in extension global
storage on first sync. Baseline host/compiled plists preserve host-owned data
such as the icon while applying structural Python changes.

### Load Another ToolKit

By default, Connect uses:

```text
~/Library/Shortcuts/ToolKit/Tools-active
```

Run **Shortcuts IDE: Load ToolKit SQLite** to select another database. The
selection is persisted for the project, prepared with the same rules, activated
after launch-time indexing, and followed by a complete ToolRenderer cache
refresh.

## Command-Line Development

Build and launch the bridge:

```sh
make -C bridge clean all
bridge/tools/launch_shortcuts_sim_bridge.sh
```

Build the Apple-native reference path without the owned C IR adapter:

```sh
make -C bridge BUILD_DIR=build-sim-native-only ENABLE_SHORTPY_PIPELINE=0
```

Check bridge status:

```sh
bridge/tools/bridgectl.py --socket auto status
```

Compile and sign a shortcut:

```sh
bridge/tools/bridgectl.py --raw python-to-bplist --text 'def shortcut() -> None:
    com_apple_shortcuts_show_notification(title="Hello", body="World")
'
```

Use global `--pipeline native` to select Apple's reference path. Use
`--no-sign` when only the unsigned workflow plist is needed.

Import a raw plist, signed `.shortcut`, or iCloud link:

```sh
bridge/tools/bridgectl.py --raw plist-data-to-python --file Example.shortcut
bridge/tools/bridgectl.py --raw plist-data-to-python \
  --text 'https://www.icloud.com/shortcuts/00000000-0000-0000-0000-000000000000'
```

Signed imports support `anyone` and `people-who-know-me` AEA1 envelopes. iCloud
imports resolve `fields.shortcut.value.downloadURL` from the public record API.

## Static Diagnostics

Return the exact ranges produced by the VS Code static checker:

```sh
node vscode-extension/scripts/diagnose-shortpy.js --pretty Example.py
printf 'def shortcut() -> None:\n    com_apple_shortcuts_not_real()\n' |
  node vscode-extension/scripts/diagnose-shortpy.js \
    --pretty --fail-on-diagnostics -
```

Use `--metadata PATH` to test a specific ToolRenderer cache. Static checks cover
known actions, triggers, and top-level keyword parameters. Nested payload
validation remains authoritative in Apple's runtime compiler.

## Development Commands

```sh
npm run check
npm run package-extension
npm run install-extension -- --install-only
```

The live simulator regression suite is:

```sh
python3 bridge/tests/runtime_shortpy_to_shortcut.py
```

It performs two compile/import cycles across finite Repeat,
`if`/`elif`/`else`, Choose from Menu, nested Repeat Results, variable actions,
list actions, comments, root decorators, and inline trigger metadata.

## Scope and License

- Primary target: iOS Simulator 27.0.
- Launch-time dylib loading is the supported path; live injection is a debug
  fallback.
- The bridge uses private Apple frameworks and may require updates when Apple
  changes Shortcuts, Xcode, macOS, or the simulator runtime.
- Signed shortcut envelopes are processed on the host before plist-to-Python
  conversion in the simulator.

> [!WARNING]
> Private Apple interfaces have no compatibility guarantee.

Shortpy IDE is MIT licensed and is not affiliated with Apple or Microsoft. It
does not include or license Apple or Microsoft software. See
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
