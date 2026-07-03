# Shortpy IDE

Shortpy IDE is a local VS Code and iOS Simulator bridge for Apple's Shortcuts Python surface. It uses the same native compiler/runtime surfaces that the built-in Shortcuts agent uses where they are currently proven.

This repository is intentionally small. It contains the current working bridge and editor source, not the long-run RE logs, crash dumps, generated VSIX packages, or captured prompts.

## Layout

- `bridge/`: injected iOS Simulator dylib, bridge control CLI, internal catalog-binding helpers, and build files.
- `vscode-extension/`: VS Code custom editor and Python tooling integration.
- `docs/`: implementation notes, TODO, and selected proof reports.

## Current Runtime Boundary

Python-to-workflow plist export now uses Apple's native whole-workflow record serializer:

```text
ShortcutsLanguage.pythonToShortcut
  -> WFWorkflow.databaseAccessQueue dispatch_barrier_sync
  -> WFWorkflow.saveToRecord
  -> WFWorkflow.record
  -> WFWorkflowRecord.fileRepresentation
  -> WFWorkflowFile.fileDataWithError:
```

This preserves workflow root metadata and native trigger decorators such as `@when_app_opened` without manually rebuilding `WFWorkflowTriggers`. Host-side `.shortcut` export then signs those workflow plist bytes with macOS `/usr/bin/shortcuts sign --mode anyone`.

Editable Python should use inline catalog/parameter-state metadata instead of visible `ref(...)` handles. The bridge rewrites that representation internally for Apple's compiler.

VS Code visible metadata comes from Apple's ToolRenderer Python interface. The extension loads cached ToolRenderer metadata at startup for offline hovers, completions, highlighting, signature help, search, and static Shortpy diagnostics, then rebuilds the visible cache from that local interface plus the active sqlite names. Live native ToolRenderer refresh is an explicit command because it can occupy the simulator bridge for a long time. Function and decorator hovers show exact native ToolRenderer definition blocks; keyword hovers show the specific parameter type/default/docs plus stable referenced enum/type material. Environment-specific enum cases are omitted because they depend on the active runtime catalog. ToolRenderer docs/signatures are paired with the active ToolKit sqlite `pythonName` values so the sqlite is the source of truth for editable Shortpy names; generated ToolRenderer names are only a fallback when a sqlite name is missing. The bridge also ensures selected DB rows have both `visibleForShortcuts` (`0x1`) and `approved` (`0x4`) set before ToolRenderer refresh so native ToolRenderer renders actions that were present in the DB but hidden from the generative surface. ToolKit sqlite data is not a user-facing documentation source; it remains an internal bridge source for compiler names and a temporary fallback for catalog host/key binding until native metadata-provider binding extraction is implemented.

## Quick Start

For the VS Code extension, install/package from `vscode-extension/` and run
`Shortcuts IDE: Connect To Bridge`, or click the Shortcuts status bar item.
The packaged extension bundles the bridge source, stages it into extension
global storage on first connect, builds the simulator dylib if needed, boots
Simulator if needed, launches Shortcuts with the bridge, and keeps bridge
status visible in the status bar.
The bridge build discovers the installed iOS Simulator runtime at build time
and prefers iOS 27.0 when present.
By default the launcher uses `~/Library/Shortcuts/ToolKit/Tools-active` as the
ToolKit source of truth. On connect it backs up the selected sqlite, rewrites
duplicate action/trigger Python names in place from their native identifiers,
sets the ToolRenderer visibility/approval bits, points Simulator
Shortcuts at that same sqlite, and refreshes bridge metadata.
Use `Shortcuts IDE: Load ToolKit SQLite` to select a different sqlite; that
command applies the same in-place name and visibility adjustments and relaunches
the bridge.

The direct CLI development path is still available:

Build and launch the simulator bridge:

```sh
make -C bridge clean all
bridge/tools/launch_shortcuts_sim_bridge.sh
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

The response contains both `plist_payload` (unsigned workflow plist bytes) and `shortcut_payload` (signed `.shortcut` bytes). Use `--no-sign` for validation/debug paths that only need the unsigned plist payload.

Import a raw workflow plist, signed `.shortcut` file, or iCloud Shortcuts link:

```sh
bridge/tools/bridgectl.py --raw plist-data-to-python --file Example.shortcut
bridge/tools/bridgectl.py --raw plist-data-to-python --text 'https://www.icloud.com/shortcuts/00000000-0000-0000-0000-000000000000'
```

Signed import unwraps either `anyone` or `people-who-know-me` AEA1 envelopes host-side. iCloud import resolves `fields.shortcut.value.downloadURL` from the public record API. Both paths send the resulting unsigned `Shortcut.wflow` plist to the simulator edit-mode converter.

Run VS Code extension syntax checks:

```sh
cd vscode-extension
npm test
npm run check
```

Package the extension from `vscode-extension/` with `vsce` when needed. The
prepublish step syncs VS Code command contributions from
`src/commandRegistry.js` and stages the bundled bridge source:

```sh
cd vscode-extension
npx --yes @vscode/vsce package --no-dependencies
```

Install the local VSIX with the repo helper. It uses `code` from PATH when
available and falls back to the standard macOS VS Code app bundle CLI:

```sh
cd vscode-extension
npm run install:local
```

Low-level checks can also be run directly:

```sh
node --check vscode-extension/src/bridge.js
node --check vscode-extension/src/toolrenderer.js
node --check vscode-extension/src/extension.js
node --check vscode-extension/test/smoke.js
```

## Scope Notes

- Primary target is iOS Simulator 27.0.
- The bridge uses private Apple frameworks and is a local RE/development tool.
- Signed `.shortcut`/AEA1 envelope import is handled host-side before the simulator plist-to-Python bridge call.
- Launch-time dylib loading is the supported simulator path; live injection is retained as a debug fallback.
