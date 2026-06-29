"use strict";

const cp = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

function defaultToolkitCtlPath() {
  return path.resolve(__dirname, "..", "..", "bridge", "tools", "toolkitctl.py");
}

function normalizeToolkitOptions(options = {}) {
  return {
    pythonPath: options.pythonPath || "python3",
    toolkitCtlPath: options.toolkitCtlPath || defaultToolkitCtlPath(),
    device: options.device || "booted",
  };
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { maxBuffer: DEFAULT_MAX_BUFFER, ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr && stderr.trim() ? `${error.message}\n${stderr}` : error.message;
        reject(new Error(detail));
        return;
      }
      resolve(stdout);
    });
  });
}

async function runToolkitCommand(args, options = {}) {
  const config = normalizeToolkitOptions(options);
  const stdout = await execFile(config.pythonPath, [
    config.toolkitCtlPath,
    "--device",
    config.device,
    ...args,
  ]);
  return JSON.parse(stdout);
}

async function refreshToolkitMetadata(outPath, options = {}) {
  const config = normalizeToolkitOptions(options);
  const stdout = await execFile(config.pythonPath, [
    config.toolkitCtlPath,
    "--device",
    config.device,
    "--quiet",
    "metadata",
    "--out",
    outPath,
  ]);
  return JSON.parse(stdout);
}

async function loadToolkitMetadata(metadataPath) {
  const data = await fs.readFile(metadataPath, "utf8");
  return JSON.parse(data);
}

function indexToolkitMetadata(metadata) {
  const byName = new Map();
  const actions = Array.isArray(metadata && metadata.actions) ? metadata.actions : [];
  const triggers = Array.isArray(metadata && metadata.triggers) ? metadata.triggers : [];
  const types = Array.isArray(metadata && metadata.types) ? metadata.types : [];
  const uniqueActions = new Map();
  const uniqueTriggers = new Map();
  const uniqueTypes = new Map();
  for (const action of actions) {
    const item = { ...action, kind: "action" };
    byName.set(action.pythonName, item);
    uniqueActions.set(action.pythonName, item);
  }
  for (const trigger of triggers) {
    const item = { ...trigger, kind: "trigger" };
    byName.set(trigger.pythonName, item);
    uniqueTriggers.set(trigger.pythonName, item);
  }
  for (const type of types) {
    const item = { ...type, kind: "type" };
    if (!byName.has(type.pythonName)) {
      byName.set(type.pythonName, item);
    }
    uniqueTypes.set(type.pythonName, item);
  }
  return {
    byName,
    actions: Array.from(uniqueActions.values()),
    triggers: Array.from(uniqueTriggers.values()),
    types: Array.from(uniqueTypes.values()),
  };
}

module.exports = {
  defaultToolkitCtlPath,
  indexToolkitMetadata,
  loadToolkitMetadata,
  normalizeToolkitOptions,
  refreshToolkitMetadata,
  runToolkitCommand,
};
