"use strict";

const assert = require("assert");
const cp = require("child_process");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  determineSyncAction,
  ensureHeadlessRuntime,
  exportHostShortcut,
  hashSource,
  mergeWorkflowPlists,
  parseResponse,
  syncHostShortcut,
  versionedStorageRoot,
} = require("../src/hostShortcuts");

async function main() {
  assert.deepStrictEqual(parseResponse('{"ok":true,"workflowID":"A"}', "create"), {
    ok: true,
    workflowID: "A",
  });
  assert.throws(
    () => parseResponse('{"ok":false,"error":{"code":"not_found","message":"missing"}}', "edit"),
    (error) => error.code === "not_found" && error.message === "missing"
  );
  assert.strictEqual(
    versionedStorageRoot("/tmp/storage", "0.1.0 beta"),
    path.join("/tmp/storage", "headless-shortcuts-runtimes", "0.1.0_beta")
  );
  const baseline = { sourceHash: hashSource("source"), hostHash: "host" };
  assert.strictEqual(determineSyncAction(undefined, "source", "host"), "initialize");
  assert.strictEqual(determineSyncAction(baseline, hashSource("source"), "host"), "none");
  assert.strictEqual(determineSyncAction(baseline, hashSource("changed"), "host"), "push");
  assert.strictEqual(determineSyncAction(baseline, hashSource("source"), "changed"), "pull");
  assert.strictEqual(determineSyncAction(baseline, hashSource("changed"), "changed"), "conflict");

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "shortpy-host-test-"));
  const binary = path.join(directory, "headless-shortcuts");
  await fsp.writeFile(binary, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const command = args[0];
if (command === "create") {
  const plistIndex = args.indexOf("--plist");
  if (plistIndex < 0 || fs.readFileSync(args[plistIndex + 1], "utf8") !== "plist fixture") process.exit(70);
  const name = args[args.indexOf("--name") + 1];
  process.stdout.write(JSON.stringify({ok:true,operation:"create",workflowID:"11111111-1111-1111-1111-111111111111",name}) + "\\n");
} else if (command === "edit") {
  const plistIndex = args.indexOf("--plist");
  if (plistIndex < 0 || fs.readFileSync(args[plistIndex + 1], "utf8") !== "plist fixture") process.exit(70);
  const id = args[args.indexOf("--id") + 1];
  process.stdout.write(JSON.stringify({ok:true,operation:"edit",workflowID:id,name:"Existing"}) + "\\n");
} else if (command === "export") {
  const id = args[args.indexOf("--id") + 1];
  const output = args[args.indexOf("--output") + 1];
  const plist = '<?xml version="1.0" encoding="UTF-8"?>\\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n<plist version="1.0"><dict><key>WFWorkflowActions</key><array/></dict></plist>\\n';
  fs.writeFileSync(output, plist);
  process.stdout.write(JSON.stringify({ok:true,operation:"export",workflowID:id,name:"Existing",bytes:Buffer.byteLength(plist),output}) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ok:false,error:{code:"invalid_arguments",message:"bad command"}}) + "\\n");
  process.exit(64);
}
`);
  await fsp.chmod(binary, 0o755);

  try {
    const runtime = await ensureHeadlessRuntime({ headlessShortcutsPath: binary });
    assert.strictEqual(runtime.binary, binary);
    assert.strictEqual(runtime.source, "configured");

    const created = await syncHostShortcut({
      plist: Buffer.from("plist fixture"),
      name: "Created From Test",
    }, { headlessShortcutsPath: binary });
    assert.strictEqual(created.operation, "create");
    assert.strictEqual(created.name, "Created From Test");

    const edited = await syncHostShortcut({
      plist: Buffer.from("plist fixture"),
      workflowID: created.workflowID,
    }, { headlessShortcutsPath: binary });
    assert.strictEqual(edited.operation, "edit");
    assert.strictEqual(edited.workflowID, created.workflowID);

    const exported = await exportHostShortcut(created.workflowID, {
      headlessShortcutsPath: binary,
    });
    assert.strictEqual(exported.operation, "export");
    assert.strictEqual(exported.workflowID, created.workflowID);
    assert.ok(exported.plist.toString("utf8").includes("WFWorkflowActions"));
    assert.match(exported.hostHash, /^[a-f0-9]{64}$/);

    const plist = (color, action, metadata) => Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0"><dict>` +
      `<key>WFWorkflowIcon</key><dict><key>Color</key><integer>${color}</integer></dict>` +
      `<key>WFWorkflowActions</key><array><string>${action}</string></array>` +
      `<key>Metadata</key><string>${metadata}</string>` +
      `</dict></plist>\n`
    );
    const merged = await mergeWorkflowPlists({
      base: plist(1, "old", "base"),
      local: plist(2, "new", "base"),
      host: plist(9, "old", "host"),
      preserveRootKeys: ["WFWorkflowIcon"],
    });
    const mergedPath = path.join(directory, "merged.plist");
    await fsp.writeFile(mergedPath, merged);
    const mergedJSON = JSON.parse(cp.execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", mergedPath],
      { encoding: "utf8" }
    ));
    assert.strictEqual(mergedJSON.WFWorkflowIcon.Color, 9);
    assert.deepStrictEqual(mergedJSON.WFWorkflowActions, ["new"]);
    assert.strictEqual(mergedJSON.Metadata, "host");

    const triggerPlist = (uuid, state, selectedApp) => Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0"><dict><key>WFWorkflowTriggers</key><array><dict>` +
      `<key>WFTriggerIdentifier</key><string>WFAppInFocusTrigger</string>` +
      `<key>WFTriggerUUID</key><string>${uuid}</string>` +
      `<key>WFTriggerSerializedParameters</key><dict>` +
      `<key>WFAppState</key><string>${state}</string>` +
      `<key>WFSelectedApps</key>${selectedApp ? `<string>${selectedApp}</string>` : `<array/>`}` +
      `</dict></dict></array></dict></plist>\n`
    );
    const mergedTrigger = await mergeWorkflowPlists({
      base: triggerPlist("BASE", "opened", ""),
      local: triggerPlist("LOCAL", "closed", ""),
      host: triggerPlist("HOST", "opened", "com.apple.shortcuts"),
      preserveKeys: ["WFTriggerUUID"],
    });
    const mergedTriggerPath = path.join(directory, "merged-trigger.plist");
    await fsp.writeFile(mergedTriggerPath, mergedTrigger);
    const mergedTriggerJSON = JSON.parse(cp.execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", mergedTriggerPath],
      { encoding: "utf8" }
    ));
    const trigger = mergedTriggerJSON.WFWorkflowTriggers[0];
    assert.strictEqual(trigger.WFTriggerUUID, "HOST");
    assert.strictEqual(trigger.WFTriggerSerializedParameters.WFAppState, "closed");
    assert.strictEqual(trigger.WFTriggerSerializedParameters.WFSelectedApps, "com.apple.shortcuts");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }

  process.stdout.write("hostShortcuts tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
