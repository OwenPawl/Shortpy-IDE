"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  bridgeCtlPathForRoot,
  disconnectBridge,
  ensureBridgeLaunched,
  normalizeOptions,
  resolveBridgeRuntime,
  runBridgeCommand,
  validateImportedPythonSource,
  validateSimulatorSession,
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
  await fs.writeFile(path.join(root, "build-sim", "libShortcutsIDESimBridge-v020.dylib"), "", "utf8");
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
    "com_apple_shortcuts_open_app_intent",
    "com_apple_mobiletimer_open_app_intent",
  ]);
  assert.deepStrictEqual(names.Triggers, [
    "com_apple_shortcuts_when_app_opened",
    "com_apple_focus_when_app_opened",
  ]);
  assert.deepStrictEqual(names.Types, ["App", "App"]);
}

async function testToolkitNativeNameAlignment(temp) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const toolkitCtl = path.join(repoRoot, "bridge", "tools", "toolkitctl.py");
  const source = path.join(temp, "toolkit-native-names-source.sqlite");
  const adjusted = path.join(temp, "toolkit-native-names-adjusted.sqlite");
  const adjustedAgain = path.join(temp, "toolkit-native-names-adjusted-again.sqlite");
  await execFile("python3", ["-c", `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.executescript("""
CREATE TABLE ContainerMetadata (
  rowId INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  bundleVersion TEXT NOT NULL,
  teamId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  origin INTEGER NOT NULL,
  containerType INTEGER NOT NULL,
  UNIQUE (id, bundleVersion, deviceId)
);
CREATE TABLE Tools (
  rowId INTEGER PRIMARY KEY,
  id TEXT,
  pythonName TEXT,
  sourceContainerId INTEGER,
  attributionContainerId INTEGER
);
CREATE TABLE Triggers (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE ToolLocalizations (
  toolId INTEGER,
  locale TEXT,
  localizationUsage TEXT,
  name TEXT
);
CREATE TABLE TriggerLocalizations (triggerId INTEGER, locale TEXT, name TEXT);
INSERT INTO ContainerMetadata VALUES (1, 'com.apple.shortcuts', '1', '', '', -1, 1);
INSERT INTO ContainerMetadata VALUES (2, 'com.apple.Safari', '1', '', '', -1, 1);
INSERT INTO Tools VALUES (1, 'is.workflow.actions.getwifi', 'com_apple_shortcuts_get_network_details', 1, NULL);
INSERT INTO Tools VALUES (2, 'is.workflow.actions.openurl', 'safari_open_urls', 1, 2);
INSERT INTO Tools VALUES (3, 'com.apple.Home.SecureToggleIntent', 'ComAppleHomeSecureToggleIntent', 1, 1);
INSERT INTO Triggers VALUES (1, 'com.apple.shortcuts.WFAirplaneModeTrigger.changes', 'when_airplane_mode_changes');
INSERT INTO ToolLocalizations VALUES (1, 'en', 'display', 'Get Network Details');
INSERT INTO ToolLocalizations VALUES (2, 'en', 'display', 'Open URLs');
INSERT INTO ToolLocalizations VALUES (3, 'en', 'display', 'Toggle Accessory or Scene');
INSERT INTO TriggerLocalizations VALUES (1, 'en', 'Airplane Mode');
""")
conn.commit()
conn.close()
`, source]);

  const raw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", source, "--out", adjusted]);
  const payload = JSON.parse(raw);
  const alignment = payload.toolrenderer_name_alignment;
  assert(alignment.changed_count > 0);
  assert.strictEqual(alignment.container.created, true);

  const rowsRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps({
  "tools": list(conn.execute("SELECT id, pythonName, sourceContainerId, attributionContainerId FROM Tools ORDER BY rowId")),
  "toolNames": list(conn.execute("SELECT toolId, name FROM ToolLocalizations ORDER BY toolId")),
  "containers": list(conn.execute("SELECT rowId, id, bundleVersion FROM ContainerMetadata ORDER BY rowId")),
  "triggers": list(conn.execute("SELECT t.pythonName, l.name FROM Triggers t JOIN TriggerLocalizations l ON l.triggerId=t.rowId")),
}))
conn.close()
`, adjusted]);
  const rows = JSON.parse(rowsRaw);
  const neutralId = alignment.container.containerId;
  assert.deepStrictEqual(rows.tools, [
    ["is.workflow.actions.getwifi", "com_apple_shortcuts_get_network_details", neutralId, null],
    ["is.workflow.actions.openurl", "safari_open_urls", neutralId, neutralId],
    ["com.apple.Home.SecureToggleIntent", "com_apple_home_secure_toggle_intent", neutralId, neutralId],
  ]);
  assert.deepStrictEqual(rows.toolNames, [
    [1, "com_apple_shortcuts_get_network_details"],
    [2, "safari_open_urls"],
    [3, "com_apple_home_secure_toggle_intent"],
  ]);
  assert.deepStrictEqual(rows.containers.slice(0, 2), [
    [1, "com.apple.shortcuts", "1"],
    [2, "com.apple.Safari", "1"],
  ]);
  assert.deepStrictEqual(rows.triggers, [["when_airplane_mode_changes", "Airplane Mode"]]);

  const sourceRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT id, bundleVersion FROM ContainerMetadata ORDER BY rowId"))))
`, source]);
  assert.deepStrictEqual(JSON.parse(sourceRaw), [
    ["com.apple.shortcuts", "1"],
    ["com.apple.Safari", "1"],
  ]);

  const secondRaw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", adjusted, "--out", adjustedAgain]);
  assert.strictEqual(JSON.parse(secondRaw).toolrenderer_name_alignment.changed_count, 0);
}

async function testToolkitIntrinsicNamesRemainNative(temp) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const toolkitCtl = path.join(repoRoot, "bridge", "tools", "toolkitctl.py");
  const source = path.join(temp, "toolkit-intrinsic-source.sqlite");
  const adjusted = path.join(temp, "toolkit-intrinsic-adjusted.sqlite");
  await execFile("python3", ["-c", `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.executescript("""
CREATE TABLE Tools (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE Triggers (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
INSERT INTO Tools VALUES (1, 'is.workflow.actions.dictionary', 'com_apple_shortcuts_dictionary');
INSERT INTO Tools VALUES (2, 'is.workflow.actions.gettext', 'com_apple_shortcuts_text');
INSERT INTO Tools VALUES (3, 'is.workflow.actions.getvalueforkey', 'com_apple_shortcuts_get_dictionary_value');
INSERT INTO Tools VALUES (4, 'is.workflow.actions.list', 'com_apple_shortcuts_list');
INSERT INTO Tools VALUES (5, 'is.workflow.actions.nothing', 'com_apple_shortcuts_nothing');
INSERT INTO Tools VALUES (6, 'third.party.dictionary', 'dictionary');
""")
conn.commit()
conn.close()
`, source]);

  const raw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", source, "--out", adjusted]);
  const payload = JSON.parse(raw);
  assert.strictEqual(payload.shortcuts_language_intrinsic_name_repair, undefined);

  const rowsRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT id, pythonName FROM Tools ORDER BY rowId"))))
`, adjusted]);
  assert.deepStrictEqual(JSON.parse(rowsRaw), [
    ["is.workflow.actions.dictionary", "com_apple_shortcuts_dictionary"],
    ["is.workflow.actions.gettext", "com_apple_shortcuts_text"],
    ["is.workflow.actions.getvalueforkey", "com_apple_shortcuts_get_dictionary_value"],
    ["is.workflow.actions.list", "com_apple_shortcuts_list"],
    ["is.workflow.actions.nothing", "com_apple_shortcuts_nothing"],
    ["third.party.dictionary", "dictionary"],
  ]);

  const sourceRowsRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT id, pythonName FROM Tools ORDER BY rowId"))))
`, source]);
  assert.strictEqual(JSON.parse(sourceRowsRaw)[0][1], "com_apple_shortcuts_dictionary");
}

async function testToolkitReferentialClosureRepair(temp) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const toolkitCtl = path.join(repoRoot, "bridge", "tools", "toolkitctl.py");
  const source = path.join(temp, "toolkit-closure-source.sqlite");
  const adjusted = path.join(temp, "toolkit-closure-adjusted.sqlite");
  const adjustedAgain = path.join(temp, "toolkit-closure-adjusted-again.sqlite");
  await execFile("python3", ["-c", `
import sqlite3, sys

def varint(value):
    encoded = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        if value:
            encoded.append(byte | 0x80)
        else:
            encoded.append(byte)
            return bytes(encoded)

def length_delimited(field, payload):
    return varint((field << 3) | 2) + varint(len(payload)) + payload

def relationship(parent_key, value, comparison_field=3):
    typed_value = length_delimited(6, value.encode())
    operands = length_delimited(1, typed_value)
    comparison = length_delimited(1, operands)
    condition = length_delimited(comparison_field, comparison)
    entry = length_delimited(1, parent_key.encode()) + length_delimited(2, condition)
    return length_delimited(1, entry)

def scalar_type_instance(value):
    return length_delimited(3, length_delimited(2, length_delimited(2, length_delimited(2, value.encode()))))

def collection_type_instance(value):
    return length_delimited(3, length_delimited(2, length_delimited(4, length_delimited(2, length_delimited(2, length_delimited(2, value.encode()))))))

conn = sqlite3.connect(sys.argv[1])
conn.executescript("""
CREATE TABLE Tools (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE Triggers (rowId INTEGER PRIMARY KEY, id TEXT, pythonName TEXT);
CREATE TABLE Types (rowId TEXT PRIMARY KEY, id BLOB, kind INTEGER, pythonName TEXT);
CREATE TABLE Parameters (toolId INTEGER, key TEXT, relationships BLOB, typeInstance BLOB);
CREATE TABLE ToolParameterTypes (toolId INTEGER, key TEXT, typeId TEXT);
CREATE TABLE TriggerParameters (triggerId INTEGER, key TEXT, relationships BLOB, typeInstance BLOB, typeId TEXT);
CREATE TABLE EnumerationCases (
    typeId TEXT NOT NULL,
    locale TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT,
    synonyms BLOB NOT NULL,
    PRIMARY KEY (typeId, id, locale)
);
INSERT INTO Tools VALUES (1, 'test.action', 'test_action');
INSERT INTO Triggers VALUES (2, 'test.trigger', 'test_trigger');
INSERT INTO Types VALUES ('action.mode', X'', 4, 'action_mode');
INSERT INTO Types VALUES ('action.detail', X'', 2, 'action_detail');
INSERT INTO Types VALUES ('trigger.mode', X'', 4, 'trigger_mode');
INSERT INTO Types VALUES ('trigger.detail', X'', 2, 'trigger_detail');
INSERT INTO Parameters VALUES (1, 'Mode', X'', X'');
INSERT INTO Parameters VALUES (1, 'Detail', X'', X'');
INSERT INTO Parameters VALUES (1, 'NotDetail', X'', X'');
INSERT INTO Parameters VALUES (1, 'Broken', X'0A', X'');
INSERT INTO Parameters VALUES (1, 'DefaultMode', X'', X'');
INSERT INTO Parameters VALUES (1, 'ListMode', X'', X'');
INSERT INTO ToolParameterTypes VALUES (1, 'Mode', 'action.mode');
INSERT INTO ToolParameterTypes VALUES (1, 'Detail', 'action.detail');
INSERT INTO ToolParameterTypes VALUES (1, 'NotDetail', 'action.detail');
INSERT INTO ToolParameterTypes VALUES (1, 'DefaultMode', 'action.mode');
INSERT INTO ToolParameterTypes VALUES (1, 'ListMode', 'action.mode');
INSERT INTO TriggerParameters VALUES (2, 'Surface', X'', X'', 'trigger.mode');
INSERT INTO TriggerParameters VALUES (2, 'WatchDetail', X'', X'', 'trigger.detail');
INSERT INTO EnumerationCases VALUES ('action.mode', 'en', 'Wi-Fi', 'Wi-Fi', X'');
INSERT INTO EnumerationCases VALUES ('action.mode', 'fr', 'Wi-Fi', 'Wi-Fi', X'');
""")
conn.execute("UPDATE Parameters SET relationships=? WHERE toolId=1 AND key='Detail'", (relationship('Mode', 'Cellular'),))
conn.execute("UPDATE Parameters SET relationships=? WHERE toolId=1 AND key='NotDetail'", (relationship('Mode', 'Ethernet', 4),))
conn.execute("UPDATE Parameters SET typeInstance=? WHERE toolId=1 AND key='DefaultMode'", (scalar_type_instance('Default'),))
conn.execute("UPDATE Parameters SET typeInstance=? WHERE toolId=1 AND key='ListMode'", (collection_type_instance('ListOnly'),))
conn.execute("UPDATE TriggerParameters SET relationships=? WHERE triggerId=2 AND key='WatchDetail'", (relationship('Surface', 'Watch'),))
conn.commit()
conn.close()
`, source]);

  const raw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", source, "--out", adjusted]);
  const payload = JSON.parse(raw);
  const repair = payload.referential_closure_repair;
  assert.strictEqual(repair.relationship_parameter_count, 4);
  assert.strictEqual(repair.reference_count, 3);
  assert.strictEqual(repair.resolved_reference_count, 3);
  assert.strictEqual(repair.decode_error_count, 1);
  assert.strictEqual(repair.type_instance_parameter_count, 2);
  assert.strictEqual(repair.type_instance_reference_count, 2);
  assert.strictEqual(repair.type_instance_decode_error_count, 0);
  assert.strictEqual(repair.candidate_case_count, 5);
  assert.strictEqual(repair.case_count, 5);
  assert.strictEqual(repair.inserted_row_count, 10);
  assert.strictEqual(repair.pass_count, 2);

  const rowsRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT typeId, locale, id FROM EnumerationCases ORDER BY typeId, locale, id"))))
`, adjusted]);
  assert.deepStrictEqual(JSON.parse(rowsRaw), [
    ["action.mode", "en", "Cellular"],
    ["action.mode", "en", "Default"],
    ["action.mode", "en", "Ethernet"],
    ["action.mode", "en", "ListOnly"],
    ["action.mode", "en", "Wi-Fi"],
    ["action.mode", "fr", "Cellular"],
    ["action.mode", "fr", "Default"],
    ["action.mode", "fr", "Ethernet"],
    ["action.mode", "fr", "ListOnly"],
    ["action.mode", "fr", "Wi-Fi"],
    ["trigger.mode", "en", "Watch"],
    ["trigger.mode", "fr", "Watch"],
  ]);

  const sourceRowsRaw = await execFile("python3", ["-c", `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
print(json.dumps(list(conn.execute("SELECT typeId, locale, id FROM EnumerationCases ORDER BY typeId, locale, id"))))
`, source]);
  assert.deepStrictEqual(JSON.parse(sourceRowsRaw), [
    ["action.mode", "en", "Wi-Fi"],
    ["action.mode", "fr", "Wi-Fi"],
  ]);

  const secondRaw = await execFile("python3", [toolkitCtl, "prepare", "--sqlite", adjusted, "--out", adjustedAgain]);
  const secondRepair = JSON.parse(secondRaw).referential_closure_repair;
  assert.strictEqual(secondRepair.case_count, 0);
  assert.strictEqual(secondRepair.inserted_row_count, 0);
  assert.strictEqual(secondRepair.pass_count, 1);
}

async function testImportedSourceValidationGate() {
  const source = "def shortcut() -> None:\n    pass\n";
  let invocation;
  const result = await validateImportedPythonSource(
    { python_code: source, raw_python_code: "invalid_native_alias()\n" },
    { socket: "test", signShortcut: true },
    async (command, input, options) => {
      invocation = { command, input, options };
      return { ok: true, plist_summary: { WFWorkflowActions_count: 0 } };
    }
  );
  assert.strictEqual(result.source, source);
  assert.strictEqual(result.validation.ok, true);
  assert.deepStrictEqual(invocation, {
    command: "python-to-bplist",
    input: source,
    options: { socket: "test", signShortcut: false },
  });
  await assert.rejects(
    validateImportedPythonSource({ raw_python_code: source }, {}, async () => ({ ok: true })),
    /did not produce canonical ShortPy source/
  );
  const rejection = new Error("native compiler rejected import");
  await assert.rejects(
    validateImportedPythonSource({ python_code: source }, {}, async () => { throw rejection; }),
    (error) => error === rejection
  );
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
    ["com.apple.shortcuts.OpenAppIntent", "com_apple_shortcuts_open_app_intent", 5],
    ["com.apple.mobiletimer.OpenAppIntent", "com_apple_mobiletimer_open_app_intent", 7],
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

async function testVisibleToolRendererParameterClosure() {
  const bridgeCtl = path.resolve(__dirname, "..", "..", "bridge", "tools", "bridgectl.py");
  const raw = await execFile("python3", ["-c", `
import json, runpy, sys
module = runpy.run_path(sys.argv[1])
visible = module["visible_toolrenderer_item"]
merge_aliases = module["merge_toolkit_parameter_aliases"]
payload = {
    "network": visible({
        "kind": "action",
        "pythonName": "com_apple_shortcuts_get_network_details",
        "parameters": [
            {"pythonName": "detail", "key": "WFWiFiDetail"},
            {"pythonName": "detail", "key": "WFCellularDetail"},
        ],
    }),
    "filter": visible({
        "kind": "action",
        "pythonName": "com_apple_shortcuts_filter_files",
        "parameters": [
            {"pythonName": "wfcontentitemfilter", "key": "WFContentItemFilter"},
            {"pythonName": "sort_by", "key": "WFContentItemSortProperty"},
            {"pythonName": "order", "key": "WFContentItemSortOrder"},
            {"pythonName": "limit", "key": "WFContentItemLimitEnabled"},
            {"pythonName": "get", "key": "WFContentItemLimitNumber"},
            {"pythonName": "wfcompoundtype", "key": "WFCompoundType"},
            {"pythonName": "files", "key": "WFContentItemInputParameter"},
        ],
    }),
    "mergedFilter": visible(merge_aliases(
        {"kind": "action", "pythonName": "com_apple_shortcuts_filter_files", "parameters": [
            {"pythonName": "query", "type": "List[query_file]"},
            {"pythonName": "query_operator", "type": "QUERY_OPERATOR"},
            {"pythonName": "sort_by", "type": "Optional[filter_files_wfcontent_item_sort_property]"},
            {"pythonName": "query_sort_order", "type": "QUERY_SORT_ORDER"},
            {"pythonName": "limit", "type": "Optional[int]"},
            {"pythonName": "scope", "type": "Optional[com_apple_shortcuts_wfcontent_item]"},
        ]},
        {"parameters": [
            {"pythonName": "wfcontentitemfilter", "key": "WFContentItemFilter"},
            {"pythonName": "sort_by", "key": "WFContentItemSortProperty"},
            {"pythonName": "order", "key": "WFContentItemSortOrder"},
            {"pythonName": "limit", "key": "WFContentItemLimitEnabled"},
            {"pythonName": "get", "key": "WFContentItemLimitNumber"},
            {"pythonName": "wfcompoundtype", "key": "WFCompoundType"},
            {"pythonName": "files", "key": "WFContentItemInputParameter"},
        ]},
    )),
    "matched": merge_aliases(
        {"parameters": [
            {"pythonName": "operand"},
            {"pythonName": "operand"},
        ]},
        {"parameters": [
            {"pythonName": "operand", "key": "WFMathOperand"},
            {"pythonName": "operand", "key": "WFScientificMathOperand"},
        ]},
    ),
}
print(json.dumps(payload))
`, bridgeCtl]);
  const payload = JSON.parse(raw);
  assert.deepStrictEqual(payload.network.parameters.map((parameter) => parameter.acceptedNames), [
    ["detail", "wi_fi_detail"],
    ["detail", "cellular_detail"],
  ]);
  assert.strictEqual(payload.filter.filterActionSurface, undefined);
  assert.deepStrictEqual(payload.filter.parameters.map((parameter) => parameter.pythonName), [
    "wfcontentitemfilter",
    "sort_by",
    "order",
    "limit",
    "get",
    "wfcompoundtype",
    "files",
  ]);
  assert.deepStrictEqual(payload.mergedFilter.parameters.map((parameter) => parameter.pythonName), [
    "query",
    "query_operator",
    "sort_by",
    "query_sort_order",
    "limit",
    "scope",
  ]);
  assert(payload.mergedFilter.parameters.at(-1).acceptedNames.includes("files"));
  assert(!JSON.stringify(payload).includes("WFContentItem"), "visible metadata must not expose raw ToolKit parameter keys");
  assert.deepStrictEqual(payload.matched.parameters.map((parameter) => parameter.acceptedNames), [
    ["operand", "math_operand"],
    ["operand", "scientific_math_operand"],
  ]);
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

async function testExactSimulatorDisconnect(bridgeCtlPath) {
  const session = {
    simulatorUDID: "SHORTPY-DEVICE",
    runtimeBuild: "24A123",
    bridgePID: 4242,
    socketPath: "/tmp/shortpy-test.sock",
  };
  const status = { ok: true, pid: 4242, socket_path: "/tmp/shortpy-test.sock" };
  const states = new Map([
    ["SHORTPY-DEVICE", "Booted"],
    ["UNRELATED-DEVICE", "Booted"],
  ]);
  const shutdowns = [];
  let cleanupCount = 0;
  const execAdapter = async (_command, args) => {
    if (args[0] === "simctl" && args[1] === "list") {
      return JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-27-0": Array.from(states, ([udid, state]) => ({ udid, state })),
        },
      });
    }
    if (args[0] === "simctl" && args[1] === "shutdown") {
      shutdowns.push(args[2]);
      states.set(args[2], "Shutdown");
      return "";
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const adapters = {
    readSession: async () => session,
    runStatus: async () => status,
    execFile: execAdapter,
    cleanup: async () => { cleanupCount += 1; },
    pollMs: 1,
    timeoutMs: 100,
  };
  const result = await disconnectBridge({ bridgeCtlPath }, adapters);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(shutdowns, ["SHORTPY-DEVICE"]);
  assert.strictEqual(states.get("UNRELATED-DEVICE"), "Booted");
  assert.strictEqual(cleanupCount, 1);

  shutdowns.length = 0;
  states.set("SHORTPY-DEVICE", "Booted");
  await assert.rejects(
    disconnectBridge({ bridgeCtlPath }, {
      ...adapters,
      runStatus: async () => ({ ...status, pid: 9999 }),
    }),
    /does not match bridge PID/
  );
  assert.deepStrictEqual(shutdowns, []);

  states.set("SHORTPY-DEVICE", "Shutdown");
  const alreadyStopped = await disconnectBridge({ bridgeCtlPath }, {
    ...adapters,
    runStatus: async () => { throw new Error("offline"); },
  });
  assert.strictEqual(alreadyStopped.alreadyStopped, true);

  states.set("SHORTPY-DEVICE", "Booted");
  await assert.rejects(
    disconnectBridge({ bridgeCtlPath }, {
      ...adapters,
      runStatus: async () => { throw new Error("offline"); },
    }),
    /is booted but the bridge no longer responds/
  );
  assert.deepStrictEqual(shutdowns, []);

  assert.throws(
    () => validateSimulatorSession(undefined, status),
    /session marker is missing or incomplete/
  );
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

    await testExactSimulatorDisconnect(explicitCtl);

    await testToolkitDuplicateRewrite(temp);
    await testToolkitNativeNameAlignment(temp);
    await testToolkitIntrinsicNamesRemainNative(temp);
    await testToolkitReferentialClosureRepair(temp);
    await testImportedSourceValidationGate();
    await testToolkitActivateReplacesActiveTarget(temp);
    await testVisibleToolRendererParameterClosure();
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
