"use strict";

const fs = require("fs/promises");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const sourceRoot = path.join(repoRoot, "bridge");
const destRoot = path.join(extensionRoot, "bundled", "bridge");
const entries = ["Makefile", "README.md", "src", "tools"];

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (_) {
    return false;
  }
}

async function copyEntry(entry) {
  const source = path.join(sourceRoot, entry);
  if (!(await exists(source))) {
    throw new Error(`Missing bridge package source: ${source}`);
  }
  await fs.cp(source, path.join(destRoot, entry), {
    recursive: true,
    filter(sourcePath) {
      const base = path.basename(sourcePath);
      if (base === ".DS_Store" || base === "__pycache__") {
        return false;
      }
      return !base.endsWith(".pyc");
    },
  });
}

async function main() {
  if (!(await exists(path.join(sourceRoot, "tools", "bridgectl.py")))) {
    throw new Error(`Could not find bridge/tools/bridgectl.py under ${sourceRoot}`);
  }
  await fs.rm(destRoot, { recursive: true, force: true });
  await fs.mkdir(destRoot, { recursive: true });
  for (const entry of entries) {
    await copyEntry(entry);
  }
  await fs.mkdir(path.join(destRoot, "logs"), { recursive: true });
  console.log(`Bundled bridge staged at ${destRoot}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
