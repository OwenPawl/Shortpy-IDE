"use strict";

const cp = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
const BRIDGE_DYLIB_RELATIVE_PATH = path.join("build-sim", "libShortcutsIDESimBridge-v019.dylib");
const BRIDGE_RUNTIME_MARKER = ".shortpy-bridge-runtime.json";

function bridgeCtlPathForRoot(root) {
  return path.join(root, "tools", "bridgectl.py");
}

function bridgeRootForCtlPath(bridgeCtlPath) {
  return path.resolve(path.dirname(bridgeCtlPath), "..");
}

function packagedBridgeRoot() {
  return path.resolve(__dirname, "..", "bundled", "bridge");
}

function workspaceBridgeRoot() {
  return path.resolve(__dirname, "..", "..", "bridge");
}

function versionedStorageBridgeRoot(globalStoragePath, extensionVersion) {
  if (!globalStoragePath) {
    return "";
  }
  const safeVersion = String(extensionVersion || "dev").replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(globalStoragePath, "bridge-runtimes", safeVersion, "bridge");
}

function existsSync(file) {
  try {
    return fs.existsSync(file);
  } catch (_) {
    return false;
  }
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch (_) {
    return false;
  }
}

async function bridgeSourceSignature(root) {
  const entries = ["Makefile", "README.md", "src", "tools"];
  const files = [];
  async function visit(file, relative) {
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch (_) {
      return;
    }
    if (stat.isDirectory()) {
      const children = await fsp.readdir(file);
      for (const child of children.sort()) {
        if (child === ".DS_Store" || child === "__pycache__" || child === "logs" || child === "build-sim") {
          continue;
        }
        await visit(path.join(file, child), path.join(relative, child));
      }
      return;
    }
    if (!stat.isFile() || relative.endsWith(".pyc")) {
      return;
    }
    files.push(`${relative}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
  }
  for (const entry of entries) {
    await visit(path.join(root, entry), entry);
  }
  return files.sort().join("\n");
}

async function runtimeCopyIsCurrent(sourceRoot, destRoot) {
  const markerPath = path.join(destRoot, BRIDGE_RUNTIME_MARKER);
  try {
    const marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    return marker.sourceSignature === await bridgeSourceSignature(sourceRoot) &&
      await exists(bridgeCtlPathForRoot(destRoot));
  } catch (_) {
    return false;
  }
}

function defaultBridgeCtlPath() {
  for (const root of [packagedBridgeRoot(), workspaceBridgeRoot()]) {
    const candidate = bridgeCtlPathForRoot(root);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return bridgeCtlPathForRoot(workspaceBridgeRoot());
}

function resolveBridgeCtlPath(options = {}) {
  if (options.bridgeCtlPath) {
    return options.bridgeCtlPath;
  }
  if (options.activeBridgeCtlPath) {
    return options.activeBridgeCtlPath;
  }
  const storageRoot = versionedStorageBridgeRoot(options.globalStoragePath, options.extensionVersion);
  if (storageRoot && existsSync(bridgeCtlPathForRoot(storageRoot))) {
    return bridgeCtlPathForRoot(storageRoot);
  }
  return defaultBridgeCtlPath();
}

function normalizeOptions(options = {}) {
  return {
    pythonPath: options.pythonPath || "python3",
    bridgeCtlPath: resolveBridgeCtlPath(options),
    activeBridgeCtlPath: options.activeBridgeCtlPath || "",
    globalStoragePath: options.globalStoragePath || "",
    extensionVersion: options.extensionVersion || "dev",
    socket: options.socket || "auto",
    signShortcut: options.signShortcut,
    shortcutSigningMode: options.shortcutSigningMode || "anyone",
    shortcutsCliPath: options.shortcutsCliPath || "",
    toolkitSqlitePath: options.toolkitSqlitePath || "",
    bridgeCommandTimeoutMs: Number(options.bridgeCommandTimeoutMs) || 120000,
    bridgeMetadataTimeoutMs: Number(options.bridgeMetadataTimeoutMs) || 180000,
    bridgeStatusTimeoutMs: Number(options.bridgeStatusTimeoutMs) || 10000,
    bridgeLaunchTimeoutMs: Number(options.bridgeLaunchTimeoutMs) || 300000,
    forceBridgeLaunch: Boolean(options.forceBridgeLaunch),
  };
}

async function withTempInput(input, callback) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "shortcuts-runtime-ide-"));
  const file = path.join(dir, "input.bin");
  try {
    await fsp.writeFile(file, Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8"));
    return await callback(file);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...execOptions } = options;
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined;
    cp.execFile(command, args, { maxBuffer: DEFAULT_MAX_BUFFER, timeout, killSignal: "SIGTERM", ...execOptions }, (error, stdout, stderr) => {
      if (error) {
        const timedOut = Boolean(timeout && error.killed);
        const commandText = [command, ...args].join(" ");
        const message = timedOut
          ? `Command timed out after ${timeout}ms: ${commandText}`
          : error.message;
        const detail = stderr && stderr.trim() ? `${message}\n${stderr}` : message;
        reject(new Error(detail));
        return;
      }
      resolve(stdout);
    });
  });
}

function spawnFile(command, args, options = {}, onOutput) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child = cp.spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    };
    const emit = (stream, chunk) => {
      const text = chunk.toString();
      if (stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (onOutput) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            onOutput(line, stream);
          }
        }
      }
    };
    child.stdout.on("data", (chunk) => emit("stdout", chunk));
    child.stderr.on("data", (chunk) => emit("stderr", chunk));
    child.on("error", finish);
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const commandText = [command, ...args].join(" ");
      const message = signal
        ? `Command terminated by ${signal}: ${commandText}`
        : `Command failed with exit code ${code}: ${commandText}`;
      finish(new Error(stderr && stderr.trim() ? `${message}\n${stderr}` : message));
    });
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined;
    if (timeout) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`Command timed out after ${timeout}ms: ${[command, ...args].join(" ")}`));
      }, timeout);
    }
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
    if (command === "python-to-bplist") {
      if (config.signShortcut === false) {
        args.push("--no-sign");
      } else if (config.signShortcut === true) {
        args.push("--sign");
      }
      if (config.shortcutSigningMode) {
        args.push("--sign-mode", config.shortcutSigningMode);
      }
      if (config.shortcutsCliPath) {
        args.push("--shortcuts-cli", config.shortcutsCliPath);
      }
    }
    const timeoutMs = command.includes("toolrenderer")
      ? config.bridgeMetadataTimeoutMs
      : config.bridgeCommandTimeoutMs;
    const stdout = await execFile(config.pythonPath, args, { timeoutMs });
    let response;
    try {
      response = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Bridge returned non-JSON response for ${command}: ${stdout.slice(0, 500)}`);
    }
    if (!response.ok) {
      const signing = response.shortcut_signing;
      const signingDetail = signing && signing.stderr
        ? `\n${signing.stderr}`
        : "";
      const diagnostic = `${response.diagnostic || response.error || JSON.stringify(response)}${signingDetail}`;
      const err = new Error(diagnostic);
      err.bridgeResponse = response;
      throw err;
    }
    return response;
  });
}

async function runBridgeCli(args, options = {}) {
  const config = normalizeOptions(options);
  const commandName = Array.isArray(args) && args.length > 0 ? String(args[0]) : "";
  const timeoutMs = commandName.includes("toolrenderer")
    ? config.bridgeMetadataTimeoutMs
    : config.bridgeCommandTimeoutMs;
  const stdout = await execFile(config.pythonPath, [
    config.bridgeCtlPath,
    "--socket",
    config.socket,
    "--raw",
    ...args,
  ], { timeoutMs });
  let response;
  try {
    response = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Bridge returned non-JSON response: ${stdout.slice(0, 500)}`);
  }
  if (!response.ok) {
    const signing = response.shortcut_signing;
    const signingDetail = signing && signing.stderr
      ? `\n${signing.stderr}`
      : "";
    const diagnostic = `${response.diagnostic || response.error || JSON.stringify(response)}${signingDetail}`;
    const err = new Error(diagnostic);
    err.bridgeResponse = response;
    throw err;
  }
  return response;
}

async function runBridgeStatus(options = {}) {
  const config = normalizeOptions(options);
  const stdout = await execFile(
    config.pythonPath,
    [config.bridgeCtlPath, "--socket", config.socket, "--raw", "status"],
    { timeoutMs: config.bridgeStatusTimeoutMs }
  );
  return JSON.parse(stdout);
}

async function copyBridgeRuntime(sourceRoot, destRoot) {
  const entries = ["Makefile", "README.md", "src", "tools"];
  const sourceSignature = await bridgeSourceSignature(sourceRoot);
  await fsp.rm(destRoot, { recursive: true, force: true });
  await fsp.mkdir(destRoot, { recursive: true });
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry);
    if (!(await exists(source))) {
      continue;
    }
    await fsp.cp(source, path.join(destRoot, entry), {
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
  await fsp.mkdir(path.join(destRoot, "logs"), { recursive: true });
  await fsp.writeFile(path.join(destRoot, BRIDGE_RUNTIME_MARKER), JSON.stringify({
    copiedAt: new Date().toISOString(),
    sourceRoot,
    sourceSignature,
  }, null, 2));
}

async function resolveBridgeRuntime(options = {}) {
  const config = normalizeOptions(options);
  if (options.bridgeCtlPath) {
    const bridgeRoot = bridgeRootForCtlPath(options.bridgeCtlPath);
    return {
      source: "configured",
      bridgeRoot,
      bridgeCtlPath: options.bridgeCtlPath,
    };
  }
  const storageRoot = versionedStorageBridgeRoot(config.globalStoragePath, config.extensionVersion);
  const storageCtl = storageRoot ? bridgeCtlPathForRoot(storageRoot) : "";
  const packagedRoot = packagedBridgeRoot();
  const packagedCtl = bridgeCtlPathForRoot(packagedRoot);
  const hasPackagedRuntime = await exists(packagedCtl);
  if (storageRoot && hasPackagedRuntime && !(await runtimeCopyIsCurrent(packagedRoot, storageRoot))) {
    await copyBridgeRuntime(packagedRoot, storageRoot);
    return {
      source: "bundled-storage",
      bridgeRoot: storageRoot,
      bridgeCtlPath: storageCtl,
      copiedFrom: packagedRoot,
    };
  }
  if (storageCtl && await exists(storageCtl)) {
    return {
      source: "bundled-storage",
      bridgeRoot: storageRoot,
      bridgeCtlPath: storageCtl,
    };
  }
  if (storageRoot && await exists(packagedCtl)) {
    await copyBridgeRuntime(packagedRoot, storageRoot);
    return {
      source: "bundled-storage",
      bridgeRoot: storageRoot,
      bridgeCtlPath: storageCtl,
      copiedFrom: packagedRoot,
    };
  }
  const workspaceRoot = workspaceBridgeRoot();
  const workspaceCtl = bridgeCtlPathForRoot(workspaceRoot);
  if (await exists(workspaceCtl)) {
    return {
      source: "workspace",
      bridgeRoot: workspaceRoot,
      bridgeCtlPath: workspaceCtl,
    };
  }
  throw new Error(
    "Could not find the Shortpy bridge. Install the full Shortpy IDE extension package or set shortcutsRuntimeIDE.bridgeCtlPath."
  );
}

async function buildBridgeIfNeeded(runtime, options = {}, onProgress) {
  const config = normalizeOptions(options);
  const dylib = path.join(runtime.bridgeRoot, BRIDGE_DYLIB_RELATIVE_PATH);
  if (await exists(dylib)) {
    return { built: false, dylib };
  }
  if (onProgress) {
    onProgress({ kind: "building", message: "Building simulator bridge dylib", bridgeRoot: runtime.bridgeRoot });
  }
  await execFile("make", ["-C", runtime.bridgeRoot, "all"], {
    timeoutMs: config.bridgeLaunchTimeoutMs,
  });
  if (!(await exists(dylib))) {
    throw new Error(`Bridge build completed but did not create ${dylib}`);
  }
  return { built: true, dylib };
}

async function launchBridgeRuntime(runtime, options = {}, onProgress) {
  const config = normalizeOptions({ ...options, bridgeCtlPath: runtime.bridgeCtlPath });
  const launcher = path.join(runtime.bridgeRoot, "tools", "launch_shortcuts_sim_bridge.sh");
  if (!(await exists(launcher))) {
    throw new Error(`Missing simulator bridge launcher: ${launcher}`);
  }
  if (onProgress) {
    onProgress({ kind: "booting", message: "Booting or opening iOS Simulator if needed", bridgeRoot: runtime.bridgeRoot });
  }
  const env = {
    ...process.env,
    SHORTPY_IDE_BOOT_SIMULATOR: "1",
  };
  if (config.toolkitSqlitePath) {
    env.SHORTPY_TOOLKIT_SQLITE = config.toolkitSqlitePath;
  }
  const output = await spawnFile("/bin/bash", [launcher], {
    timeoutMs: config.bridgeLaunchTimeoutMs,
    env,
  }, (line, stream) => {
    if (onProgress) {
      if (/shortpy-bridge-stage:\s*booting/i.test(line)) {
        onProgress({ kind: "booting", message: line.replace(/^shortpy-bridge-stage:\s*/i, ""), stream });
      } else if (/shortpy-bridge-stage:\s*toolkit/i.test(line)) {
        onProgress({ kind: "toolkit", message: line.replace(/^shortpy-bridge-stage:\s*/i, ""), stream });
      } else if (/shortpy-bridge-stage:\s*launching/i.test(line)) {
        onProgress({ kind: "launching", message: line.replace(/^shortpy-bridge-stage:\s*/i, ""), stream });
      } else {
        onProgress({ kind: "launching", message: line, stream });
      }
    }
  });
  return output;
}

async function ensureBridgeLaunched(options = {}, onProgress) {
  const config = normalizeOptions(options);
  const runtime = await resolveBridgeRuntime(options);
  const statusOptions = { ...config, bridgeCtlPath: runtime.bridgeCtlPath };
  if (!config.forceBridgeLaunch) {
    try {
      const status = await runBridgeStatus(statusOptions);
      return {
        status,
        alreadyRunning: true,
        bridgeRoot: runtime.bridgeRoot,
        bridgeCtlPath: runtime.bridgeCtlPath,
        source: runtime.source,
      };
    } catch (_) {
      // Fall through to build/launch on explicit Connect.
    }
  }
  const build = await buildBridgeIfNeeded(runtime, config, onProgress);
  await launchBridgeRuntime(runtime, config, onProgress);
  const status = await runBridgeStatus(statusOptions);
  return {
    status,
    alreadyRunning: false,
    build,
    bridgeRoot: runtime.bridgeRoot,
    bridgeCtlPath: runtime.bridgeCtlPath,
    source: runtime.source,
  };
}

function bplistBufferFromResponse(response) {
  const payload = response && response.plist_payload;
  if (!payload || payload.encoding !== "base64" || typeof payload.data !== "string") {
    throw new Error("Bridge response did not include a base64 binary plist payload.");
  }
  return Buffer.from(payload.data, "base64");
}

function shortcutBufferFromResponse(response) {
  const payload = response && response.shortcut_payload;
  if (!payload || payload.encoding !== "base64" || typeof payload.data !== "string") {
    return bplistBufferFromResponse(response);
  }
  return Buffer.from(payload.data, "base64");
}

module.exports = {
  binaryPlistToXml,
  bplistBufferFromResponse,
  bridgeCtlPathForRoot,
  defaultBridgeCtlPath,
  ensureBridgeLaunched,
  normalizeOptions,
  resolveBridgeCtlPath,
  resolveBridgeRuntime,
  runBridgeCli,
  runBridgeCommand,
  runBridgeStatus,
  shortcutBufferFromResponse,
  versionedStorageBridgeRoot,
};
