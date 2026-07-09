"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  indexToolRendererMetadata,
  isRuntimeSpecificMetadata,
  parseToolRendererInterface,
} = require("../src/toolrenderer");

const promptFixture = "/Users/owenpawling/Documents/codex-long-runs/20260619-110431-shortcuts-ai-ide-re/full-transcript-lower-20260623-0040/normalized_prompt_pass2.txt";

const inlineFixture = `
def com_apple_shortcuts_open_app(
    app: Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state],
    window_location_size: Optional[openapp_wfwindowing_format] = openapp_wfwindowing_format.FULL_SCREEN,
) -> App:
    """Open App
    Launches a chosen application on iOS or macOS.
    Args:
        app: Query string searches across: name.
    Returns:
        App: App
    """
def runnable(
    surface: RunSurface,
) -> Callable:
    """runnable
    Registers the shortcut to automatically run on the specified run surface. Can ONLY be used as a python decorator: @runnable
    """
def messages_find_conversation(
    : query_com_apple_mobile_sms_conversation_entity,
    sort_by: com_apple_mobile_sms_conversation_entity_wfcontent_item_sort_property,
    limit: Optional[bool] = False,
    get: Optional[float] = 5,
    conversation: Optional[com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter] = com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter.CONVERSATION,
) -> com_apple_mobile_sms_conversation_entity:
    """Find Conversation
    Search and filter Messages conversations.
    Args:
        : (query_com_apple_mobile_sms_conversation_entity)
        sort_by: Optionally, what to sort the conversation by.
        limit: Whether or not to limit the number of conversation retrieved.
    Returns:
        Conversation: com_apple_mobile_sms_conversation_entity
    """
query_com_apple_mobile_sms_conversation_entity = Any
class com_apple_mobile_sms_conversation_entity_wfcontent_item_input_parameter(Enum):
    CONVERSATION = "CONVERSATION"
class RunSurface(Enum):
    SHARE_SHEET = "SHARE_SHEET"
    APPLE_WATCH = "APPLE_WATCH"
class com_example_dynamic_choices(Enum):
    ONE = "ONE"
    TWO = "TWO"
`;

function fixtureSource() {
  const promptText = fs.existsSync(promptFixture) ? fs.readFileSync(promptFixture, "utf8") : "";
  return `${promptText}\n${inlineFixture}`;
}

const metadata = parseToolRendererInterface(fixtureSource());
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
assert(findConversation, "inline-argument action should be parsed");
assert.strictEqual(findConversation.filterActionSurface, "expanded-query", "filter action should be normalized to the compiler/import query surface");
assert.strictEqual(findConversation.parameters.length, 6, "filter parameters should use the expanded query surface");
assert.strictEqual(findConversation.parameters[0].pythonName, "query");
assert.strictEqual(findConversation.parameters[0].inline, false);
assert.strictEqual(findConversation.parameters[0].type, "List[query_com_apple_mobile_sms_conversation_entity]");
assert.strictEqual(findConversation.parameters[1].pythonName, "query_operator");
assert.strictEqual(findConversation.parameters[3].pythonName, "query_sort_order");
assert.strictEqual(findConversation.parameters[4].pythonName, "limit");
assert.strictEqual(findConversation.parameters[5].pythonName, "scope");
assert(index.parameterByItemAndName.has("messages_find_conversation.query"), "inline query parameter should be indexed under query=");
assert(index.parameterByItemAndName.has("messages_find_conversation.get"), "native get alias should be indexed");
assert(index.parameterByItemAndName.has("messages_find_conversation.conversation"), "native scope alias should be indexed");
assert((index.directDependencies.get("messages_find_conversation") || []).includes("query_com_apple_mobile_sms_conversation_entity"), "inline parameter type should be indexed as a dependency");
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
