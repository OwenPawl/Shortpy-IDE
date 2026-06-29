"use strict";

const path = require("path");
const crypto = require("crypto");
const vscode = require("vscode");
const {
  binaryPlistToXml,
  bplistBufferFromResponse,
  runBridgeCli,
  runBridgeCommand,
  runBridgeStatus,
  shortcutBufferFromResponse,
} = require("./bridge");
const { parseAppleDiagnostic } = require("./diagnostics");
const {
  defaultToolkitCtlPath,
  indexToolkitMetadata,
  loadToolkitMetadata,
  refreshToolkitMetadata,
  runToolkitCommand,
} = require("./toolkit");
const {
  indexToolRendererMetadata,
  loadToolRendererMetadata,
  mergeToolRendererWithToolkit,
  refreshToolRendererMetadata,
  searchToolRendererMetadata,
} = require("./toolrenderer");
const {
  collectToolkitDiagnostics,
  parameterInfoAt,
} = require("./toolkitDiagnostics");

const COMMAND_NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const CUSTOM_EDITOR_VIEW_TYPE = "shortcutsRuntimeIDE.workflowEditor";

let runtimeLog;
let toolkitIndex = indexToolkitMetadata({});
let toolRendererIndex = indexToolRendererMetadata({});
let toolkitMetadataPath;
let toolRendererMetadataPath;
let actionDecoration;
let triggerDecoration;
let bridgeStatusBar;
let toolkitDiagnosticsCollection;
const workflowSessionsByWorkflowUri = new Map();
const workflowSessionsByPythonUri = new Map();

function configOptions() {
  const config = vscode.workspace.getConfiguration("shortcutsRuntimeIDE");
  return {
    bridgeCtlPath: config.get("bridgeCtlPath") || undefined,
    toolkitCtlPath: config.get("toolkitCtlPath") || undefined,
    simulatorDevice: config.get("simulatorDevice") || "booted",
    toolkitMetadataPath: config.get("toolkitMetadataPath") || undefined,
    toolRendererMetadataPath: config.get("toolRendererMetadataPath") || undefined,
    refreshToolKitMetadataOnActivation: config.get("refreshToolKitMetadataOnActivation") !== false,
    refreshToolRendererInterfaceOnActivation: config.get("refreshToolRendererInterfaceOnActivation") !== false,
    highlightKnownCommands: config.get("highlightKnownCommands") !== false,
    writeToDebugConsole: config.get("writeToDebugConsole") !== false,
    pythonPath: config.get("pythonPath") || "python3",
    socket: config.get("socket") || "auto",
    defaultShortcutExtension: config.get("defaultShortcutExtension") || ".shortcut",
    signShortcutExports: config.get("signShortcutExports") !== false,
    shortcutSigningMode: config.get("shortcutSigningMode") || "anyone",
    shortcutsCliPath: config.get("shortcutsCliPath") || undefined,
    autoConvertPlistOnOpen: config.get("autoConvertPlistOnOpen") !== false,
    validateOnSave: Boolean(config.get("validateOnSave")),
    validateOnType: Boolean(config.get("validateOnType")),
    validateDebounceMs: Number(config.get("validateDebounceMs")) || 900,
    offerOpenInShortcutsAfterSave: config.get("offerOpenInShortcutsAfterSave") !== false,
    overwriteSiblingShortcut: Boolean(config.get("overwriteSiblingShortcut")),
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

async function connectBridge() {
  try {
    const status = await runBridgeStatus(configOptions());
    setBridgeStatus("connected", `Bridge ${status.version || "unknown"} at ${status.socket_path || "auto socket"}`);
    logRuntime("Bridge connected", status);
    vscode.window.showInformationMessage(`Shortcuts bridge connected${status.version ? ` (${status.version})` : ""}.`);
    return status;
  } catch (error) {
    setBridgeStatus("error", error && error.message ? error.message : String(error));
    throw error;
  }
}

function toolkitOptions() {
  const options = configOptions();
  return {
    pythonPath: options.pythonPath,
    toolkitCtlPath: options.toolkitCtlPath || defaultToolkitCtlPath(),
    device: options.simulatorDevice,
  };
}

function defaultMetadataPath(context) {
  return path.join(context.globalStorageUri.fsPath, "toolkit-metadata.json");
}

function defaultToolRendererMetadataPath(context) {
  return path.join(context.globalStorageUri.fsPath, "toolrenderer-interface.json");
}

function commandMetadata(item) {
  const lines = [];
  lines.push(`**${item.pythonName}**`);
  lines.push("");
  lines.push(item.kind === "trigger" ? "Trigger" : item.kind === "enum" ? "Enum" : item.kind === "enumCase" ? "Enum Case" : item.kind === "typeAlias" ? "Type Alias" : item.kind === "class" ? "Type" : item.kind === "decorator" ? "Decorator" : item.kind === "helper" ? "Helper" : "Action");
  if (item.source) {
    lines.push(`Source: ${item.source}`);
  }
  if (item.displayName) {
    lines.push(`Display: ${item.displayName}`);
  }
  const nativeIdentifier = item.nativeIdentifier || item.id;
  if (nativeIdentifier) {
    lines.push(`Native ID: \`${nativeIdentifier}\``);
  }
  if (item.returnType) {
    lines.push(`Returns: \`${item.returnType}\``);
  }
  if (item.aliasedTo) {
    lines.push(`Alias: \`${item.aliasedTo}\``);
  }
  if (item.summary) {
    lines.push("");
    lines.push(item.summary);
  }
  if (item.customDescription && item.customDescription.mainDescription && item.customDescription.mainDescription !== item.summary) {
    lines.push("");
    lines.push(item.customDescription.mainDescription);
  }
  if (item.customDescription && item.customDescription.source) {
    lines.push(`Description Source: \`${item.customDescription.source}\``);
  }
  if (item.signature) {
    lines.push("");
    lines.push("```python");
    lines.push(item.signature);
    lines.push("```");
  }
  if (Array.isArray(item.parameters) && item.parameters.length > 0) {
    lines.push("");
    lines.push("Parameters:");
    for (const parameter of item.parameters.slice(0, 20)) {
      const parameterName = parameter.pythonName || parameter.key;
      const label = parameter.displayName ? ` - ${parameter.displayName}` : "";
      const rawKey = parameter.rawKey || parameter.key;
      const raw = rawKey && rawKey !== parameterName ? ` (\`${rawKey}\`)` : "";
      const type = parameter.type ? `: \`${parameter.type}\`` : "";
      lines.push(`- \`${parameterName}\`${type}${raw}${label}`);
      if (parameter.catalog) {
        lines.push(`  Catalog: ${parameter.catalog.kind || "catalog"} inline parameterState${parameter.catalog.supported === false ? " (binding unavailable)" : ""}`);
      }
    }
  }
  if (Array.isArray(item.cases) && item.cases.length > 0) {
    lines.push("");
    lines.push("Cases:");
    for (const entry of item.cases.slice(0, 24)) {
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
  return new vscode.MarkdownString(lines.join("\n"));
}

function commandSignatureLabel(item) {
  const params = Array.isArray(item.parameters) ? item.parameters : [];
  return `${item.pythonName}(${params.map((param) => `${param.pythonName || param.key}=`).join(", ")})`;
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
    const name = parameter.pythonName || parameter.key || `value${offset + 1}`;
    return `${name}=${snippetPlaceholder(startIndex + offset, parameterSnippetValue(parameter))}`;
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
    .map((parameter) => `${parameter.pythonName || parameter.key}=${plainArgumentValue(parameter)}`)
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

async function refreshToolKitMetadata(context, announce = true) {
  const options = configOptions();
  toolkitMetadataPath = options.toolkitMetadataPath || defaultMetadataPath(context);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toolkitMetadataPath)));
  const refresh = await refreshToolkitMetadata(toolkitMetadataPath, toolkitOptions());
  const metadata = await loadToolkitMetadata(toolkitMetadataPath);
  toolkitIndex = indexToolkitMetadata(metadata);
  updateCommandDecorations();
  refreshToolkitDiagnosticsForOpenDocuments(toolkitDiagnosticsCollection);
  logRuntime("ToolKit metadata refreshed", refresh);
  if (announce) {
    const counts = refresh.counts || metadata.counts || {};
    vscode.window.showInformationMessage(
      `Loaded ToolKit metadata (${counts.actions || 0} actions, ${counts.triggers || 0} triggers).`
    );
  }
  return metadata;
}

async function refreshNativeToolRendererInterface(context, announce = true, refreshOptions = {}) {
  const options = configOptions();
  toolRendererMetadataPath = options.toolRendererMetadataPath || defaultToolRendererMetadataPath(context);
  toolkitMetadataPath = options.toolkitMetadataPath || defaultMetadataPath(context);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toolRendererMetadataPath)));
  const metadata = await refreshToolRendererMetadata(toolRendererMetadataPath, {
    ...options,
    toolkitMetadataPath,
    live: refreshOptions.live === true,
    allowLiveFallback: refreshOptions.allowLiveFallback,
  });
  toolRendererIndex = indexToolRendererMetadata(metadata);
  updateCommandDecorations();
  refreshToolkitDiagnosticsForOpenDocuments(toolkitDiagnosticsCollection);
  logRuntime("ToolRenderer interface refreshed", metadata.counts);
  if (announce) {
    const counts = metadata.counts || {};
    const source = metadata.response && metadata.response.cached ? "cached native" : "live native";
    vscode.window.showInformationMessage(
      `Loaded ${source} ToolRenderer interface (${counts.actions || 0} actions, ${counts.triggers || 0} triggers).`
    );
  }
  return metadata;
}

async function refreshAllToolMetadata(context, announce = true) {
  const toolkit = await refreshToolKitMetadata(context, false);
  const native = await refreshNativeToolRendererInterface(context, false);
  if (announce) {
    const nativeCounts = native.counts || {};
    const toolkitCounts = toolkit.counts || {};
    vscode.window.showInformationMessage(
      `Refreshed tool metadata (${nativeCounts.actions || 0} native actions, ${nativeCounts.triggers || 0} native triggers; ${toolkitCounts.actions || 0} ToolKit actions).`
    );
  }
  return { native, toolkit };
}

async function ensureToolKitMetadata(context) {
  if (toolkitIndex.byName.size > 0) {
    return;
  }
  const options = configOptions();
  toolkitMetadataPath = options.toolkitMetadataPath || defaultMetadataPath(context);
  try {
    toolkitIndex = indexToolkitMetadata(await loadToolkitMetadata(toolkitMetadataPath));
  } catch (_) {
    if (options.refreshToolKitMetadataOnActivation) {
      await refreshToolKitMetadata(context, false);
    }
  }
}

async function ensureToolRendererMetadata(context) {
  if (toolRendererIndex.byName.size > 0) {
    return;
  }
  const options = configOptions();
  toolRendererMetadataPath = options.toolRendererMetadataPath || defaultToolRendererMetadataPath(context);
  try {
    let metadata = await loadToolRendererMetadata(toolRendererMetadataPath);
    try {
      const toolkitMetadata = await loadToolkitMetadata(options.toolkitMetadataPath || defaultMetadataPath(context));
      metadata = mergeToolRendererWithToolkit(metadata, toolkitMetadata);
    } catch (_) {
      // ToolRenderer metadata is still useful without raw ToolKit key enrichment.
    }
    toolRendererIndex = indexToolRendererMetadata(metadata);
  } catch (_) {
    if (options.refreshToolRendererInterfaceOnActivation) {
      await refreshNativeToolRendererInterface(context, false, { live: false, allowLiveFallback: false });
    }
  }
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
  session.lastImportResponse = response;
  await writeWorkflowPythonSource(session, response.python_code || "");
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
    setToolkitDiagnostics(toolkitDiagnosticsCollection, document);
    updateCommandDecorationsForEditor(editor);
    return editor;
  }
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: options.viewColumn || vscode.ViewColumn.Beside,
    preview: false,
    preserveFocus: Boolean(options.preserveFocus),
  });
  setToolkitDiagnostics(toolkitDiagnosticsCollection, document);
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

function severityFromToolkitDiagnostic(item) {
  if (item.severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  if (item.severity === "info") {
    return vscode.DiagnosticSeverity.Information;
  }
  return vscode.DiagnosticSeverity.Error;
}

function setToolkitDiagnostics(collection, document) {
  if (!collection || document.languageId !== "python") {
    return [];
  }
  const rawDiagnostics = collectToolkitDiagnostics(document.getText(), [toolRendererIndex, toolkitIndex]);
  const diagnostics = rawDiagnostics.map((item) => {
    const line = Math.min(Math.max(0, item.line), Math.max(0, document.lineCount - 1));
    const text = document.lineAt(line).text;
    const start = Math.min(Math.max(0, item.start), text.length);
    const end = Math.min(Math.max(start + 1, item.end), text.length);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, start, line, end),
      item.message,
      severityFromToolkitDiagnostic(item)
    );
    diagnostic.source = "Shortcuts Tool Metadata";
    diagnostic.code = item.code;
    return diagnostic;
  });
  collection.set(document.uri, diagnostics);
  return rawDiagnostics;
}

function refreshToolkitDiagnosticsForOpenDocuments(collection) {
  for (const document of vscode.workspace.textDocuments) {
    setToolkitDiagnostics(collection, document);
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
  await vscode.workspace.fs.writeFile(target, bytes);
  const count = response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  const signed = Boolean(response.shortcut_payload) && path.extname(target.fsPath).toLowerCase() !== ".plist";
  await offerOpenInShortcuts(target, `Saved ${signed ? "signed shortcut" : "runtime plist"} (${bytes.length} bytes${Number.isInteger(count) ? `, ${count} actions` : ""}).`);
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
  const response = await compilePythonDocument(editor.document, selectedOrFullText(editor), collection, compileOptionsForExport());
  const bytes = shortcutBytesForTarget(response, target);
  await vscode.workspace.fs.writeFile(target, bytes);
  const count = response.plist_summary && response.plist_summary.WFWorkflowActions_count;
  const signed = Boolean(response.shortcut_payload) && path.extname(target.fsPath).toLowerCase() !== ".plist";
  await offerOpenInShortcuts(target, `Wrote ${signed ? "signed " : ""}${path.basename(target.fsPath)} (${bytes.length} bytes${Number.isInteger(count) ? `, ${count} actions` : ""}).`);
}

async function validatePython(collection) {
  const editor = activeEditorOrThrow();
  const response = await compilePythonDocument(editor.document, selectedOrFullText(editor), collection);
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
  await ensureToolRendererMetadata(context);
  if (toolRendererIndex.byName.size === 0) {
    throw new Error("Native ToolRenderer metadata is not loaded. Run Refresh Native ToolRenderer Interface first.");
  }
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
  const results = searchToolRendererMetadata(toolRendererIndex, query, fixedKind, 40);
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

function pythonLiteral(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonLiteral(item)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item)}`)
      .join(", ")}}`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === true) {
    return "True";
  }
  if (value === false) {
    return "False";
  }
  if (value === null || value === undefined) {
    return "None";
  }
  return String(value);
}

function metadataEntriesFromResolveResponse(response) {
  const entries = [];
  for (const result of response.results || []) {
    if (!result || typeof result !== "object") {
      continue;
    }
    for (const [tag, metadataText] of Object.entries(result)) {
      try {
        entries.push({ tag, metadata: JSON.parse(metadataText), metadataText });
      } catch (_) {
        // Ignore malformed native metadata strings; manual fallback below handles empty results.
      }
    }
  }
  for (const candidate of response.candidates || []) {
    if (!candidate || !candidate.metadata) {
      continue;
    }
    try {
      const metadata = JSON.parse(candidate.metadata);
      if (!entries.some((entry) => JSON.stringify(entry.metadata) === JSON.stringify(metadata))) {
        entries.push({ tag: candidate.tag, metadata, metadataText: candidate.metadata });
      }
    } catch (_) {
      // Ignore malformed fallback metadata strings.
    }
  }
  return entries;
}

async function resolveEntity(context, options = {}) {
  const typeName = await vscode.window.showInputBox({
    title: "Shortcuts IDE: Resolve Entity",
    prompt: "Entity type name",
    placeHolder: "AppEntity, Contact, Focus, Calendar, Playlist",
  });
  if (typeName === undefined) {
    return undefined;
  }
  const parameterName = await vscode.window.showInputBox({
    title: "Shortcuts IDE: Resolve Entity",
    prompt: "Action or trigger parameter name",
    value: "app",
    placeHolder: "app, contact, calendar",
  });
  if (parameterName === undefined) {
    return undefined;
  }
  const query = await vscode.window.showInputBox({
    title: "Shortcuts IDE: Resolve Entity",
    prompt: "Entity query or label",
    placeHolder: "Shortcuts, Work Focus, Alice",
  });
  if (query === undefined) {
    return undefined;
  }
  const response = await runBridgeCli([
    "resolve-entity",
    typeName.trim(),
    query.trim(),
    "--method-parameter-name",
    parameterName.trim(),
  ], configOptions());
  let entries = metadataEntriesFromResolveResponse(response);
  if (entries.length === 0) {
    const manual = await vscode.window.showInputBox({
      title: "Shortcuts IDE: Resolve Entity",
      prompt: "No entity metadata was returned. Enter inline JSON metadata to insert.",
      value: parameterName.trim().toLowerCase() === "app"
        ? "{\"Bundle Identifier\":\"com.apple.shortcuts\",\"Name\":\"Shortcuts\"}"
        : "{\"Name\":\"Example\"}",
      validateInput(value) {
        try {
          JSON.parse(value);
          return undefined;
        } catch (error) {
          return error && error.message ? error.message : "Invalid JSON metadata.";
        }
      },
    });
    if (manual === undefined) {
      return undefined;
    }
    entries = [{ tag: "inline", metadata: JSON.parse(manual), metadataText: manual }];
  }
  const pick = entries.length === 1
    ? entries[0]
    : await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: entry.metadata.Name || entry.metadata["Display Name"] || entry.metadata["Bundle Identifier"] || entry.tag || "Entity",
        description: entry.metadata["Bundle Identifier"] || entry.tag || "",
        detail: JSON.stringify(entry.metadata),
        entry,
      })),
      { title: "Shortcuts IDE: Resolve Entity", placeHolder: "Select entity metadata to insert" }
    ).then((item) => item && item.entry);
  if (!pick) {
    return undefined;
  }
  const text = parameterName.trim().toLowerCase() === "app"
    ? `[${pythonLiteral(pick.metadata)}]`
    : pythonLiteral(pick.metadata);
  logRuntime("resolve_entity inline metadata", {
    typeName: typeName.trim(),
    parameterName: parameterName.trim(),
    query: query.trim(),
    tag: pick.tag,
    metadata: pick.metadata,
  });
  if (options.insert === false) {
    return { text, entry: pick, response };
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "python") {
    await editor.insertSnippet(new vscode.SnippetString(text), editor.selection);
  }
  vscode.window.showInformationMessage("Inserted inline entity metadata.");
  return { text, entry: pick, response };
}

async function showStatus() {
  const status = await runBridgeStatus(configOptions());
  setBridgeStatus("connected", `Bridge ${status.version || "unknown"} at ${status.socket_path || "auto socket"}`);
  await openText(JSON.stringify(status, null, 2), "json", "Shortcuts runtime bridge status");
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
  const item = toolRendererIndex.byName.get(name) || toolkitIndex.byName.get(name);
  return item ? { item, range } : undefined;
}

function provideShortcutCompletions() {
  const items = [];
  const nativeActionNames = new Set();
  const nativeTriggerNames = new Set();
  for (const helper of toolRendererIndex.helpers || []) {
    const item = new vscode.CompletionItem(helper.pythonName, vscode.CompletionItemKind.Function);
    item.detail = helper.displayName ? `Shortcuts helper: ${helper.displayName}` : "Shortcuts helper";
    item.documentation = commandMetadata(helper);
    item.insertText = new vscode.SnippetString(`${helper.pythonName}($0)`);
    item.sortText = `0_helper_${helper.pythonName}`;
    items.push(item);
  }
  for (const trigger of toolRendererIndex.triggers || []) {
    nativeTriggerNames.add(trigger.pythonName);
    const item = new vscode.CompletionItem(trigger.pythonName, vscode.CompletionItemKind.Event);
    item.detail = trigger.displayName ? `Native Shortcuts trigger: ${trigger.displayName}` : "Native Shortcuts trigger";
    item.documentation = commandMetadata(trigger);
    item.insertText = new vscode.SnippetString(`@${trigger.pythonName}($0)`);
    item.sortText = `0_native_${trigger.pythonName}`;
    items.push(item);
  }
  for (const action of toolRendererIndex.actions || []) {
    nativeActionNames.add(action.pythonName);
    const item = new vscode.CompletionItem(action.pythonName, vscode.CompletionItemKind.Function);
    item.detail = action.displayName ? `Native Shortcuts action: ${action.displayName}` : "Native Shortcuts action";
    item.documentation = commandMetadata(action);
    item.insertText = new vscode.SnippetString(`${action.pythonName}($0)`);
    item.sortText = `1_native_${action.pythonName}`;
    items.push(item);
  }
  for (const trigger of toolkitIndex.triggers || []) {
    if (nativeTriggerNames.has(trigger.pythonName)) {
      continue;
    }
    const item = new vscode.CompletionItem(trigger.pythonName, vscode.CompletionItemKind.Event);
    item.detail = trigger.displayName ? `Shortcuts trigger: ${trigger.displayName}` : "Shortcuts trigger";
    item.documentation = commandMetadata({ ...trigger, kind: "trigger" });
    item.insertText = new vscode.SnippetString(`@${trigger.pythonName}($0)`);
    item.sortText = `0_toolkit_${trigger.pythonName}`;
    items.push(item);
  }
  for (const action of toolkitIndex.actions || []) {
    if (nativeActionNames.has(action.pythonName)) {
      continue;
    }
    const item = new vscode.CompletionItem(action.pythonName, vscode.CompletionItemKind.Function);
    item.detail = action.displayName ? `Shortcuts action: ${action.displayName}` : "Shortcuts action";
    item.documentation = commandMetadata({ ...action, kind: "action" });
    item.insertText = new vscode.SnippetString(`${action.pythonName}($0)`);
    item.sortText = `1_toolkit_${action.pythonName}`;
    items.push(item);
  }
  for (const type of (toolRendererIndex.types || []).slice(0, 2000)) {
    const kind = type.kind === "enum"
      ? vscode.CompletionItemKind.Enum
      : type.kind === "typeAlias"
        ? vscode.CompletionItemKind.TypeParameter
        : vscode.CompletionItemKind.Class;
    const item = new vscode.CompletionItem(type.pythonName, kind);
    item.detail = type.kind === "enum" ? "Native Shortcuts enum" : "Native Shortcuts type";
    item.documentation = commandMetadata(type);
    item.sortText = `2_native_${type.pythonName}`;
    items.push(item);
    for (const enumCase of (type.cases || []).slice(0, 80)) {
      const caseItem = new vscode.CompletionItem(enumCase.pythonName, vscode.CompletionItemKind.EnumMember);
      caseItem.detail = `Native Shortcuts enum case: ${type.pythonName}`;
      caseItem.documentation = commandMetadata({ ...enumCase, kind: "enumCase", displayName: enumCase.name });
      caseItem.sortText = `2_case_${enumCase.pythonName}`;
      items.push(caseItem);
    }
  }
  for (const type of (toolkitIndex.types || []).slice(0, 1500)) {
    if (toolRendererIndex.byName.has(type.pythonName)) {
      continue;
    }
    const item = new vscode.CompletionItem(type.pythonName, vscode.CompletionItemKind.Class);
    item.detail = "Shortcuts type";
    item.documentation = commandMetadata({ ...type, kind: "type" });
    item.sortText = `2_${type.pythonName}`;
    items.push(item);
  }
  return items;
}

function provideShortcutHover(document, position) {
  const parameter = parameterInfoAt(document.getText(), position.line, position.character, [toolRendererIndex, toolkitIndex]);
  if (parameter) {
    const rawKey = parameter.parameter.rawKey || parameter.parameter.key;
    const binding = parameter.parameter.binding && parameter.parameter.binding.hostAndKey
      ? JSON.stringify(parameter.parameter.binding.hostAndKey)
      : "";
    const markdown = new vscode.MarkdownString([
      `**${parameter.name}**`,
      "",
      rawKey && rawKey !== parameter.name
        ? `Raw plist key: \`${rawKey}\``
        : "",
      parameter.parameter.displayName ? `Display: ${parameter.parameter.displayName}` : "",
      parameter.parameter.type ? `Type: \`${parameter.parameter.type}\`` : "",
      parameter.parameter.defaultValue ? `Default: \`${parameter.parameter.defaultValue}\`` : "",
      parameter.parameter.catalog ? `Catalog: ${parameter.parameter.catalog.kind || "catalog"} inline parameterState${parameter.parameter.catalog.supported === false ? " (binding unavailable)" : ""}` : "",
      binding ? `Binding: \`${binding}\`` : "",
      parameter.parameter.doc || parameter.parameter.summary || "",
      "",
      `Action: \`${parameter.item.pythonName}\``,
    ].filter(Boolean).join("\n\n"));
    return new vscode.Hover(
      markdown,
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
  const item = name ? (toolRendererIndex.byName.get(name) || toolkitIndex.byName.get(name)) : undefined;
  if (!item || !Array.isArray(item.parameters)) {
    return undefined;
  }
  const signature = new vscode.SignatureInformation(commandSignatureLabel(item), commandMetadata(item));
  signature.parameters = item.parameters.map((parameter) => {
    const parameterName = parameter.pythonName || parameter.key;
    const rawKey = parameter.rawKey || parameter.key;
    const markdown = new vscode.MarkdownString([
      `\`${parameterName}\``,
      rawKey && rawKey !== parameterName ? `Raw plist key: \`${rawKey}\`` : "",
      parameter.displayName ? `Display: ${parameter.displayName}` : "",
      parameter.type ? `Type: \`${parameter.type}\`` : "",
      parameter.defaultValue ? `Default: \`${parameter.defaultValue}\`` : "",
      parameter.catalog ? `Catalog: ${parameter.catalog.kind || "catalog"} inline parameterState${parameter.catalog.supported === false ? " (binding unavailable)" : ""}` : "",
      parameter.doc || parameter.summary || "",
    ].filter(Boolean).join("\n\n"));
    return new vscode.ParameterInformation(`${parameterName}=`, markdown);
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
      const item = toolRendererIndex.byName.get(match[0]) || toolkitIndex.byName.get(match[0]);
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
  return collectToolkitDiagnostics(source, [toolRendererIndex, toolkitIndex]).map((item) => ({
    ...item,
    source: "Shortcuts Tool Metadata",
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
    <button data-command="connect">Connect</button>
    <button data-command="status">Status</button>
    <button class="primary" data-command="openPython">Open Python Editor</button>
    <button class="primary" data-command="validate">Validate</button>
    <button class="primary" data-command="export">Export Plist</button>
    <button data-command="import">Reimport</button>
    <button data-command="searchActions">Search Actions</button>
    <button data-command="searchTriggers">Search Triggers</button>
    <button data-command="resolveEntity">Resolve Entity</button>
    <button data-command="refreshMetadata">Refresh Metadata</button>
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
    const session = await importWorkflowPlistToSession(this.context, document.uri);
    session.webviews.add(webview);
    webviewPanel.onDidDispose(() => {
      session.webviews.delete(webview);
    });
    webview.html = workflowEditorHtml(path.basename(document.uri.fsPath), session.pythonUri.fsPath);
    await showWorkflowPythonEditor(session);
    postWorkflowSessionStatus(session, `Imported ${path.basename(document.uri.fsPath)}`);

    const pythonDocument = async () => vscode.workspace.openTextDocument(session.pythonUri);

    const validatePythonDocument = async () => {
      const pyDocument = await pythonDocument();
      await showWorkflowPythonEditor(session, { preserveFocus: true });
      return compilePythonDocument(pyDocument, pyDocument.getText(), this.runtimeDiagnosticsCollection);
    };

    webview.onDidReceiveMessage(async (message) => {
      try {
        const commandName = message && message.command;
        if (commandName === "openPython") {
          await showWorkflowPythonEditor(session);
          postWorkflowSessionStatus(session, `Editing ${path.basename(session.pythonUri.fsPath)}`);
        } else if (commandName === "validate") {
          await validatePythonDocument();
        } else if (commandName === "export") {
          const pyDocument = await pythonDocument();
          await showWorkflowPythonEditor(session, { preserveFocus: true });
          const shouldSign = path.extname(document.uri.fsPath).toLowerCase() !== ".plist";
          const response = await compilePythonDocument(
            pyDocument,
            pyDocument.getText(),
            this.runtimeDiagnosticsCollection,
            shouldSign ? compileOptionsForExport() : compileOptionsForValidation()
          );
          const bytes = shortcutBytesForTarget(response, document.uri);
          await vscode.workspace.fs.writeFile(document.uri, bytes);
          postWorkflowSessionStatus(session, `Exported ${bytes.length} bytes to ${path.basename(document.uri.fsPath)}`);
          setBridgeStatus("connected", `Exported ${path.basename(document.uri.fsPath)}`);
        } else if (commandName === "import") {
          await importWorkflowPlistToSession(this.context, document.uri);
          await showWorkflowPythonEditor(session);
          postWorkflowSessionRuntimeResponse(session, "No validation run yet.");
          postWorkflowSessionStatus(session, `Reimported ${path.basename(document.uri.fsPath)}`);
        } else if (commandName === "connect") {
          const status = await connectBridge();
          postWorkflowSessionStatus(session, `Connected ${status.version || ""}`.trim());
        } else if (commandName === "status") {
          const status = await runBridgeStatus(configOptions());
          setBridgeStatus("connected", `Bridge ${status.version || "unknown"}`);
          await openText(JSON.stringify(status, null, 2), "json", "Shortcuts runtime bridge status");
          postWorkflowSessionStatus(session, `Bridge ${status.version || "unknown"}`);
        } else if (commandName === "searchActions") {
          await showWorkflowPythonEditor(session);
          await searchNativeAgentTools(this.context, "tool", true);
        } else if (commandName === "searchTriggers") {
          await showWorkflowPythonEditor(session);
          await searchNativeAgentTools(this.context, "trigger", true);
        } else if (commandName === "resolveEntity") {
          await showWorkflowPythonEditor(session);
          await resolveEntity(this.context, { documentUri: session.pythonUri });
        } else if (commandName === "refreshMetadata") {
          await refreshAllToolMetadata(this.context, false);
          const pyDocument = await pythonDocument();
          setToolkitDiagnostics(toolkitDiagnosticsCollection, pyDocument);
          updateCommandDecorations();
          postWorkflowSessionStatus(session, "Refreshed ToolRenderer and ToolKit metadata");
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
  runtimeLog = vscode.window.createOutputChannel("Shortcuts Runtime IDE");
  bridgeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  bridgeStatusBar.command = "shortcutsRuntimeIDE.status";
  setBridgeStatus("disconnected", "Shortcuts Runtime IDE bridge is not connected.");
  actionDecoration = vscode.window.createTextEditorDecorationType({
    textDecoration: "underline dotted",
  });
  triggerDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "600",
    textDecoration: "underline dotted",
  });
  const diagnostics = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDE");
  toolkitDiagnosticsCollection = vscode.languages.createDiagnosticCollection("shortcutsRuntimeIDEToolkit");
  const handledPlists = new Set();
  const validateTimers = new Map();
  context.subscriptions.push(
    runtimeLog,
    bridgeStatusBar,
    actionDecoration,
    triggerDecoration,
    diagnostics,
    toolkitDiagnosticsCollection,
    vscode.window.registerCustomEditorProvider(
      CUSTOM_EDITOR_VIEW_TYPE,
      new WorkflowPythonCustomEditorProvider(context, diagnostics),
      { supportsMultipleEditorsPerDocument: false }
    ),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.connectBridge", command(connectBridge)),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.saveRuntimePlistFromPython", command(() => saveRuntimePlistFromPython(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.writeSiblingRuntimePlistFromPython", command(() => writeSiblingRuntimePlistFromPython(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.validatePython", command(() => validatePython(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.openWorkflowPlistFromPython", command(() => openWorkflowPlistFromPython(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.pythonToPlistDebugJson", command(() => pythonToPlistDebugJson(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.loadPythonFromPlist", command(loadPythonFromPlist)),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.importICloudShortcutLink", command(importICloudShortcutLink)),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.roundTripPythonThroughPlist", command(() => roundTripPythonThroughPlist(diagnostics))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.searchNativeAgentTools", command(() => searchNativeAgentTools(context))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.searchActions", command(() => searchNativeAgentTools(context, "tool"))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.searchTriggers", command(() => searchNativeAgentTools(context, "trigger"))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.resolveEntity", command(() => resolveEntity(context))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.status", command(showStatus)),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.refreshToolMetadata", command(() => refreshAllToolMetadata(context, true))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.refreshToolKitMetadata", command(() => refreshToolKitMetadata(context, true))),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.refreshToolRendererInterface", command(async () => {
      const metadata = await refreshNativeToolRendererInterface(context, true, { live: true });
      logRuntime("Live ToolRenderer refresh completed; relaunch bridge before compile if runtime calls start timing out.", {
        counts: metadata.counts || {},
        source: metadata.source,
      });
      vscode.window.showWarningMessage("Live ToolRenderer refresh can leave the simulator bridge unable to compile until Shortcuts is relaunched.");
    })),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.showToolKitStatus", command(async () => {
      const status = await runToolkitCommand(["show"], toolkitOptions());
      logRuntime("ToolKit status", status);
      await openText(JSON.stringify(status, null, 2), "json", "Simulator ToolKit status");
    })),
    vscode.commands.registerCommand("shortcutsRuntimeIDE.pointSimulatorToolKitToHost", command(async () => {
      const result = await runToolkitCommand(["point-host"], toolkitOptions());
      logRuntime("Pointed simulator ToolKit to host", result);
      await refreshToolKitMetadata(context, false);
      await openText(JSON.stringify(result, null, 2), "json", "Pointed simulator ToolKit to host");
      vscode.window.showInformationMessage("Simulator ToolKit now points to the host sqlite. Relaunch the simulator bridge for runtime changes.");
    })),
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
  ensureToolKitMetadata(context).then(() => {
    logRuntime("ToolKit metadata ready", { commands: toolkitIndex.byName.size });
    updateCommandDecorations();
    refreshToolkitDiagnosticsForOpenDocuments(toolkitDiagnosticsCollection);
  }).catch((error) => {
    logRuntime("ToolKit metadata unavailable", error && error.message ? error.message : String(error));
  });
  ensureToolRendererMetadata(context).then(() => {
    logRuntime("ToolRenderer metadata ready", {
      actions: toolRendererIndex.actions.length,
      triggers: toolRendererIndex.triggers.length,
      helpers: toolRendererIndex.helpers.length,
    });
    updateCommandDecorations();
    refreshToolkitDiagnosticsForOpenDocuments(toolkitDiagnosticsCollection);
  }).catch((error) => {
    logRuntime("ToolRenderer metadata unavailable", error && error.message ? error.message : String(error));
  });
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (!configOptions().validateOnSave || document.languageId !== "python") {
      return;
    }
    compilePythonDocument(document, document.getText(), diagnostics).catch(() => {});
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const options = configOptions();
    setToolkitDiagnostics(toolkitDiagnosticsCollection, event.document);
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
    setToolkitDiagnostics(toolkitDiagnosticsCollection, document);
    updateCommandDecorations();
  }));
  for (const document of vscode.workspace.textDocuments) {
    maybeAutoConvertPlist(document, handledPlists).catch(() => {});
    setToolkitDiagnostics(toolkitDiagnosticsCollection, document);
  }
  updateCommandDecorations();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
