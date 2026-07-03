"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const extensionRoot = path.join(repoRoot, "vscode-extension");
const extensionPackage = require(path.join(extensionRoot, "package.json"));
const installVsixScript = path.join(extensionRoot, "scripts", "install-vsix.js");
const defaultVsix = path.join(extensionRoot, `shortpy-ide-${extensionPackage.version}.vsix`);

function printHelp() {
  console.log(`Usage: npm run install-extension -- [--package-only] [--install-only]

Packages the Shortpy IDE VS Code extension and installs it into VS Code.

Options:
  --package-only   Build the VSIX but do not install it.
  --install-only   Install the already-built VSIX for the current extension version.

Environment:
  VSCODE_CLI=/path/to/code   Override VS Code CLI discovery.
`);
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function commandWorks(command, args) {
  const result = cp.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function ensureNpm() {
  if (!commandWorks("npm", ["--version"])) {
    throw new Error("npm is required to package the VS Code extension.");
  }
}

function packageExtension() {
  run("npm", [
    "exec",
    "--yes",
    "--package",
    "@vscode/vsce",
    "--",
    "vsce",
    "package",
    "--allow-missing-repository",
  ], { cwd: extensionRoot });
}

function installExtension() {
  if (!fs.existsSync(defaultVsix)) {
    throw new Error(`Missing VSIX: ${defaultVsix}. Run npm run package-extension first.`);
  }
  run(process.execPath, [installVsixScript, defaultVsix], { cwd: extensionRoot });
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  const packageOnly = args.has("--package-only");
  const installOnly = args.has("--install-only");
  if (packageOnly && installOnly) {
    throw new Error("Use either --package-only or --install-only, not both.");
  }

  ensureNpm();
  if (!installOnly) {
    packageExtension();
  }
  if (packageOnly) {
    console.log(`\nPackaged VSIX: ${defaultVsix}`);
    return;
  }

  installExtension();
  console.log("\nInstalled Shortpy IDE.");
  console.log("Next: open VS Code and run Command Palette -> Shortcuts IDE: Connect To Bridge.");
}

try {
  main();
} catch (error) {
  console.error(`\nInstall failed: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
