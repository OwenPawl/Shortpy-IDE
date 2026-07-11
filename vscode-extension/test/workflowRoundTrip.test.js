"use strict";

const assert = require("assert");
const {
  exactWorkflowRoundTripBytes,
  rememberWorkflowBaseline,
  workflowByteKind,
} = require("../src/workflowRoundTrip");


const session = {};
const source = "def shortcut() -> None:\n    pass\n";
const signed = Buffer.concat([Buffer.from("AEA1"), Buffer.from([0, 1, 2, 3])]);
rememberWorkflowBaseline(session, source, signed, "/tmp/Input.shortcut");

assert.strictEqual(workflowByteKind(signed), "signed-shortcut");
assert.deepStrictEqual(
  exactWorkflowRoundTripBytes(session, source, "/tmp/Input.shortcut"),
  signed
);
assert.deepStrictEqual(
  exactWorkflowRoundTripBytes(session, source, "/tmp/Copy.shortcut"),
  signed
);
assert.strictEqual(
  exactWorkflowRoundTripBytes(session, `${source}\n`, "/tmp/Input.shortcut"),
  undefined
);
assert.strictEqual(
  exactWorkflowRoundTripBytes(session, source, "/tmp/Input.plist"),
  undefined
);

signed[4] = 99;
assert.notStrictEqual(session.workflowBaseline.bytes[4], 99);

const plist = Buffer.concat([Buffer.from("bplist00"), Buffer.from([4, 5, 6])]);
rememberWorkflowBaseline(session, source, plist, "/tmp/Input.plist");
assert.strictEqual(workflowByteKind(plist), "binary-plist");
assert.deepStrictEqual(
  exactWorkflowRoundTripBytes(session, source, "/tmp/Copy.plist"),
  plist
);
assert.strictEqual(
  exactWorkflowRoundTripBytes(session, source, "/tmp/Copy.shortcut"),
  undefined
);

console.log("workflow-roundtrip-ok");
