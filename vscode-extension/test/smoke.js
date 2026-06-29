"use strict";

const cp = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const util = require("util");
const {
  binaryPlistToXml,
  bplistBufferFromResponse,
  runBridgeCommand,
  runBridgeStatus,
} = require("../src/bridge");
const {
  indexToolkitMetadata,
  loadToolkitMetadata,
  refreshToolkitMetadata,
} = require("../src/toolkit");
const {
  indexToolRendererMetadata,
  loadToolRendererMetadata,
  refreshToolRendererMetadata,
  searchToolRendererMetadata,
} = require("../src/toolrenderer");
const { collectToolkitDiagnostics, parameterInfoAt } = require("../src/toolkitDiagnostics");

const execFile = util.promisify(cp.execFile);

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const logs = path.join(root, "bridge", "logs");
  await fs.mkdir(logs, { recursive: true });
  const options = {
    bridgeCtlPath: path.join(root, "bridge", "tools", "bridgectl.py"),
  };
  const toolkitOptions = {
    toolkitCtlPath: path.join(root, "bridge", "tools", "toolkitctl.py"),
  };
  const metadataPath = path.join(logs, "vscode-extension-toolkit-metadata.json");
  options.toolkitMetadataPath = metadataPath;
  const metadataRefresh = await refreshToolkitMetadata(metadataPath, toolkitOptions);
  const toolkit = indexToolkitMetadata(await loadToolkitMetadata(metadataPath));
  const toolRendererMetadataPath = path.join(logs, "vscode-extension-toolrenderer-interface.json");
  let toolRendererRefresh;
  try {
    toolRendererRefresh = await refreshToolRendererMetadata(toolRendererMetadataPath, options);
  } catch (error) {
    const cached = await loadToolRendererMetadata(toolRendererMetadataPath);
    toolRendererRefresh = {
      counts: cached.counts,
      source: "cached ToolRenderer metadata",
      refresh_error: error.message,
    };
  }
  const toolRenderer = indexToolRendererMetadata(await loadToolRendererMetadata(toolRendererMetadataPath));
  const nativeToolSearch = searchToolRendererMetadata(toolRenderer, "show a notification", "tool", 5);
  const nativeTriggerSearch = searchToolRendererMetadata(toolRenderer, "when app opened", "trigger", 5);
  const staticDiagnosticSource = [
    "def shortcut() -> None:",
    "    com_apple_shortcuts_show_notification(title=\"Hello\", body=dict(bogus_nested=True), bogus_param=True)",
    "    com_apple_shortcuts_not_a_real_action()",
    "",
  ].join("\n");
  const staticDiagnostics = collectToolkitDiagnostics(staticDiagnosticSource, [toolRenderer, toolkit]);
  const staticDiagnosticLines = staticDiagnosticSource.split(/\r?\n/);
  const nestedParameterColumn = staticDiagnosticLines[1].indexOf("bogus_nested") + 4;
  const titleParameterColumn = staticDiagnosticLines[1].indexOf("title") + 2;
  const nestedParameterHover = parameterInfoAt(staticDiagnosticSource, 1, nestedParameterColumn, [toolRenderer, toolkit]);
  const titleParameterHover = parameterInfoAt(staticDiagnosticSource, 1, titleParameterColumn, [toolRenderer, toolkit]);
  const bridgeCtl = path.join(root, "bridge", "tools", "bridgectl.py");
  const cliActionSearch = JSON.parse((await execFile("python3", [
    bridgeCtl,
    "--raw",
    "retrieve-relevant-actions",
    "show notification",
    "--limit",
    "5",
  ])).stdout);
  const cliTriggerSearch = JSON.parse((await execFile("python3", [
    bridgeCtl,
    "--raw",
    "retrieve-relevant-triggers",
    "when app opened",
    "--limit",
    "5",
  ])).stdout);
  const source = [
    "def shortcut() -> None:",
    "    com_apple_shortcuts_show_notification(title=\"Hello\", body=\"World\")",
    "",
  ].join("\n");
  const compiled = await runBridgeCommand("python-to-bplist", source, options);
  const cliTranspilerFeedback = JSON.parse((await execFile("python3", [
    bridgeCtl,
    "--raw",
    "get-transpiler-feedback",
    "--text",
    source,
  ])).stdout);
  const cliResolveEntity = JSON.parse((await execFile("python3", [
    bridgeCtl,
    "--raw",
    "resolve-entity",
    "AppEntity",
    "Shortcuts",
    "--method-parameter-name",
    "app",
  ])).stdout);
  const plist = bplistBufferFromResponse(compiled);
  const plistPath = path.join(logs, "vscode-extension-smoke.shortcut");
  await fs.writeFile(plistPath, plist);
  const restored = await runBridgeCommand("plist-data-to-python", plist, options);
  const xml = await binaryPlistToXml(plist);
  const fixturePlistPath = path.join(logs, "user-plist-441867F0", "final-input.xml.plist");
  const fixturePlist = await fs.readFile(fixturePlistPath);
  const fixtureRestored = await runBridgeCommand("plist-data-to-python", fixturePlist, options);
  const triggerSource = [
    "@when_app_opened(app=[{\"Bundle Identifier\":\"com.apple.shortcuts\",\"Name\":\"Shortcuts\"}], state=com_apple_shortcuts_wfapp_in_focus_trigger_wfapp_state.OPENED)",
    "def shortcut() -> None:",
    "    com_apple_shortcuts_show_notification(title=\"Inline metadata\", body=\"Trigger round trip\")",
    "",
  ].join("\n");
  const triggerCompiled = await runBridgeCommand("python-to-bplist", triggerSource, options);
  const triggerPlist = bplistBufferFromResponse(triggerCompiled);
  const triggerPlistPath = path.join(logs, "vscode-extension-trigger-smoke.shortcut");
  await fs.writeFile(triggerPlistPath, triggerPlist);
  const triggerXml = await binaryPlistToXml(triggerPlist);
  const triggerReimported = await runBridgeCommand("plist-data-to-python", triggerPlist, options);
  let invalidDiagnostic = "";
  try {
    await runBridgeCommand("python-to-bplist", "def shortcut():\n    com_apple_shortcuts_not_real()\n", options);
  } catch (error) {
    invalidDiagnostic = error.message;
  }
  const status = await runBridgeStatus(options);
  const showNotification = toolkit.byName.get("com_apple_shortcuts_show_notification");
  const showNotificationParameters = (showNotification && showNotification.parameters || [])
    .map((parameter) => parameter.pythonName || parameter.key);
  const summary = {
    ok: true,
    bridge_version: status.version,
    plist_path: plistPath,
    trigger_plist_path: triggerPlistPath,
    plist_length: plist.length,
    plist_header: plist.subarray(0, 8).toString("ascii"),
    xml_has_workflow_actions: xml.includes("WFWorkflowActions"),
    restored_python: restored.python_code,
    trigger_roundtrip: {
      serialized: Boolean(triggerCompiled.plist_builder && triggerCompiled.plist_builder.unifiedAutomationTriggers_serialized),
      xml_has_workflow_triggers: triggerXml.includes("WFWorkflowTriggers"),
      fixture_imported_has_native_app_trigger: (fixtureRestored.python_code || "").includes("@when_app_opened"),
      fixture_imported_has_native_focus_trigger: (fixtureRestored.python_code || "").includes("@when_focus_enable"),
      fixture_imported_has_no_refs: !(fixtureRestored.python_code || "").includes("ref(0x"),
      reimported_has_native_app_trigger: (triggerReimported.python_code || "").includes("@when_app_opened"),
      reimported_has_inline_app_metadata: (triggerReimported.python_code || "").includes("\"Bundle Identifier\": \"com.apple.shortcuts\"") ||
        (triggerReimported.python_code || "").includes("\"BundleIdentifier\": \"com.apple.shortcuts\""),
      reimported_has_no_refs: !(triggerReimported.python_code || "").includes("ref(0x"),
    },
    toolkit_counts: metadataRefresh.counts,
    toolrenderer_counts: toolRendererRefresh.counts,
    has_show_notification_metadata: toolkit.byName.has("com_apple_shortcuts_show_notification"),
    has_native_show_notification_metadata: toolRenderer.byName.has("com_apple_shortcuts_show_notification"),
    has_native_when_app_opened_metadata: toolRenderer.byName.has("when_app_opened"),
    has_native_when_focus_enable_metadata: toolRenderer.byName.has("when_focus_enable"),
    has_native_run_surface_type: toolRenderer.byName.has("RunSurface"),
    has_native_run_surface_case: toolRenderer.byName.has("RunSurface.SHARE_SHEET"),
    has_native_input_fallback_type: toolRenderer.byName.has("InputFallback"),
    open_app_binding_key: (((toolRenderer.byName.get("com_apple_shortcuts_open_app") || {}).parameters || [])[0] || {}).rawKey,
    when_app_opened_binding_key: (((toolRenderer.byName.get("when_app_opened") || {}).parameters || [])[0] || {}).rawKey,
    native_when_app_opened_parameters: ((toolRenderer.byName.get("when_app_opened") || {}).parameters || []).map((parameter) => parameter.pythonName),
    native_tool_search_top: nativeToolSearch.map((item) => item.pythonName),
    native_trigger_search_top: nativeTriggerSearch.map((item) => item.pythonName),
    static_diagnostics: {
      count: staticDiagnostics.length,
      codes: staticDiagnostics.map((item) => item.code),
      messages: staticDiagnostics.map((item) => item.message),
      nested_parameter_hover: Boolean(nestedParameterHover),
      title_parameter_hover: Boolean(titleParameterHover),
    },
    cli_agent_wrappers: {
      actions_mode: cliActionSearch.mode,
      actions_top: (cliActionSearch.results || []).map((item) => item.pythonName),
      triggers_mode: cliTriggerSearch.mode,
      triggers_top: (cliTriggerSearch.results || []).map((item) => item.pythonName),
      transpiler_mode: cliTranspilerFeedback.mode,
      transpiler_valid: cliTranspilerFeedback.valid,
      resolve_mode: cliResolveEntity.mode,
      resolve_ok: cliResolveEntity.ok,
      resolve_result_count: (cliResolveEntity.results || cliResolveEntity.candidates || []).length,
      resolve_blocker_present: Boolean(cliResolveEntity.blocker),
    },
    show_notification_parameters: showNotificationParameters,
    has_show_notification_python_parameter_names:
      showNotificationParameters.includes("title") && showNotificationParameters.includes("body"),
    has_when_app_opened_trigger_metadata: toolkit.byName.has("when_app_opened"),
    invalid_diagnostic_prefix: invalidDiagnostic.slice(0, 240),
  };
  if (!summary.has_show_notification_python_parameter_names) {
    throw new Error(`missing show_notification python parameter names: ${showNotificationParameters.join(", ")}`);
  }
  if (!summary.has_native_show_notification_metadata || !summary.has_native_when_app_opened_metadata || !summary.has_native_when_focus_enable_metadata || !summary.has_native_run_surface_type || !summary.has_native_run_surface_case || !summary.has_native_input_fallback_type) {
    throw new Error(`missing native ToolRenderer metadata: ${JSON.stringify({
      show_notification: summary.has_native_show_notification_metadata,
      when_app_opened: summary.has_native_when_app_opened_metadata,
      when_focus_enable: summary.has_native_when_focus_enable_metadata,
      RunSurface: summary.has_native_run_surface_type,
      RunSurface_SHARE_SHEET: summary.has_native_run_surface_case,
      InputFallback: summary.has_native_input_fallback_type,
    })}`);
  }
  if (summary.open_app_binding_key !== "WFSelectedApp" || summary.when_app_opened_binding_key !== "WFSelectedApps") {
    throw new Error(`native binding keys failed: ${JSON.stringify({
      open_app: summary.open_app_binding_key,
      when_app_opened: summary.when_app_opened_binding_key,
    })}`);
  }
  if (!summary.native_tool_search_top.includes("com_apple_shortcuts_show_notification") || !summary.native_trigger_search_top.includes("when_app_opened")) {
    throw new Error(`native ToolRenderer search failed: ${JSON.stringify({
      tools: summary.native_tool_search_top,
      triggers: summary.native_trigger_search_top,
    })}`);
  }
  if (!summary.static_diagnostics.codes.includes("unknownShortcutsCommand") || !summary.static_diagnostics.codes.includes("unknownShortcutsParameter")) {
    throw new Error(`static Toolkit diagnostics failed: ${JSON.stringify(summary.static_diagnostics)}`);
  }
  if (summary.static_diagnostics.messages.some((message) => message.includes("bogus_nested"))) {
    throw new Error(`static Toolkit diagnostics captured nested subparameter: ${JSON.stringify(summary.static_diagnostics)}`);
  }
  if (summary.static_diagnostics.nested_parameter_hover || !summary.static_diagnostics.title_parameter_hover) {
    throw new Error(`static Toolkit hover depth handling failed: ${JSON.stringify(summary.static_diagnostics)}`);
  }
  const resolveWrapperUsable = summary.cli_agent_wrappers.resolve_ok === true
    ? summary.cli_agent_wrappers.resolve_result_count > 0
    : summary.cli_agent_wrappers.resolve_blocker_present;
  if (!summary.cli_agent_wrappers.actions_top.includes("com_apple_shortcuts_show_notification") || !summary.cli_agent_wrappers.triggers_top.includes("when_app_opened") || summary.cli_agent_wrappers.transpiler_valid !== true || !resolveWrapperUsable) {
    throw new Error(`agent wrapper smoke failed: ${JSON.stringify(summary.cli_agent_wrappers)}`);
  }
  if (!summary.trigger_roundtrip.fixture_imported_has_native_app_trigger || !summary.trigger_roundtrip.fixture_imported_has_native_focus_trigger || !summary.trigger_roundtrip.fixture_imported_has_no_refs) {
    throw new Error(`native trigger decorator import failed: ${JSON.stringify(summary.trigger_roundtrip)}`);
  }
  if (!summary.trigger_roundtrip.serialized || !summary.trigger_roundtrip.xml_has_workflow_triggers || !summary.trigger_roundtrip.reimported_has_native_app_trigger || !summary.trigger_roundtrip.reimported_has_inline_app_metadata || !summary.trigger_roundtrip.reimported_has_no_refs) {
    throw new Error(`inline trigger decorator roundtrip failed: ${JSON.stringify(summary.trigger_roundtrip)}`);
  }
  await fs.writeFile(
    path.join(logs, "vscode-extension-smoke.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
