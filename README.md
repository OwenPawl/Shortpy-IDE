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

Editable Python uses inline catalog/parameter-state metadata instead of visible `ref(...)` handles. The bridge reconstructs any required compiler catalog from that source representation. Ref-free source without inline catalog values compiles with `defaultInitialCatalog`; the compiler no longer silently falls back to the latest imported workflow catalog.

VS Code visible metadata comes from Apple's ToolRenderer Python interface. The extension loads cached ToolRenderer metadata at startup for offline hovers, completions, highlighting, signature help, search, and static Shortpy diagnostics, then rebuilds the visible cache from that local interface plus the active sqlite names. Live native ToolRenderer refresh is an explicit command because it can occupy the simulator bridge for a long time. Function and decorator hovers show exact native ToolRenderer definition blocks; keyword hovers show the specific parameter type/default/docs plus stable referenced enum/type material. Environment-specific enum cases are omitted because they depend on the active runtime catalog. The prepared ToolKit gives every tool a neutral ToolRenderer naming context and uses its normalized sqlite `pythonName` as the native render name. Visible metadata then accepts definitions only by exact Python-name equality; it does not rewrite or synthesize definition text. The bridge also ensures selected DB rows have both `visibleForShortcuts` (`0x1`) and `approved` (`0x4`) set before ToolRenderer refresh so native ToolRenderer renders actions that were present in the DB but hidden from the generative surface. ToolKit sqlite data is not a user-facing documentation source; it remains an internal bridge source for compiler names and a temporary fallback for catalog host/key binding until native metadata-provider binding extraction is implemented.

## Quick Start

Install the VS Code extension from a fresh checkout with one command:

```sh
npm run install-extension
```

Then open VS Code and run `Shortcuts IDE: Connect To Bridge`, or click the
Shortcuts status bar item.
The packaged extension bundles the bridge source, stages it into extension
global storage on first connect, builds the simulator dylib if needed, boots
an iOS simulator if needed, launches Shortcuts with the bridge, and keeps
bridge status visible in the status bar. Connect runs headlessly by default:
it does not open `Simulator.app`, quits the visible Simulator app if it is
already running, and keeps only the selected iOS simulator booted by shutting
down other booted iOS simulators.
The bridge build discovers the installed iOS Simulator runtime at build time
and prefers iOS 27.0 when present.
By default the launcher uses `~/Library/Shortcuts/ToolKit/Tools-active` as the
ToolKit source of truth. On connect it launches the simulator bridge, waits for
Shortcuts' launch-time ToolKit indexing to settle, creates an adjusted copy,
repairs missing enum rows that are still referenced by typed parameter
relationships or type instances, rewrites duplicate action/trigger Python names
from their native identifiers, reserves the finite ShortcutsLanguage action
names used by dictionary/list/text/nothing/subscript syntax, aligns every tool's
normalized `pythonName` with its native ToolRenderer render name through a
dedicated neutral naming container, sets the ToolRenderer visibility/approval bits, backs up the
simulator's resolved `Tools-active` target, replaces that target file with the
adjusted copy, primes the WAL database, and refreshes bridge metadata. The
closure repair uses only typed references retained in the selected ToolKit.
Use `Shortcuts IDE: Load ToolKit SQLite` to select a different sqlite; that
command applies the same post-index prepared-copy target replacement and
relaunches the bridge.
Set `shortcutsRuntimeIDE.openSimulatorOnConnect` when you intentionally want the
visible Simulator UI, or disable `shortcutsRuntimeIDE.singleSimulatorOnConnect`
when another booted iOS simulator must stay running.

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

Imported action names are canonicalized by matching each named Python call to
the workflow's action identifiers, retained ToolRenderer native function names,
ToolKit display aliases, and accepted
parameter names. Literal and control-flow actions do not consume call positions.
Ambiguous aliases or excess calls are left unchanged and reported in
`name_canonicalization` instead of being guessed by sequence order.

The prepared ToolKit keeps actions represented by Python syntax on their native
intrinsic names, so dictionary/list/text/nothing/subscript expressions remain
ordinary Python. Other actions that WorkflowKit renders as values can still be
reified as canonical ToolKit calls under unique parameter and output/order
consensus. A separate fail-closed AST pass initializes loop-carried branch
results only when recursive and nonrecursive calls identify one existing seed.
Diagnostics are returned in `value_action_reification` and
`control_flow_initialization`.

Static editor diagnostics treat ToolRenderer as a positive metadata source.
They validate parameters only when the rendered signature is complete and
non-overloaded; incomplete device/runtime surfaces remain unmarked until native
compiler validation. Compiler-facing aliases are closed over the loaded ToolKit
parameter keys and the finite filter-query syntax without exposing raw keys.

Return the exact static highlight ranges for a ShortPy file or stdin with:

```sh
node vscode-extension/scripts/diagnose-shortpy.js --pretty Example.py
printf 'def shortcut() -> None:\n    com_apple_shortcuts_not_real()\n' |
  node vscode-extension/scripts/diagnose-shortpy.js --pretty --fail-on-diagnostics -
```

Use `--metadata PATH` to test against a specific ToolRenderer cache. The probe
uses the same collector as VS Code and emits both one-based and zero-based
ranges plus a caret-rendered source excerpt.

Run VS Code extension tests and syntax checks:

```sh
npm run check
```

Package the extension without installing it:

```sh
npm run package-extension
```

Install an already-packaged VSIX for the current extension version:

```sh
npm run install-extension -- --install-only
```

The installer uses `code` from PATH when available and falls back to the
standard macOS VS Code app bundle CLI. Set `VSCODE_CLI=/path/to/code` if VS Code
is installed somewhere else.

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

## License

Shortpy IDE is MIT licensed. The license includes an interoperability notice:
this is an independent VS Code and bridge implementation, is not affiliated
with Apple or Microsoft, does not license or include Apple or Microsoft
software, and does not warrant that private Apple runtime surfaces will continue
to work. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
