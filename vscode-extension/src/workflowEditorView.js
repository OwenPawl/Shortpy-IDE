"use strict";

const { customEditorActionTiers } = require("./commandRegistry");

const TIER_LABELS = Object.freeze({
  session: "Bridge and editor navigation",
  authoring: "Shortcut authoring",
  sync: "Host sync and setup",
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderButton(action) {
  const classes = [action.primary && "primary", action.bridgeToggle && "bridgeToggle"]
    .filter(Boolean)
    .join(" ");
  const attributes = [
    classes && `class="${classes}"`,
    action.message === "toggleLiveSync" && 'aria-pressed="false"',
    action.conditional && `data-conditional="${escapeHtml(action.conditional)}" hidden`,
  ].filter(Boolean).join(" ");
  const prefix = attributes ? ` ${attributes}` : "";
  if (action.bridgeToggle) {
    return `<button${prefix} data-command="toggleBridge" data-state="disconnected" aria-label="Connect to Shortcuts bridge" title="Connect to Shortcuts bridge"><span class="bridgeDot" aria-hidden="true"></span><span class="bridgeLabel">Connect</span></button>`;
  }
  return `<button${prefix} data-command="${escapeHtml(action.message)}">${escapeHtml(action.label)}</button>`;
}

function renderTier(tier, fileName) {
  const buttons = tier.actions.filter((action) => !action.overflow).map(renderButton).join("\n      ");
  const overflow = tier.actions.filter((action) => action.overflow);
  const overflowHtml = overflow.length === 0 ? "" : `
      <details class="overflowMenu">
        <summary aria-label="More workflow commands" title="More workflow commands">&#x2026;</summary>
        <div class="overflowItems">
          ${overflow.map(renderButton).join("\n          ")}
        </div>
      </details>`;
  const status = tier.id === "session"
    ? `\n      <div class="status" id="status">${escapeHtml(fileName)}</div>`
    : "";
  return `<div class="toolbarRow" data-tier="${escapeHtml(tier.id)}" role="toolbar" aria-label="${escapeHtml(TIER_LABELS[tier.id] || tier.id)}">
      ${buttons}${overflowHtml}${status}
    </div>`;
}

function workflowEditorToolbarHtml(fileName) {
  return customEditorActionTiers().map((tier) => renderTier(tier, fileName)).join("\n    ");
}

function workflowEditorHtml(fileName, nonce) {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(String(nonce || ""))) {
    throw new Error("A CSP-safe webview nonce is required.");
  }
  const safeNonce = escapeHtml(nonce);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}';">
  <style nonce="${safeNonce}">
    body {
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      margin: 0;
    }
    .toolbar {
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .toolbarRow {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 28px;
      padding: 7px 8px;
    }
    .toolbarRow + .toolbarRow {
      background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
      border-top: 1px solid var(--vscode-sideBar-border);
    }
    button {
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      font: inherit;
      min-height: 28px;
      padding: 4px 8px;
      white-space: nowrap;
    }
    button.primary,
    button[aria-pressed="true"] {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      cursor: default;
      opacity: 0.72;
    }
    button:focus-visible,
    .overflowMenu > summary:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .bridgeToggle {
      align-items: center;
      display: inline-flex;
      gap: 6px;
    }
    .bridgeDot {
      background: var(--vscode-testing-iconFailed, #f14c4c);
      border-radius: 50%;
      display: inline-block;
      height: 8px;
      width: 8px;
    }
    .bridgeToggle[data-state="connected"] .bridgeDot {
      background: var(--vscode-testing-iconPassed, #73c991);
    }
    .bridgeToggle[data-state="connecting"] .bridgeDot,
    .bridgeToggle[data-state="disconnecting"] .bridgeDot {
      background: var(--vscode-editorWarning-foreground, #cca700);
    }
    .overflowMenu {
      position: relative;
    }
    .overflowMenu > summary {
      align-items: center;
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      display: flex;
      font-size: 18px;
      height: 26px;
      justify-content: center;
      list-style: none;
      width: 28px;
    }
    .overflowMenu > summary::-webkit-details-marker {
      display: none;
    }
    .overflowItems {
      background: var(--vscode-menu-background);
      border: 1px solid var(--vscode-menu-border, var(--vscode-sideBar-border));
      box-shadow: 0 4px 12px var(--vscode-widget-shadow);
      min-width: 220px;
      padding: 4px;
      position: absolute;
      right: 0;
      top: 32px;
      z-index: 5;
    }
    .overflowItems button {
      background: transparent;
      border: 0;
      color: var(--vscode-menu-foreground);
      text-align: left;
      width: 100%;
    }
    .overflowItems button:hover {
      background: var(--vscode-menu-selectionBackground);
      color: var(--vscode-menu-selectionForeground);
    }
    .status {
      color: var(--vscode-descriptionForeground);
      flex: 1 1 160px;
      margin-left: auto;
      min-width: 0;
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      overflow: auto;
      padding: 8px;
    }
    .runtimeDetails {
      border-top: 1px solid var(--vscode-sideBar-border);
      max-width: 980px;
    }
    .runtimeDetails summary {
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 12px;
      padding: 8px 0;
    }
    .runtimeSummary {
      margin-left: 8px;
    }
    .runtimeDetails pre {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-sideBar-border);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.35;
      margin: 0;
      max-height: 42vh;
      overflow: auto;
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    ${workflowEditorToolbarHtml(fileName)}
  </div>
  <div class="body">
    <details class="runtimeDetails" id="runtimeDetails">
      <summary><strong>Runtime Details</strong><span class="runtimeSummary" id="runtimeSummary">No runtime operation yet.</span></summary>
      <pre id="runtimeResponse">No runtime operation yet.</pre>
    </details>
  </div>
  <script nonce="${safeNonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById("status");
    const runtimeDetails = document.getElementById("runtimeDetails");
    const runtimeSummary = document.getElementById("runtimeSummary");
    const runtimeResponse = document.getElementById("runtimeResponse");
    const liveSyncButton = document.querySelector('button[data-command="toggleLiveSync"]');
    const bridgeButton = document.querySelector('button[data-command="toggleBridge"]');
    const bridgeLabel = bridgeButton && bridgeButton.querySelector(".bridgeLabel");
    const loadToolkitButton = document.querySelector('button[data-command="loadToolkit"]');
    const overflowMenu = document.querySelector(".overflowMenu");

    function renderRuntimeResponse(payload) {
      if (!payload) {
        runtimeSummary.textContent = "No runtime operation yet.";
        runtimeResponse.textContent = "No runtime operation yet.";
        return;
      }
      runtimeResponse.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      runtimeSummary.textContent = typeof payload === "string"
        ? payload.split(/\\r?\\n/, 1)[0]
        : payload.message || payload.operation || (payload.ok === false ? "Operation failed" : "Operation complete");
      if (typeof payload === "object" && payload.ok === false) {
        runtimeDetails.open = true;
      }
    }

    function renderBridgeState(message) {
      if (!bridgeButton || !bridgeLabel) return;
      const kind = message.kind || "disconnected";
      bridgeButton.dataset.state = kind;
      bridgeButton.disabled = Boolean(message.transitioning);
      bridgeLabel.textContent = message.label || "Connect";
      const action = kind === "connected" ? "Disconnect Shortcuts bridge" : "Connect to Shortcuts bridge";
      bridgeButton.title = message.detail ? action + ": " + message.detail : action;
      bridgeButton.setAttribute("aria-label", bridgeButton.title);
    }

    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => {
        vscode.postMessage({ command: button.dataset.command });
        if (overflowMenu) overflowMenu.open = false;
      });
    }

    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.command === "runtimeResponse") {
        renderRuntimeResponse(message.payload);
      } else if (message.command === "status") {
        status.textContent = message.text || "";
      } else if (message.command === "bridgeState") {
        renderBridgeState(message);
      } else if (message.command === "toolkitState" && loadToolkitButton) {
        loadToolkitButton.hidden = !message.showLoadToolkit;
      } else if (message.command === "liveSyncState" && liveSyncButton) {
        liveSyncButton.setAttribute("aria-pressed", message.enabled ? "true" : "false");
        liveSyncButton.textContent = message.paused
          ? "Live Sync: Paused"
          : message.enabled ? "Live Sync: On" : "Live Sync";
        liveSyncButton.title = message.paused && message.reason
          ? "Paused: " + message.reason
          : message.enabled ? "Disable Live Sync" : "Enable Live Sync";
      }
    });
  </script>
</body>
</html>`;
}

module.exports = {
  workflowEditorHtml,
  workflowEditorToolbarHtml,
};
