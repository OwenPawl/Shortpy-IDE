"use strict";

const path = require("path");
const crypto = require("crypto");
const vscode = require("vscode");
const {
  binaryPlistToXml,
  bplistBufferFromResponse,
  currentSimulatorSession,
  disconnectBridge: disconnectSimulatorBridge,
  ensureBridgeLaunched,
  runBridgeCli,
  runBridgeCommand,
  runBridgeStatus,
  shortcutBufferFromResponse,
  validateImportedPythonSource,
  validateSimulatorSession,
} = require("./bridge");
const { bridgeControlState, bridgeStatusPresentation } = require("./connectionState");
const { parseAppleDiagnostic } = require("./diagnostics");
const {
  indexToolRendererMetadata,
  isRuntimeSpecificMetadata,
  loadToolRendererMetadata,
  refreshToolRendererMetadata,
  searchToolRendererMetadata,
} = require("./toolrenderer");
const {
  collectToolRendererDiagnostics,
  parameterInfoAt,
} = require("./shortpyDiagnostics");
const {
  determineSyncAction,
  exportHostShortcut,
  hashSource,
  mergeWorkflowPlists,
  shortcutEditorDeepLink,
  syncHostShortcut,
} = require("./hostShortcuts");
const {
  CUSTOM_EDITOR_VIEW_TYPE,
  VISIBLE_COMMANDS,
} = require("./commandRegistry");
const { workflowEditorHtml } = require("./workflowEditorView");
const {
  exactWorkflowRoundTripBytes,
  rememberWorkflowBaseline,
} = require("./workflowRoundTrip");
const { parameterTabStops, triggerInsertion } = require("./editorInsertion");
const {
  recordToolkitActivation,
  sha256File,
  shouldShowLoadToolkit,
} = require("./toolkitState");

const COMMAND_NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const TOOLKIT_SQLITE_STATE_KEY = "shortcutsRuntimeIDE.toolkitSqlitePath";
const TOOLKIT_ACTIVATIONS_STATE_KEY = "shortcutsRuntimeIDE.toolkitActivations.v1";
const HOST_SHORTCUT_LINKS_STATE_KEY = "shortcutsRuntimeIDE.hostShortcutLinks.v1";

let runtimeLog;
let compilerTraceLog;
let toolRendererIndex = indexToolRendererMetadata({});
let toolRendererMetadataPath;
let actionDecoration;
let triggerDecoration;
let bridgeStatusBar;
let shortpyDiagnosticsCollection;
let missingToolRendererCacheReported = false;
let activeBridgeCtlPath = "";
let activeToolkitSqlitePath = "";
let activeBridgeSession;
let bridgeConnectionState = {
  kind: "disconnected",
  detail: "Shortcuts Runtime IDE bridge is not connected.",
};
let activeExtensionContext;
let extensionGlobalStoragePath = "";
let extensionVersion = "dev";
const workflowSessionsByWorkflowUri = new Map();
const workflowSessionsByPythonUri = new Map();
const hostSyncRunsByLinkKey = new Map();
const programmaticHostPullDocuments = new Set();
const validateTimers = new Map();
let hostShortcutLinkStateUpdate = Promise.resolve();
let liveSyncTimer;
let liveSyncPollRunning = false;

function configOptions() {
  const config = vscode.workspace.getConfiguration("shortcutsRuntimeIDE");
  return {
    bridgeCtlPath: config.get("bridgeCtlPath") || undefined,
    activeBridgeCtlPath,
    globalStoragePath: extensionGlobalStoragePath,
    extensionVersion,
    toolRendererMetadataPath: config.get("toolRendererMetadataPath") || undefined,
    highlightKnownCommands: config.get("highlightKnownCommands") !== false,
    writeToDebugConsole: config.get("writeToDebugConsole") !== false,
    pythonPath: config.get("pythonPath") || "python3",
    socket: config.get("socket") || "auto",
    defaultShortcutExtension: config.get("defaultShortcutExtension") || ".shortcut",
    signShortcutExports: config.get("signShortcutExports") !== false,
    shortcutSigningMode: config.get("shortcutSigningMode") || "anyone",
    shortcutsCliPath: config.get("shortcutsCliPath") || undefined,
    toolkitSqlitePath: config.get("toolkitSqlitePath") || activeToolkitSqlitePath || "",
    bridgeCommandTimeoutMs: Number(config.get("bridgeCommandTimeoutMs")) || 120000,
    bridgeMetadataTimeoutMs: Number(config.get("bridgeMetadataTimeoutMs")) || 180000,
    bridgeStatusTimeoutMs: Number(config.get("bridgeStatusTimeoutMs")) || 10000,
    bridgeLaunchTimeoutMs: Number(config.get("bridgeLaunchTimeoutMs")) || 300000,
    openSimulatorOnConnect: Boolean(config.get("openSimulatorOnConnect")),
    quitSimulatorAppOnHeadlessConnect: config.get("quitSimulatorAppOnHeadlessConnect") !== false,
    singleSimulatorOnConnect: config.get("singleSimulatorOnConnect") !== false,
    autoConvertPlistOnOpen: config.get("autoConvertPlistOnOpen") !== false,
    validateOnSave: Boolean(config.get("validateOnSave")),
    validateOnType: Boolean(config.get("validateOnType")),
    validateDebounceMs: Number(config.get("validateDebounceMs")) || 900,
    offerOpenInShortcutsAfterSave: config.get("offerOpenInShortcutsAfterSave") !== false,
    overwriteSiblingShortcut: Boolean(config.get("overwriteSiblingShortcut")),
    headlessShortcutsPath: config.get("headlessShortcutsPath") || "",
    hostCommandTimeoutMs: Number(config.get("hostCommandTimeoutMs")) || 120000,
    liveSyncPollIntervalMs: Math.max(1000, Number(config.get("liveSyncPollIntervalMs")) || 3000),
  };
}

function logRuntime(message, detail) {
  const line = detail === undefined
    ? `[Shortcuts IDE] ${message}`
    : `[Shortcuts IDE] ${message} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  if (runtimeLog) {
    runtimeLog.appendLine(line);
  }
  if (configOptions().writeToDebugConsole && vscode.debug && vscode.debug.activeDebugConsole) {
    try {
      vscode.debug.activeDebugConsole.appendLine(line);
    } catch (_) {
      // Some VS Code surfaces do not expose an active debug console.
    }
  }
}

function compilerTraceFromResponse(response) {
  const trace = response && response.compiler_trace;
  if (!trace || typeof trace !== "object") {
    return undefined;
  }
  if (trace.encoding === "base64" && typeof trace.data === "string") {
    return { trace, text: Buffer.from(trace.data, "base64").toString("utf8") };
  }
  if (typeof trace.text === "string") {
    return { trace, text: trace.text };
  }
  return undefined;
}

function publishCompilerTrace(document, response, outcome) {
  if (!compilerTraceLog) {
    return false;
  }
  const decoded = compilerTraceFromResponse(response);
  if (!decoded) {
    return false;
  }
  const label = document && document.uri
    ? document.uri.fsPath || document.uri.toString()
    : "Shortpy source";
  compilerTraceLog.appendLine(`=== ${new Date().toISOString()} | ${outcome} | ${label} ===`);
  compilerTraceLog.append(decoded.text);
  if (!decoded.text.endsWith("\n")) {
    compilerTraceLog.appendLine("");
  }
  if (decoded.trace.truncated) {
    compilerTraceLog.appendLine(
      `[Shortpy IDE] Trace truncated after ${decoded.trace.captured_byte_length} of ${decoded.trace.byte_length} bytes.`
    );
  }
  compilerTraceLog.appendLine("");
  return true;
}

function showCompilerTrace() {
  if (compilerTraceLog) {
    compilerTraceLog.show(true);
  }
}

function renderBridgeStatus(kind, detail) {
  if (!bridgeStatusBar) {
    return;
  }
  const presentation = bridgeStatusPresentation(kind);
  bridgeStatusBar.text = `${presentation.icon} Shortcuts: ${presentation.label}`;
  bridgeStatusBar.backgroundColor = presentation.error
    ? new vscode.ThemeColor("statusBarItem.errorBackground")
    : undefined;
  bridgeStatusBar.tooltip = detail || "Shortcuts Runtime IDE bridge";
  bridgeStatusBar.show();
}

function bridgeStateMessage() {
  const control = bridgeControlState(bridgeConnectionState.kind);
  return {
    command: "bridgeState",
    ...control,
    detail: bridgeConnectionState.detail || "",
    phase: bridgeConnectionState.phase || control.kind,
  };
}

function publishBridgeState() {
  const message = bridgeStateMessage();
  for (const session of workflowSessionsByWorkflowUri.values()) {
    postWorkflowSessionMessage(session, message);
  }
  if (activeExtensionContext) {
    vscode.commands.executeCommand(
      "setContext",
      "shortcutsRuntimeIDE.bridgeCanConnect",
      message.canConnect
    ).then(undefined, () => {});
    vscode.commands.executeCommand(
      "setContext",
      "shortcutsRuntimeIDE.bridgeCanDisconnect",
      message.canDisconnect
    ).then(undefined, () => {});
  }
}

function setBridgeConnectionState(kind, detail, options = {}) {
  bridgeConnectionState = {
    kind,
    detail: detail || "Shortcuts Runtime IDE bridge",
    phase: options.phase || kind,
  };
  if (Object.prototype.hasOwnProperty.call(options, "session")) {
    activeBridgeSession = options.session;
  }
  renderBridgeStatus(options.phase || kind, bridgeConnectionState.detail);
  publishBridgeState();
}

function setBridgeActivity(kind, detail) {
  renderBridgeStatus(kind, detail);
}

function restoreBridgeStatus(detail) {
  renderBridgeStatus(
    bridgeConnectionState.kind,
    detail || bridgeConnectionState.detail
  );
}

function bridgeStatusDetail(status) {
  return `Bridge ${status.version || "unknown"} at ${status.socket_path || "auto socket"}`;
}

function defaultHostToolkitSqlitePath() {
  const home = process.env.HOME || "";
  return home ? path.join(home, "Library", "Shortcuts", "ToolKit", "Tools-active") : "";
}

function toolkitActivations(context) {
  const value = context && context.globalState.get(TOOLKIT_ACTIVATIONS_STATE_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function selectedToolkitSourceSha256() {
  const selected = configOptions().toolkitSqlitePath || defaultHostToolkitSqlitePath();
  if (!selected) {
    return "";
  }
  try {
    return await sha256File(selected);
  } catch (_) {
    return "";
  }
}

async function postToolkitState(context) {
  const selectedSourceSha256 = await selectedToolkitSourceSha256();
  const visible = shouldShowLoadToolkit(
    activeBridgeSession,
    toolkitActivations(context),
    selectedSourceSha256
  );
  for (const session of workflowSessionsByWorkflowUri.values()) {
    postWorkflowSessionMessage(session, {
      command: "toolkitState",
      showLoadToolkit: visible,
    });
  }
  return visible;
}

async function recordActiveToolkitSession(context, session) {
  if (!context || !session) {
    await postToolkitState(context);
    return false;
  }
  const recorded = recordToolkitActivation(toolkitActivations(context), session);
  if (recorded.key) {
    await context.globalState.update(TOOLKIT_ACTIVATIONS_STATE_KEY, recorded.activations);
  }
  await postToolkitState(context);
  return recorded.changed;
}

function applyBridgeProgress(event) {
  const detail = event && event.message ? event.message : "Connecting Shortcuts bridge";
  const phase = event && event.kind ? event.kind : "connecting";
  setBridgeConnectionState("connecting", detail, { phase });
  logRuntime("bridge bootstrap", event || {});
}

async function probeBridgeStatusPassive() {
  try {
    const status = await runBridgeStatus(configOptions());
    activeBridgeSession = await currentSimulatorSession(configOptions());
    try {
      validateSimulatorSession(activeBridgeSession, status);
    } catch (markerError) {
      const detail = `${markerError.message} Click Connect to relaunch Shortcuts and adopt the current simulator safely.`;
      setBridgeConnectionState("error", detail, { session: undefined });
      await pauseLiveSyncForBridgeDisconnect(activeExtensionContext);
      logRuntime("Bridge session marker unavailable", detail);
      return status;
    }
    setBridgeConnectionState("connected", bridgeStatusDetail(status), {
      session: activeBridgeSession,
    });
    await recordActiveToolkitSession(activeExtensionContext, activeBridgeSession);
    await resumeLiveSyncAfterBridgeConnect(activeExtensionContext);
    logRuntime("Bridge status", status);
    return status;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setBridgeConnectionState(
      "disconnected",
      `Shortcuts bridge is not connected. Run Shortcuts IDE: Connect To Bridge. ${message}`,
      { session: undefined }
    );
    await pauseLiveSyncForBridgeDisconnect(activeExtensionContext);
    await postToolkitState(activeExtensionContext);
    logRuntime("Bridge status unavailable", message);
    return undefined;
  }
}

async function connectBridge(options = {}) {
  setBridgeConnectionState("connecting", "Checking Shortcuts bridge status");
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Connecting Shortcuts bridge",
    cancellable: false,
  }, async (progress) => {
    const bridgeOptions = {
      ...configOptions(),
      forceBridgeLaunch: Boolean(options.forceLaunch),
    };
    if (options.toolkitSqlitePath) {
      bridgeOptions.toolkitSqlitePath = options.toolkitSqlitePath;
    }
    let launched = await ensureBridgeLaunched({
      ...bridgeOptions,
    }, (event) => {
      applyBridgeProgress(event);
      progress.report({ message: event && event.message ? event.message : "Connecting" });
    });
    try {
      validateSimulatorSession(launched.session, launched.status);
    } catch (markerError) {
      if (bridgeOptions.forceBridgeLaunch) {
        throw markerError;
      }
      progress.report({ message: "Adopting the active simulator for safe disconnect" });
      launched = await ensureBridgeLaunched({
        ...bridgeOptions,
        forceBridgeLaunch: true,
      }, (event) => {
        applyBridgeProgress(event);
        progress.report({ message: event && event.message ? event.message : "Connecting" });
      });
      validateSimulatorSession(launched.session, launched.status);
    }
    activeBridgeCtlPath = launched.bridgeCtlPath || activeBridgeCtlPath;
    activeBridgeSession = launched.session || await currentSimulatorSession(configOptions());
    const toolkitChanged = await recordActiveToolkitSession(activeExtensionContext, activeBridgeSession);
    if (toolkitChanged) {
      const detail = "Refreshing ToolRenderer metadata for the activated ToolKit";
      setBridgeConnectionState("connecting", detail, {
        phase: "metadata",
        session: activeBridgeSession,
      });
      progress.report({ message: detail });
      try {
        await refreshToolMetadata(activeExtensionContext, false);
      } catch (error) {
        logRuntime("Automatic ToolRenderer refresh after ToolKit activation failed", error && error.message ? error.message : String(error));
      }
    }
    setBridgeConnectionState("connected", bridgeStatusDetail(launched.status), {
      session: activeBridgeSession,
    });
    await resumeLiveSyncAfterBridgeConnect(activeExtensionContext);
    logRuntime("Bridge connected", {
      status: launched.status,
      bridgeRoot: launched.bridgeRoot,
      bridgeCtlPath: launched.bridgeCtlPath,
      source: launched.source,
      alreadyRunning: launched.alreadyRunning,
    });
    vscode.window.showInformationMessage(`Shortcuts bridge connected${launched.status.version ? ` (${launched.status.version})` : ""}.`);
    return launched.status;
  }).catch((error) => {
    const message = error && error.message ? error.message : String(error);
    setBridgeConnectionState("error", message);
    logRuntime("Bridge connect failed", message);
    throw error;
  });
}

async function disconnectBridge() {
  setBridgeConnectionState("disconnecting", "Shutting down the Shortpy simulator");
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Disconnecting Shortcuts bridge",
    cancellable: false,
  }, async (progress) => {
    progress.report({ message: "Validating Shortpy simulator session" });
    const result = await disconnectSimulatorBridge(configOptions());
    await pauseLiveSyncForBridgeDisconnect(activeExtensionContext);
    activeBridgeSession = undefined;
    setBridgeConnectionState(
      "disconnected",
      result.alreadyStopped
        ? "Shortpy simulator was already stopped."
        : `Shut down Shortpy simulator ${result.simulatorUDID}.`,
      { session: undefined }
    );
    await postToolkitState(activeExtensionContext);
    logRuntime("Bridge disconnected", result);
    vscode.window.showInformationMessage(
      result.alreadyStopped
        ? "Shortcuts bridge is disconnected; its simulator was already stopped."
        : "Shortcuts bridge disconnected and its simulator was shut down."
    );
    return result;
  }).catch(async (error) => {
    const message = error && error.message ? error.message : String(error);
    try {
      const status = await runBridgeStatus(configOptions());
      setBridgeConnectionState("connected", bridgeStatusDetail(status), {
        session: activeBridgeSession,
      });
    } catch (_) {
      setBridgeConnectionState("error", message);
    }
    logRuntime("Bridge disconnect failed", message);
    throw error;
  });
}

function defaultToolRendererMetadataPath(context) {
  return path.join(context.globalStorageUri.fsPath, "toolrenderer-interface.json");
}

function itemKindLabel(item) {
  if (!item) {
    return "ToolRenderer Entry";
  }
  if (item.kind === "trigger") {
    return "Trigger";
  }
  if (item.kind === "enum") {
    return "Enum";
  }
  if (item.kind === "enumCase") {
    return "Enum Case";
  }
  if (item.kind === "typeAlias") {
    return "Type Alias";
  }
  if (item.kind === "class") {
    return "Type";
  }
  if (item.kind === "decorator") {
    return "Decorator";
  }
  if (item.kind === "helper") {
    return "Helper";
  }
  return "Action";
}

function markdown(lines) {
  return new vscode.MarkdownString(lines.filter((line) => line !== undefined && line !== null && line !== "").join("\n"));
}

function typeNamesInExpression(value) {
  const names = new Set();
  const ignored = new Set([
    "Any",
    "Callable",
    "Dict",
    "Enum",
    "List",
    "Literal",
    "None",
    "Optional",
    "Picked",
    "Resolved",
    "Set",
    "Tuple",
    "Union",
    "bool",
    "bytes",
    "dict",
    "float",
    "int",
    "list",
    "set",
    "str",
    "tuple",
  ]);
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let match;
  while ((match = re.exec(String(value || ""))) !== null) {
    if (!ignored.has(match[0])) {
      names.add(match[0]);
    }
  }
  return [...names];
}

function referencedTypesForExpression(value) {
  const byType = toolRendererIndex.typeByPythonName || new Map();
  return typeNamesInExpression(value)
    .map((name) => byType.get(name))
    .filter(Boolean);
}

function catalogParameterGuidance(type) {
  const text = String(type || "");
  if (!/\b(Resolved|Picked)\s*\[/.test(text)) {
    return "";
  }
  return [
    "Use inline parameterState JSON in editable Shortpy. The bridge rewrites it to Apple catalog refs internally during compile.",
    "",
    "```python",
    "app=[{\"Bundle Identifier\": \"com.apple.shortcuts\", \"Name\": \"Shortcuts\"}]",
    "```",
  ].join("\n");
}

function appendRuntimeSpecificNotice(lines, item) {
  if (!isRuntimeSpecificMetadata(item)) {
    return;
  }
  lines.push("");
  lines.push("> This definition is from the current simulator runtime; dynamic cases may differ on another runtime/device.");
}

function appendTypeMaterial(lines, type, options = {}) {
  if (!type) {
    return;
  }
  lines.push("");
  lines.push(options.heading || `Referenced ${itemKindLabel(type)}: \`${type.pythonName}\``);
  appendRuntimeSpecificNotice(lines, type);
  if (type.definitionBlock) {
    lines.push("");
    lines.push("```python");
    lines.push(type.definitionBlock);
    lines.push("```");
    return;
  }
  if (type.signature) {
    lines.push(`\`${type.signature}\``);
  }
  const docs = type.documentation || type.docString || type.summary;
  if (docs) {
    lines.push("");
    lines.push(docs);
  }
  if (Array.isArray(type.bases) && type.bases.length > 0) {
    lines.push(`Bases: ${type.bases.map((base) => `\`${base}\``).join(", ")}`);
  }
  if (Array.isArray(type.cases) && type.cases.length > 0) {
      lines.push("");
      lines.push("Cases:");
      for (const entry of type.cases.slice(0, 80)) {
        const doc = entry.summary || entry.doc || entry.description;
        lines.push(`- \`${type.pythonName}.${entry.name}\` = ${entry.value}${doc ? ` - ${doc}` : ""}`);
      }
  }
  if (Array.isArray(type.members) && type.members.length > 0) {
    lines.push("");
    lines.push("Members:");
    for (const entry of type.members.slice(0, 24)) {
      lines.push(`- \`${entry.name}\`${entry.returnType ? ` -> \`${entry.returnType}\`` : ""}`);
    }
  }
}

function commandMetadata(item, options = {}) {
  const lines = [];
  const hasDefinition = Boolean(item.definitionBlock || item.signature);
  const preferExactDefinition = options.preferExactDefinition !== false &&
    hasDefinition &&
    ["action", "trigger", "helper", "decorator"].includes(item.kind);
  lines.push(`**${item.pythonName}**`);
  lines.push("");
  lines.push(itemKindLabel(item));
  if (item.displayName) {
    lines.push(`Display: ${item.displayName}`);
  }
  if (item.startLine) {
    lines.push(`Source line: ${item.startLine}`);
  }
  appendRuntimeSpecificNotice(lines, item);
  if (!preferExactDefinition && item.returnType) {
    lines.push(`Returns: \`${item.returnType}\``);
  }
  if (!preferExactDefinition && item.returnDocs) {
    lines.push(item.returnDocs);
  }
  if (item.aliasedTo) {
    lines.push(`Alias: \`${item.aliasedTo}\``);
  }
  if (Array.isArray(item.bases) && item.bases.length > 0) {
    lines.push(`Bases: ${item.bases.map((base) => `\`${base}\``).join(", ")}`);
  }
  if (!preferExactDefinition && item.summary) {
    lines.push("");
    lines.push(item.summary);
  }
  const fullDocs = item.documentation || item.docString;
  if (!preferExactDefinition && fullDocs && fullDocs !== item.summary && fullDocs !== item.displayName) {
    lines.push("");
    lines.push(fullDocs);
  }
  if (hasDefinition) {
    lines.push("");
    lines.push("```python");
    lines.push(item.definitionBlock || item.signature);
    lines.push("```");
  }
  if (!preferExactDefinition && Array.isArray(item.parameters) && item.parameters.length > 0) {
    lines.push("");
    lines.push("Parameters:");
    for (const [index, parameter] of item.parameters.slice(0, 20).entries()) {
      const parameterName = parameterLabel(parameter, index);
      const label = parameter.displayName ? ` - ${parameter.displayName}` : "";
      const type = parameter.type ? `: \`${parameter.type}\`` : "";
      const defaultValue = parameter.defaultValue ? ` = \`${parameter.defaultValue}\`` : "";
      lines.push(`- \`${parameterName}\`${type}${defaultValue}${label}`);
      const doc = parameter.doc || parameter.summary;
      if (doc) {
        lines.push(`  ${doc}`);
      }
    }
  }
  if (Array.isArray(item.cases) && item.cases.length > 0) {
    lines.push("");
    lines.push("Cases:");
    for (const entry of item.cases.slice(0, 80)) {
      const doc = entry.summary || entry.doc || entry.description;
      lines.push(`- \`${item.pythonName}.${entry.name}\` = ${entry.value}${doc ? ` - ${doc}` : ""}`);
    }
  }
  if (Array.isArray(item.members) && item.members.length > 0) {
    lines.push("");
    lines.push("Members:");
    for (const entry of item.members.slice(0, 24)) {
      lines.push(`- \`${entry.name}\`${entry.returnType ? ` -> \`${entry.returnType}\`` : ""}`);
    }
  }
  if (!preferExactDefinition && options.includeReferencedTypes !== false) {
    for (const dependencyName of (toolRendererIndex.directDependencies || new Map()).get(item.pythonName) || []) {
      const type = toolRendererIndex.typeByPythonName && toolRendererIndex.typeByPythonName.get(dependencyName);
      if (type) {
        appendTypeMaterial(lines, type);
      }
    }
  }
  return markdown(lines);
}

function parameterMetadata(parameterInfo) {
  const { item, parameter, name } = parameterInfo;
  const label = parameterLabel(parameter, typeof parameter.positionalIndex === "number" ? parameter.positionalIndex : undefined, name);
  const lines = [
    `**${label}**`,
    "",
    `Parameter of \`${item.pythonName}\``,
    isInlineParameter(parameter) ? "Call style: positional inline argument" : "",
    parameter.displayName ? `Display: ${parameter.displayName}` : "",
    parameter.type ? `Type: \`${parameter.type}\`` : "",
    parameter.defaultValue ? `Default: \`${parameter.defaultValue}\`` : "",
  ];
  const doc = parameter.doc || parameter.summary;
  if (doc) {
    lines.push("");
    lines.push(doc);
  }
  const guidance = catalogParameterGuidance(parameter.type);
  if (guidance) {
    lines.push("");
    lines.push(guidance);
  }
  for (const type of referencedTypesForExpression(`${parameter.type || ""} ${parameter.defaultValue || ""}`)) {
    appendTypeMaterial(lines, type);
  }
  return markdown(lines);
}

function isInlineParameter(parameter) {
  return Boolean(parameter && ((parameter.inline || parameter.positional) && !(parameter.pythonName || parameter.name || parameter.key)));
}

function parameterLabel(parameter, index = 0, fallback = "") {
  if (!parameter) {
    return fallback || `argument ${index + 1}`;
  }
  if (isInlineParameter(parameter)) {
    return parameter.displayName || fallback || "inline argument";
  }
  return parameter.pythonName || parameter.name || parameter.key || parameter.displayName || fallback || `argument ${index + 1}`;
}

function parameterSignatureLabel(parameter, index = 0) {
  if (isInlineParameter(parameter)) {
    return parameter.type || parameter.displayName || `argument ${index + 1}`;
  }
  return `${parameterLabel(parameter, index)}=`;
}

function commandSignatureLabel(item) {
  const params = Array.isArray(item.parameters) ? item.parameters : [];
  return `${item.pythonName}(${params.map((param, index) => parameterSignatureLabel(param, index)).join(", ")})`;
}

function snippetPlaceholder(index, value) {
  return `\${${index}:${String(value || "").replace(/[\\}$]/g, "\\$&")}}`;
}

function parameterSnippetValue(parameter) {
  if (parameter.defaultValue && parameter.defaultValue !== "None") {
    return parameter.defaultValue;
  }
  if (parameter.type) {
    return parameter.type.replace(/^Optional\[(.*)\]$/, "$1");
  }
  return parameter.pythonName || parameter.key || "value";
}

function callArgumentsSnippet(parameters, startIndex = 1) {
  const values = parameters || [];
  const tabStops = parameterTabStops(values, startIndex);
  return values.map((parameter, offset) => {
    const value = snippetPlaceholder(tabStops[offset], parameterSnippetValue(parameter));
    if (isInlineParameter(parameter)) {
      return value;
    }
    const name = parameter.pythonName || parameter.key || `value${offset + 1}`;
    return `${name}=${value}`;
  }).join(", ");
}

function nativeToolSnippet(item, editor) {
  const parameters = Array.isArray(item.parameters) ? item.parameters : [];
  const lineText = editor.document.lineAt(editor.selection.active.line).text;
  const indent = (lineText.match(/^\s*/) || [""])[0];
  const inFunctionHeader = /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:\s*$/.test(lineText);
  const actionPrefix = inFunctionHeader ? "\n    " : indent;
  const args = callArgumentsSnippet(parameters, 1);
  return new vscode.SnippetString(`${actionPrefix}${item.pythonName}(${args})$0`);
}

async function insertNativeTool(editor, item) {
  if (item.kind !== "trigger" && item.searchKind !== "trigger") {
    return editor.insertSnippet(nativeToolSnippet(item, editor), editor.selection);
  }
  const placement = triggerInsertion(editor.document.getText());
  const args = callArgumentsSnippet(Array.isArray(item.parameters) ? item.parameters : [], 1);
  const snippet = new vscode.SnippetString(
    `${placement.prefix}@${item.pythonName}(${args})$0${placement.suffix}`
  );
  return editor.insertSnippet(snippet, editor.document.positionAt(placement.offset));
}

function signaturePreview(item) {
  const signature = String(item.signature || "");
  const firstLine = signature.split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.trim() : commandSignatureLabel(item);
}

async function refreshNativeToolRendererInterface(context, announce = true, refreshOptions = {}) {
  const options = configOptions();
  toolRendererMetadataPath = options.toolRendererMetadataPath || defaultToolRendererMetadataPath(context);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toolRendererMetadataPath)));
  const metadata = await refreshToolRendererMetadata(toolRendererMetadataPath, {
    ...options,
    live: refreshOptions.live === true,
    allowLiveFallback: refreshOptions.allowLiveFallback,
  });
  toolRendererIndex = indexToolRendererMetadata(metadata);
  updateCommandDecorations();
  refreshShortpyDiagnosticsForOpenDocuments(shortpyDiagnosticsCollection);
  logRuntime("ToolRenderer interface refreshed", metadata.counts);
  if (announce) {
    const counts = metadata.counts || {};
    const source = metadata.response && metadata.response.cached ? "cached" : "live";
    vscode.window.showInformationMessage(
      `Loaded ${source} ToolRenderer metadata (${counts.actions || 0} actions, ${counts.triggers || 0} triggers).`
    );
  }
  return metadata;
}

async function refreshToolMetadata(context, announce = true) {
  const native = await refreshNativeToolRendererInterface(context, false, {
    live: true,
    allowLiveFallback: true,
  });
  if (announce) {
    const nativeCounts = native.counts || {};
    vscode.window.showInformationMessage(
      `Refreshed ToolRenderer metadata (${nativeCounts.actions || 0} actions, ${nativeCounts.triggers || 0} triggers).`
    );
  }
  return native;
}

async function loadToolkitSqlite(context) {
  const defaultPath = activeToolkitSqlitePath || defaultHostToolkitSqlitePath();
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: defaultPath ? vscode.Uri.file(path.dirname(defaultPath)) : undefined,
    filters: {
      "SQLite databases": ["sqlite", "db", "sqlite3"],
      "All files": ["*"],
    },
    openLabel: "Load ToolKit SQLite",
    title: "Shortcuts IDE: Load ToolKit SQLite",
  });
  if (!selection || selection.length === 0) {
    return undefined;
  }
  activeToolkitSqlitePath = selection[0].fsPath;
  const selectedSha256 = await sha256File(activeToolkitSqlitePath);
  await context.globalState.update(TOOLKIT_SQLITE_STATE_KEY, activeToolkitSqlitePath);
  logRuntime("ToolKit sqlite selected", activeToolkitSqlitePath);
  if (
    bridgeConnectionState.kind === "connected"
    && activeBridgeSession
    && activeBridgeSession.toolkit
    && activeBridgeSession.toolkit.activated
    && activeBridgeSession.toolkit.sourceSha256 === selectedSha256
  ) {
    await recordActiveToolkitSession(context, activeBridgeSession);
    const status = await runBridgeStatus(configOptions());
    restoreBridgeStatus(`ToolKit ${path.basename(activeToolkitSqlitePath)} is already active.`);
    vscode.window.showInformationMessage(`ToolKit is already active: ${path.basename(activeToolkitSqlitePath)}`);
    return status;
  }
  setBridgeConnectionState("connecting", `Loading ToolKit sqlite ${activeToolkitSqlitePath}`, {
    phase: "toolkit",
  });
  const status = await connectBridge({
    forceLaunch: true,
    toolkitSqlitePath: activeToolkitSqlitePath,
  });
  vscode.window.showInformationMessage(`Loaded ToolKit sqlite source of truth: ${path.basename(activeToolkitSqlitePath)}`);
  return status;
}

async function loadCachedToolRendererMetadata(context) {
  const options = configOptions();
  toolRendererMetadataPath = options.toolRendererMetadataPath || defaultToolRendererMetadataPath(context);
  try {
    const metadata = await loadToolRendererMetadata(toolRendererMetadataPath);
    toolRendererIndex = indexToolRendererMetadata(metadata);
    updateCommandDecorations();
    refreshShortpyDiagnosticsForOpenDocuments(shortpyDiagnosticsCollection);
    logRuntime("Cached ToolRenderer metadata loaded", metadata.counts || {});
    return metadata;
  } catch (error) {
    logRuntime("Cached ToolRenderer metadata unavailable", error && error.message ? error.message : String(error));
    return undefined;
  }
}

async function ensureToolRendererMetadata(context) {
  if (toolRendererIndex.byName.size > 0) {
    return;
  }
  const cached = await loadCachedToolRendererMetadata(context);
  if (cached) {
    return;
  }
  throw new Error("ToolRenderer metadata is not available yet. Connect the Shortcuts bridge to activate a ToolKit and build the metadata cache.");
}

async function primeToolRendererMetadata(context) {
  const cached = await loadCachedToolRendererMetadata(context);
  if (!cached && !missingToolRendererCacheReported) {
    missingToolRendererCacheReported = true;
    vscode.window.showWarningMessage("Shortcuts ToolRenderer metadata is not cached yet. Connect the bridge once to activate a ToolKit and enable hovers, completions, and diagnostics.");
  }
}

function toolRendererOnlyIndex() {
  return toolRendererIndex;
}

function shortpyDiagnosticIndex() {
  return toolRendererIndex;
}

function toolRendererParameterInfoAt(source, line, character) {
  return parameterInfoAt(source, line, character, [toolRendererOnlyIndex()]);
}

function collectShortpyDiagnostics(source) {
  return collectToolRendererDiagnostics(source, shortpyDiagnosticIndex());
}

function findToolRendererItem(name) {
  return name ? toolRendererIndex.byName.get(name) : undefined;
}

function activeEditorOrThrow() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("No active editor.");
  }
  return editor;
}

function selectedOrFullText(editor) {
  const selection = editor.selection;
  if (selection && !selection.isEmpty) {
    return editor.document.getText(selection);
  }
  return editor.document.getText();
}

function siblingShortcutUri(document, extension) {
  if (document.uri.scheme !== "file") {
    return undefined;
  }
  const parsed = path.parse(document.uri.fsPath);
  return vscode.Uri.file(path.join(parsed.dir, `${parsed.name}${extension}`));
}

function isShortcutPlistUri(uri) {
  return uri && uri.scheme === "file" && /\.(shortcut|plist)$/i.test(uri.fsPath);
}

async function readPlistBytes(uri) {
  if (uri && uri.scheme === "file") {
    return Buffer.from(await vscode.workspace.fs.readFile(uri));
  }
  const editor = activeEditorOrThrow();
  if (editor.document.uri.scheme === "file") {
    return Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri));
  }
  return Buffer.from(selectedOrFullText(editor), "utf8");
}

function isICloudShortcutUrlBytes(bytes) {
  let text;
  try {
    text = bytes.toString("utf8").trim();
  } catch (_) {
    return false;
  }
  if (!text) {
    return false;
  }
  try {
    const url = new URL(text);
    return url.protocol === "https:" &&
      url.hostname === "www.icloud.com" &&
      /^\/shortcuts\/(?:api\/records\/)?[A-Fa-f0-9-]{32,40}\/?$/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function assertShortcutImportBytes(bytes, sourceName = "input") {
  if (isICloudShortcutUrlBytes(bytes)) {
    return;
  }
  const signedPrefix = bytes.subarray(0, 4).toString("ascii");
  if (signedPrefix === "AEA1") {
    return;
  }
  const prefix = bytes.subarray(0, 8).toString("ascii");
  const trimmed = bytes.toString("utf8", 0, Math.min(bytes.length, 64)).trimStart();
  if (prefix !== "bplist00" && !trimmed.startsWith("<?xml") && !trimmed.startsWith("<plist")) {
    throw new Error(`${sourceName} is not a workflow plist, signed shortcut, or iCloud shortcut link. Expected AEA1, bplist00, XML plist, or https://www.icloud.com/shortcuts/<UUID>.`);
  }
}

function workflowSessionKey(uri) {
  return uri && uri.toString();
}

function workflowPythonUri(context, workflowUri) {
  const hash = crypto.createHash("sha256").update(workflowUri.toString()).digest("hex").slice(0, 16);
  const parsed = path.parse(workflowUri.fsPath || "workflow.shortcut");
  const base = parsed.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "workflow";
  return vscode.Uri.file(path.join(context.globalStorageUri.fsPath, "workflow-editors", `${base}-${hash}.shortcuts.py`));
}

function getOrCreateWorkflowSession(context, workflowUri) {
  const key = workflowSessionKey(workflowUri);
  let session = workflowSessionsByWorkflowUri.get(key);
  if (!session) {
    session = {
      workflowUri,
      pythonUri: workflowPythonUri(context, workflowUri),
      webviews: new Set(),
    };
    workflowSessionsByWorkflowUri.set(key, session);
    workflowSessionsByPythonUri.set(workflowSessionKey(session.pythonUri), session);
  }
  return session;
}

function workflowSessionForDocument(document) {
  return document && workflowSessionsByPythonUri.get(workflowSessionKey(document.uri));
}

function controllerWebviewsForSession(session) {
  return session && session.webviews ? Array.from(session.webviews) : [];
}

function postWorkflowSessionMessage(session, message) {
  for (const webview of controllerWebviewsForSession(session)) {
    webview.postMessage(message);
  }
}

function postWorkflowSessionRuntimeResponse(session, payload) {
  postWorkflowSessionMessage(session, { command: "runtimeResponse", payload });
}

function postWorkflowSessionStatus(session, text) {
  postWorkflowSessionMessage(session, { command: "status", text });
}

function postWorkflowSessionLiveSyncState(session, link) {
  postWorkflowSessionMessage(session, {
    command: "liveSyncState",
    enabled: Boolean(link && link.liveSync),
    paused: Boolean(link && link.liveSyncPausedReason),
    reason: link && link.liveSyncPausedReason,
  });
}

async function writeWorkflowPythonSource(session, source) {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(session.pythonUri.fsPath)));
  const openDocument = vscode.workspace.textDocuments.find((document) =>
    document.uri.toString() === session.pythonUri.toString()
  );
  if (!openDocument) {
    await vscode.workspace.fs.writeFile(session.pythonUri, Buffer.from(source, "utf8"));
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    openDocument.uri,
    new vscode.Range(openDocument.positionAt(0), openDocument.positionAt(openDocument.getText().length)),
    source
  );
  await vscode.workspace.applyEdit(edit);
  await openDocument.save();
}

async function importWorkflowPlistToSession(context, workflowUri) {
  const bytes = Buffer.from(await vscode.workspace.fs.readFile(workflowUri));
  assertShortcutImportBytes(bytes, path.basename(workflowUri.fsPath));
  const response = await runBridgeCommand("plist-data-to-python", bytes, configOptions());
  const imported = await validateImportedPythonSource(response, compileOptionsForValidation());
  const session = getOrCreateWorkflowSession(context, workflowUri);
  await writeWorkflowPythonSource(session, imported.source);
  session.lastImportResponse = response;
  session.lastImportValidation = imported.validation;
  session.lastImportError = undefined;
  rememberWorkflowBaseline(session, imported.source, bytes, workflowUri.fsPath);
  return session;
}

async function showWorkflowPythonEditor(session, options = {}) {
  const document = await vscode.workspace.openTextDocument(session.pythonUri);
  const existing = vscode.window.visibleTextEditors.find((editor) =>
    editor.document.uri.toString() === session.pythonUri.toString()
  );
  if (existing) {
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: existing.viewColumn,
      preview: false,
      preserveFocus: Boolean(options.preserveFocus),
    });
    setShortpyDiagnostics(shortpyDiagnosticsCollection, document);
    updateCommandDecorationsForEditor(editor);
    return editor;
  }
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: options.viewColumn || vscode.ViewColumn.Beside,
    preview: false,
    preserveFocus: Boolean(options.preserveFocus),
  });
  setShortpyDiagnostics(shortpyDiagnosticsCollection, document);
  updateCommandDecorationsForEditor(editor);
  return editor;
}

function compilationSourceForDocument(document, source) {
  const session = workflowSessionForDocument(document);
  return {
    source,
    visibleSource: source,
    session,
  };
}

async function openText(content, language, title) {
  const document = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(document, { preview: false });
  if (title) {
    vscode.window.setStatusBarMessage(title, 4000);
  }
}

function compilerDiagnosticRange(parsed, document) {
  if (!parsed || !parsed.line || !parsed.column) {
    return new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length));
  }
  const line = Math.max(0, Number(parsed.line) - 1);
  const column = Math.max(0, Number(parsed.column) - 1);
  const safeLine = Math.min(line, Math.max(0, document.lineCount - 1));
  const text = document.lineAt(safeLine).text;
  const start = Math.min(column, text.length);
  const wordRange = document.getWordRangeAtPosition(
    new vscode.Position(safeLine, start),
    /[A-Za-z_][A-Za-z0-9_]*/
  );
  if (wordRange) {
    return wordRange;
  }
  const end = Math.min(text.length, Math.max(start + 1, start));
  return new vscode.Range(safeLine, start, safeLine, end);
}

function firstNonEmptyRange(document) {
  for (let index = 0; index < document.lineCount; index += 1) {
    const line = document.lineAt(index);
    const first = line.firstNonWhitespaceCharacterIndex;
    if (!line.isEmptyOrWhitespace) {
      return new vscode.Range(index, first, index, Math.max(first + 1, line.text.length));
    }
  }
  return new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length));
}

function setCompilerDiagnostic(collection, document, error) {
  const message = error && error.message ? error.message : String(error);
  const parsed = parseAppleDiagnostic(message);
  const diagnostic = new vscode.Diagnostic(
    compilerDiagnosticRange(parsed, document),
    message,
    vscode.DiagnosticSeverity.Error
  );
  diagnostic.source = "Shortcuts Runtime IDE";
  diagnostic.code = parsed.code || (error && error.bridgeResponse && error.bridgeResponse.error_type);
  diagnostic.relatedInformation = [
    ...parsed.hints.map((hint) => new vscode.DiagnosticRelatedInformation(
      new vscode.Location(document.uri, diagnostic.range),
      `Hint: ${hint}`
    )),
    ...parsed.fixIts.map((fixIt) => new vscode.DiagnosticRelatedInformation(
      new vscode.Location(document.uri, diagnostic.range),
      `Fix-it: ${fixIt.text}`
    )),
  ];
  diagnostic.shortcutsRuntimeIDE = {
    parsed,
    response: error && error.bridgeResponse,
  };
  collection.set(document.uri, [diagnostic]);
}

function setSuccessDiagnostics(collection, document, source, response) {
  const actionCount = response && response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  if (source.trim() && actionCount === 0) {
    const diagnostic = new vscode.Diagnostic(
      firstNonEmptyRange(document),
      "Shortcuts runtime compiled this source to an empty workflow. Treat this as suspicious parser recovery unless an empty shortcut was intended.",
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "Shortcuts Runtime IDE";
    diagnostic.code = "emptyWorkflow";
    collection.set(document.uri, [diagnostic]);
    return;
  }
  collection.delete(document.uri);
}

function severityFromShortpyDiagnostic(item) {
  if (item.severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  if (item.severity === "info") {
    return vscode.DiagnosticSeverity.Information;
  }
  return vscode.DiagnosticSeverity.Error;
}

function setShortpyDiagnostics(collection, document) {
  if (!collection || document.languageId !== "python") {
    return [];
  }
  const rawDiagnostics = collectShortpyDiagnostics(document.getText());
  const diagnostics = rawDiagnostics.map((item) => {
    const line = Math.min(Math.max(0, item.line), Math.max(0, document.lineCount - 1));
    const text = document.lineAt(line).text;
    const start = Math.min(Math.max(0, item.start), text.length);
    const end = Math.min(Math.max(start + 1, item.end), text.length);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, start, line, end),
      item.message,
      severityFromShortpyDiagnostic(item)
    );
    diagnostic.source = "Shortcuts ToolRenderer";
    diagnostic.code = item.code;
    return diagnostic;
  });
  collection.set(document.uri, diagnostics);
  return rawDiagnostics;
}

function refreshShortpyDiagnosticsForOpenDocuments(collection) {
  for (const document of vscode.workspace.textDocuments) {
    setShortpyDiagnostics(collection, document);
  }
}

function compileOptionsForValidation() {
  return {
    ...configOptions(),
    signShortcut: false,
  };
}

function compileOptionsForExport() {
  const options = configOptions();
  return {
    ...options,
    signShortcut: options.signShortcutExports,
  };
}

function shortcutBytesForTarget(response, target) {
  const extension = target && target.fsPath ? path.extname(target.fsPath).toLowerCase() : "";
  if (extension === ".plist") {
    return bplistBufferFromResponse(response);
  }
  return shortcutBufferFromResponse(response);
}

async function compilePythonDocument(document, source, collection, bridgeOptions = compileOptionsForValidation()) {
  const prepared = compilationSourceForDocument(document, source);
  try {
    setBridgeActivity("validating", "Validating");
    if (prepared.session) {
      postWorkflowSessionRuntimeResponse(prepared.session, "Validating with Apple runtime...");
      postWorkflowSessionStatus(prepared.session, `Validating ${path.basename(prepared.session.workflowUri.fsPath)}`);
    }
    logRuntime("compile python-to-bplist", { uri: document.uri.toString(), bytes: Buffer.byteLength(prepared.source, "utf8") });
    const response = await runBridgeCommand("python-to-bplist", prepared.source, bridgeOptions);
    publishCompilerTrace(document, response, "compile succeeded");
    setSuccessDiagnostics(collection, document, prepared.visibleSource, response);
    const actions = response && response.plist_summary && response.plist_summary.WFWorkflowActions_count;
    logRuntime("compile ok", { actions, compiledTrigger: response && response.plist_builder && response.plist_builder.unifiedAutomationTriggers_serialized });
    restoreBridgeStatus(`Valid (${Number.isInteger(actions) ? `${actions} actions` : "connected"})`);
    if (prepared.session) {
      postWorkflowSessionRuntimeResponse(prepared.session, customEditorValidationResponse({ ok: true, response }));
      postWorkflowSessionStatus(prepared.session, `Validated ${Number.isInteger(actions) ? `${actions} actions` : "workflow"}`);
    }
    return response;
  } catch (error) {
    publishCompilerTrace(document, error && error.bridgeResponse, "compile failed");
    setCompilerDiagnostic(collection, document, error);
    logRuntime("compile diagnostic", error && error.message ? error.message : String(error));
    restoreBridgeStatus("Validation failed; bridge remains connected.");
    if (prepared.session) {
      postWorkflowSessionRuntimeResponse(prepared.session, customEditorValidationResponse({ ok: false, error }));
      postWorkflowSessionStatus(prepared.session, "Validation failed");
    }
    throw error;
  }
}

function hostShortcutLinkKey(document) {
  const session = workflowSessionForDocument(document);
  return (session ? session.workflowUri : document.uri).toString();
}

function suggestedHostShortcutName(document) {
  const session = workflowSessionForDocument(document);
  const file = session ? session.workflowUri.fsPath : document.uri.fsPath;
  return path.basename(file || "Shortpy Shortcut")
    .replace(/\.shortcuts\.py$/i, "")
    .replace(/\.(?:shortcut|plist|py)$/i, "") || "Shortpy Shortcut";
}

function hostShortcutLinks(context) {
  const value = context.globalState.get(HOST_SHORTCUT_LINKS_STATE_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function updateAllHostShortcutLinks(context, updater) {
  if (!context) {
    return Promise.resolve({});
  }
  const operation = hostShortcutLinkStateUpdate.catch(() => undefined).then(async () => {
    const current = hostShortcutLinks(context);
    const updated = updater(current);
    await context.globalState.update(HOST_SHORTCUT_LINKS_STATE_KEY, updated);
    for (const session of workflowSessionsByWorkflowUri.values()) {
      postWorkflowSessionLiveSyncState(session, updated[session.workflowUri.toString()]);
    }
    return updated;
  });
  hostShortcutLinkStateUpdate = operation.then(() => undefined, () => undefined);
  return operation;
}

async function pauseLiveSyncForBridgeDisconnect(context) {
  await updateAllHostShortcutLinks(context, (links) => Object.fromEntries(
    Object.entries(links).map(([key, link]) => {
      if (!link || !link.liveSync || link.liveSyncPausedReason) {
        return [key, link];
      }
      return [key, { ...link, liveSyncPausedReason: "bridge disconnected" }];
    })
  ));
}

async function resumeLiveSyncAfterBridgeConnect(context) {
  await updateAllHostShortcutLinks(context, (links) => Object.fromEntries(
    Object.entries(links).map(([key, link]) => {
      if (!link || link.liveSyncPausedReason !== "bridge disconnected") {
        return [key, link];
      }
      const resumed = { ...link };
      delete resumed.liveSyncPausedReason;
      return [key, resumed];
    })
  ));
}

async function ensureBridgeConnectedForHostSync() {
  try {
    return await runBridgeStatus(configOptions());
  } catch (_) {
    return connectBridge();
  }
}

function updateHostShortcutLink(context, linkKey, linkOrUpdater) {
  const operation = hostShortcutLinkStateUpdate.catch(() => undefined).then(async () => {
    const links = hostShortcutLinks(context);
    const link = typeof linkOrUpdater === "function"
      ? linkOrUpdater(links[linkKey])
      : linkOrUpdater;
    await context.globalState.update(HOST_SHORTCUT_LINKS_STATE_KEY, {
      ...links,
      [linkKey]: link,
    });
    return link;
  });
  hostShortcutLinkStateUpdate = operation.then(() => undefined, () => undefined);
  return operation;
}

async function removeHostShortcutLink(context, linkKey) {
  const operation = hostShortcutLinkStateUpdate.catch(() => undefined).then(async () => {
    const links = { ...hostShortcutLinks(context) };
    delete links[linkKey];
    await context.globalState.update(HOST_SHORTCUT_LINKS_STATE_KEY, links);
  });
  hostShortcutLinkStateUpdate = operation.then(() => undefined, () => undefined);
  await operation;
  const uris = hostSyncSnapshotUris(context, linkKey);
  try {
    await vscode.workspace.fs.delete(uris.directory, { recursive: true, useTrash: false });
  } catch (_) {
    // Missing baseline state is already equivalent to an unlinked document.
  }
}

async function replacePythonDocumentSource(document, source) {
  const documentKey = document.uri.toString();
  programmaticHostPullDocuments.add(documentKey);
  clearTimeout(validateTimers.get(documentKey));
  validateTimers.delete(documentKey);
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      source
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error("VS Code could not apply the host Shortcuts version to the Python editor.");
    }
    await document.save();
  } finally {
    programmaticHostPullDocuments.delete(documentKey);
  }
  setShortpyDiagnostics(shortpyDiagnosticsCollection, document);
  updateCommandDecorations();
}

function hostSyncSnapshotUris(context, linkKey) {
  const stateHash = crypto.createHash("sha256").update(linkKey).digest("hex").slice(0, 24);
  const directory = vscode.Uri.file(path.join(context.globalStorageUri.fsPath, "host-sync-state", stateHash));
  return {
    directory,
    host: vscode.Uri.joinPath(directory, "host.plist"),
    compiled: vscode.Uri.joinPath(directory, "compiled.plist"),
  };
}

async function writeHostSyncSnapshots(context, linkKey, hostPlist, compiledPlist) {
  const uris = hostSyncSnapshotUris(context, linkKey);
  await vscode.workspace.fs.createDirectory(uris.directory);
  await vscode.workspace.fs.writeFile(uris.host, hostPlist);
  await vscode.workspace.fs.writeFile(uris.compiled, compiledPlist);
}

async function readHostSyncSnapshots(context, linkKey) {
  const uris = hostSyncSnapshotUris(context, linkKey);
  try {
    return {
      host: Buffer.from(await vscode.workspace.fs.readFile(uris.host)),
      compiled: Buffer.from(await vscode.workspace.fs.readFile(uris.compiled)),
    };
  } catch (_) {
    return undefined;
  }
}

async function hostPythonSource(hostExport) {
  const response = await runBridgeCommand("plist-data-to-python", hostExport.plist, configOptions());
  const imported = await validateImportedPythonSource(response, compileOptionsForValidation());
  return {
    compiledPlist: bplistBufferFromResponse(imported.validation),
    source: imported.source,
    validation: imported.validation,
  };
}

async function openHostPythonDiff(context, document, source, name, linkKey) {
  const previewHash = crypto.createHash("sha256").update(linkKey).digest("hex").slice(0, 16);
  const previewUri = vscode.Uri.file(path.join(
    context.globalStorageUri.fsPath,
    "host-sync-previews",
    `${previewHash}-host.py`
  ));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(previewUri.fsPath)));
  await vscode.workspace.fs.writeFile(previewUri, Buffer.from(source, "utf8"));
  await vscode.commands.executeCommand(
    "vscode.diff",
    previewUri,
    document.uri,
    `${name}: Shortcuts Version ↔ Editor Version`
  );
}

async function performPythonDocumentHostSync(context, document, collection, syncOptions = {}) {
  if (!document || document.languageId !== "python") {
    throw new Error("Open a Shortpy Python editor before syncing to host Shortcuts.");
  }
  const interactive = syncOptions.interactive !== false;
  await ensureBridgeConnectedForHostSync();

  const linkKey = hostShortcutLinkKey(document);
  const links = hostShortcutLinks(context);
  const link = links[linkKey];
  let name = link && link.name;
  if (!link) {
    if (!interactive) {
      return { ok: false, operation: "unlinked", name: suggestedHostShortcutName(document) };
    }
    name = await vscode.window.showInputBox({
      title: "Sync With Host Shortcuts",
      prompt: "Name for the host shortcut",
      value: suggestedHostShortcutName(document),
      ignoreFocusOut: true,
      validateInput(value) {
        return String(value || "").trim() ? undefined : "Enter a shortcut name.";
      },
    });
    if (name === undefined) {
      return undefined;
    }
    name = name.trim();
  }

  const run = async (progress) => {
    const hostOptions = configOptions();
    const runSync = (currentRequest) => syncHostShortcut(currentRequest, hostOptions, (event) => {
      progress.report({ message: event.message || "Preparing host runtime" });
      logRuntime("host sync runtime", event);
    });
    const runExport = (workflowID) => exportHostShortcut(workflowID, hostOptions, (event) => {
      progress.report({ message: event.message || "Reading host shortcut" });
      logRuntime("host export runtime", event);
    });
    const saveBaseline = async (result, hostExport, source, compiledPlist) => {
      await writeHostSyncSnapshots(context, linkKey, hostExport.plist, compiledPlist);
      const updated = await updateHostShortcutLink(context, linkKey, (currentLink) => {
        const updatedLink = {
          ...(currentLink || link || {}),
          workflowID: result.workflowID,
          name: hostExport.name || result.name || name,
          sourceHash: hashSource(source),
          hostHash: hostExport.hostHash,
          updatedAt: new Date().toISOString(),
        };
        delete updatedLink.liveSyncPausedReason;
        return updatedLink;
      });
      postWorkflowSessionLiveSyncState(workflowSessionForDocument(document), updated);
      return updated;
    };
    const compileLocal = async () => {
      progress.report({ message: "Compiling editor version" });
      const compiled = await compilePythonDocument(
        document,
        document.getText(),
        collection,
        compileOptionsForValidation()
      );
      return {
        plist: bplistBufferFromResponse(compiled),
        source: document.getText(),
      };
    };
    const pushLocal = async (currentLink, currentHost) => {
      const local = await compileLocal();
      let plist = local.plist;
      if (currentLink && currentHost) {
        const snapshots = await readHostSyncSnapshots(context, linkKey);
        if (!snapshots) {
          throw new Error("Host sync baseline is missing. Pull the Shortcuts version or recreate the link before overwriting it.");
        }
        plist = await mergeWorkflowPlists({
          base: snapshots.compiled,
          local: local.plist,
          host: currentHost.plist,
          preserveKeys: ["WFTriggerUUID"],
          preserveRootKeys: ["WFWorkflowIcon"],
        }, hostOptions);
      }
      progress.report({ message: currentLink ? "Updating host workflow record" : "Creating host workflow record" });
      const result = await runSync({
        plist,
        workflowID: currentLink && currentLink.workflowID,
        name: currentLink ? undefined : name,
      });
      const savedHost = await runExport(result.workflowID);
      const updatedLink = await saveBaseline(result, savedHost, local.source, local.plist);
      restoreBridgeStatus(`Synced ${updatedLink.name} with host Shortcuts`);
      logRuntime("host sync push complete", {
        operation: result.operation,
        workflowID: result.workflowID,
        name: updatedLink.name,
      });
      if (interactive) {
        vscode.window.showInformationMessage(
          `${result.operation === "create" ? "Created" : "Updated"} ${updatedLink.name} in Shortcuts.`
        );
      }
      return { ...result, name: updatedLink.name, direction: "push" };
    };
    const pullHost = async (hostExport) => {
      progress.report({ message: "Converting Shortcuts version to Shortpy" });
      const imported = await hostPythonSource(hostExport);
      await replacePythonDocumentSource(document, imported.source);
      setSuccessDiagnostics(collection, document, imported.source, imported.validation);
      const result = {
        ok: true,
        operation: "pull",
        workflowID: hostExport.workflowID,
        name: hostExport.name,
      };
      const updatedLink = await saveBaseline(
        result,
        hostExport,
        imported.source,
        imported.compiledPlist
      );
      restoreBridgeStatus(`Pulled ${updatedLink.name} from host Shortcuts`);
      logRuntime("host sync pull complete", {
        workflowID: updatedLink.workflowID,
        name: updatedLink.name,
      });
      if (interactive) {
        vscode.window.showInformationMessage(`Updated the editor from ${updatedLink.name} in Shortcuts.`);
      }
      return { ...result, name: updatedLink.name, direction: "pull" };
    };

    if (!link) {
      return pushLocal(undefined, undefined);
    }

    progress.report({ message: "Reading host workflow record" });
    let currentHost;
    try {
      currentHost = await runExport(link.workflowID);
    } catch (error) {
      if (error.code !== "not_found") {
        throw error;
      }
      if (!interactive) {
        return { ok: false, operation: "missing", workflowID: link.workflowID, name: link.name };
      }
      const missingChoice = await vscode.window.showWarningMessage(
        `Host shortcut ${link.name} no longer exists.`,
        "Create Again",
        "Unlink"
      );
      if (missingChoice === "Unlink") {
        await removeHostShortcutLink(context, linkKey);
        vscode.window.showInformationMessage(`Unlinked ${link.name} from this editor.`);
        return { ok: true, operation: "unlink", workflowID: link.workflowID, name: link.name };
      }
      return missingChoice === "Create Again" ? pushLocal(undefined, undefined) : undefined;
    }

    const sourceHash = hashSource(document.getText());
    const action = determineSyncAction(link, sourceHash, currentHost.hostHash);
    logRuntime("host sync decision", {
      action,
      sourceChanged: sourceHash !== link.sourceHash,
      hostChanged: currentHost.hostHash !== link.hostHash,
      workflowID: link.workflowID,
      name: currentHost.name || link.name,
    });

    if (action === "initialize") {
      const local = await compileLocal();
      const updatedLink = await saveBaseline(
        link,
        currentHost,
        local.source,
        local.plist
      );
      if (interactive) {
        vscode.window.showInformationMessage(`Initialized two-way sync for ${updatedLink.name}.`);
      }
      return { ok: true, operation: "initialize", ...updatedLink };
    }
    if (action === "none") {
      if ((currentHost.name && currentHost.name !== link.name) || link.liveSyncPausedReason) {
        const updated = await updateHostShortcutLink(context, linkKey, (currentLink) => {
          const updatedLink = { ...(currentLink || link), name: currentHost.name || link.name };
          delete updatedLink.liveSyncPausedReason;
          return updatedLink;
        });
        postWorkflowSessionLiveSyncState(workflowSessionForDocument(document), updated);
      }
      restoreBridgeStatus(`${currentHost.name || link.name} is in sync`);
      if (interactive) {
        vscode.window.showInformationMessage(`${currentHost.name || link.name} is already in sync.`);
      }
      return { ok: true, operation: "none", workflowID: link.workflowID, name: currentHost.name || link.name };
    }
    if (action === "push") {
      return pushLocal(link, currentHost);
    }
    if (action === "pull") {
      return pullHost(currentHost);
    }

    if (!interactive) {
      return { ok: false, operation: "conflict", workflowID: link.workflowID, name: currentHost.name || link.name };
    }

    const conflictChoice = await vscode.window.showWarningMessage(
      `Both the editor and ${currentHost.name || link.name} changed since the last sync.`,
      { modal: true },
      "Use Editor Version",
      "Use Shortcuts Version",
      "Compare"
    );
    if (conflictChoice === "Use Editor Version") {
      return pushLocal(link, currentHost);
    }
    if (conflictChoice === "Use Shortcuts Version") {
      return pullHost(currentHost);
    }
    if (conflictChoice === "Compare") {
      progress.report({ message: "Preparing Shortcuts version for comparison" });
      const imported = await hostPythonSource(currentHost);
      await openHostPythonDiff(
        context,
        document,
        imported.source,
        currentHost.name || link.name,
        linkKey
      );
      return { ok: false, operation: "conflict", workflowID: link.workflowID, name: currentHost.name || link.name };
    }
    return undefined;
  };
  if (!interactive) {
    return run({ report() {} });
  }
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: link ? `Syncing ${link.name} with Shortcuts` : `Creating ${name} in Shortcuts`,
    cancellable: false,
  }, run);
}

function syncPythonDocumentToHost(context, document, collection, syncOptions = {}) {
  const linkKey = hostShortcutLinkKey(document);
  const existing = hostSyncRunsByLinkKey.get(linkKey);
  if (existing && syncOptions.coalesce) {
    return existing;
  }
  const prior = existing ? existing.catch(() => undefined) : Promise.resolve();
  const current = prior.then(() => performPythonDocumentHostSync(
    context,
    document,
    collection,
    syncOptions
  ));
  hostSyncRunsByLinkKey.set(linkKey, current);
  current.finally(() => {
    if (hostSyncRunsByLinkKey.get(linkKey) === current) {
      hostSyncRunsByLinkKey.delete(linkKey);
    }
  }).catch(() => {});
  return current;
}

async function syncToHostShortcuts(context, collection) {
  const editor = activeEditorOrThrow();
  return syncPythonDocumentToHost(context, editor.document, collection);
}

function hostShortcutLinkForDocument(context, document) {
  const linkKey = hostShortcutLinkKey(document);
  return { linkKey, link: hostShortcutLinks(context)[linkKey] };
}

function postHostSyncStatus(document, text) {
  const session = workflowSessionForDocument(document);
  if (session) {
    postWorkflowSessionStatus(session, text);
  }
}

async function openHostShortcutEditorLink(context, linkKey, fallbackName) {
  const link = hostShortcutLinks(context)[linkKey];
  const name = (link && link.name) || fallbackName;
  const deepLink = shortcutEditorDeepLink(link && link.workflowID, name);
  const opened = await vscode.env.openExternal(vscode.Uri.parse(deepLink));
  if (!opened) {
    throw new Error("macOS did not open the Shortcuts editor deep link.");
  }
  logRuntime("opened host shortcut editor", {
    workflowID: link && link.workflowID,
    name,
    deepLink,
  });
  return { ok: true, workflowID: link && link.workflowID, name, deepLink };
}

async function openHostShortcutEditorForDocument(context, document) {
  if (!document || document.languageId !== "python") {
    throw new Error("Open a Shortpy Python editor before opening the Shortcuts editor.");
  }
  const result = await openHostShortcutEditorLink(
    context,
    hostShortcutLinkKey(document),
    suggestedHostShortcutName(document)
  );
  postHostSyncStatus(document, `Opened ${result.name} in Shortcuts`);
  return result;
}

async function openHostShortcutEditor(context) {
  const editor = activeEditorOrThrow();
  return openHostShortcutEditorForDocument(context, editor.document);
}

function openDocumentForHostLinkKey(linkKey) {
  return vscode.workspace.textDocuments.find((document) =>
    document.languageId === "python" && hostShortcutLinkKey(document) === linkKey
  );
}

async function pauseLiveSync(context, document, reason, message) {
  const { linkKey, link } = hostShortcutLinkForDocument(context, document);
  if (!link || !link.liveSync) {
    return;
  }
  const alreadyPaused = link.liveSyncPausedReason === reason;
  const paused = await updateHostShortcutLink(context, linkKey, (currentLink) => ({
    ...(currentLink || link),
    liveSyncPausedReason: reason,
  }));
  postWorkflowSessionLiveSyncState(workflowSessionForDocument(document), paused);
  postHostSyncStatus(document, `Live Sync paused: ${message}`);
  restoreBridgeStatus(`Live Sync paused for ${link.name}: ${message}`);
  if (!alreadyPaused) {
    vscode.window.showWarningMessage(
      `Live Sync paused for ${link.name}: ${message} Run Sync With Host Shortcuts to resolve it.`
    );
  }
}

async function runLiveSyncForDocument(context, document, collection, reason) {
  const { link } = hostShortcutLinkForDocument(context, document);
  if (!link || !link.liveSync || link.liveSyncPausedReason) {
    return undefined;
  }
  if (bridgeConnectionState.kind !== "connected") {
    await pauseLiveSyncForBridgeDisconnect(context);
    return undefined;
  }
  if (reason === "poll" && document.isDirty) {
    return undefined;
  }
  postHostSyncStatus(document, `Live Sync checking ${link.name}`);
  try {
    const result = await syncPythonDocumentToHost(context, document, collection, {
      interactive: false,
      coalesce: true,
    });
    if (!result) {
      return undefined;
    }
    const currentLink = hostShortcutLinkForDocument(context, document).link;
    if (!currentLink || !currentLink.liveSync) {
      return result;
    }
    if (result.operation === "conflict") {
      await pauseLiveSync(context, document, "conflict", "both the editor and Shortcuts changed");
      return result;
    }
    if (result.operation === "missing") {
      await pauseLiveSync(context, document, "missing", "the linked shortcut no longer exists");
      return result;
    }
    if (["push", "pull", "initialize"].includes(result.operation)) {
      postHostSyncStatus(document, `Live Sync ${result.direction || result.operation}: ${result.name}`);
      logRuntime("live sync propagated change", {
        reason,
        operation: result.operation,
        direction: result.direction,
        workflowID: result.workflowID,
        name: result.name,
      });
    } else {
      postHostSyncStatus(document, `Live Sync active: ${result.name || link.name}`);
    }
    return result;
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    const currentLink = hostShortcutLinkForDocument(context, document).link;
    if (currentLink && currentLink.liveSync) {
      postHostSyncStatus(document, `Live Sync retry pending: ${text}`);
    }
    logRuntime("live sync attempt failed", { reason, name: link.name, error: text });
    return undefined;
  }
}

async function pollLiveSyncDocuments(context, collection) {
  if (liveSyncPollRunning) {
    return;
  }
  liveSyncPollRunning = true;
  try {
    for (const [linkKey, link] of Object.entries(hostShortcutLinks(context))) {
      if (!link || !link.liveSync || link.liveSyncPausedReason) {
        continue;
      }
      const document = openDocumentForHostLinkKey(linkKey);
      if (document) {
        await runLiveSyncForDocument(context, document, collection, "poll");
      }
    }
  } finally {
    liveSyncPollRunning = false;
  }
}

async function toggleLiveSyncForDocument(context, document, collection) {
  if (!document || document.languageId !== "python") {
    throw new Error("Open a Shortpy Python editor before changing Live Sync.");
  }
  let { linkKey, link } = hostShortcutLinkForDocument(context, document);
  if (link && link.liveSync) {
    const disabled = await updateHostShortcutLink(context, linkKey, (currentLink) => {
      const value = { ...(currentLink || link), liveSync: false };
      delete value.liveSyncPausedReason;
      return value;
    });
    postWorkflowSessionLiveSyncState(workflowSessionForDocument(document), disabled);
    postHostSyncStatus(document, `Live Sync disabled for ${link.name}`);
    vscode.window.showInformationMessage(`Live Sync disabled for ${link.name}.`);
    return { ok: true, enabled: false, ...disabled };
  }

  if (!link || !link.sourceHash || !link.hostHash) {
    const result = await syncPythonDocumentToHost(context, document, collection);
    if (!result || ["conflict", "unlink"].includes(result.operation)) {
      return result;
    }
    ({ linkKey, link } = hostShortcutLinkForDocument(context, document));
  }
  if (!link) {
    throw new Error("Live Sync requires a linked host shortcut. Run Sync With Host Shortcuts first.");
  }
  const enabled = await updateHostShortcutLink(context, linkKey, (currentLink) => {
    const value = { ...(currentLink || link), liveSync: true };
    delete value.liveSyncPausedReason;
    return value;
  });
  postWorkflowSessionLiveSyncState(workflowSessionForDocument(document), enabled);
  postHostSyncStatus(document, `Live Sync enabled for ${enabled.name}`);
  vscode.window.showInformationMessage(
    `Live Sync enabled for ${enabled.name}. Editor changes sync after save; Shortcuts changes are polled while the editor is open.`
  );
  return { ok: true, enabled: true, ...enabled };
}

async function toggleLiveSync(context, collection) {
  const editor = activeEditorOrThrow();
  return toggleLiveSyncForDocument(context, editor.document, collection);
}

async function offerOpenInShortcuts(uri, message) {
  if (!configOptions().offerOpenInShortcutsAfterSave) {
    vscode.window.showInformationMessage(message);
    return;
  }
  const choice = await vscode.window.showInformationMessage(message, "Open in Shortcuts");
  if (choice === "Open in Shortcuts") {
    await vscode.env.openExternal(uri);
  }
}

async function saveRuntimePlistFromPython(collection) {
  const editor = activeEditorOrThrow();
  const options = configOptions();
  const source = selectedOrFullText(editor);
  const response = collection
    ? await compilePythonDocument(editor.document, source, collection, compileOptionsForExport())
    : await runBridgeCommand("python-to-bplist", source, compileOptionsForExport());
  const defaultUri = siblingShortcutUri(editor.document, options.defaultShortcutExtension);
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      "Shortcut": ["shortcut"],
      "Workflow plist": ["plist"],
      "All files": ["*"],
    },
    saveLabel: "Save Shortcut",
  });
  if (!target) {
    return;
  }
  const bytes = shortcutBytesForTarget(response, target);
  const session = workflowSessionForDocument(editor.document);
  const preserved = exactWorkflowRoundTripBytes(session, source, target.fsPath);
  await vscode.workspace.fs.writeFile(target, preserved || bytes);
  const count = response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  const signed = Boolean(response.shortcut_payload) && path.extname(target.fsPath).toLowerCase() !== ".plist";
  const written = preserved || bytes;
  await offerOpenInShortcuts(target, `Saved ${preserved ? "byte-identical imported shortcut" : signed ? "signed shortcut" : "runtime plist"} (${written.length} bytes${Number.isInteger(count) ? `, ${count} actions` : ""}).`);
}

async function writeSiblingRuntimePlistFromPython(collection) {
  const editor = activeEditorOrThrow();
  const options = configOptions();
  const target = siblingShortcutUri(editor.document, options.defaultShortcutExtension);
  if (!target) {
    await saveRuntimePlistFromPython(collection);
    return;
  }
  let exists = false;
  try {
    await vscode.workspace.fs.stat(target);
    exists = true;
  } catch (_) {
    exists = false;
  }
  if (exists && !options.overwriteSiblingShortcut) {
    const choice = await vscode.window.showWarningMessage(`${path.basename(target.fsPath)} already exists.`, "Overwrite");
    if (choice !== "Overwrite") {
      return;
    }
  }
  const source = selectedOrFullText(editor);
  const response = await compilePythonDocument(editor.document, source, collection, compileOptionsForExport());
  const bytes = shortcutBytesForTarget(response, target);
  const session = workflowSessionForDocument(editor.document);
  const preserved = exactWorkflowRoundTripBytes(session, source, target.fsPath);
  const written = preserved || bytes;
  await vscode.workspace.fs.writeFile(target, written);
  const count = response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  const signed = Boolean(response.shortcut_payload) && path.extname(target.fsPath).toLowerCase() !== ".plist";
  await offerOpenInShortcuts(target, `Wrote ${preserved ? "byte-identical " : signed ? "signed " : ""}${path.basename(target.fsPath)} (${written.length} bytes${Number.isInteger(count) ? `, ${count} actions` : ""}).`);
}

async function validatePython(collection) {
  const editor = activeEditorOrThrow();
  let response;
  try {
    response = await compilePythonDocument(editor.document, editor.document.getText(), collection);
  } catch (error) {
    if (error && error.bridgeResponse) {
      if (compilerTraceFromResponse(error.bridgeResponse)) {
        showCompilerTrace();
      }
      vscode.window.showWarningMessage("Shortcuts Python has validation diagnostics. See Problems for details.");
      return;
    }
    throw error;
  }
  if (compilerTraceFromResponse(response)) {
    showCompilerTrace();
  }
  const count = response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  vscode.window.showInformationMessage(`Shortcuts Python is valid${Number.isInteger(count) ? ` (${count} actions)` : ""}.`);
}

async function openWorkflowPlistFromPython(collection) {
  const editor = activeEditorOrThrow();
  const response = await compilePythonDocument(editor.document, selectedOrFullText(editor), collection);
  const xml = await binaryPlistToXml(bplistBufferFromResponse(response));
  await openText(xml, "xml", "Opened Shortcuts workflow plist");
}

async function pythonToPlistDebugJson(collection) {
  const editor = activeEditorOrThrow();
  const source = selectedOrFullText(editor);
  const response = collection
    ? await compilePythonDocument(editor.document, source, collection)
    : await runBridgeCommand("python-to-bplist", source, compileOptionsForValidation());
  const debugResponse = { ...response };
  if (debugResponse.plist_payload && debugResponse.plist_payload.data) {
    debugResponse.plist_payload = {
      ...debugResponse.plist_payload,
      data: `<base64 ${debugResponse.plist_payload.data.length} chars>`,
    };
  }
  await openText(JSON.stringify(debugResponse, null, 2), "json", "Shortcuts runtime plist debug JSON");
}

async function loadPythonFromPlist(uri) {
  const bytes = await readPlistBytes(uri);
  assertShortcutImportBytes(bytes, uri && uri.fsPath ? path.basename(uri.fsPath) : "input");
  const response = await runBridgeCommand("plist-data-to-python", bytes, configOptions());
  await openText(response.python_code || "", "python", "Loaded Python from Shortcuts plist");
}

async function importICloudShortcutLink() {
  const link = await vscode.window.showInputBox({
    prompt: "Paste an iCloud Shortcuts link",
    placeHolder: "https://www.icloud.com/shortcuts/00000000-0000-0000-0000-000000000000",
    ignoreFocusOut: true,
    validateInput(value) {
      return isICloudShortcutUrlBytes(Buffer.from(String(value || ""), "utf8"))
        ? undefined
        : "Enter a valid https://www.icloud.com/shortcuts/<UUID> link.";
    },
  });
  if (!link) {
    return;
  }
  const bytes = Buffer.from(link.trim(), "utf8");
  const response = await runBridgeCommand("plist-data-to-python", bytes, configOptions());
  await openText(response.python_code || "", "python", "Loaded Python from iCloud Shortcut");
}

async function roundTripPythonThroughPlist(collection) {
  const editor = activeEditorOrThrow();
  const options = compileOptionsForValidation();
  const compiled = collection
    ? await compilePythonDocument(editor.document, selectedOrFullText(editor), collection)
    : await runBridgeCommand("python-to-bplist", selectedOrFullText(editor), options);
  const restored = await runBridgeCommand("plist-data-to-python", bplistBufferFromResponse(compiled), options);
  await openText(restored.python_code || "", "python", "Round-tripped Python through binary plist");
}

async function pickNativeAgentTool(context, fixedKind = "all") {
  const toolName = fixedKind === "tool"
    ? "Actions"
    : fixedKind === "trigger"
      ? "Triggers"
      : "Agent Tools";
  const query = await vscode.window.showInputBox({
    title: `Shortcuts IDE: Retrieve Relevant ${toolName}`,
    prompt: "Search Apple's native ToolRenderer Python interface",
    placeHolder: fixedKind === "trigger" ? "when app opened" : "show a notification, choose from menu",
  });
  if (query === undefined) {
    return undefined;
  }
  let results;
  if ((fixedKind === "tool" || fixedKind === "trigger") && bridgeConnectionState.kind === "connected") {
    const bridgeCommand = fixedKind === "trigger"
      ? "retrieve-relevant-triggers"
      : "retrieve-relevant-actions";
    try {
      setBridgeActivity("validating", `Retrieving relevant ${toolName.toLowerCase()}`);
      const response = await runBridgeCli([bridgeCommand, query, "--limit", "40"], configOptions());
      results = (response.results || []).map((item) => ({
        ...item,
        searchKind: fixedKind,
      }));
      restoreBridgeStatus(`${toolName} search used ${response.tool_visibility_source || response.source || "bridge retrieval"}`);
      logRuntime(`bridge ${bridgeCommand}`, {
        query,
        source: response.source,
        tool_visibility_source: response.tool_visibility_source,
        counts: response.counts,
      });
    } catch (error) {
      logRuntime(`bridge ${bridgeCommand} unavailable; falling back to cached ToolRenderer search`, error && error.message ? error.message : String(error));
      restoreBridgeStatus("Bridge search unavailable; using cached ToolRenderer metadata");
    }
  }
  if (!results) {
    await ensureToolRendererMetadata(context);
    if (toolRendererIndex.byName.size === 0) {
      throw new Error("Native ToolRenderer metadata is not loaded. Connect the bridge to activate a ToolKit and build the metadata cache first.");
    }
    results = searchToolRendererMetadata(toolRendererIndex, query, fixedKind, 40);
  }
  if (results.length === 0) {
    vscode.window.showInformationMessage(`No native Shortcuts ${toolName.toLowerCase()} matched.`);
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    results.map((item) => ({
      label: `${item.searchKind === "trigger" ? "$(zap)" : item.searchKind === "helper" ? "$(symbol-function)" : "$(symbol-method)"} ${item.pythonName}`,
      description: `${item.searchKind === "tool" ? "action" : item.searchKind}${item.displayName ? ` - ${item.displayName}` : ""}`,
      detail: signaturePreview(item),
      item,
    })),
    {
      title: "Shortcuts IDE: Native Agent Tool",
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "Select a native ToolRenderer entry to insert",
    }
  );
  if (!pick) {
    return undefined;
  }
  return pick.item;
}

async function searchNativeAgentTools(context, fixedKind = "all", targetEditor = vscode.window.activeTextEditor) {
  const item = await pickNativeAgentTool(context, fixedKind);
  if (!item) {
    return undefined;
  }
  logRuntime("native agent tool selected", {
    name: item.pythonName,
    kind: item.searchKind,
    score: item.score,
  });
  if (targetEditor && targetEditor.document.languageId === "python") {
    await insertNativeTool(targetEditor, item);
    updateCommandDecorationsForEditor(targetEditor);
    return item;
  }
  await openText(
    [
      item.signature || commandSignatureLabel(item),
      "",
      item.documentation || item.summary || "",
    ].join("\n").trimEnd(),
    "python",
    `Opened native Shortcuts tool ${item.pythonName}`
  );
  return item;
}

function textRangeInLine(document, line, text, fallback) {
  if (!text) {
    return fallback;
  }
  const content = document.lineAt(line).text;
  const start = content.indexOf(text);
  if (start < 0) {
    return fallback;
  }
  return new vscode.Range(line, start, line, start + text.length);
}

function rangeForFixIt(document, diagnostic, fixIt) {
  const line = diagnostic.range.start.line;
  if (fixIt.kind === "replace-word") {
    return document.getWordRangeAtPosition(
      diagnostic.range.start,
      /[A-Za-z_][A-Za-z0-9_]*/
    ) || diagnostic.range;
  }
  if (fixIt.kind === "replace-text" || fixIt.kind === "remove-text") {
    return textRangeInLine(document, line, fixIt.target, diagnostic.range);
  }
  return diagnostic.range;
}

function editForFixIt(document, diagnostic, fixIt) {
  const edit = new vscode.WorkspaceEdit();
  const range = rangeForFixIt(document, diagnostic, fixIt);
  if (fixIt.kind === "replace-word" || fixIt.kind === "replace-text") {
    edit.replace(document.uri, range, fixIt.replacement || "");
  } else if (fixIt.kind === "insert") {
    edit.insert(document.uri, diagnostic.range.start, fixIt.insertion || "");
  } else if (fixIt.kind === "remove-text") {
    edit.delete(document.uri, range);
  } else {
    return undefined;
  }
  return edit;
}

function provideShortcutCodeActions(document, _range, context) {
  const actions = [];
  for (const diagnostic of context.diagnostics) {
    if (diagnostic.source !== "Shortcuts Runtime IDE") {
      continue;
    }
    const parsed = (diagnostic.shortcutsRuntimeIDE && diagnostic.shortcutsRuntimeIDE.parsed) ||
      parseAppleDiagnostic(diagnostic.message);
    for (const fixIt of parsed.fixIts || []) {
      const edit = editForFixIt(document, diagnostic, fixIt);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction(
        `Apply Apple fix-it: ${fixIt.text}`,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diagnostic];
      action.isPreferred = fixIt.index === 1;
      action.edit = edit;
      actions.push(action);
    }
    const copy = new vscode.CodeAction("Copy Shortcuts diagnostic", vscode.CodeActionKind.QuickFix);
    copy.diagnostics = [diagnostic];
    copy.command = {
      command: "shortcutsRuntimeIDE.copyDiagnostic",
      title: "Copy Shortcuts diagnostic",
      arguments: [diagnostic.message],
    };
    actions.push(copy);
  }
  return actions;
}

function commandAtPosition(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) {
    return undefined;
  }
  const name = document.getText(range);
  const item = findToolRendererItem(name);
  return item ? { item, range } : undefined;
}

function provideShortcutCompletions() {
  const items = [];
  for (const helper of toolRendererIndex.helpers || []) {
    const item = new vscode.CompletionItem(helper.pythonName, vscode.CompletionItemKind.Function);
    item.detail = helper.displayName ? `Shortcuts helper: ${helper.displayName}` : "Shortcuts helper";
    item.documentation = commandMetadata(helper);
    item.insertText = new vscode.SnippetString(`${helper.pythonName}($0)`);
    item.sortText = `0_helper_${helper.pythonName}`;
    items.push(item);
  }
  for (const trigger of toolRendererIndex.triggers || []) {
    const item = new vscode.CompletionItem(trigger.pythonName, vscode.CompletionItemKind.Event);
    item.detail = trigger.displayName ? `Shortcuts trigger: ${trigger.displayName}` : "Shortcuts trigger";
    item.documentation = commandMetadata(trigger);
    item.insertText = new vscode.SnippetString(`@${trigger.pythonName}($0)`);
    item.sortText = `0_toolrenderer_${trigger.pythonName}`;
    items.push(item);
  }
  for (const action of toolRendererIndex.actions || []) {
    const item = new vscode.CompletionItem(action.pythonName, vscode.CompletionItemKind.Function);
    item.detail = action.displayName ? `Shortcuts action: ${action.displayName}` : "Shortcuts action";
    item.documentation = commandMetadata(action);
    item.insertText = new vscode.SnippetString(`${action.pythonName}($0)`);
    item.sortText = `1_toolrenderer_${action.pythonName}`;
    items.push(item);
  }
  for (const type of (toolRendererIndex.types || []).slice(0, 2000)) {
    const kind = type.kind === "enum"
      ? vscode.CompletionItemKind.Enum
      : type.kind === "typeAlias"
        ? vscode.CompletionItemKind.TypeParameter
        : vscode.CompletionItemKind.Class;
    const item = new vscode.CompletionItem(type.pythonName, kind);
    item.detail = type.kind === "enum" ? "Shortcuts enum" : "Shortcuts type";
    item.documentation = commandMetadata(type);
    item.sortText = `2_toolrenderer_${type.pythonName}`;
    items.push(item);
    for (const enumCase of (type.cases || []).slice(0, 80)) {
      const caseItem = new vscode.CompletionItem(enumCase.pythonName, vscode.CompletionItemKind.EnumMember);
      caseItem.detail = `Shortcuts enum case: ${type.pythonName}`;
      caseItem.documentation = commandMetadata({ ...enumCase, kind: "enumCase", displayName: enumCase.name });
      caseItem.sortText = `2_case_${enumCase.pythonName}`;
      items.push(caseItem);
    }
  }
  return items;
}

function provideShortcutHover(document, position) {
  const parameter = toolRendererParameterInfoAt(document.getText(), position.line, position.character);
  if (parameter) {
    return new vscode.Hover(
      parameterMetadata(parameter),
      new vscode.Range(position.line, parameter.start, position.line, parameter.end)
    );
  }
  const found = commandAtPosition(document, position);
  if (!found) {
    return undefined;
  }
  return new vscode.Hover(commandMetadata(found.item), found.range);
}

function functionNameBeforePosition(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  let depth = 0;
  for (let index = line.length - 1; index >= 0; index -= 1) {
    const ch = line[index];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const prefix = line.slice(0, index);
      const match = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(prefix);
      return match ? match[1] : undefined;
    }
  }
  return undefined;
}

function activeParameterIndex(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  let depth = 0;
  let commas = 0;
  for (let index = line.length - 1; index >= 0; index -= 1) {
    const ch = line[index];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      commas += 1;
    }
  }
  return commas;
}

function provideShortcutSignatureHelp(document, position) {
  const name = functionNameBeforePosition(document, position);
  const item = findToolRendererItem(name);
  if (!item || !Array.isArray(item.parameters)) {
    return undefined;
  }
  const signature = new vscode.SignatureInformation(commandSignatureLabel(item), commandMetadata(item));
  signature.parameters = item.parameters.map((parameter, index) => {
    const parameterName = parameterLabel(parameter, index);
    const markdown = new vscode.MarkdownString([
      `\`${parameterName}\``,
      isInlineParameter(parameter) ? "Call style: positional inline argument" : "",
      parameter.displayName ? `Display: ${parameter.displayName}` : "",
      parameter.type ? `Type: \`${parameter.type}\`` : "",
      parameter.defaultValue ? `Default: \`${parameter.defaultValue}\`` : "",
      parameter.doc || parameter.summary || "",
    ].filter(Boolean).join("\n\n"));
    return new vscode.ParameterInformation(parameterSignatureLabel(parameter, index), markdown);
  });
  const help = new vscode.SignatureHelp();
  help.signatures = [signature];
  help.activeSignature = 0;
  help.activeParameter = Math.min(activeParameterIndex(document, position), Math.max(0, signature.parameters.length - 1));
  return help;
}

function commandRanges(document, kind) {
  const ranges = [];
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    COMMAND_NAME_RE.lastIndex = 0;
    let match;
    while ((match = COMMAND_NAME_RE.exec(text)) !== null) {
      const item = findToolRendererItem(match[0]);
      if (!item || item.kind !== kind) {
        continue;
      }
      ranges.push(new vscode.Range(line, match.index, line, match.index + match[0].length));
    }
  }
  return ranges;
}

function updateCommandDecorationsForEditor(editor) {
  if (!editor || editor.document.languageId !== "python" || !configOptions().highlightKnownCommands) {
    return;
  }
  if (!actionDecoration || !triggerDecoration) {
    return;
  }
  editor.setDecorations(actionDecoration, commandRanges(editor.document, "action"));
  editor.setDecorations(triggerDecoration, commandRanges(editor.document, "trigger"));
}

function updateCommandDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    updateCommandDecorationsForEditor(editor);
  }
}

async function maybeAutoConvertPlist(document, handledPlists) {
  if (!configOptions().autoConvertPlistOnOpen || !isShortcutPlistUri(document.uri)) {
    return;
  }
  const key = document.uri.toString();
  if (handledPlists.has(key)) {
    return;
  }
  handledPlists.add(key);
  try {
    const response = await runBridgeCommand(
      "plist-data-to-python",
      Buffer.from(await vscode.workspace.fs.readFile(document.uri)),
      configOptions()
    );
    await openText(response.python_code || "", "python", `Converted ${path.basename(document.uri.fsPath)} to Python`);
  } catch (_) {
    // Ignore non-workflow plists during automatic import. Explicit import still reports errors.
  }
}

function command(handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      const diagnostic = error && error.message ? error.message : String(error);
      vscode.window.showErrorMessage(diagnostic);
      if (error && error.bridgeResponse) {
        await openText(JSON.stringify(error.bridgeResponse, null, 2), "json", "Shortcuts runtime diagnostic");
      }
    }
  };
}

function compactValidationResponse(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const copy = JSON.parse(JSON.stringify(payload));
  if (copy.plist_payload && copy.plist_payload.data) {
    copy.plist_payload = {
      ...copy.plist_payload,
      data: `<base64 ${copy.plist_payload.data.length} chars>`,
    };
  }
  if (copy.plist) {
    copy.plist = "<omitted; use Python To Plist Debug JSON for full plist dictionary>";
  }
  if (copy.compiler_trace && copy.compiler_trace.data) {
    copy.compiler_trace = {
      ...copy.compiler_trace,
      data: `<base64 ${copy.compiler_trace.data.length} chars; see Shortcuts Compiler Trace output>`,
    };
  }
  return copy;
}

function customEditorValidationResponse(result) {
  if (result.ok) {
    const response = compactValidationResponse(result.response || {});
    return {
      ok: true,
      source: "Shortcuts Runtime IDE",
      message: "Apple runtime validation succeeded.",
      mode: response.mode,
      workflow: response.workflow,
      plist_summary: response.plist_summary,
      plist_builder: response.plist_builder,
      error_policy_decision_count: response.error_policy_decision_count,
      error_policy_decisions: response.error_policy_decisions,
      raw_response: response,
    };
  }
  const error = result.error;
  const bridgeResponse = compactValidationResponse(error && error.bridgeResponse ? error.bridgeResponse : undefined);
  return {
    ok: false,
    source: "Shortcuts Runtime IDE",
    message: error && error.message ? error.message : String(error || "Validation failed"),
    bridge_response: bridgeResponse,
  };
}

class WorkflowPythonCustomEditorProvider {
  constructor(context, runtimeDiagnosticsCollection) {
    this.context = context;
    this.runtimeDiagnosticsCollection = runtimeDiagnosticsCollection;
  }

  async openCustomDocument(uri) {
    return {
      uri,
      dispose() {},
    };
  }

  async resolveCustomEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true };
    const session = getOrCreateWorkflowSession(this.context, document.uri);
    session.webviews.add(webview);
    webviewPanel.onDidDispose(() => {
      session.webviews.delete(webview);
    });
    const nonce = crypto.randomBytes(18).toString("base64url");
    webview.html = workflowEditorHtml(path.basename(document.uri.fsPath), nonce);

    const performImport = async (options = {}) => {
      try {
        const imported = await importWorkflowPlistToSession(this.context, document.uri);
        postWorkflowSessionRuntimeResponse(imported, "No validation run yet.");
        postWorkflowSessionStatus(imported, `Imported ${path.basename(document.uri.fsPath)}`);
        if (options.openEditor !== false) {
          await showWorkflowPythonEditor(imported, options.editorOptions || {});
        }
        return imported;
      } catch (error) {
        session.lastImportError = error;
        const text = error && error.message ? error.message : String(error);
        const compilerRejected = Boolean(error && error.bridgeResponse);
        const payload = {
          ok: false,
          source: "Shortcuts Runtime IDE",
          message: compilerRejected
            ? "Imported ShortPy failed native validation. Existing editor source was preserved."
            : "Could not import workflow. Connect to the bridge, then retry import.",
          error: text,
        };
        postWorkflowSessionRuntimeResponse(session, payload);
        postWorkflowSessionStatus(
          session,
          compilerRejected ? "Import rejected; editor source preserved." : "Bridge required. Click Connect."
        );
        if (compilerRejected) {
          restoreBridgeStatus(`Imported ShortPy failed native validation; editor source was preserved. ${text}`);
        } else {
          setBridgeConnectionState(
            "disconnected",
            `Shortcuts bridge is not connected. Click Connect or run Shortcuts IDE: Connect To Bridge. ${text}`,
            { session: undefined }
          );
        }
        logRuntime("Workflow import failed", text);
        return undefined;
      }
    };
    let importPromise;
    const importIntoSession = (options = {}) => {
      if (!importPromise) {
        importPromise = performImport(options).finally(() => {
          importPromise = undefined;
        });
      }
      return importPromise;
    };

    const ensureImported = async (options = {}) => {
      if (session.lastImportResponse) {
        return session;
      }
      const imported = await importIntoSession(options);
      if (!imported) {
        throw session.lastImportError || new Error("Workflow has not been imported from the bridge yet.");
      }
      return imported;
    };

    const pythonDocument = async () => vscode.workspace.openTextDocument(session.pythonUri);

    const validatePythonDocument = async () => {
      await ensureImported({ editorOptions: { preserveFocus: true } });
      const pyDocument = await pythonDocument();
      await showWorkflowPythonEditor(session, { preserveFocus: true });
      try {
        const response = await compilePythonDocument(
          pyDocument,
          pyDocument.getText(),
          this.runtimeDiagnosticsCollection
        );
        if (compilerTraceFromResponse(response)) {
          showCompilerTrace();
        }
        return response;
      } catch (error) {
        if (error && error.bridgeResponse) {
          if (compilerTraceFromResponse(error.bridgeResponse)) {
            showCompilerTrace();
          }
          return undefined;
        }
        throw error;
      }
    };

    webview.onDidReceiveMessage(async (message) => {
      try {
        const commandName = message && message.command;
        if (commandName === "openPython") {
          await ensureImported();
          await showWorkflowPythonEditor(session);
          postWorkflowSessionStatus(session, `Editing ${path.basename(session.pythonUri.fsPath)}`);
        } else if (commandName === "searchActions" || commandName === "searchTriggers") {
          await ensureImported({ openEditor: false });
          const editor = await showWorkflowPythonEditor(session);
          const item = await searchNativeAgentTools(
            this.context,
            commandName === "searchTriggers" ? "trigger" : "tool",
            editor
          );
          if (item) {
            postWorkflowSessionStatus(session, `Inserted ${item.pythonName}`);
          }
        } else if (commandName === "validate") {
          await validatePythonDocument();
        } else if (commandName === "export") {
          await ensureImported({ editorOptions: { preserveFocus: true } });
          const pyDocument = await pythonDocument();
          await showWorkflowPythonEditor(session, { preserveFocus: true });
          const source = pyDocument.getText();
          const preserved = exactWorkflowRoundTripBytes(
            session,
            source,
            document.uri.fsPath
          );
          if (preserved) {
            await vscode.workspace.fs.writeFile(document.uri, preserved);
            postWorkflowSessionStatus(session, `Built exact ${path.basename(document.uri.fsPath)} (${preserved.length} bytes)`);
            postWorkflowSessionRuntimeResponse(session, {
              ok: true,
              source: "Shortpy document baseline",
              message: "Editable Shortpy was unchanged; exported the exact imported workflow bytes.",
              byteIdentical: true,
              length: preserved.length,
            });
            restoreBridgeStatus(`Built byte-identical ${path.basename(document.uri.fsPath)}`);
            return;
          }
          const shouldSign = path.extname(document.uri.fsPath).toLowerCase() !== ".plist";
          const response = await compilePythonDocument(
            pyDocument,
            source,
            this.runtimeDiagnosticsCollection,
            shouldSign ? compileOptionsForExport() : compileOptionsForValidation()
          );
          const bytes = shortcutBytesForTarget(response, document.uri);
          await vscode.workspace.fs.writeFile(document.uri, bytes);
          rememberWorkflowBaseline(session, source, bytes, document.uri.fsPath);
          postWorkflowSessionStatus(session, `Built ${bytes.length} bytes to ${path.basename(document.uri.fsPath)}`);
          restoreBridgeStatus(`Built ${path.basename(document.uri.fsPath)}`);
        } else if (commandName === "syncHost") {
          await ensureImported({ editorOptions: { preserveFocus: true } });
          const pyDocument = await pythonDocument();
          const result = await syncPythonDocumentToHost(
            this.context,
            pyDocument,
            this.runtimeDiagnosticsCollection
          );
          if (result) {
            postWorkflowSessionStatus(session, `Synced ${result.name || "shortcut"} with host Shortcuts`);
            postWorkflowSessionRuntimeResponse(session, {
              ok: true,
              source: "Headless Shortcuts",
              operation: result.operation,
              workflowID: result.workflowID,
              name: result.name,
            });
          }
        } else if (commandName === "toggleLiveSync") {
          await ensureImported({ editorOptions: { preserveFocus: true } });
          const pyDocument = await pythonDocument();
          const result = await toggleLiveSyncForDocument(
            this.context,
            pyDocument,
            this.runtimeDiagnosticsCollection
          );
          if (result) {
            postWorkflowSessionRuntimeResponse(session, {
              ok: result.ok !== false,
              source: "Headless Shortcuts",
              operation: "live-sync",
              enabled: result.enabled,
              workflowID: result.workflowID,
              name: result.name,
            });
          }
        } else if (commandName === "openHostShortcutEditor") {
          const result = await openHostShortcutEditorLink(
            this.context,
            session.workflowUri.toString(),
            path.basename(session.workflowUri.fsPath).replace(/\.(?:shortcut|plist)$/i, "")
          );
          postWorkflowSessionStatus(session, `Opened ${result.name} in Shortcuts`);
          postWorkflowSessionRuntimeResponse(session, {
            ok: true,
            source: "Shortcuts URL scheme",
            operation: "open-shortcut-editor",
            workflowID: result.workflowID,
            name: result.name,
          });
        } else if (commandName === "import") {
          const pyDocument = await pythonDocument();
          const baseline = session.workflowBaseline && session.workflowBaseline.source;
          if (baseline !== undefined && pyDocument.getText() !== baseline) {
            const choice = await vscode.window.showWarningMessage(
              "Reloading will replace the current Shortpy editor contents with a fresh conversion from the shortcut.",
              { modal: true },
              "Reload Python"
            );
            if (choice !== "Reload Python") {
              return;
            }
          }
          await importIntoSession();
        } else if (commandName === "toggleBridge") {
          if (bridgeConnectionState.kind === "connected") {
            await disconnectBridge();
            postWorkflowSessionStatus(session, "Disconnected and shut down the Shortpy simulator");
          } else if (bridgeConnectionState.kind !== "connecting" && bridgeConnectionState.kind !== "disconnecting") {
            const status = await connectBridge();
            postWorkflowSessionStatus(session, `Connected ${status.version || ""}`.trim());
            await ensureImported();
          }
        } else if (commandName === "loadToolkit") {
          await loadToolkitSqlite(this.context);
        }
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        restoreBridgeStatus(text);
        postWorkflowSessionRuntimeResponse(session, customEditorValidationResponse({ ok: false, error }));
        postWorkflowSessionStatus(session, text);
        vscode.window.showErrorMessage(text);
      }
    });

    postWorkflowSessionMessage(session, bridgeStateMessage());
    await postToolkitState(this.context);
    postWorkflowSessionLiveSyncState(
      session,
      hostShortcutLinks(this.context)[session.workflowUri.toString()]
    );
    await importIntoSession();
  }
}

function activate(context) {
  activeExtensionContext = context;
  extensionGlobalStoragePath = context.globalStorageUri.fsPath;
  activeToolkitSqlitePath = context.globalState.get(TOOLKIT_SQLITE_STATE_KEY, "");
  extensionVersion = context.extension && context.extension.packageJSON && context.extension.packageJSON.version
    ? context.extension.packageJSON.version
    : "dev";
  runtimeLog = vscode.window.createOutputChannel("Shortcuts Runtime IDE");
  compilerTraceLog = vscode.window.createOutputChannel("Shortcuts Compiler Trace");
  bridgeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  setBridgeConnectionState("disconnected", "Shortcuts Runtime IDE bridge is not connected.");
  actionDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "500",
  });
  triggerDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "600",
  });
  const diagnostics = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDE");
  shortpyDiagnosticsCollection = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDEToolRenderer");
  const handledPlists = new Set();
  const visibleCommandHandlers = {
    connectBridge: () => connectBridge(),
    disconnectBridge: () => disconnectBridge(),
    saveRuntimePlistFromPython: () => saveRuntimePlistFromPython(diagnostics),
    writeSiblingRuntimePlistFromPython: () => writeSiblingRuntimePlistFromPython(diagnostics),
    validatePython: () => validatePython(diagnostics),
    showCompilerTrace: () => showCompilerTrace(),
    syncToHostShortcuts: () => syncToHostShortcuts(context, diagnostics),
    toggleLiveSync: () => toggleLiveSync(context, diagnostics),
    openHostShortcutEditor: () => openHostShortcutEditor(context),
    openWorkflowPlistFromPython: () => openWorkflowPlistFromPython(diagnostics),
    pythonToPlistDebugJson: () => pythonToPlistDebugJson(diagnostics),
    loadPythonFromPlist: loadPythonFromPlist,
    importICloudShortcutLink: importICloudShortcutLink,
    searchActions: () => searchNativeAgentTools(context, "tool"),
    searchTriggers: () => searchNativeAgentTools(context, "trigger"),
    loadToolkitSqlite: () => loadToolkitSqlite(context),
  };
  const visibleCommandRegistrations = VISIBLE_COMMANDS.map((definition) => {
    const handler = visibleCommandHandlers[definition.key];
    if (!handler) {
      throw new Error(`Missing command handler for ${definition.key}`);
    }
    return vscode.commands.registerCommand(definition.command, command(handler));
  });
  context.subscriptions.push(
    runtimeLog,
    compilerTraceLog,
    bridgeStatusBar,
    actionDecoration,
    triggerDecoration,
    diagnostics,
    shortpyDiagnosticsCollection,
    vscode.window.registerCustomEditorProvider(
      CUSTOM_EDITOR_VIEW_TYPE,
      new WorkflowPythonCustomEditorProvider(context, diagnostics),
      { supportsMultipleEditorsPerDocument: false }
    ),
    ...visibleCommandRegistrations,
    vscode.commands.registerCommand("shortcutsRuntimeIDE.refreshToolMetadata", command(() => refreshToolMetadata(context, true))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.refreshToolRendererInterface", command(async () => {
      const metadata = await refreshNativeToolRendererInterface(context, true, { live: true });
      logRuntime("Live ToolRenderer refresh completed; relaunch bridge before compile if runtime calls start timing out.", {
        counts: metadata.counts || {},
        source: metadata.source,
      });
      vscode.window.showWarningMessage("Live ToolRenderer refresh can leave the simulator bridge unable to compile until Shortcuts is relaunched.");
    })),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.roundTripPythonThroughPlist", command(() => roundTripPythonThroughPlist(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.searchNativeAgentTools", command(() => searchNativeAgentTools(context))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.copyDiagnostic", command(async (message) => {
      await vscode.env.clipboard.writeText(String(message || ""));
      vscode.window.showInformationMessage("Copied Shortcuts diagnostic.");
    })),
    vscode.languages.registerCodeActionsProvider(
      { language: "python", scheme: "*" },
      { provideCodeActions: provideShortcutCodeActions },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.languages.registerCompletionItemProvider(
      { language: "python", scheme: "*" },
      { provideCompletionItems: provideShortcutCompletions },
      "_"
    ),
    vscode.languages.registerHoverProvider(
      { language: "python", scheme: "*" },
      { provideHover: provideShortcutHover }
    ),
    vscode.languages.registerSignatureHelpProvider(
      { language: "python", scheme: "*" },
      { provideSignatureHelp: provideShortcutSignatureHelp },
      "(",
      ","
    ),
    vscode.window.onDidChangeActiveTextEditor(updateCommandDecorationsForEditor)
  );
  primeToolRendererMetadata(context).catch((error) => {
    logRuntime("ToolRenderer metadata unavailable", error && error.message ? error.message : String(error));
  });
  probeBridgeStatusPassive().catch((error) => {
    logRuntime("Passive bridge status probe failed", error && error.message ? error.message : String(error));
  });
  liveSyncTimer = setInterval(() => {
    pollLiveSyncDocuments(context, diagnostics).catch((error) => {
      logRuntime("Live Sync poll failed", error && error.message ? error.message : String(error));
    });
  }, configOptions().liveSyncPollIntervalMs);
  context.subscriptions.push({
    dispose() {
      if (liveSyncTimer) {
        clearInterval(liveSyncTimer);
        liveSyncTimer = undefined;
      }
    },
  });
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId !== "python") {
      return;
    }
    if (programmaticHostPullDocuments.has(document.uri.toString())) {
      return;
    }
    const { link } = hostShortcutLinkForDocument(context, document);
    if (link && link.liveSync && !link.liveSyncPausedReason) {
      runLiveSyncForDocument(context, document, diagnostics, "save").catch(() => {});
    } else if (configOptions().validateOnSave) {
      compilePythonDocument(document, document.getText(), diagnostics).catch(() => {});
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const options = configOptions();
    setShortpyDiagnostics(shortpyDiagnosticsCollection, event.document);
    updateCommandDecorationsForEditor(vscode.window.visibleTextEditors.find((editor) => editor.document === event.document));
    const key = event.document.uri.toString();
    if (programmaticHostPullDocuments.has(key)) {
      clearTimeout(validateTimers.get(key));
      validateTimers.delete(key);
      return;
    }
    if (!options.validateOnType || event.document.languageId !== "python") {
      return;
    }
    clearTimeout(validateTimers.get(key));
    validateTimers.set(key, setTimeout(() => {
      compilePythonDocument(event.document, event.document.getText(), diagnostics).catch(() => {});
      updateCommandDecorations();
    }, options.validateDebounceMs));
  }));
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(updateCommandDecorations));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
    maybeAutoConvertPlist(document, handledPlists).catch(() => {});
    setShortpyDiagnostics(shortpyDiagnosticsCollection, document);
    updateCommandDecorations();
  }));
  for (const document of vscode.workspace.textDocuments) {
    maybeAutoConvertPlist(document, handledPlists).catch(() => {});
    setShortpyDiagnostics(shortpyDiagnosticsCollection, document);
  }
  updateCommandDecorations();
}

function deactivate() {
  if (liveSyncTimer) {
    clearInterval(liveSyncTimer);
    liveSyncTimer = undefined;
  }
  for (const timer of validateTimers.values()) {
    clearTimeout(timer);
  }
  validateTimers.clear();
  programmaticHostPullDocuments.clear();
}

module.exports = {
  activate,
  deactivate,
};
