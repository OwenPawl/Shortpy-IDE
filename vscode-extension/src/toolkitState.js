"use strict";

const crypto = require("crypto");
const fs = require("fs");

function toolkitActivationKey(session) {
  const device = session && session.simulatorUDID;
  const runtime = session && session.runtimeBuild;
  return device && runtime ? `${device}:${runtime}` : "";
}

function activeToolkitSelection(session) {
  const toolkit = session && session.toolkit;
  if (!toolkit || !toolkit.activated || !toolkit.sourceSha256) {
    return undefined;
  }
  return {
    sourcePath: toolkit.sourcePath || "",
    sourceSha256: toolkit.sourceSha256,
    activatedAt: toolkit.activatedAt || session.launchedAt || new Date().toISOString(),
  };
}

function recordToolkitActivation(activations, session) {
  const key = toolkitActivationKey(session);
  const selection = activeToolkitSelection(session);
  if (!key || !selection) {
    return { activations: { ...(activations || {}) }, changed: false, key: "" };
  }
  const current = activations && activations[key];
  const changed = !current || current.sourceSha256 !== selection.sourceSha256;
  return {
    activations: { ...(activations || {}), [key]: selection },
    changed,
    key,
  };
}

function shouldShowLoadToolkit(session, activations, selectedSourceSha256 = "") {
  const key = toolkitActivationKey(session);
  if (!key) {
    return true;
  }
  const active = activations && activations[key];
  if (!active || !active.sourceSha256) {
    return true;
  }
  return Boolean(selectedSourceSha256 && selectedSourceSha256 !== active.sourceSha256);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

module.exports = {
  activeToolkitSelection,
  recordToolkitActivation,
  sha256File,
  shouldShowLoadToolkit,
  toolkitActivationKey,
};
