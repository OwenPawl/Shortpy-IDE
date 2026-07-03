# Shortpy IDE

This VS Code extension drives the iOS Simulator Shortcuts runtime bridge from this repository.

It does not use JSON as the shortcut plist representation for file operations. Python is compiled through `ShortcutsLanguage.pythonToShortcut`, the bridge returns raw workflow plist bytes, and host-side export signs `.shortcut` files with macOS `/usr/bin/shortcuts sign --mode anyone` by default. Saving as `.plist` writes raw workflow plist bytes.

Commands:

- Opening a raw `.shortcut` or workflow `.plist` uses the `Shortcuts Workflow Python` custom editor as a controller. It imports plist bytes into a native Python editor sidecar when the bridge is available. If the bridge is disconnected, the controller still opens and shows a Connect button instead of failing the editor.
- `Shortcuts IDE: Connect To Bridge` verifies an existing bridge or builds the bundled simulator bridge, boots Simulator if needed, launches Shortcuts with the bridge, and updates the status bar. Clicking the Shortcuts status bar item also runs this command.
- `Shortcuts IDE: Export Python To Shortcut` writes a signed `.shortcut` by default, or raw workflow plist bytes when saving as `.plist`.
- `Shortcuts IDE: Write Sibling Shortcut` writes `<current-file-name>.shortcut` next to the active Python file.
- `Shortcuts IDE: Validate With Apple Runtime` compiles the active Python through the runtime bridge and surfaces compiler errors in VS Code Problems.
- `Shortcuts IDE: Open Workflow Plist From Python` opens the generated Workflow plist as XML without using JSON as the plist representation.
- `Shortcuts IDE: Import Plist As Python` opens edit-mode Python from a selected signed `.shortcut`, raw workflow `.plist`, or selected/open iCloud Shortcuts link text.
- `Shortcuts IDE: Import iCloud Link As Python` prompts for a `https://www.icloud.com/shortcuts/<UUID>` link and opens edit-mode Python.
- `Shortcuts IDE: Retrieve Relevant Actions` searches Apple's native ToolRenderer action definitions.
- `Shortcuts IDE: Retrieve Relevant Triggers` searches Apple's native ToolRenderer trigger decorators.
- `Shortcuts IDE: Refresh ToolRenderer Metadata` refreshes the cached ToolRenderer metadata used by hovers, completions, highlighting, signature help, search, and static Shortpy diagnostics.
- `Shortcuts IDE: Load ToolKit SQLite` selects the ToolKit sqlite used as the bridge/compiler source of truth, backs it up, rewrites duplicate action/trigger Python names in place, sets ToolRenderer `visibleForShortcuts` and `approved` bits, points Simulator Shortcuts at it, relaunches Shortcuts, and refreshes visible metadata.
- `Shortcuts IDE: Python To Plist Debug JSON` opens a diagnostic summary without embedding the binary plist payload.

Prerequisites:

- `Shortcuts IDE: Connect To Bridge` needs Xcode command line tools, an iOS Simulator runtime, and the private Shortcuts frameworks available in that simulator runtime. It prefers iOS 27.0 when present.
- The simulator bridge build discovers the installed iOS Simulator runtime dynamically instead of using a machine-local runtime path.
- The VSIX bundles the bridge source and stages a buildable copy into extension global storage on first Connect. Set `shortcutsRuntimeIDE.bridgeCtlPath` only when you want to use a specific local bridge checkout.
- Raw workflow plist bytes (`bplist00` or XML plist), signed `.shortcut` files beginning with `AEA1`, and iCloud Shortcuts links can be imported.

The signed `.shortcut` output is produced by the macOS Shortcuts CLI. The simulator bridge still owns compilation and unsigned workflow plist serialization.

Workflow triggers are represented with Apple's native ToolRenderer/ShortcutAgent decorators such as `@when_app_opened`. The workflow controller keeps that Python visible as the editing source and sends it directly to the runtime compiler.

For local development installs, run `npm run install:local` from this directory after packaging. The helper uses `code` from PATH when present and falls back to the standard macOS VS Code app bundle CLI.

Useful settings:

- `shortcutsRuntimeIDE.autoConvertPlistOnOpen`: legacy behavior for opening an unmanaged Python document from a plist. The custom editor plus managed native Python sidecar is the primary plist UI.
- `shortcutsRuntimeIDE.signShortcutExports`: sign `.shortcut` exports with macOS `shortcuts sign`; enabled by default.
- `shortcutsRuntimeIDE.shortcutSigningMode`: signing mode for `.shortcut` exports; default `anyone`.
- `shortcutsRuntimeIDE.shortcutsCliPath`: path to the macOS `shortcuts` CLI; default `/usr/bin/shortcuts`.
- `shortcutsRuntimeIDE.toolkitSqlitePath`: ToolKit sqlite used by the bridge/compiler source-of-truth layer. Empty uses `~/Library/Shortcuts/ToolKit/Tools-active`.
- `shortcutsRuntimeIDE.toolRendererMetadataPath`: optional path to cached ToolRenderer metadata. The default is extension global storage.
- `shortcutsRuntimeIDE.refreshToolRendererInterfaceOnActivation`: rebuild the visible metadata cache from the cached ToolRenderer interface at activation. Live native ToolRenderer refresh is explicit because it can occupy the simulator bridge for a long time.
- `shortcutsRuntimeIDE.bridgeCommandTimeoutMs`, `shortcutsRuntimeIDE.bridgeMetadataTimeoutMs`, `shortcutsRuntimeIDE.bridgeStatusTimeoutMs`: bound bridge subprocesses so validation/import/status failures return to the UI instead of hanging indefinitely. Metadata refresh defaults to a longer timeout because native ToolRenderer output is large after widening visibility.
- `shortcutsRuntimeIDE.bridgeLaunchTimeoutMs`: bound Connect To Bridge bootstrap work including build, simulator boot, Shortcuts launch, and status verification.
- `shortcutsRuntimeIDE.highlightKnownCommands`: highlight ToolRenderer-known action and trigger Python names in Python editors.
- `shortcutsRuntimeIDE.writeToDebugConsole`: mirror key bridge and Shortpy IDE events into the VS Code Debug Console when available.
- `shortcutsRuntimeIDE.validateOnSave`: validate Python files on save and update Problems.
- `shortcutsRuntimeIDE.validateOnType`: validate while typing after a debounce.
- `shortcutsRuntimeIDE.overwriteSiblingShortcut`: allow sibling `.shortcut` writes without an overwrite prompt.
- `shortcutsRuntimeIDE.offerOpenInShortcutsAfterSave`: offer to open saved shortcut files after writing them.

Compiler diagnostics from Apple are parsed for line/column, diagnostic id, hints, and fix-its. Known replacement fix-its are exposed as VS Code Quick Fixes. The extension also writes a `Shortcuts Runtime IDE` output channel, mirrors events into the Debug Console where VS Code exposes one, and keeps bridge status visible in the status bar.

Visible commands are defined in `src/commandRegistry.js`. The package prepublish step syncs command palette contributions, editor menus, activation events, and custom editor toolbar actions from that registry so command UI does not drift across files.

ToolRenderer definitions are the visible action/trigger/type source. The extension uses the cached ToolRenderer index for hovers, completions, signature help, command highlighting, action/trigger search, and static Shortpy diagnostics without waiting on the bridge after activation. If no cache exists and the bridge is unavailable, refresh ToolRenderer metadata once while the simulator bridge is running.

ToolKit sqlite data is not surfaced directly in VS Code hovers, completions, or diagnostics. The selected sqlite supplies Python names where ToolRenderer needs disambiguation and is also the compiler source of truth after duplicate names and ToolRenderer visibility/approval bits are adjusted in place. It remains an internal temporary bridge fallback for catalog host/key binding during inline parameter-state compilation until native ToolRenderer/metadata-provider binding extraction replaces it. The static checker only validates action/trigger names and their top-level keyword parameters; nested payload fields are left to Apple's runtime diagnostics.

License: MIT. Shortpy IDE is an independent implementation and integration layer, is not affiliated with Apple or Microsoft, does not include or license Apple or Microsoft software, and does not warrant that private Apple runtime surfaces will continue to work. See `LICENSE.txt`.
