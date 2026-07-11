"use strict";

const path = require("path");
const crypto = require("crypto");
const vscode = require("vscode");
const {
  binaryPlistToXml,
  bplistBufferFromResponse,
  ensureBridgeLaunched,
  runBridgeCli,
  runBridgeCommand,
  runBridgeStatus,
  shortcutBufferFromResponse,
  validateImportedPythonSource,
} = require("./bridge");
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
  syncHostShortcut,
} = require("./hostShortcuts");
const {
  CUSTOM_EDITOR_VIEW_TYPE,
  VISIBLE_COMMANDS,
  customEditorActions,
} = require("./commandRegistry");
const {
  exactWorkflowRoundTripBytes,
  rememberWorkflowBaseline,
} = require("./workflowRoundTrip");

const COMMAND_NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const TOOLKIT_SQLITE_STATE_KEY = "shortcutsRuntimeIDE.toolkitSqlitePath";
const HOST_SHORTCUT_LINKS_STATE_KEY = "shortcutsRuntimeIDE.hostShortcutLinks.v1";

let runtimeLog;
let toolRendererIndex = indexToolRendererMetadata({});
let toolRendererMetadataPath;
let actionDecoration;
let triggerDecoration;
let bridgeStatusBar;
let shortpyDiagnosticsCollection;
let missingToolRendererCacheReported = false;
let activeBridgeCtlPath = "";
let activeToolkitSqlitePath = "";
let extensionGlobalStoragePath = "";
let extensionVersion = "dev";
const workflowSessionsByWorkflowUri = new Map();
const workflowSessionsByPythonUri = new Map();

function configOptions() {
  const config = vscode.workspace.getConfiguration("shortcutsRuntimeIDE");
  return {
    bridgeCtlPath: config.get("bridgeCtlPath") || undefined,
    activeBridgeCtlPath,
    globalStoragePath: extensionGlobalStoragePath,
    extensionVersion,
    toolRendererMetadataPath: config.get("toolRendererMetadataPath") || undefined,
    refreshToolRendererInterfaceOnActivation: config.get("refreshToolRendererInterfaceOnActivation") !== false,
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

function setBridgeStatus(kind, detail) {
  if (!bridgeStatusBar) {
    return;
  }
  if (kind === "connected") {
    bridgeStatusBar.text = "$(plug) Shortcuts: connected";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "connecting") {
    bridgeStatusBar.text = "$(sync~spin) Shortcuts: connecting";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "building") {
    bridgeStatusBar.text = "$(tools) Shortcuts: building bridge";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "toolkit") {
    bridgeStatusBar.text = "$(database) Shortcuts: loading toolkit";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "booting") {
    bridgeStatusBar.text = "$(device-mobile) Shortcuts: booting simulator";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "launching") {
    bridgeStatusBar.text = "$(rocket) Shortcuts: launching";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "validating") {
    bridgeStatusBar.text = "$(sync~spin) Shortcuts: validating";
    bridgeStatusBar.backgroundColor = undefined;
  } else if (kind === "error") {
    bridgeStatusBar.text = "$(error) Shortcuts: error";
    bridgeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  } else {
    bridgeStatusBar.text = "$(debug-disconnect) Shortcuts: disconnected";
    bridgeStatusBar.backgroundColor = undefined;
  }
  bridgeStatusBar.tooltip = detail || "Shortcuts Runtime IDE bridge";
  bridgeStatusBar.show();
}

function bridgeStatusDetail(status) {
  return `Bridge ${status.version || "unknown"} at ${status.socket_path || "auto socket"}`;
}

function defaultHostToolkitSqlitePath() {
  const home = process.env.HOME || "";
  return home ? path.join(home, "Library", "Shortcuts", "ToolKit", "Tools-active") : "";
}

function applyBridgeProgress(event) {
  const detail = event && event.message ? event.message : "Connecting Shortcuts bridge";
  const kind = event && event.kind ? event.kind : "connecting";
  setBridgeStatus(kind, detail);
  logRuntime("bridge bootstrap", event || {});
}

async function probeBridgeStatusPassive() {
  try {
    const status = await runBridgeStatus(configOptions());
    setBridgeStatus("connected", bridgeStatusDetail(status));
    logRuntime("Bridge status", status);
    return status;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setBridgeStatus("disconnected", `Shortcuts bridge is not connected. Run Shortcuts IDE: Connect To Bridge. ${message}`);
    logRuntime("Bridge status unavailable", message);
    return undefined;
  }
}

async function connectBridge(options = {}) {
  setBridgeStatus("connecting", "Checking Shortcuts bridge status");
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
    const launched = await ensureBridgeLaunched({
      ...bridgeOptions,
    }, (event) => {
      applyBridgeProgress(event);
      progress.report({ message: event && event.message ? event.message : "Connecting" });
    });
    activeBridgeCtlPath = launched.bridgeCtlPath || activeBridgeCtlPath;
    setBridgeStatus("connected", bridgeStatusDetail(launched.status));
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
    setBridgeStatus("error", message);
    logRuntime("Bridge connect failed", message);
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
  return (parameters || []).map((parameter, offset) => {
    const value = snippetPlaceholder(startIndex + offset, parameterSnippetValue(parameter));
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
  if (item.kind === "trigger" || item.searchKind === "trigger") {
    const args = callArgumentsSnippet(parameters, 1);
    return new vscode.SnippetString(`${indent}@${item.pythonName}(${args})\n${indent}$0`);
  }
  const args = callArgumentsSnippet(parameters, 1);
  return new vscode.SnippetString(`${actionPrefix}${item.pythonName}(${args})$0`);
}

function plainArgumentValue(parameter) {
  if (parameter.defaultValue && parameter.defaultValue !== "None") {
    return parameter.defaultValue;
  }
  const type = String(parameter.type || "");
  if (/bool/i.test(type)) {
    return "False";
  }
  if (/int|double|float|number/i.test(type)) {
    return "0";
  }
  if (/array|list/i.test(type)) {
    return "[]";
  }
  if (/Resolved|Entity|App|Focus/i.test(type)) {
    return "[{\"Bundle Identifier\": \"com.apple.shortcuts\", \"Name\": \"Shortcuts\"}]";
  }
  return "None";
}

function nativeToolPlainText(item) {
  const args = (Array.isArray(item.parameters) ? item.parameters : [])
    .map((parameter, index) => {
      const value = plainArgumentValue(parameter);
      if (isInlineParameter(parameter)) {
        return value;
      }
      return `${parameterLabel(parameter, index)}=${value}`;
    })
    .join(", ");
  if (item.kind === "trigger" || item.searchKind === "trigger") {
    return `@${item.pythonName}(${args})\n`;
  }
  return `${item.pythonName}(${args})`;
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
  await context.globalState.update(TOOLKIT_SQLITE_STATE_KEY, activeToolkitSqlitePath);
  setBridgeStatus("toolkit", `Loading ToolKit sqlite ${activeToolkitSqlitePath}`);
  logRuntime("ToolKit sqlite selected", activeToolkitSqlitePath);
  const status = await connectBridge({
    forceLaunch: true,
    toolkitSqlitePath: activeToolkitSqlitePath,
  });
  try {
    await refreshToolMetadata(context, false);
  } catch (error) {
    logRuntime("ToolRenderer metadata refresh after ToolKit load failed", error && error.message ? error.message : String(error));
  }
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
  const options = configOptions();
  const cached = await loadCachedToolRendererMetadata(context);
  if (cached) {
    return;
  }
  if (options.refreshToolRendererInterfaceOnActivation) {
    await refreshNativeToolRendererInterface(context, false, {
      live: false,
      allowLiveFallback: false,
    });
    return;
  }
  throw new Error("ToolRenderer metadata is not cached. Run Shortcuts IDE: Refresh Native ToolRenderer Interface once while the simulator bridge is available.");
}

async function primeToolRendererMetadata(context) {
  const options = configOptions();
  const cached = await loadCachedToolRendererMetadata(context);
  if (!options.refreshToolRendererInterfaceOnActivation) {
    if (!cached && !missingToolRendererCacheReported) {
      missingToolRendererCacheReported = true;
      vscode.window.showWarningMessage("Shortcuts ToolRenderer metadata is not cached. Run Shortcuts IDE: Refresh Native ToolRenderer Interface once while the simulator bridge is available.");
    }
    return;
  }
  refreshNativeToolRendererInterface(context, false, {
    live: false,
    allowLiveFallback: false,
  }).then((metadata) => {
    logRuntime("Background ToolRenderer metadata refresh completed", metadata.counts || {});
  }).catch((error) => {
    logRuntime("Background ToolRenderer metadata refresh failed", error && error.message ? error.message : String(error));
    if (!cached && !missingToolRendererCacheReported) {
      missingToolRendererCacheReported = true;
      vscode.window.showWarningMessage("Shortcuts ToolRenderer metadata must be refreshed once before hovers, completions, and Shortpy diagnostics are available offline.");
    }
  });
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
    setBridgeStatus("validating", "Validating");
    if (prepared.session) {
      postWorkflowSessionRuntimeResponse(prepared.session, "Validating with Apple runtime...");
      postWorkflowSessionStatus(prepared.session, `Validating ${path.basename(prepared.session.workflowUri.fsPath)}`);
    }
    logRuntime("compile python-to-bplist", { uri: document.uri.toString(), bytes: Buffer.byteLength(prepared.source, "utf8") });
    const response = await runBridgeCommand("python-to-bplist", prepared.source, bridgeOptions);
    setSuccessDiagnostics(collection, document, prepared.visibleSource, response);
    const actions = response && response.plist_summary && response.plist_summary.WFWorkflowActions_count;
    logRuntime("compile ok", { actions, compiledTrigger: response && response.plist_builder && response.plist_builder.unifiedAutomationTriggers_serialized });
    setBridgeStatus("connected", `Valid (${Number.isInteger(actions) ? `${actions} actions` : "connected"})`);
    if (prepared.session) {
      postWorkflowSessionRuntimeResponse(prepared.session, customEditorValidationResponse({ ok: true, response }));
      postWorkflowSessionStatus(prepared.session, `Validated ${Number.isInteger(actions) ? `${actions} actions` : "workflow"}`);
    }
    return response;
  } catch (error) {
    setCompilerDiagnostic(collection, document, error);
    logRuntime("compile diagnostic", error && error.message ? error.message : String(error));
    setBridgeStatus("error", "Validation error");
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

async function ensureBridgeConnectedForHostSync() {
  try {
    return await runBridgeStatus(configOptions());
  } catch (_) {
    return connectBridge();
  }
}

async function updateHostShortcutLink(context, linkKey, link) {
  await context.globalState.update(HOST_SHORTCUT_LINKS_STATE_KEY, {
    ...hostShortcutLinks(context),
    [linkKey]: link,
  });
}

async function removeHostShortcutLink(context, linkKey) {
  const links = { ...hostShortcutLinks(context) };
  delete links[linkKey];
  await context.globalState.update(HOST_SHORTCUT_LINKS_STATE_KEY, links);
  const uris = hostSyncSnapshotUris(context, linkKey);
  try {
    await vscode.workspace.fs.delete(uris.directory, { recursive: true, useTrash: false });
  } catch (_) {
    // Missing baseline state is already equivalent to an unlinked document.
  }
}

async function replacePythonDocumentSource(document, source) {
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

async function syncPythonDocumentToHost(context, document, collection) {
  if (!document || document.languageId !== "python") {
    throw new Error("Open a Shortpy Python editor before syncing to host Shortcuts.");
  }
  await ensureBridgeConnectedForHostSync();

  const linkKey = hostShortcutLinkKey(document);
  const links = hostShortcutLinks(context);
  const link = links[linkKey];
  let name = link && link.name;
  if (!link) {
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

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: link ? `Syncing ${link.name} with Shortcuts` : `Creating ${name} in Shortcuts`,
    cancellable: false,
  }, async (progress) => {
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
      const updatedLink = {
        workflowID: result.workflowID,
        name: hostExport.name || result.name || name,
        sourceHash: hashSource(source),
        hostHash: hostExport.hostHash,
        updatedAt: new Date().toISOString(),
      };
      await writeHostSyncSnapshots(context, linkKey, hostExport.plist, compiledPlist);
      await updateHostShortcutLink(context, linkKey, updatedLink);
      return updatedLink;
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
      setBridgeStatus("connected", `Synced ${updatedLink.name} with host Shortcuts`);
      logRuntime("host sync push complete", {
        operation: result.operation,
        workflowID: result.workflowID,
        name: updatedLink.name,
      });
      vscode.window.showInformationMessage(
        `${result.operation === "create" ? "Created" : "Updated"} ${updatedLink.name} in Shortcuts.`
      );
      return { ...result, name: updatedLink.name, direction: "push" };
    };
    const pullHost = async (hostExport) => {
      progress.report({ message: "Converting Shortcuts version to Shortpy" });
      const imported = await hostPythonSource(hostExport);
      await replacePythonDocumentSource(document, imported.source);
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
      setBridgeStatus("connected", `Pulled ${updatedLink.name} from host Shortcuts`);
      logRuntime("host sync pull complete", {
        workflowID: updatedLink.workflowID,
        name: updatedLink.name,
      });
      vscode.window.showInformationMessage(`Updated the editor from ${updatedLink.name} in Shortcuts.`);
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
      vscode.window.showInformationMessage(`Initialized two-way sync for ${updatedLink.name}.`);
      return { ok: true, operation: "initialize", ...updatedLink };
    }
    if (action === "none") {
      if (currentHost.name && currentHost.name !== link.name) {
        await updateHostShortcutLink(context, linkKey, { ...link, name: currentHost.name });
      }
      setBridgeStatus("connected", `${currentHost.name || link.name} is in sync`);
      vscode.window.showInformationMessage(`${currentHost.name || link.name} is already in sync.`);
      return { ok: true, operation: "none", workflowID: link.workflowID, name: currentHost.name || link.name };
    }
    if (action === "push") {
      return pushLocal(link, currentHost);
    }
    if (action === "pull") {
      return pullHost(currentHost);
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
  });
}

async function syncToHostShortcuts(context, collection) {
  const editor = activeEditorOrThrow();
  return syncPythonDocumentToHost(context, editor.document, collection);
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
      vscode.window.showWarningMessage("Shortcuts Python has validation diagnostics. See Problems for details.");
      return;
    }
    throw error;
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
  if (fixedKind === "tool" || fixedKind === "trigger") {
    const bridgeCommand = fixedKind === "trigger"
      ? "retrieve-relevant-triggers"
      : "retrieve-relevant-actions";
    try {
      setBridgeStatus("validating", `Retrieving relevant ${toolName.toLowerCase()}`);
      const response = await runBridgeCli([bridgeCommand, query, "--limit", "40"], configOptions());
      results = (response.results || []).map((item) => ({
        ...item,
        searchKind: fixedKind,
      }));
      setBridgeStatus("connected", `${toolName} search used ${response.tool_visibility_source || response.source || "bridge retrieval"}`);
      logRuntime(`bridge ${bridgeCommand}`, {
        query,
        source: response.source,
        tool_visibility_source: response.tool_visibility_source,
        counts: response.counts,
      });
    } catch (error) {
      logRuntime(`bridge ${bridgeCommand} unavailable; falling back to cached ToolRenderer search`, error && error.message ? error.message : String(error));
      setBridgeStatus("error", "Bridge search unavailable; using cached ToolRenderer metadata");
    }
  }
  if (!results) {
    await ensureToolRendererMetadata(context);
    if (toolRendererIndex.byName.size === 0) {
      throw new Error("Native ToolRenderer metadata is not loaded. Run Refresh Native ToolRenderer Interface first.");
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

async function searchNativeAgentTools(context, fixedKind = "all", insert = true) {
  const item = await pickNativeAgentTool(context, fixedKind);
  if (!item) {
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  logRuntime("native agent tool selected", {
    name: item.pythonName,
    kind: item.searchKind,
    score: item.score,
  });
  if (insert && editor && editor.document.languageId === "python") {
    await editor.insertSnippet(nativeToolSnippet(item, editor), editor.selection);
    updateCommandDecorationsForEditor(editor);
    return item;
  }
  if (insert) {
    await openText(
      [
        item.signature || commandSignatureLabel(item),
        "",
        item.documentation || item.summary || "",
      ].join("\n").trimEnd(),
      "python",
      `Opened native Shortcuts tool ${item.pythonName}`
    );
  }
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

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function customEditorDiagnostics(source) {
  return collectShortpyDiagnostics(source).map((item) => ({
    ...item,
    source: "Shortcuts ToolRenderer",
  }));
}

function customEditorRuntimeDiagnostic(error) {
  const message = error && error.message ? error.message : String(error);
  const parsed = parseAppleDiagnostic(message);
  const line = parsed && parsed.line ? Math.max(0, Number(parsed.line) - 1) : 0;
  const start = parsed && parsed.column ? Math.max(0, Number(parsed.column) - 1) : 0;
  return {
    source: "Shortcuts Runtime IDE",
    severity: "error",
    code: parsed.code || (error && error.bridgeResponse && error.bridgeResponse.error_type) || "runtimeDiagnostic",
    message,
    line,
    start,
    end: start + 1,
    hints: parsed.hints,
    fixIts: parsed.fixIts,
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

function workflowEditorToolbarHtml() {
  return customEditorActions()
    .map((action) => {
      const classes = action.primary ? " class=\"primary\"" : "";
      return `<button${classes} data-command="${htmlEscape(action.message)}">${htmlEscape(action.label)}</button>`;
    })
    .join("\n    ");
}

function workflowEditorHtml(fileName, pythonPath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      margin: 0;
    }
    .toolbar {
      align-items: center;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    button {
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      padding: 4px 8px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .status {
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      overflow: auto;
      padding: 16px;
    }
    .panel {
      max-width: 980px;
    }
    .label {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin: 0 0 4px;
    }
    .path {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-sideBar-border);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.35;
      margin: 0 0 16px;
      overflow: auto;
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .runtimeResponse {
      margin-top: 12px;
    }
    .runtimeResponse h2 {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .runtimeResponse pre {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-sideBar-border);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.35;
      margin: 8px 0 0;
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
    ${workflowEditorToolbarHtml()}
    <div class="status" id="status">${htmlEscape(fileName)}</div>
  </div>
  <div class="body">
    <div class="panel">
      <div class="label">Native Python editor backing this workflow</div>
      <pre class="path">${htmlEscape(pythonPath)}</pre>
      <div class="runtimeResponse">
        <h2>Runtime Response</h2>
        <pre id="runtimeResponse">No validation run yet.</pre>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const status = document.getElementById("status");
    const runtimeResponse = document.getElementById("runtimeResponse");
    function renderRuntimeResponse(payload) {
      if (!payload) {
        runtimeResponse.textContent = "No validation run yet.";
        return;
      }
      runtimeResponse.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    }
    function post(command) {
      vscode.postMessage({ command });
    }
    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => post(button.dataset.command));
    }
    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.command === "runtimeResponse") {
        renderRuntimeResponse(message.payload);
      } else if (message.command === "status") {
        status.textContent = message.text || "";
      }
    });
  </script>
</body>
</html>`;
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
    webview.html = workflowEditorHtml(path.basename(document.uri.fsPath), session.pythonUri.fsPath);

    const importIntoSession = async (options = {}) => {
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
        setBridgeStatus(
          compilerRejected ? "error" : "disconnected",
          compilerRejected
            ? `Imported ShortPy failed native validation; editor source was preserved. ${text}`
            : `Shortcuts bridge is not connected. Click the status bar or run Shortcuts IDE: Connect To Bridge. ${text}`
        );
        logRuntime("Workflow import failed", text);
        return undefined;
      }
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

    await importIntoSession();

    const pythonDocument = async () => vscode.workspace.openTextDocument(session.pythonUri);

    const validatePythonDocument = async () => {
      await ensureImported({ editorOptions: { preserveFocus: true } });
      const pyDocument = await pythonDocument();
      await showWorkflowPythonEditor(session, { preserveFocus: true });
      try {
        return await compilePythonDocument(pyDocument, pyDocument.getText(), this.runtimeDiagnosticsCollection);
      } catch (error) {
        if (error && error.bridgeResponse) {
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
            postWorkflowSessionStatus(session, `Preserved exact ${path.basename(document.uri.fsPath)} (${preserved.length} bytes)`);
            postWorkflowSessionRuntimeResponse(session, {
              ok: true,
              source: "Shortpy document baseline",
              message: "Editable Shortpy was unchanged; exported the exact imported workflow bytes.",
              byteIdentical: true,
              length: preserved.length,
            });
            setBridgeStatus("connected", `Exported byte-identical ${path.basename(document.uri.fsPath)}`);
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
          postWorkflowSessionStatus(session, `Exported ${bytes.length} bytes to ${path.basename(document.uri.fsPath)}`);
          setBridgeStatus("connected", `Exported ${path.basename(document.uri.fsPath)}`);
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
        } else if (commandName === "import") {
          await importIntoSession();
        } else if (commandName === "connect") {
          const status = await connectBridge();
          postWorkflowSessionStatus(session, `Connected ${status.version || ""}`.trim());
          await importIntoSession();
        } else if (commandName === "searchActions") {
          await ensureImported({ editorOptions: { preserveFocus: true } });
          await showWorkflowPythonEditor(session);
          await searchNativeAgentTools(this.context, "tool", true);
        } else if (commandName === "searchTriggers") {
          await ensureImported({ editorOptions: { preserveFocus: true } });
          await showWorkflowPythonEditor(session);
          await searchNativeAgentTools(this.context, "trigger", true);
        } else if (commandName === "refreshMetadata") {
          await refreshToolMetadata(this.context, false);
          await ensureImported({ editorOptions: { preserveFocus: true } });
          const pyDocument = await pythonDocument();
          setShortpyDiagnostics(shortpyDiagnosticsCollection, pyDocument);
          updateCommandDecorations();
          postWorkflowSessionStatus(session, "Refreshed ToolRenderer metadata");
        } else if (commandName === "loadToolkit") {
          await loadToolkitSqlite(this.context);
          await importIntoSession({ editorOptions: { preserveFocus: true } });
        }
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        setBridgeStatus("error", text);
        postWorkflowSessionRuntimeResponse(session, customEditorValidationResponse({ ok: false, error }));
        postWorkflowSessionStatus(session, text);
        vscode.window.showErrorMessage(text);
      }
    });
  }
}

function activate(context) {
  extensionGlobalStoragePath = context.globalStorageUri.fsPath;
  activeToolkitSqlitePath = context.globalState.get(TOOLKIT_SQLITE_STATE_KEY, "");
  extensionVersion = context.extension && context.extension.packageJSON && context.extension.packageJSON.version
    ? context.extension.packageJSON.version
    : "dev";
  runtimeLog = vscode.window.createOutputChannel("Shortcuts Runtime IDE");
  bridgeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  bridgeStatusBar.command = "shortcutsRuntimeIDE.connectBridge";
  setBridgeStatus("disconnected", "Shortcuts Runtime IDE bridge is not connected.");
  actionDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "500",
  });
  triggerDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "600",
  });
  const diagnostics = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDE");
  shortpyDiagnosticsCollection = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDEToolRenderer");
  const handledPlists = new Set();
  const validateTimers = new Map();
  const visibleCommandHandlers = {
    connectBridge: () => connectBridge(),
    saveRuntimePlistFromPython: () => saveRuntimePlistFromPython(diagnostics),
    writeSiblingRuntimePlistFromPython: () => writeSiblingRuntimePlistFromPython(diagnostics),
    validatePython: () => validatePython(diagnostics),
    syncToHostShortcuts: () => syncToHostShortcuts(context, diagnostics),
    openWorkflowPlistFromPython: () => openWorkflowPlistFromPython(diagnostics),
    pythonToPlistDebugJson: () => pythonToPlistDebugJson(diagnostics),
    loadPythonFromPlist: loadPythonFromPlist,
    importICloudShortcutLink: importICloudShortcutLink,
    searchActions: () => searchNativeAgentTools(context, "tool"),
    searchTriggers: () => searchNativeAgentTools(context, "trigger"),
    refreshToolMetadata: () => refreshToolMetadata(context, true),
    loadToolkitSqlite: () => loadToolkitSqlite(context),
    refreshToolRendererInterface: async () => {
      const metadata = await refreshNativeToolRendererInterface(context, true, { live: true });
      logRuntime("Live ToolRenderer refresh completed; relaunch bridge before compile if runtime calls start timing out.", {
        counts: metadata.counts || {},
        source: metadata.source,
      });
      vscode.window.showWarningMessage("Live ToolRenderer refresh can leave the simulator bridge unable to compile until Shortcuts is relaunched.");
    },
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
    )
  );
  primeToolRendererMetadata(context).catch((error) => {
    logRuntime("ToolRenderer metadata unavailable", error && error.message ? error.message : String(error));
  });
  probeBridgeStatusPassive().catch((error) => {
    logRuntime("Passive bridge status probe failed", error && error.message ? error.message : String(error));
  });
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (!configOptions().validateOnSave || document.languageId !== "python") {
      return;
    }
    compilePythonDocument(document, document.getText(), diagnostics).catch(() => {});
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const options = configOptions();
    setShortpyDiagnostics(shortpyDiagnosticsCollection, event.document);
    updateCommandDecorationsForEditor(vscode.window.visibleTextEditors.find((editor) => editor.document === event.document));
    if (!options.validateOnType || event.document.languageId !== "python") {
      return;
    }
    const key = event.document.uri.toString();
    clearTimeout(validateTimers.get(key));
    validateTimers.set(key, setTimeout(() => {
      compilePythonDocument(event.document, event.document.getText(), diagnostics).catch(() => {});
      updateCommandDecorations();
    }, options.validateDebounceMs));
  }));
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(updateCommandDecorations));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateCommandDecorationsForEditor));
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

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
