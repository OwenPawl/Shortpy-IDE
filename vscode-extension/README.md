# Shortpy IDE

This VS Code extension drives the iOS Simulator Shortcuts runtime bridge from this repository.

It does not use JSON as the shortcut plist representation for file operations. Python is compiled through `ShortcutsLanguage.pythonToShortcut`, the bridge returns raw workflow plist bytes, and host-side export signs `.shortcut` files with macOS `/usr/bin/shortcuts sign --mode anyone` by default. Saving as `.plist` writes raw workflow plist bytes.

Commands:

- Opening a raw `.shortcut` or workflow `.plist` uses the `Shortcuts Workflow Python` custom editor as a controller. It imports plist bytes into a native Python editor sidecar, keeps diagnostics/hovers/completions/fix-its in that Python editor, shows the Apple runtime response in the controller, and exports the Python editor contents back to plist bytes.
- `Shortcuts IDE: Connect To Bridge` verifies the simulator bridge and updates the status bar.
- `Shortcuts IDE: Show Bridge Status` opens the current bridge status.
- `Shortcuts IDE: Export Python To Shortcut` writes a signed `.shortcut` by default, or raw workflow plist bytes when saving as `.plist`.
- `Shortcuts IDE: Write Sibling Shortcut` writes `<current-file-name>.shortcut` next to the active Python file.
- `Shortcuts IDE: Validate With Apple Runtime` compiles the active Python through the runtime bridge and surfaces compiler errors in VS Code Problems.
- `Shortcuts IDE: Open Workflow Plist From Python` opens the generated Workflow plist as XML without using JSON as the plist representation.
- `Shortcuts IDE: Import Plist As Python` opens edit-mode Python from a selected `.shortcut` or `.plist`.
- `Shortcuts IDE: Retrieve Relevant Actions` searches Apple's native ToolRenderer action definitions.
- `Shortcuts IDE: Retrieve Relevant Triggers` searches Apple's native ToolRenderer trigger decorators.
- `Shortcuts IDE: Resolve Entity` remains a debug/research command. Editable Python should prefer inline parameter-state metadata; `ref(...)` is an internal compiler representation.
- `Shortcuts IDE: Refresh Tool Metadata` refreshes both native ToolRenderer definitions and ToolKit fallback metadata.
- `Shortcuts IDE: Python To Plist Debug JSON` opens a diagnostic summary without embedding the binary plist payload.
- `Shortcuts IDE: Simulator ToolKit Status` shows the booted simulator's `Library/Shortcuts/ToolKit/Tools-active` target.
- `Shortcuts IDE: Point Simulator ToolKit To Host` points the booted simulator `Tools-active` symlink at the host mac ToolKit sqlite.
- `Shortcuts IDE: Refresh ToolKit Metadata` extracts action, trigger, and type Python names for completions, hover text, signature help, and command highlighting. Parameter hints show Python-style names derived from localized parameter labels, with raw plist keys retained for bridge/debugging.

Prerequisites:

- Shortcuts must be running in the iOS 27 simulator through `bridge/tools/launch_shortcuts_sim_bridge.sh`.
- The default `bridgectl.py` path assumes this extension is checked out next to this repository's `bridge` folder. Set `shortcutsRuntimeIDE.bridgeCtlPath` if installed elsewhere.
- Raw workflow plist bytes (`bplist00` or XML plist) can be imported. Signed `.shortcut` files beginning with `AEA1` are detected and reported as signed envelopes; unwrapping those envelopes is a separate import primitive.

The signed `.shortcut` output is produced by the macOS Shortcuts CLI. The simulator bridge still owns compilation and unsigned workflow plist serialization.

Workflow triggers are represented with Apple's native ToolRenderer/ShortcutAgent decorators such as `@when_app_opened`. The workflow controller keeps that Python visible as the editing source and sends it directly to the runtime compiler.

Useful settings:

- `shortcutsRuntimeIDE.autoConvertPlistOnOpen`: legacy behavior for opening an unmanaged Python document from a plist. The custom editor plus managed native Python sidecar is the primary plist UI.
- `shortcutsRuntimeIDE.toolkitCtlPath`: path to `bridge/tools/toolkitctl.py`.
- `shortcutsRuntimeIDE.simulatorDevice`: simulator UDID for ToolKit commands, or `booted`.
- `shortcutsRuntimeIDE.signShortcutExports`: sign `.shortcut` exports with macOS `shortcuts sign`; enabled by default.
- `shortcutsRuntimeIDE.shortcutSigningMode`: signing mode for `.shortcut` exports; default `anyone`.
- `shortcutsRuntimeIDE.shortcutsCliPath`: path to the macOS `shortcuts` CLI; default `/usr/bin/shortcuts`.
- `shortcutsRuntimeIDE.refreshToolKitMetadataOnActivation`: refresh Python-name metadata when the extension activates.
- `shortcutsRuntimeIDE.highlightKnownCommands`: highlight ToolKit-known action and trigger Python names in Python editors.
- `shortcutsRuntimeIDE.writeToDebugConsole`: mirror key bridge and ToolKit events into the VS Code Debug Console when available.
- `shortcutsRuntimeIDE.validateOnSave`: validate Python files on save and update Problems.
- `shortcutsRuntimeIDE.validateOnType`: validate while typing after a debounce.
- `shortcutsRuntimeIDE.overwriteSiblingShortcut`: allow sibling `.shortcut` writes without an overwrite prompt.
- `shortcutsRuntimeIDE.offerOpenInShortcutsAfterSave`: offer to open saved shortcut files after writing them.

Compiler diagnostics from Apple are parsed for line/column, diagnostic id, hints, and fix-its. Known replacement fix-its are exposed as VS Code Quick Fixes. The extension also writes a `Shortcuts Runtime IDE` output channel and mirrors events into the Debug Console where VS Code exposes one.

Native ToolRenderer definitions are the primary action/trigger signature source. ToolKit sqlite metadata remains the fallback source for live squiggles, parameter hover text, signature help, completions, and command highlighting. The static checker only validates action/trigger names and their top-level keyword parameters; nested payload fields are left to Apple's runtime diagnostics.
