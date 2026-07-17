"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { bridgeControlState, bridgeStatusPresentation } = require("../src/connectionState");
const { parameterTabStops, triggerInsertion } = require("../src/editorInsertion");
const {
  recordToolkitActivation,
  sha256File,
  shouldShowLoadToolkit,
  toolkitActivationKey,
} = require("../src/toolkitState");

function testTriggerInsertion() {
  assert.deepStrictEqual(triggerInsertion("def shortcut() -> None:\n    pass\n"), {
    offset: 0,
    prefix: "",
    suffix: "\n",
  });
  const decorated = "@runnable()\n@when_app_opened(app=[])\ndef shortcut() -> None:\n    pass\n";
  assert.deepStrictEqual(triggerInsertion(decorated), {
    offset: decorated.indexOf("def shortcut"),
    prefix: "",
    suffix: "\n",
  });
  assert.deepStrictEqual(triggerInsertion("value = 1"), {
    offset: 9,
    prefix: "\n",
    suffix: "\n",
  });
  assert.deepStrictEqual(triggerInsertion("value = 1\n"), {
    offset: 10,
    prefix: "",
    suffix: "\n",
  });
  assert.deepStrictEqual(triggerInsertion(""), {
    offset: 0,
    prefix: "",
    suffix: "\n",
  });
}

function testRequiredParameterTraversal() {
  assert.deepStrictEqual(parameterTabStops([
    { pythonName: "optional_first", defaultValue: "False" },
    { pythonName: "required" },
    { pythonName: "optional_last", defaultValue: "None" },
  ]), [2, 1, 3]);
}

function testBridgeControlState() {
  assert.deepStrictEqual(bridgeControlState("connected"), {
    kind: "connected",
    connected: true,
    transitioning: false,
    canConnect: false,
    canDisconnect: true,
    label: "Disconnect",
  });
  assert.strictEqual(bridgeControlState("connecting").label, "Connecting...");
  assert.strictEqual(bridgeControlState("connecting").transitioning, true);
  assert.strictEqual(bridgeControlState("disconnecting").label, "Disconnecting...");
  assert.strictEqual(bridgeControlState("error").canConnect, true);
  assert.strictEqual(bridgeControlState("unknown").kind, "disconnected");
  assert.deepStrictEqual(bridgeStatusPresentation("metadata"), {
    icon: "$(sync~spin)",
    label: "refreshing metadata",
  });
  assert.strictEqual(bridgeStatusPresentation("error").error, true);
  assert.strictEqual(bridgeStatusPresentation("unknown").label, "disconnected");
}

async function testToolkitState() {
  const session = {
    simulatorUDID: "DEVICE-A",
    runtimeBuild: "24A123",
    launchedAt: "2026-07-14T00:00:00Z",
    toolkit: {
      activated: true,
      sourcePath: "/tmp/Tools-active",
      sourceSha256: "abc",
    },
  };
  assert.strictEqual(toolkitActivationKey(session), "DEVICE-A:24A123");
  assert.strictEqual(shouldShowLoadToolkit(undefined, {}), true);
  assert.strictEqual(shouldShowLoadToolkit(session, {}), true);
  const first = recordToolkitActivation({}, session);
  assert.strictEqual(first.changed, true);
  assert.strictEqual(shouldShowLoadToolkit(session, first.activations), false);
  assert.strictEqual(shouldShowLoadToolkit(session, first.activations, "abc"), false);
  assert.strictEqual(shouldShowLoadToolkit(session, first.activations, "def"), true);
  assert.strictEqual(recordToolkitActivation(first.activations, session).changed, false);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "shortpy-toolkit-state-"));
  try {
    const file = path.join(temp, "Tools.sqlite");
    await fs.writeFile(file, "shortpy");
    assert.strictEqual(
      await sha256File(file),
      "7c9e57028c5ac8abc0bdbda2e95f06875f0ec5c9d8752b9b9189cbec4c1ef84b"
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  testTriggerInsertion();
  testRequiredParameterTraversal();
  testBridgeControlState();
  await testToolkitState();
  console.log("ui-state-ok");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
