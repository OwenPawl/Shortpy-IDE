"use strict";

const cp = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const RUNTIME_MARKER = ".shortpy-headless-runtime.json";
const BINARY_RELATIVE_PATH = path.join("build", "headless-shortcuts");
const SOURCE_ENTRIES = ["Makefile", "README.md", "LICENSE", "Sources"];
const WORKFLOW_ID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

function packagedSourceRoot() {
  return path.resolve(__dirname, "..", "bundled", "headless-shortcuts");
}

function mergeScriptPath() {
  return path.resolve(__dirname, "..", "scripts", "merge-workflow-plists.py");
}

function versionedStorageRoot(globalStoragePath, extensionVersion) {
  if (!globalStoragePath) {
    return "";
  }
  const version = String(extensionVersion || "dev").replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(globalStoragePath, "headless-shortcuts-runtimes", version);
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch (_) {
    return false;
  }
}

async function sourceSignature(root) {
  const hash = crypto.createHash("sha256");
  async function visit(file, relative) {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      const children = (await fsp.readdir(file)).sort();
      for (const child of children) {
        if (child === ".DS_Store" || child === "build") {
          continue;
        }
        await visit(path.join(file, child), path.join(relative, child));
      }
      return;
    }
    if (stat.isFile()) {
      hash.update(relative);
      hash.update(await fsp.readFile(file));
    }
  }
  for (const entry of SOURCE_ENTRIES) {
    const file = path.join(root, entry);
    if (await exists(file)) {
      await visit(file, entry);
    }
  }
  return hash.digest("hex");
}

async function copySourceRuntime(sourceRoot, destinationRoot) {
  const signature = await sourceSignature(sourceRoot);
  await fsp.rm(destinationRoot, { recursive: true, force: true });
  await fsp.mkdir(destinationRoot, { recursive: true });
  for (const entry of SOURCE_ENTRIES) {
    const source = path.join(sourceRoot, entry);
    if (!(await exists(source))) {
      continue;
    }
    await fsp.cp(source, path.join(destinationRoot, entry), {
      recursive: true,
      filter(candidate) {
        const base = path.basename(candidate);
        return base !== ".DS_Store" && base !== "build";
      },
    });
  }
  await fsp.writeFile(path.join(destinationRoot, RUNTIME_MARKER), JSON.stringify({
    copiedAt: new Date().toISOString(),
    signature,
    sourceRoot,
  }, null, 2));
  return signature;
}

async function runtimeCopyIsCurrent(sourceRoot, destinationRoot) {
  try {
    const marker = JSON.parse(await fsp.readFile(path.join(destinationRoot, RUNTIME_MARKER), "utf8"));
    return marker.signature === await sourceSignature(sourceRoot);
  } catch (_) {
    return false;
  }
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = Number(options.timeoutMs) || 120000;
    cp.execFile(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout,
      killSignal: "SIGTERM",
    }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(stderr && stderr.trim() ? `${error.message}\n${stderr.trim()}` : error.message);
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        wrapped.cause = error;
        reject(wrapped);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function resolveSourceRoot() {
  const root = packagedSourceRoot();
  if (await exists(path.join(root, "Makefile")) && await exists(path.join(root, "Sources"))) {
    return root;
  }
  throw new Error("Headless Shortcuts source is missing from this extension package.");
}

async function ensureHeadlessRuntime(options = {}, onProgress) {
  if (options.headlessShortcutsPath) {
    const binary = path.resolve(options.headlessShortcutsPath);
    if (!(await exists(binary))) {
      throw new Error(`Configured Headless Shortcuts binary does not exist: ${binary}`);
    }
    return { binary, source: "configured" };
  }

  const destinationRoot = versionedStorageRoot(options.globalStoragePath, options.extensionVersion);
  if (!destinationRoot) {
    throw new Error("VS Code extension storage is unavailable for the Headless Shortcuts runtime.");
  }
  const sourceRoot = await resolveSourceRoot();
  if (!(await runtimeCopyIsCurrent(sourceRoot, destinationRoot))) {
    if (onProgress) {
      onProgress({ kind: "copying", message: "Preparing host Shortcuts runtime" });
    }
    await copySourceRuntime(sourceRoot, destinationRoot);
  }

  const binary = path.join(destinationRoot, BINARY_RELATIVE_PATH);
  if (!(await exists(binary))) {
    if (onProgress) {
      onProgress({ kind: "building", message: "Building host Shortcuts runtime" });
    }
    try {
      await execFile("make", ["-C", destinationRoot, "all"], {
        timeoutMs: options.hostCommandTimeoutMs,
      });
    } catch (error) {
      throw new Error(`Could not build Headless Shortcuts. Install Xcode Command Line Tools and retry. ${error.message}`);
    }
  }
  if (!(await exists(binary))) {
    throw new Error(`Headless Shortcuts build did not create ${binary}`);
  }
  return { binary, root: destinationRoot, source: "bundled-storage" };
}

function parseResponse(stdout, command) {
  let response;
  try {
    response = JSON.parse(String(stdout || "").trim());
  } catch (_) {
    throw new Error(`Headless Shortcuts returned non-JSON output for ${command}: ${String(stdout || "").slice(0, 500)}`);
  }
  if (!response.ok) {
    const detail = response.error && response.error.message
      ? response.error.message
      : JSON.stringify(response);
    const error = new Error(detail);
    error.code = response.error && response.error.code;
    error.hostResponse = response;
    throw error;
  }
  return response;
}

async function runHeadless(binary, args, options = {}) {
  const env = { ...process.env };
  if (options.databasePath) {
    env.HEADLESS_SHORTCUTS_DATABASE = options.databasePath;
  }
  try {
    const result = await execFile(binary, args, {
      env,
      timeoutMs: options.hostCommandTimeoutMs,
    });
    return parseResponse(result.stdout, args[0]);
  } catch (error) {
    if (error.stdout && String(error.stdout).trim()) {
      return parseResponse(error.stdout, args[0]);
    }
    throw error;
  }
}

function hashSource(source) {
  return crypto.createHash("sha256").update(String(source || ""), "utf8").digest("hex");
}

function shortcutEditorDeepLink(workflowID, name) {
  const id = String(workflowID || "").trim();
  const title = String(name || "").trim();
  const query = [];
  if (WORKFLOW_ID_RE.test(id)) {
    query.push(`id=${encodeURIComponent(id)}`);
  }
  if (title) {
    query.push(`name=${encodeURIComponent(title)}`);
  }
  if (query.length === 0) {
    throw new Error("A valid shortcut workflow ID or name is required to open the Shortcuts editor.");
  }
  return `shortcuts://open-shortcut?${query.join("&")}`;
}

async function canonicalPlistHashAtPath(plistPath, options = {}) {
  const result = await execFile("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", plistPath], {
    timeoutMs: options.hostCommandTimeoutMs,
  });
  return crypto.createHash("sha256").update(result.stdout, "utf8").digest("hex");
}

function determineSyncAction(link, sourceHash, hostHash) {
  if (!link || !link.sourceHash || !link.hostHash) {
    return "initialize";
  }
  const localChanged = sourceHash !== link.sourceHash;
  const hostChanged = hostHash !== link.hostHash;
  if (!localChanged && !hostChanged) {
    return "none";
  }
  if (localChanged && !hostChanged) {
    return "push";
  }
  if (!localChanged && hostChanged) {
    return "pull";
  }
  return "conflict";
}

async function exportHostShortcut(workflowID, options = {}, onProgress) {
  const runtime = await ensureHeadlessRuntime(options, onProgress);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "shortpy-host-export-"));
  const outputPath = path.join(directory, "workflow.plist");
  try {
    const response = await runHeadless(runtime.binary, [
      "export",
      "--id",
      workflowID,
      "--output",
      outputPath,
    ], options);
    const plist = await fsp.readFile(outputPath);
    const hostHash = await canonicalPlistHashAtPath(outputPath, options);
    return { ...response, hostHash, plist, runtime };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

async function mergeWorkflowPlists(request, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "shortpy-host-merge-"));
  const basePath = path.join(directory, "base.plist");
  const localPath = path.join(directory, "local.plist");
  const hostPath = path.join(directory, "host.plist");
  const outputPath = path.join(directory, "merged.plist");
  try {
    await Promise.all([
      fsp.writeFile(basePath, Buffer.from(request.base)),
      fsp.writeFile(localPath, Buffer.from(request.local)),
      fsp.writeFile(hostPath, Buffer.from(request.host)),
    ]);
    await execFile(options.pythonPath || "python3", [
      mergeScriptPath(),
      "--base",
      basePath,
      "--local",
      localPath,
      "--host",
      hostPath,
      "--output",
      outputPath,
      ...(request.preserveKeys || []).flatMap((key) => ["--preserve-key", key]),
      ...(request.preserveRootKeys || []).flatMap((key) => ["--preserve-root-key", key]),
    ], { timeoutMs: options.hostCommandTimeoutMs });
    return await fsp.readFile(outputPath);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

async function syncHostShortcut(request, options = {}, onProgress) {
  const runtime = await ensureHeadlessRuntime(options, onProgress);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "shortpy-host-sync-"));
  const plistPath = path.join(directory, "workflow.plist");
  try {
    await fsp.writeFile(plistPath, Buffer.from(request.plist));
    const args = request.workflowID
      ? ["edit", "--id", request.workflowID, "--plist", plistPath]
      : ["create", "--plist", plistPath, "--name", request.name];
    if (!request.workflowID && !request.name) {
      throw new Error("A shortcut name is required for the first host sync.");
    }
    const response = await runHeadless(runtime.binary, args, options);
    return { ...response, runtime };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

module.exports = {
  determineSyncAction,
  ensureHeadlessRuntime,
  exportHostShortcut,
  hashSource,
  mergeWorkflowPlists,
  packagedSourceRoot,
  parseResponse,
  shortcutEditorDeepLink,
  syncHostShortcut,
  versionedStorageRoot,
};
