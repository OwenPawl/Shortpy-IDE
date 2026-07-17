"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  customEditorActionTiers,
  packageActivationEvents,
  packageCommands,
  packageMenus,
} = require("../src/commandRegistry");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const extensionSource = fs.readFileSync(path.join(root, "src", "extension.js"), "utf8");
const viewSource = fs.readFileSync(path.join(root, "src", "workflowEditorView.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const vscodeIgnore = fs.readFileSync(path.join(root, ".vscodeignore"), "utf8");

const activationEvents = manifest.activationEvents || [];
const commands = (manifest.contributes && manifest.contributes.commands || []).map((item) => item.command);
const menus = Object.values(manifest.contributes && manifest.contributes.menus || {}).flat();
const menuCommands = menus.map((item) => item.command);
const configuration = manifest.contributes && manifest.contributes.configuration || {};
const configurationProperties = configuration.properties || {};

assert.deepStrictEqual(activationEvents, packageActivationEvents(), "activationEvents must be generated from commandRegistry.js");
assert.deepStrictEqual(manifest.contributes.commands, packageCommands(), "contributed commands must be generated from commandRegistry.js");
assert.deepStrictEqual(manifest.contributes.menus, packageMenus(), "menus must be generated from commandRegistry.js");

for (const surface of [activationEvents, commands, menuCommands]) {
  assert(!surface.some((item) => /resolveEntity|shortcutsRuntimeIDE\.status/.test(String(item))), "resolve entity and explicit status commands must not be contributed");
}

assert(!viewSource.includes('data-command="resolveEntity"'), "custom editor must not expose Resolve Entity");
assert(!viewSource.includes('data-command="status"'), "custom editor must not expose a Status button");
assert(!extensionSource.includes("bridgeStatusBar.command ="), "status bar must remain passive");
assert(!/Shortcuts IDE: Resolve Entity/.test(readme), "README must not document Resolve Entity as a UI command");
assert(!/Shortcuts IDE: Show Bridge Status/.test(readme), "README must not document Show Bridge Status as a UI command");
assert(commands.includes("shortcutsRuntimeIDE.openHostShortcutEditor"), "Open Shortcut Editor must be a visible command");
assert(commands.includes("shortcutsRuntimeIDE.toggleLiveSync"), "Live Sync must be a visible command");
assert(commands.includes("shortcutsRuntimeIDE.disconnectBridge"), "Disconnect Bridge must be a visible command");
assert(commands.includes("shortcutsRuntimeIDE.showCompilerTrace"), "Compiler trace must be a visible command");
assert(!commands.includes("shortcutsRuntimeIDE.refreshToolMetadata"), "routine metadata refresh must be internal");
assert(!commands.includes("shortcutsRuntimeIDE.refreshToolRendererInterface"), "native metadata refresh must be internal");
assert(!configurationProperties["shortcutsRuntimeIDE.refreshToolRendererInterfaceOnActivation"], "activation-time live metadata refresh must be removed");
assert(extensionSource.includes('commandName === "openHostShortcutEditor"'), "custom editor must handle Open Shortcut Editor");
assert(extensionSource.includes('commandName === "toggleLiveSync"'), "custom editor must handle Live Sync");
assert(viewSource.includes('aria-pressed="false"'), "custom editor Live Sync must expose native toggle state");
assert(
  extensionSource.includes("programmaticHostPullDocuments.has(document.uri.toString())"),
  "host pulls must suppress their own save-triggered Live Sync event"
);
assert(
  extensionSource.includes("programmaticHostPullDocuments.has(key)"),
  "host pulls must suppress validation triggered by their document edit"
);
assert.strictEqual(
  configurationProperties["shortcutsRuntimeIDE.liveSyncPollIntervalMs"].default,
  3000,
  "Live Sync must use the documented default polling interval"
);
const tiers = customEditorActionTiers();
const customActions = tiers.flatMap((tier) => tier.actions);
assert.deepStrictEqual(
  customActions.filter((item) => !item.overflow).map((item) => item.label),
  [
    "Connect",
    "Open Python Editor",
    "Open in Shortcuts",
    "Search Actions",
    "Search Triggers",
    "Validate",
    "Build Shortcut",
    "Sync With Host",
    "Live Sync",
    "Load ToolKit",
  ],
  "custom editor toolbar order must match the compact controller design"
);
assert.strictEqual(customActions.find((item) => item.message === "import").overflow, true);
assert.strictEqual(customActions.find((item) => item.message === "loadToolkit").conditional, "toolkitMissing");
assert(!manifest.contributes.menus["editor/title"], "search controls must not be duplicated as easy-to-miss editor-title icons");
assert.deepStrictEqual(
  tiers.map((tier) => ({
    id: tier.id,
    labels: tier.actions.filter((item) => !item.overflow).map((item) => item.label),
  })),
  [
    { id: "session", labels: ["Connect", "Open Python Editor", "Open in Shortcuts"] },
    { id: "authoring", labels: ["Search Actions", "Search Triggers", "Validate", "Build Shortcut"] },
    { id: "sync", labels: ["Sync With Host", "Live Sync", "Load ToolKit"] },
  ],
  "custom editor must render explicit session, authoring, and sync tiers"
);
assert(extensionSource.includes('commandName === "searchActions" || commandName === "searchTriggers"'));
const resolveEditorSource = extensionSource.slice(
  extensionSource.indexOf("async resolveCustomEditor"),
  extensionSource.indexOf("function activate")
);
assert(
  resolveEditorSource.indexOf("webview.onDidReceiveMessage") < resolveEditorSource.lastIndexOf("await importIntoSession()"),
  "custom-editor commands must be registered before initial bridge import can block"
);
assert(resolveEditorSource.includes("let importPromise;"), "custom-editor imports must be serialized");
assert((manifest.contributes.menus.commandPalette || []).some((item) =>
  item.command === "shortcutsRuntimeIDE.connectBridge" && item.when === "shortcutsRuntimeIDE.bridgeCanConnect"
));
assert((manifest.contributes.menus.commandPalette || []).some((item) =>
  item.command === "shortcutsRuntimeIDE.disconnectBridge" && item.when === "shortcutsRuntimeIDE.bridgeCanDisconnect"
));
assert(!extensionSource.includes("Native Python editor backing this workflow"));
assert(
  extensionSource.includes('createOutputChannel("Shortcuts Compiler Trace")'),
  "compiler debug stdout must have a dedicated Output channel"
);
assert(
  extensionSource.includes('publishCompilerTrace(document, response, "compile succeeded")') &&
    extensionSource.includes('publishCompilerTrace(document, error && error.bridgeResponse, "compile failed")'),
  "success and failure responses must both publish compiler traces"
);
assert(viewSource.includes("Runtime Details"));
assert(viewSource.includes('data-command="toggleBridge"'));
assert(
  extensionSource.includes('if (bridgeConnectionState.kind !== "connected")'),
  "Live Sync must pause instead of bootstrapping a disconnected bridge"
);
const connectSource = extensionSource.slice(
  extensionSource.indexOf("async function connectBridge"),
  extensionSource.indexOf("async function disconnectBridge")
);
assert(
  connectSource.indexOf("await refreshToolMetadata") < connectSource.lastIndexOf('setBridgeConnectionState("connected"'),
  "Connect must remain in its amber transition state until changed-ToolKit metadata refresh finishes"
);
assert(/^\*\*\/__pycache__\/\*\*$/m.test(vscodeIgnore), "VSIX must exclude Python bytecode cache directories");
assert(/^\*\*\/\*\.pyc$/m.test(vscodeIgnore), "VSIX must exclude Python bytecode files");
assert(
  !manifest.scripts["vscode:prepublish"].includes("prepare-bundled-headless-shortcuts"),
  "extension packaging must use the checked-in Headless Shortcuts snapshot"
);
assert.strictEqual(
  manifest.scripts["sync:headless-runtime"],
  "node scripts/prepare-bundled-headless-shortcuts.js",
  "Headless Shortcuts snapshot updates must remain an explicit maintainer operation"
);
assert(
  /^bundled\/headless-shortcuts\/build$/m.test(vscodeIgnore),
  "VSIX must exclude local Headless Shortcuts build output"
);

console.log("manifest-ok");
