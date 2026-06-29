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

This preserves workflow root metadata and native trigger decorators such as `@when_app_opened` without manually rebuilding `WFWorkflowTriggers`.

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
- Signed `.shortcut`/AEA1 envelope handling is separate from unsigned workflow plist export.
- Launch-time dylib loading is the supported simulator path; live injection is retained as a debug fallback.
