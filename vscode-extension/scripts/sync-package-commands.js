"use strict";

const fs = require("fs");
const path = require("path");
const {
  packageActivationEvents,
  packageCommands,
  packageMenus,
} = require("../src/commandRegistry");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");

function stable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function syncedManifest(manifest) {
  return {
    ...manifest,
    activationEvents: packageActivationEvents(),
    contributes: {
      ...manifest.contributes,
      commands: packageCommands(),
      menus: packageMenus(),
    },
  };
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check") || !write;
  const originalText = fs.readFileSync(packagePath, "utf8");
  const manifest = JSON.parse(originalText);
  const nextText = stable(syncedManifest(manifest));
  if (write) {
    if (originalText !== nextText) {
      fs.writeFileSync(packagePath, nextText, "utf8");
      console.log("Updated package.json command contributions from commandRegistry.js");
    } else {
      console.log("package.json command contributions already synced");
    }
    return;
  }
  if (check && originalText !== nextText) {
    console.error("package.json command contributions are out of sync. Run: node scripts/sync-package-commands.js --write");
    process.exitCode = 1;
    return;
  }
  console.log("package-commands-ok");
}

main();
