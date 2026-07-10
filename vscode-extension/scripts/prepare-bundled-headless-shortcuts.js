"use strict";

const fs = require("fs");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const destination = path.join(extensionRoot, "bundled", "headless-shortcuts");
const configuredSource = process.env.SHORTPY_HEADLESS_SHORTCUTS_SOURCE;
const source = configuredSource
  ? path.resolve(configuredSource)
  : path.resolve(extensionRoot, "..", "..", "Headless-Shortcuts");
const entries = ["Makefile", "README.md", "LICENSE", "Sources"];

if (!fs.existsSync(path.join(source, "Makefile"))) {
  if (fs.existsSync(path.join(destination, "Makefile"))) {
    process.stdout.write(`Using existing bundled Headless Shortcuts snapshot at ${destination}\n`);
    process.exit(0);
  }
  throw new Error(`Headless Shortcuts source was not found at ${source}`);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const entry of entries) {
  const input = path.join(source, entry);
  if (!fs.existsSync(input)) {
    continue;
  }
  fs.cpSync(input, path.join(destination, entry), {
    recursive: true,
    filter(candidate) {
      const base = path.basename(candidate);
      return base !== ".DS_Store" && base !== "build";
    },
  });
}

process.stdout.write(`Bundled Headless Shortcuts from ${source}\n`);
