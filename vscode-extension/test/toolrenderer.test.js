"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  indexToolRendererMetadata,
  isRuntimeSpecificMetadata,
  metadataFromStructuredResponse,
  sanitizeToolRendererMetadata,
} = require("../src/toolrenderer");

const openAppDefinition = [
  "def com_apple_shortcuts_open_app(",
  "    app: Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state],",
  "    window_location_size: Optional[openapp_wfwindowing_format] = openapp_wfwindowing_format.FULL_SCREEN,",
  ") -> App:",
  "    \"\"\"Open App",
  "    Launches a chosen application on iOS or macOS.",
  "    Args:",
  "        app: Query string searches across: name.",
  "    Returns:",
  "        App: App",
  "    \"\"\"",
].join("\n");

const metadata = sanitizeToolRendererMetadata(metadataFromStructuredResponse({
  items: [
    {
      kind: "decorator",
      pythonName: "runnable",
      displayName: "runnable",
      signature: "def runnable(surface: RunSurface) -> Callable:",
      returnType: "Callable",
      parameters: [{ pythonName: "surface", type: "RunSurface" }],
    },
    {
      kind: "action",
      pythonName: "com_apple_shortcuts_open_app",
      displayName: "Open App",
      signature: "def com_apple_shortcuts_open_app(app: Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state]) -> App:",
      returnType: "App",
      documentation: "Open App\nLaunches a chosen application on iOS or macOS.",
      definitionBlock: openAppDefinition,
      parameters: [{
        pythonName: "app",
        type: "Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state]",
        doc: "Query string searches across: name.",
      }],
    },
    {
      kind: "action",
      pythonName: "messages_find_conversation",
      displayName: "Find Conversation",
      signature: "def messages_find_conversation(query: List[query_com_apple_mobile_sms_conversation_entity], query_operator: QUERY_OPERATOR = QUERY_OPERATOR.ALL) -> com_apple_mobile_sms_conversation_entity:",
      returnType: "com_apple_mobile_sms_conversation_entity",
      parameters: [
        { pythonName: "query", type: "List[query_com_apple_mobile_sms_conversation_entity]" },
        { pythonName: "query_operator", type: "QUERY_OPERATOR", defaultValue: "QUERY_OPERATOR.ALL" },
        { pythonName: "sort_by", type: "Optional[com_apple_mobile_sms_conversation_entity_wfcontent_item_sort_property]", defaultValue: "None" },
        { pythonName: "query_sort_order", type: "QUERY_SORT_ORDER", defaultValue: "QUERY_SORT_ORDER.ASCENDING" },
        { pythonName: "limit", type: "Optional[int]", defaultValue: "None" },
        {
          pythonName: "scope",
          type: "Optional[com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter]",
          defaultValue: "None",
        },
      ],
    },
  ],
  types: [
    { kind: "typeAlias", pythonName: "App", aliasedTo: "Any" },
    { kind: "typeAlias", pythonName: "com_apple_shortcuts_wfapp_descriptor_parameter_state", aliasedTo: "Any" },
    { kind: "typeAlias", pythonName: "query_com_apple_mobile_sms_conversation_entity", aliasedTo: "Any" },
    { kind: "typeAlias", pythonName: "com_apple_mobile_sms_conversation_entity", aliasedTo: "Any" },
    { kind: "typeAlias", pythonName: "com_apple_mobile_sms_conversation_entity_wfcontent_item_sort_property", aliasedTo: "Any" },
    {
      kind: "enum",
      pythonName: "com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter",
      cases: [{ pythonName: "com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter.CONVERSATION", name: "CONVERSATION", value: "\"CONVERSATION\"" }],
    },
    {
      kind: "enum",
      pythonName: "RunSurface",
      cases: [
        { pythonName: "RunSurface.SHARE_SHEET", name: "SHARE_SHEET", value: "\"SHARE_SHEET\"" },
        { pythonName: "RunSurface.APPLE_WATCH", name: "APPLE_WATCH", value: "\"APPLE_WATCH\"" },
      ],
    },
    {
      kind: "enum",
      pythonName: "QUERY_OPERATOR",
      cases: [
        { pythonName: "QUERY_OPERATOR.ANY", name: "ANY", value: "\"ANY\"" },
        { pythonName: "QUERY_OPERATOR.ALL", name: "ALL", value: "\"ALL\"" },
      ],
    },
    {
      kind: "enum",
      pythonName: "QUERY_SORT_ORDER",
      cases: [
        { pythonName: "QUERY_SORT_ORDER.ASCENDING", name: "ASCENDING", value: "\"ASCENDING\"" },
        { pythonName: "QUERY_SORT_ORDER.DESCENDING", name: "DESCENDING", value: "\"DESCENDING\"" },
      ],
    },
    {
      kind: "enum",
      pythonName: "com_example_dynamic_choices",
      cases: [
        { pythonName: "com_example_dynamic_choices.ONE", name: "ONE", value: "\"ONE\"" },
        { pythonName: "com_example_dynamic_choices.TWO", name: "TWO", value: "\"TWO\"" },
      ],
    },
  ],
}));
assert.throws(
  () => metadataFromStructuredResponse({ python_interface: "def fallback(): pass" }),
  (error) => error.code === "missing_structured_toolrenderer_metadata"
);
assert.throws(
  () => metadataFromStructuredResponse({
    items: [{
      kind: "action",
      pythonName: "broken",
      parameters: [{ pythonName: "value", type: "MissingNativeType" }],
    }],
    types: [],
  }),
  (error) => error.code === "missing_toolrenderer_type_definitions" && /MissingNativeType/.test(error.message)
);
const index = indexToolRendererMetadata(metadata);

const openApp = index.byName.get("com_apple_shortcuts_open_app");
assert(openApp, "Open App action should be parsed from ToolRenderer fixture");
assert(openApp.definitionBlock.includes("def com_apple_shortcuts_open_app("), "function bundle should keep exact definition block");
assert(openApp.definitionBlock.includes("Args:"), "function definition block should include native Args section");
assert(openApp.returnType === "App", "return type should be parsed");

const appParameter = index.parameterByItemAndName.get("com_apple_shortcuts_open_app.app");
assert(appParameter, "Open App app parameter should be indexed");
assert.strictEqual(appParameter.parameter.type, "Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state]");
assert(/Query string searches across: name/.test(appParameter.parameter.doc || ""), "parameter doc should come from Args section");

const runnable = index.byName.get("runnable");
assert(runnable, "runnable decorator should be parsed");
assert((index.directDependencies.get("runnable") || []).includes("RunSurface"), "runnable should depend on RunSurface");

const findConversation = index.byName.get("messages_find_conversation");
assert(findConversation, "native query action should be indexed");
assert.strictEqual(findConversation.filterActionSurface, undefined, "native filter parameters must not be synthesized");
assert.strictEqual(findConversation.parameters.length, 6, "native rendered parameter list must be preserved");
assert.strictEqual(findConversation.parameters[0].pythonName, "query");
assert.strictEqual(findConversation.parameters[0].type, "List[query_com_apple_mobile_sms_conversation_entity]");
assert.strictEqual(findConversation.parameters[1].pythonName, "query_operator");
assert.strictEqual(findConversation.parameters[3].pythonName, "query_sort_order");
assert.strictEqual(findConversation.parameters[4].pythonName, "limit");
assert.strictEqual(findConversation.parameters[5].pythonName, "scope");
assert(index.parameterByItemAndName.has("messages_find_conversation.query"), "native query parameter should be indexed");
assert(index.parameterByItemAndName.has("messages_find_conversation.query_sort_order"), "native sort-order parameter should be indexed");
assert(index.parameterByItemAndName.has("messages_find_conversation.scope"), "native scope parameter should be indexed");
assert((index.directDependencies.get("messages_find_conversation") || []).includes("query_com_apple_mobile_sms_conversation_entity"), "query parameter type should be indexed as a dependency");
assert((index.directDependencies.get("messages_find_conversation") || []).includes("QUERY_OPERATOR"), "query operator dependency should be indexed");
assert(index.byName.has("QUERY_OPERATOR.ANY"), "stable query operator enum cases should be indexed for completion/hover");

const runSurface = index.byName.get("RunSurface");
assert(runSurface, "RunSurface enum should be indexed");
assert(index.byName.has("RunSurface.SHARE_SHEET"), "stable enum cases should be indexed for completion/hover");

const dynamicEnum = index.byName.get("com_example_dynamic_choices");
assert(dynamicEnum, "runtime-shaped enum type should be indexed");
assert(isRuntimeSpecificMetadata(dynamicEnum), "dynamic enum should be classified for simulator-runtime notices");
assert(index.byName.has("com_example_dynamic_choices.ONE"), "dynamic enum cases should be indexed for completion/hover");
assert(index.byName.has("com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter.CONVERSATION"), "com_* enum cases should be indexed for completion/hover");

const rawKeyIndex = indexToolRendererMetadata(sanitizeToolRendererMetadata({
  actions: [
    {
      kind: "action",
      pythonName: "calculator_calculate",
      definitionMissing: true,
      parameters: [
        { pythonName: "operand", key: "WFMathOperand" },
        { pythonName: "operand", key: "WFScientificMathOperand" },
      ],
    },
    {
      kind: "action",
      pythonName: "com_apple_shortcuts_filter_files",
      definitionMissing: true,
      parameters: [
        { pythonName: "wfcontentitemfilter", key: "WFContentItemFilter" },
        { pythonName: "sort_by", key: "WFContentItemSortProperty" },
        { pythonName: "order", key: "WFContentItemSortOrder" },
        { pythonName: "limit", key: "WFContentItemLimitEnabled" },
        { pythonName: "get", key: "WFContentItemLimitNumber" },
        { pythonName: "wfcompoundtype", key: "WFCompoundType" },
        { pythonName: "files", key: "WFContentItemInputParameter" },
      ],
    },
    {
      kind: "action",
      pythonName: "com_apple_shortcuts_get_network_details",
      definitionMissing: true,
      parameters: [
        { pythonName: "detail", key: "WFWiFiDetail" },
        { pythonName: "detail", key: "WFCellularDetail" },
        { pythonName: "detail", key: "WFEthernetDetail" },
      ],
    },
  ],
}));
assert(rawKeyIndex.parameterByItemAndName.has("calculator_calculate.math_operand"));
assert(rawKeyIndex.parameterByItemAndName.has("calculator_calculate.scientific_math_operand"));
assert(rawKeyIndex.parameterByItemAndName.has("com_apple_shortcuts_get_network_details.wi_fi_detail"));
assert(rawKeyIndex.parameterByItemAndName.has("com_apple_shortcuts_get_network_details.cellular_detail"));
assert(rawKeyIndex.parameterByItemAndName.has("com_apple_shortcuts_get_network_details.ethernet_detail"));
const rawKeyFilter = rawKeyIndex.byName.get("com_apple_shortcuts_filter_files");
assert.strictEqual(rawKeyFilter.filterActionSurface, undefined);
assert.deepStrictEqual(
  rawKeyFilter.parameters.map((parameter) => parameter.pythonName),
  ["wfcontentitemfilter", "sort_by", "order", "limit", "get", "wfcompoundtype", "files"],
  "sanitization must not synthesize a filter surface"
);
assert(!rawKeyIndex.parameterByItemAndName.has("com_apple_shortcuts_filter_files.query_operator"));
assert(!/WFContentItem/.test(JSON.stringify(rawKeyFilter)), "visible filter metadata must not retain raw ToolKit keys");
assert(!rawKeyIndex.byName.get("com_apple_shortcuts_get_network_details").definitionBlock);
assert(openApp.definitionBlock.includes("def com_apple_shortcuts_open_app("), "native definitions remain exact");

const cachePath = path.join(__dirname, "..", "..", "bridge", "logs", "vscode-extension-toolrenderer-interface.json");
if (fs.existsSync(cachePath)) {
  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const cachedIndex = indexToolRendererMetadata(cached);
  const cachedOpenApp = cachedIndex.byName.get("com_apple_shortcuts_open_app");
  if (cachedOpenApp && cachedOpenApp.definitionBlock) {
    assert(cachedOpenApp.definitionBlock.includes("def com_apple_shortcuts_open_app("), "cached Open App block should be exact Python");
  }
}

console.log("toolrenderer-ok");
