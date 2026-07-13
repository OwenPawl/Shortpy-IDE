"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  packageActivationEvents,
  packageCommands,
  packageMenus,
} = require("../src/commandRegistry");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const extensionSource = fs.readFileSync(path.join(root, "src", "extension.js"), "utf8");
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

assert(!extensionSource.includes('data-command="resolveEntity"'), "custom editor must not expose Resolve Entity");
assert(!extensionSource.includes('data-command="status"'), "custom editor must not expose a Status button");
assert(extensionSource.includes('bridgeStatusBar.command = "shortcutsRuntimeIDE.connectBridge"'), "status bar must connect the bridge when clicked");
assert(!/Shortcuts IDE: Resolve Entity/.test(readme), "README must not document Resolve Entity as a UI command");
assert(!/Shortcuts IDE: Show Bridge Status/.test(readme), "README must not document Show Bridge Status as a UI command");
assert(commands.includes("shortcutsRuntimeIDE.openHostShortcutEditor"), "Open Shortcut Editor must be a visible command");
assert(commands.includes("shortcutsRuntimeIDE.toggleLiveSync"), "Live Sync must be a visible command");
assert(extensionSource.includes('commandName === "openHostShortcutEditor"'), "custom editor must handle Open Shortcut Editor");
assert(extensionSource.includes('commandName === "toggleLiveSync"'), "custom editor must handle Live Sync");
assert(extensionSource.includes('aria-pressed=\\"false\\"'), "custom editor Live Sync must expose native toggle state");
assert.strictEqual(
  configurationProperties["shortcutsRuntimeIDE.liveSyncPollIntervalMs"].default,
  3000,
  "Live Sync must use the documented default polling interval"
);
assert(/^\*\*\/__pycache__\/\*\*$/m.test(vscodeIgnore), "VSIX must exclude Python bytecode cache directories");
assert(/^\*\*\/\*\.pyc$/m.test(vscodeIgnore), "VSIX must exclude Python bytecode files");

console.log("manifest-ok");
