"use strict";

const assert = require("assert");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  ensureHeadlessRuntime,
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

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "shortpy-host-test-"));
  const binary = path.join(directory, "headless-shortcuts");
  await fsp.writeFile(binary, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const command = args[0];
const plistIndex = args.indexOf("--plist");
if (plistIndex < 0 || fs.readFileSync(args[plistIndex + 1], "utf8") !== "plist fixture") process.exit(70);
if (command === "create") {
  const name = args[args.indexOf("--name") + 1];
  process.stdout.write(JSON.stringify({ok:true,operation:"create",workflowID:"11111111-1111-1111-1111-111111111111",name}) + "\\n");
} else if (command === "edit") {
  const id = args[args.indexOf("--id") + 1];
  process.stdout.write(JSON.stringify({ok:true,operation:"edit",workflowID:id,name:"Existing"}) + "\\n");
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
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }

  process.stdout.write("hostShortcuts tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
