"use strict";

const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

function defaultBridgeCtlPath() {
  return path.resolve(__dirname, "..", "..", "bridge", "tools", "bridgectl.py");
}

function normalizeOptions(options = {}) {
  return {
    pythonPath: options.pythonPath || "python3",
    bridgeCtlPath: options.bridgeCtlPath || defaultBridgeCtlPath(),
    socket: options.socket || "auto",
  };
}

async function withTempInput(input, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shortcuts-runtime-ide-"));
  const file = path.join(dir, "input.bin");
  try {
    await fs.writeFile(file, Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8"));
    return await callback(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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

async function binaryPlistToXml(buffer) {
  return withTempInput(buffer, async (file) => {
    return execFile("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", file]);
  });
}

async function runBridgeCommand(command, input, options = {}) {
  const config = normalizeOptions(options);
  return withTempInput(input ?? Buffer.alloc(0), async (file) => {
    const args = [config.bridgeCtlPath, "--socket", config.socket, "--raw", command];
    const noInputCommands = new Set([
      "status",
      "last",
      "clear",
      "toolrenderer-python-interface",
      "toolrenderer-structured-metadata",
      "catalog-dump-latest",
      "catalog-encode-latest-debug",
    ]);
    if (!noInputCommands.has(command)) {
      args.push("--file", file);
    }
    const stdout = await execFile(config.pythonPath, args);
    let response;
    try {
      response = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Bridge returned non-JSON response for ${command}: ${stdout.slice(0, 500)}`);
    }
    if (!response.ok) {
      const diagnostic = response.diagnostic || response.error || JSON.stringify(response);
      const err = new Error(diagnostic);
      err.bridgeResponse = response;
      throw err;
    }
    return response;
  });
}

async function runBridgeCli(args, options = {}) {
  const config = normalizeOptions(options);
  const stdout = await execFile(config.pythonPath, [
    config.bridgeCtlPath,
    "--socket",
    config.socket,
    "--raw",
    ...args,
  ]);
  let response;
  try {
    response = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Bridge returned non-JSON response: ${stdout.slice(0, 500)}`);
  }
  if (!response.ok) {
    const diagnostic = response.diagnostic || response.error || JSON.stringify(response);
    const err = new Error(diagnostic);
    err.bridgeResponse = response;
    throw err;
  }
  return response;
}

async function runBridgeStatus(options = {}) {
  const config = normalizeOptions(options);
  const stdout = await execFile(config.pythonPath, [config.bridgeCtlPath, "--socket", config.socket, "--raw", "status"]);
  return JSON.parse(stdout);
}

function bplistBufferFromResponse(response) {
  const payload = response && response.plist_payload;
  if (!payload || payload.encoding !== "base64" || typeof payload.data !== "string") {
    throw new Error("Bridge response did not include a base64 binary plist payload.");
  }
  return Buffer.from(payload.data, "base64");
}

module.exports = {
  binaryPlistToXml,
  bplistBufferFromResponse,
  defaultBridgeCtlPath,
  normalizeOptions,
  runBridgeCli,
  runBridgeCommand,
  runBridgeStatus,
};
