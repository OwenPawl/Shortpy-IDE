"use strict";

const path = require("path");


function workflowByteKind(bytes) {
  const value = Buffer.from(bytes || []);
  if (value.subarray(0, 4).toString("ascii") === "AEA1") {
    return "signed-shortcut";
  }
  if (value.subarray(0, 8).toString("ascii") === "bplist00") {
    return "binary-plist";
  }
  const prefix = value.subarray(0, 64).toString("utf8").trimStart();
  if (prefix.startsWith("<?xml") || prefix.startsWith("<plist")) {
    return "xml-plist";
  }
  return "unknown";
}

function rememberWorkflowBaseline(session, source, bytes, sourcePath) {
  if (!session) {
    return;
  }
  session.workflowBaseline = {
    source: String(source),
    bytes: Buffer.from(bytes),
    sourcePath: sourcePath ? path.resolve(sourcePath) : undefined,
    kind: workflowByteKind(bytes),
  };
}

function exactWorkflowRoundTripBytes(session, source, targetPath) {
  const baseline = session && session.workflowBaseline;
  if (!baseline || String(source) !== baseline.source || !targetPath) {
    return undefined;
  }
  const resolvedTarget = path.resolve(targetPath);
  if (baseline.sourcePath && resolvedTarget === baseline.sourcePath) {
    return Buffer.from(baseline.bytes);
  }
  const extension = path.extname(resolvedTarget).toLowerCase();
  if (baseline.kind === "signed-shortcut" && extension === ".shortcut") {
    return Buffer.from(baseline.bytes);
  }
  if (
    (baseline.kind === "binary-plist" || baseline.kind === "xml-plist")
    && extension === ".plist"
  ) {
    return Buffer.from(baseline.bytes);
  }
  return undefined;
}


module.exports = {
  exactWorkflowRoundTripBytes,
  rememberWorkflowBaseline,
  workflowByteKind,
};
