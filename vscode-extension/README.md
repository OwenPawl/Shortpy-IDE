# Shortpy IDE for Visual Studio Code

Shortpy IDE connects a native VS Code Python editor to Apple's Shortcuts
compiler and workflow model inside an iOS Simulator. It imports signed or raw
shortcuts as editable Shortpy, validates with Apple's runtime, exports signed
`.shortcut` files, and can synchronize an editor with the host Mac Shortcuts
database.

> [!NOTE]
> This extension is a macOS development tool. It requires Xcode, an iOS
> Simulator runtime, private Apple frameworks, and `/usr/bin/shortcuts`.

## Quick Start

1. Install the VSIX.
2. Run **Shortcuts IDE: Connect To Bridge** or click the Shortcuts status-bar
   item.
3. Open a `.shortcut` or workflow `.plist`.
4. Edit the generated Python in the native VS Code editor.
5. Validate, export, or sync from the editor toolbar or Command Palette.

Connect is self-contained for a public VSIX install. It stages and builds the
bundled bridge in extension global storage, chooses the newest compatible iOS
27.0 simulator, launches Shortcuts with the dylib, activates the selected
ToolKit, refreshes ToolRenderer metadata, and reports state passively in the
status bar.

Connect runs headlessly by default. Enable
`shortcutsRuntimeIDE.openSimulatorOnConnect` to open Simulator, or disable
`shortcutsRuntimeIDE.singleSimulatorOnConnect` to keep other simulators booted.

## Editor Workflow

Opening a raw `.shortcut` or workflow `.plist` starts the **Shortcuts Workflow
Python** custom editor as a controller and opens the generated Shortpy in a
native Python editor. If the bridge is disconnected, the controller still opens
and provides Connect instead of failing.

The custom editor and Python editor share the same metadata and diagnostics:

- Python syntax highlighting and native editor behavior;
- ToolRenderer-backed action, trigger, parameter, enum, and type hovers;
- completions and signature help;
- static action/trigger and top-level parameter diagnostics;
- Apple runtime diagnostics, hints, and supported fix-its;
- output in Problems, the **Shortcuts Runtime IDE** channel, and the Debug
  Console where VS Code exposes one.

The controller retains original imported bytes. Exporting an unchanged document
returns the exact input file. Once Python changes, export uses the native
Shortpy runtime pipeline and Apple's workflow-record serializer.

## Commands

- **Connect To Bridge**: verify or bootstrap the bundled simulator bridge.
- **Validate With Apple Runtime**: compile the active Shortpy and surface Apple
  diagnostics in Problems.
- **Export Python To Shortcut**: write a signed `.shortcut`, or raw workflow
  bytes when saving as `.plist`.
- **Write Sibling Shortcut**: write `<python-name>.shortcut` beside the active
  Python file.
- **Open Workflow Plist From Python**: open the compiled plist as XML.
- **Import Plist As Python**: import a signed `.shortcut` or raw XML/binary
  workflow plist.
- **Import iCloud Link As Python**: resolve and import a public iCloud Shortcuts
  link.
- **Sync With Host Shortcuts**: create/link a Mac shortcut, then push or pull
  whichever side changed.
- **Open Shortcut Editor**: open the linked shortcut in the Shortcuts editor by
  workflow UUID, with its name as fallback.
- **Toggle Live Sync**: push editor changes after save and poll open linked
  editors for Shortcuts-side changes.
- **Retrieve Relevant Actions**: search native ToolRenderer action definitions.
- **Retrieve Relevant Triggers**: search native trigger decorators.
- **Refresh ToolRenderer Metadata**: rerender and cache the native Python
  interface.
- **Load ToolKit SQLite**: select, prepare, activate, and persist a different
  ToolKit database.
- **Python To Plist Debug JSON**: open an internal diagnostic summary.

Status is passive in the status bar. `resolve_entity` and agent final-answer
submission are not exposed as editor commands.

## Runtime Pipeline

Python compiles through the owned native IR boundary:

```text
Editable Shortpy
  -> ShortcutsLanguage.PythonToIR
  -> Shortpy native IR corrections
  -> Apple's native IR passes
  -> ShortcutsLanguage.IRToShortcut
  -> native WFAction recurrence correction, if required
  -> WFWorkflow.saveToRecord
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

This keeps Repeat Results, nested control outputs, conditions, menus, variable
aggrandizements, root decorators, and trigger decorators without rewriting the
editable Python. The compiler uses `ToolVisibilityFilter.any`.

Workflow import uses `ShortpyEditModeContext`. It preserves Apple's structural
control-flow Python and emits explicit ToolKit functions only for ambiguous real
Add/Set/Get Variable and Comment actions. The result compiles independently of
the imported workflow.

Editable `Resolved[...]` and `Picked[...]` parameters use inline
plist-compatible dictionaries. Compiler-only `ref(...)` values and catalog
handles are never shown in the editor.

## ToolRenderer and ToolKit

Apple's ToolRenderer Python interface is the visible documentation source.
Cached native definition blocks power hovers, completions, signatures, search,
highlighting, and static diagnostics without a bridge call on every hover.
Dynamic/runtime-shaped enum cases remain visible with a simulator-runtime
notice.

ToolKit SQLite is the compiler and naming source of truth. It is not displayed
as hover documentation. The selected database is prepared after Shortcuts'
first-boot indexing:

- missing referenced enum rows are repaired;
- duplicate Python names are derived from native identifiers;
- non-empty SQLite Python names are aligned with native ToolRenderer output;
- `visibleForShortcuts` and `approved` bits are set for DB-present actions;
- the resolved simulator `Tools-active` target is backed up, replaced, and
  WAL-primed;
- the complete ToolRenderer cache is regenerated.

The default source is `~/Library/Shortcuts/ToolKit/Tools-active`. A selection
made through **Load ToolKit SQLite** is persisted.

## Signed and iCloud Import

The extension imports:

- raw XML or binary workflow plists;
- AEA1 `.shortcut` envelopes signed for `anyone`;
- AEA1 envelopes signed for `people-who-know-me`;
- public `https://www.icloud.com/shortcuts/<UUID>` links.

Signed envelopes are extracted on the host before simulator conversion. iCloud
links resolve `fields.shortcut.value.downloadURL` from Apple's public record
API.

Export signs `.shortcut` files with:

```sh
/usr/bin/shortcuts sign --mode anyone
```

The signing mode and CLI path are configurable. `.plist` export always remains
unsigned raw workflow data.

## Host Shortcuts Sync

**Sync With Host Shortcuts** creates and links a host workflow on first use.
Later syncs:

- push when only the editor changed;
- pull when only Shortcuts changed;
- offer editor, Shortcuts, or comparison choices when both changed.

**Open Shortcut Editor** uses
`shortcuts://open-shortcut?id=<UUID>&name=<STRING>`. A valid linked UUID is
included when available and takes precedence; the linked or filename-derived
name remains a fallback.

**Toggle Live Sync** stores the mode on the existing per-document host link.
Editor changes propagate after save, and host changes are polled while the
linked Python editor is open. Operations are serialized per document. Live Sync
pauses on a two-sided conflict instead of choosing a winner; resolve it with the
normal Sync command and automatic propagation resumes.

The VSIX bundles a small Headless Shortcuts source runtime. It is built in
extension global storage on first sync and saves complete native
`WFWorkflowRecord` values. Baseline host and compiled plists preserve host-owned
metadata such as the icon while applying structural Python changes.

## Settings

Common settings:

- `shortcutsRuntimeIDE.openSimulatorOnConnect`: show Simulator during Connect;
  default `false`.
- `shortcutsRuntimeIDE.singleSimulatorOnConnect`: keep only the selected
  simulator booted; default `true`.
- `shortcutsRuntimeIDE.toolkitSqlitePath`: selected ToolKit; empty uses the host
  `Tools-active` path.
- `shortcutsRuntimeIDE.signShortcutExports`: sign `.shortcut` exports; default
  `true`.
- `shortcutsRuntimeIDE.shortcutSigningMode`: `anyone` or
  `people-who-know-me`.
- `shortcutsRuntimeIDE.validateOnSave`: validate Shortpy on save; default
  `true`.
- `shortcutsRuntimeIDE.validateOnType`: validate after an edit debounce;
  default `false`.
- `shortcutsRuntimeIDE.refreshToolRendererInterfaceOnActivation`: load cached
  metadata at activation and refresh in the background when connected.
- `shortcutsRuntimeIDE.highlightKnownCommands`: highlight ToolRenderer-known
  actions and triggers.
- `shortcutsRuntimeIDE.writeToDebugConsole`: mirror bridge events to the Debug
  Console.
- `shortcutsRuntimeIDE.bridgeCommandTimeoutMs`,
  `shortcutsRuntimeIDE.bridgeMetadataTimeoutMs`,
  `shortcutsRuntimeIDE.bridgeStatusTimeoutMs`, and
  `shortcutsRuntimeIDE.bridgeLaunchTimeoutMs`: bound bridge operations.
- `shortcutsRuntimeIDE.headlessShortcutsPath`: optional prebuilt host-sync
  helper; normally the bundled source is used.
- `shortcutsRuntimeIDE.liveSyncPollIntervalMs`: host-change polling interval
  while Live Sync is enabled; default `3000`, minimum `1000`.

Advanced path overrides such as `bridgeCtlPath`, `toolRendererMetadataPath`,
`pythonPath`, `socket`, and `shortcutsCliPath` can point the extension at a
development checkout.

## Local Development

From the repository root:

```sh
npm run check
npm run install-extension
npm run package-extension
npm run install-extension -- --install-only
```

The package prepublish step regenerates the bundled bridge and Headless
Shortcuts source, and synchronizes command palette contributions, menus,
activation events, and editor toolbar buttons from `src/commandRegistry.js`.

## License

Shortpy IDE is MIT licensed. It is an independent implementation, is not
affiliated with Apple or Microsoft, does not include or license their software,
and cannot guarantee compatibility with private Apple runtime interfaces. See
`LICENSE.txt` in the packaged extension.
