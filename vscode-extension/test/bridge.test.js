"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  bridgeCtlPathForRoot,
  ensureBridgeLaunched,
  normalizeOptions,
  resolveBridgeRuntime,
  runBridgeCommand,
  versionedStorageBridgeRoot,
} = require("../src/bridge");

const BRIDGE_RUNTIME_MARKER = ".shortpy-bridge-runtime.json";

async function writeExecutable(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
  await fs.chmod(file, 0o755);
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr && stderr.trim() ? `${error.message}\n${stderr}` : error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function makeFakeBridge(root, initiallyRunning) {
  const state = path.join(root, "running");
  const toolkitEnv = path.join(root, "toolkit-env");
  const launchEnv = path.join(root, "launch-env.json");
  await fs.mkdir(root, { recursive: true });
  if (initiallyRunning) {
    await fs.writeFile(state, "1", "utf8");
  }
  await fs.mkdir(path.join(root, "build-sim"), { recursive: true });
  await fs.writeFile(path.join(root, "build-sim", "libShortcutsIDESimBridge-v019.dylib"), "", "utf8");
  await writeExecutable(path.join(root, "tools", "bridgectl.py"), `#!/usr/bin/env python3
import json, os, sys
state = ${JSON.stringify(state)}
if sys.argv[-1] == "status" and os.path.exists(state):
    print(json.dumps({"ok": True, "version": "fake", "socket_path": "/tmp/fake.sock"}))
    raise SystemExit(0)
print("not running", file=sys.stderr)
raise SystemExit(2)
`);
await writeExecutable(path.join(root, "tools", "launch_shortcuts_sim_bridge.sh"), `#!/usr/bin/env bash
set -euo pipefail
echo "shortpy-bridge-stage: booting fake"
printf '%s' "\${SHORTPY_TOOLKIT_SQLITE:-}" > ${JSON.stringify(toolkitEnv)}
python3 - <<'PY'
import json, os
keys = [
    "SHORTPY_IDE_BOOT_SIMULATOR",
    "SHORTPY_IDE_OPEN_SIMULATOR",
    "SHORTPY_IDE_QUIT_SIMULATOR_APP",
    "SHORTPY_IDE_SINGLE_SIMULATOR",
]
open(${JSON.stringify(launchEnv)}, "w").write(json.dumps({key: os.environ.get(key, "") for key in keys}))
PY
echo "shortpy-bridge-stage: launching fake"
printf 1 > ${JSON.stringify(state)}
`);
  return { state, toolkitEnv, launchEnv };
}

async function exists(file) {
  try {
    await fs.access(file);
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
      stat = await fs.stat(file);
    } catch (_) {
      return;
    }
    if (stat.isDirectory()) {
      const children = await fs.readdir(file);
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

async function markFakeStorageRuntimeCurrent(storageRoot) {
  const packagedRoot = path.resolve(__dirname, "..", "bundled", "bridge");
  if (!(await exists(bridgeCtlPathForRoot(packagedRoot)))) {
    return;
  }
  await fs.writeFile(
    path.join(storageRoot, BRIDGE_RUNTIME_MARKER),
    JSON.stringify({
      sourceRoot: packagedRoot,
      sourceSignature: await bridgeSourceSignature(packagedRoot),
      copiedAt: new Date().toISOString(),
    }, null, 2),
    "utf8"
  );
}

async function testToolkitDuplicateRewrite(temp) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const toolkitCtl = path.join(repoRoot, "bridge", "tools", "toolkitctl.py");
  const source = path.join(temp, "toolkit-source.sqlite");
  const adjusted = path.join(temp, "toolkit-adjusted.sqlite");
  await execFile("python3", ["-c", `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.executescript("""
CREATE TABLE Tools (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE Triggers (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE Types (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
INSERT INTO Tools VALUES (1, 'com.apple.shortcuts.OpenAppIntent', 'open_app');
INSERT INTO Tools VALUES (2, 'com.apple.mobiletimer.OpenAppIntent', 'open_app');
INSERT INTO Triggers VALUES (1, 'com.apple.shortcuts.when_app_opened', 'when_app_opened');
INSERT INTO Triggers VALUES (2, 'com.apple.focus.when_app_opened', 'when_app_opened');
INSERT INTO Types VALUES (1, 'com.apple.shortcuts.App', 'App');
INSERT INTO Types VALUES (2, 'com.apple.contacts.App', 'App');
""")
conn.commit()
conn.close()
`, source]);
  const raw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", source, "--out", adjusted]);
  const payload = JSON.parse(raw);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.duplicate_adjustment.change_count, 4);
  const namesRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
out = {}
for table in ("Tools", "Triggers", "Types"):
    out[table] = [row[0] for row in conn.execute(f"SELECT pythonName FROM {table} ORDER BY rowId")]
print(json.dumps(out))
`, adjusted]);
  const names = JSON.parse(namesRaw);
  assert.deepStrictEqual(names.Tools, [
    "com_apple_shortcuts_OpenAppIntent",
    "com_apple_mobiletimer_OpenAppIntent",
  ]);
  assert.deepStrictEqual(names.Triggers, [
    "com_apple_shortcuts_when_app_opened",
    "com_apple_focus_when_app_opened",
  ]);
  assert.deepStrictEqual(names.Types, ["App", "App"]);
}

async function testToolkitActivateReplacesActiveTarget(temp) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const toolkitCtl = path.join(repoRoot, "bridge", "tools", "toolkitctl.py");
  const home = path.join(temp, "fake-home");
  const device = "FAKE-DEVICE";
  const toolkitDir = path.join(home, "Library", "Developer", "CoreSimulator", "Devices", device, "data", "Library", "Shortcuts", "ToolKit");
  const target = path.join(toolkitDir, "Tools-prod.v78-native.sqlite");
  const active = path.join(toolkitDir, "Tools-active");
  const source = path.join(temp, "selected-toolkit.sqlite");
  await fs.mkdir(toolkitDir, { recursive: true });
  await execFile("python3", ["-c", `
import sqlite3, sys
target, source = sys.argv[1:3]
for path, rows in [
    (target, [(1, 'native.one', 'native_one', 7)]),
    (source, [
        (1, 'com.apple.shortcuts.OpenAppIntent', 'open_app', 0),
        (2, 'com.apple.mobiletimer.OpenAppIntent', 'open_app', 3),
    ]),
]:
    conn = sqlite3.connect(path)
    conn.executescript("""
    CREATE TABLE Tools (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT, visibilityFlags INTEGER);
    CREATE TABLE Triggers (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
    """)
    conn.executemany("INSERT INTO Tools VALUES (?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()
`, target, source]);
  await fs.symlink(target, active);
  const env = { ...process.env, HOME: home };
  const raw = await execFile("python3", [toolkitCtl, "--device", device, "activate", "--sqlite", source], { env });
  const payload = JSON.parse(raw);
  const realTarget = await fs.realpath(target);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.mode, "prepared-copy-replace-active-target");
  assert.strictEqual(payload.replacement.target.path, realTarget);
  assert.strictEqual(await fs.readlink(active), target);
  assert(payload.replacement.backup.path.includes(".shortpy-target-backup-"));
  const afterRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT id, pythonName, visibilityFlags FROM Tools ORDER BY rowId"))))
`, target]);
  assert.deepStrictEqual(JSON.parse(afterRaw), [
    ["com.apple.shortcuts.OpenAppIntent", "com_apple_shortcuts_OpenAppIntent", 5],
    ["com.apple.mobiletimer.OpenAppIntent", "com_apple_mobiletimer_OpenAppIntent", 7],
  ]);
  const restoreRaw = await execFile("python3", [toolkitCtl, "--device", device, "restore"], { env });
  const restore = JSON.parse(restoreRaw);
  assert.strictEqual(restore.ok, true);
  const restoredRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT id, pythonName, visibilityFlags FROM Tools ORDER BY rowId"))))
`, target]);
  assert.deepStrictEqual(JSON.parse(restoredRaw), [["native.one", "native_one", 7]]);
}

async function testValidationBridgeArgs(temp) {
  const bridgeRoot = path.join(temp, "validation-bridge");
  const argsFile = path.join(temp, "validation-args.json");
  const inputFile = path.join(temp, "validation-input.txt");
  await fs.mkdir(path.join(bridgeRoot, "tools"), { recursive: true });
  await writeExecutable(path.join(bridgeRoot, "tools", "bridgectl.py"), `#!/usr/bin/env python3
import json, pathlib, sys
pathlib.Path(${JSON.stringify(argsFile)}).write_text(json.dumps(sys.argv))
payload = pathlib.Path(sys.argv[sys.argv.index("--file") + 1]).read_text()
pathlib.Path(${JSON.stringify(inputFile)}).write_text(payload)
print(json.dumps({
  "ok": True,
  "mode": "python-to-workflow-file-data",
  "plist_payload": {
    "encoding": "base64",
    "data": "YnBsaXN0MDA="
  },
  "plist_summary": {
    "WFWorkflowActions_count": 1
  }
}))
`);
  await runBridgeCommand("python-to-bplist", "def shortcut() -> None:\n    pass\n", {
    bridgeCtlPath: path.join(bridgeRoot, "tools", "bridgectl.py"),
    pythonPath: "python3",
    socket: "auto",
    signShortcut: false,
    shortcutSigningMode: "anyone",
    bridgeCommandTimeoutMs: 1000,
  });
  const argv = JSON.parse(await fs.readFile(argsFile, "utf8"));
  assert(argv.includes("--no-sign"), "validation compile should pass --no-sign");
  assert(argv.includes("--sign-mode"), "sign mode remains explicit for CLI compatibility");
  assert.strictEqual(await fs.readFile(inputFile, "utf8"), "def shortcut() -> None:\n    pass\n");
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "shortpy-bridge-test-"));
  try {
    const explicitRoot = path.join(temp, "explicit");
    const explicit = await makeFakeBridge(explicitRoot, true);
    const explicitCtl = bridgeCtlPathForRoot(explicitRoot);
    assert.strictEqual(normalizeOptions({ bridgeCtlPath: explicitCtl }).bridgeCtlPath, explicitCtl);
    const configured = await resolveBridgeRuntime({ bridgeCtlPath: explicitCtl });
    assert.strictEqual(configured.source, "configured");
    assert.strictEqual(normalizeOptions({}).openSimulatorOnConnect, false);
    assert.strictEqual(normalizeOptions({}).quitSimulatorAppOnHeadlessConnect, true);
    assert.strictEqual(normalizeOptions({}).singleSimulatorOnConnect, true);

    const storageRoot = versionedStorageBridgeRoot(path.join(temp, "storage"), "0.1.test");
    await makeFakeBridge(storageRoot, true);
    await markFakeStorageRuntimeCurrent(storageRoot);
    const resolvedStorage = await resolveBridgeRuntime({
      globalStoragePath: path.join(temp, "storage"),
      extensionVersion: "0.1.test",
    });
    assert.strictEqual(resolvedStorage.source, "bundled-storage");
    assert.strictEqual(resolvedStorage.bridgeCtlPath, bridgeCtlPathForRoot(storageRoot));
    const storageAlready = await ensureBridgeLaunched({
      globalStoragePath: path.join(temp, "storage"),
      extensionVersion: "0.1.test",
      pythonPath: "python3",
      bridgeStatusTimeoutMs: 1000,
      bridgeLaunchTimeoutMs: 1000,
    });
    assert.strictEqual(storageAlready.source, "bundled-storage");
    assert.strictEqual(storageAlready.bridgeCtlPath, bridgeCtlPathForRoot(storageRoot));

    const already = await ensureBridgeLaunched({
      bridgeCtlPath: explicitCtl,
      pythonPath: "python3",
      bridgeStatusTimeoutMs: 1000,
      bridgeLaunchTimeoutMs: 1000,
    });
    assert.strictEqual(already.alreadyRunning, true);
    assert.strictEqual(already.status.version, "fake");

    const forced = await ensureBridgeLaunched({
      bridgeCtlPath: explicitCtl,
      pythonPath: "python3",
      toolkitSqlitePath: "/tmp/custom-tools.sqlite",
      forceBridgeLaunch: true,
      bridgeStatusTimeoutMs: 1000,
      bridgeLaunchTimeoutMs: 1000,
    });
    assert.strictEqual(forced.alreadyRunning, false);
    assert.strictEqual(await fs.readFile(explicit.toolkitEnv, "utf8"), "/tmp/custom-tools.sqlite");
    const defaultLaunchEnv = JSON.parse(await fs.readFile(explicit.launchEnv, "utf8"));
    assert.strictEqual(defaultLaunchEnv.SHORTPY_IDE_BOOT_SIMULATOR, "1");
    assert.strictEqual(defaultLaunchEnv.SHORTPY_IDE_OPEN_SIMULATOR, "0");
    assert.strictEqual(defaultLaunchEnv.SHORTPY_IDE_QUIT_SIMULATOR_APP, "1");
    assert.strictEqual(defaultLaunchEnv.SHORTPY_IDE_SINGLE_SIMULATOR, "1");

    const launchRoot = path.join(temp, "launch");
    const launch = await makeFakeBridge(launchRoot, false);
    const progressKinds = [];
    const launched = await ensureBridgeLaunched({
      bridgeCtlPath: bridgeCtlPathForRoot(launchRoot),
      pythonPath: "python3",
      openSimulatorOnConnect: true,
      quitSimulatorAppOnHeadlessConnect: false,
      singleSimulatorOnConnect: false,
      bridgeStatusTimeoutMs: 1000,
      bridgeLaunchTimeoutMs: 1000,
    }, (event) => progressKinds.push(event.kind));
    assert.strictEqual(launched.alreadyRunning, false);
    assert.strictEqual(launched.status.version, "fake");
    assert(progressKinds.includes("booting"), "launch should report booting progress");
    assert(progressKinds.includes("launching"), "launch should report launching progress");
    const overriddenLaunchEnv = JSON.parse(await fs.readFile(launch.launchEnv, "utf8"));
    assert.strictEqual(overriddenLaunchEnv.SHORTPY_IDE_OPEN_SIMULATOR, "1");
    assert.strictEqual(overriddenLaunchEnv.SHORTPY_IDE_QUIT_SIMULATOR_APP, "0");
    assert.strictEqual(overriddenLaunchEnv.SHORTPY_IDE_SINGLE_SIMULATOR, "0");

    await testToolkitDuplicateRewrite(temp);
    await testToolkitActivateReplacesActiveTarget(temp);
    await testValidationBridgeArgs(temp);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  console.log("bridge-ok");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
