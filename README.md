# Shortpy IDE

Shortpy IDE is a local VS Code and iOS Simulator bridge for Apple's Shortcuts Python surface. It uses the same native compiler/runtime surfaces that the built-in Shortcuts agent uses where they are currently proven.

This repository is intentionally small. It contains the current working bridge and editor source, not the long-run RE logs, crash dumps, generated VSIX packages, or captured prompts.

## Layout

- `bridge/`: injected iOS Simulator dylib, bridge control CLI, ToolKit helper, and build files.
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

## Quick Start

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
node --check vscode-extension/src/bridge.js
node --check vscode-extension/src/extension.js
node --check vscode-extension/test/smoke.js
```

Package the extension from `vscode-extension/` with `vsce` when needed.

## Scope Notes

- Primary target is iOS Simulator 27.0.
- The bridge uses private Apple frameworks and is a local RE/development tool.
- Signed `.shortcut`/AEA1 envelope import is handled host-side before the simulator plist-to-Python bridge call.
- Launch-time dylib loading is the supported simulator path; live injection is retained as a debug fallback.
