"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const defaultVsix = path.join(root, `shortpy-ide-${packageJson.version}.vsix`);

const CLI_CANDIDATES = [
  process.env.VSCODE_CLI,
  "code",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
  path.join(process.env.HOME || "", "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
  path.join(process.env.HOME || "", "Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"),
].filter(Boolean);

function run(command, args, options = {}) {
  return cp.spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function usableCli(command) {
  const result = run(command, ["--version"]);
  return result.status === 0;
}

function findCli() {
  for (const candidate of CLI_CANDIDATES) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
      continue;
    }
    if (usableCli(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find the VS Code CLI. Set VSCODE_CLI=/path/to/code or install VS Code's shell command.");
}

function main() {
  const vsix = path.resolve(process.argv[2] || defaultVsix);
  if (!fs.existsSync(vsix)) {
    throw new Error(`Missing VSIX: ${vsix}`);
  }
  const cli = findCli();
  console.log(`Using VS Code CLI: ${cli}`);
  const result = run(cli, ["--install-extension", vsix, "--force"], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }
  const list = run(cli, ["--list-extensions", "--show-versions"]);
  if (list.status === 0) {
    const match = list.stdout.split(/\r?\n/).find((line) => /^local\.shortpy-ide@/.test(line));
    if (match) {
      console.log(`Installed ${match}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
}
