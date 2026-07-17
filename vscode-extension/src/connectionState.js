"use strict";

const STATUS_PRESENTATIONS = Object.freeze({
  connected: { icon: "$(plug)", label: "connected" },
  connecting: { icon: "$(sync~spin)", label: "connecting" },
  building: { icon: "$(tools)", label: "building bridge" },
  toolkit: { icon: "$(database)", label: "loading toolkit" },
  metadata: { icon: "$(sync~spin)", label: "refreshing metadata" },
  booting: { icon: "$(device-mobile)", label: "booting simulator" },
  launching: { icon: "$(rocket)", label: "launching" },
  validating: { icon: "$(sync~spin)", label: "validating" },
  disconnecting: { icon: "$(sync~spin)", label: "disconnecting" },
  error: { icon: "$(error)", label: "error", error: true },
  disconnected: { icon: "$(debug-disconnect)", label: "disconnected" },
});

function bridgeControlState(kind) {
  const normalized = ["connected", "connecting", "disconnecting", "error"].includes(kind)
    ? kind
    : "disconnected";
  return {
    kind: normalized,
    connected: normalized === "connected",
    transitioning: normalized === "connecting" || normalized === "disconnecting",
    canConnect: normalized === "disconnected" || normalized === "error",
    canDisconnect: normalized === "connected",
    label: normalized === "connected"
      ? "Disconnect"
      : normalized === "disconnecting"
        ? "Disconnecting..."
        : normalized === "connecting"
          ? "Connecting..."
          : "Connect",
  };
}

function bridgeStatusPresentation(kind) {
  return STATUS_PRESENTATIONS[kind] || STATUS_PRESENTATIONS.disconnected;
}

module.exports = {
  bridgeControlState,
  bridgeStatusPresentation,
};
