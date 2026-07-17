"use strict";

const assert = require("assert");
const { parseAppleDiagnostic } = require("../src/diagnostics");
const { collectToolRendererDiagnostics, parameterInfoAt } = require("../src/shortpyDiagnostics");
const { indexToolRendererMetadata } = require("../src/toolrenderer");
const { buildDiagnosticReport } = require("../scripts/diagnose-shortpy");

const message = `Error at Line 2, Column 5

    com_apple_shortcuts_not_real()
    |
    |> unknownAction [B0003]

Unknown action 'com_apple_shortcuts_not_real'.

Hints:
- Did you mean 'com_apple_shortcuts_nothing'?

Fix-its:
  1. Replace with 'com_apple_shortcuts_nothing'
`;

const parsed = parseAppleDiagnostic(message);
assert.strictEqual(parsed.line, 2);
assert.strictEqual(parsed.column, 5);
assert.strictEqual(parsed.code, "B0003");
assert.strictEqual(parsed.marker, "unknownAction");
assert.deepStrictEqual(parsed.hints, ["Did you mean 'com_apple_shortcuts_nothing'?"]);
assert.strictEqual(parsed.fixIts.length, 1);
assert.strictEqual(parsed.fixIts[0].kind, "replace-word");
assert.strictEqual(parsed.fixIts[0].replacement, "com_apple_shortcuts_nothing");

const toolRenderer = indexToolRendererMetadata({
  actions: [
    {
      kind: "action",
      pythonName: "com_visible_action",
      parameterValidation: "closed",
      parameters: [{ pythonName: "title" }],
    },
    {
      kind: "action",
      pythonName: "com_native_widened_action",
      parameterValidation: "closed",
      parameters: [{ pythonName: "message" }],
    },
    {
      kind: "action",
      pythonName: "messages_find_conversation",
      parameterValidation: "closed",
      parameters: [
        {
          pythonName: "query",
          type: "List[query_com_apple_mobile_sms_conversation_entity]",
        },
        { pythonName: "query_operator", type: "QUERY_OPERATOR", defaultValue: "QUERY_OPERATOR.ALL" },
        { pythonName: "sort_by", type: "Optional[str]", defaultValue: "None" },
        { pythonName: "query_sort_order", type: "QUERY_SORT_ORDER", defaultValue: "QUERY_SORT_ORDER.ASCENDING" },
        { pythonName: "limit", type: "Optional[int]", defaultValue: "None" },
        { pythonName: "scope", type: "Optional[str]", defaultValue: "None" },
      ],
    },
    {
      kind: "action",
      pythonName: "reminders_find_reminders",
      parameterValidation: "closed",
      parameters: [
        {
          pythonName: "query",
          type: "List[query_com_apple_shortcuts_wfreminder_content_item]",
        },
        { pythonName: "query_operator", type: "QUERY_OPERATOR", defaultValue: "QUERY_OPERATOR.ALL" },
        { pythonName: "sort_by", type: "Optional[filter_reminders_wfcontent_item_sort_property]", defaultValue: "None" },
        { pythonName: "query_sort_order", type: "QUERY_SORT_ORDER", defaultValue: "QUERY_SORT_ORDER.ASCENDING" },
        { pythonName: "limit", type: "Optional[int]", defaultValue: "None", acceptedNames: ["limit", "get"] },
        {
          pythonName: "scope",
          type: "Optional[filter_reminders_wfcontent_item_input_parameter]",
          defaultValue: "None",
          acceptedNames: ["scope", "reminders"],
        },
      ],
    },
  ],
});
const widenedDiagnostics = collectToolRendererDiagnostics(
  [
    "def shortcut() -> None:",
    "    com_native_widened_action(message=\"ok\")",
    "    com_native_widened_action(bogus=True)",
    "",
  ].join("\n"),
  toolRenderer
);
assert(!widenedDiagnostics.some((diagnostic) => diagnostic.code === "unknownShortcutsCommand"));
assert(widenedDiagnostics.some((diagnostic) =>
  diagnostic.code === "unknownShortcutsParameter" &&
  diagnostic.commandName === "com_native_widened_action" &&
  /bogus/.test(diagnostic.message)
));

const inlineSource = [
  "def shortcut() -> None:",
  "    messages_find_conversation(query=[conversation_filters.date_is_today()], sort_by=None)",
  "",
].join("\n");
const inlineColumn = inlineSource.split(/\r?\n/)[1].indexOf("query") + 2;
const inlineInfo = parameterInfoAt(inlineSource, 1, inlineColumn, [toolRenderer]);
assert(inlineInfo, "inline query keyword should resolve to a parameter hover");
assert.strictEqual(inlineInfo.name, "query");
assert.strictEqual(inlineInfo.parameter.type, "List[query_com_apple_mobile_sms_conversation_entity]");
const sortByColumn = inlineSource.split(/\r?\n/)[1].indexOf("sort_by") + 2;
const sortByInfo = parameterInfoAt(inlineSource, 1, sortByColumn, [toolRenderer]);
assert(sortByInfo, "keyword argument should still resolve to a parameter hover");
assert.strictEqual(sortByInfo.name, "sort_by");
assert(!collectToolRendererDiagnostics(inlineSource, toolRenderer).some((diagnostic) =>
  diagnostic.code === "unknownShortcutsParameter" && /query/.test(diagnostic.message)
), "query= should be accepted for ToolRenderer inline query parameters");

const filterSource = [
  "def shortcut() -> None:",
  "    reminders = reminders_find_reminders(query=[reminder_filters.is_completed_equal_to(bool=False)])",
  "    reminders_find_reminders(query=[reminder_filters.due_date_is_today()], query_operator=QUERY_OPERATOR.ANY, query_sort_order=QUERY_SORT_ORDER.ASCENDING, limit=5, scope=reminders)",
  "    reminders_find_reminders(query=[reminder_filters.due_date_is_today()], get=5, reminders=reminders)",
  "",
].join("\n");
const filterDiagnostics = collectToolRendererDiagnostics(filterSource, toolRenderer);
assert(!filterDiagnostics.some((diagnostic) =>
  diagnostic.code === "unknownShortcutsParameter" &&
  /query_operator|query_sort_order|limit|scope|get|reminders/.test(diagnostic.message)
), "expanded filter action parameters and native aliases should be accepted");
assert(filterDiagnostics.length === 0, `filter source should not produce diagnostics: ${JSON.stringify(filterDiagnostics)}`);
const scopeColumn = filterSource.split(/\r?\n/)[2].indexOf("scope") + 2;
const scopeInfo = parameterInfoAt(filterSource, 2, scopeColumn, [toolRenderer]);
assert(scopeInfo, "expanded filter scope keyword should resolve to a parameter hover");
assert.strictEqual(scopeInfo.name, "scope");
assert.strictEqual(scopeInfo.parameter.type, "Optional[filter_reminders_wfcontent_item_input_parameter]");
const nativeScopeColumn = filterSource.split(/\r?\n/)[3].indexOf("reminders=") + 2;
const nativeScopeInfo = parameterInfoAt(filterSource, 3, nativeScopeColumn, [toolRenderer]);
assert(nativeScopeInfo, "native filter scope alias should resolve to the scope parameter hover");
assert.strictEqual(nativeScopeInfo.parameter.pythonName, "scope");

const builtinsIndex = indexToolRendererMetadata({});
const builtinSource = [
  "def shortcut() -> None:",
  "    reminders_find_reminders(query=[reminder_filters.due_date_less_than(date=shortcuts_builtin_current_date())])",
  "    com_visible_action(title=f\"{shortcuts_builtin_clipboard()}\")",
  "",
].join("\n");
assert(builtinsIndex.byName.has("shortcuts_builtin_current_date"), "Shortpy builtin current date should be indexed");
assert(builtinsIndex.byName.has("shortcuts_builtin_clipboard"), "Shortpy builtin clipboard should be indexed");
assert(!collectToolRendererDiagnostics(builtinSource, [toolRenderer, builtinsIndex]).some((diagnostic) =>
  diagnostic.code === "unknownShortcutsCommand" && /shortcuts_builtin/.test(diagnostic.message)
), "Shortpy builtin helpers should not be flagged as unknown actions");

const probeReport = buildDiagnosticReport(
  "def shortcut() -> None:\n    com_missing_action()\n",
  toolRenderer,
  { sourcePath: "fixture.py", metadataPath: "metadata.json" }
);
assert.strictEqual(probeReport.diagnosticCount, 1);
assert.deepStrictEqual(probeReport.diagnostics[0].range, {
  start: { line: 2, column: 5 },
  end: { line: 2, column: 23 },
});
assert.strictEqual(
  probeReport.diagnostics[0].highlight,
  "    com_missing_action()\n    ^^^^^^^^^^^^^^^^^^"
);

const incompleteIndex = indexToolRendererMetadata({
  actions: [
    {
      kind: "action",
      pythonName: "com_incomplete_action",
      definitionMissing: true,
      parameters: [{ pythonName: "value" }],
    },
    {
      kind: "action",
      pythonName: "calculator_calculate",
      definitionBlock: "def calculator_calculate(operand=None, operand=None):",
      parameters: [{ pythonName: "operand" }, { pythonName: "operand" }],
    },
  ],
});
const incompleteDiagnostics = collectToolRendererDiagnostics([
  "def shortcut() -> None:",
  "    com_incomplete_action(exported_alias=True)",
  "    calculator_calculate(math_operand=1)",
  "    rich_text(_from=source)",
  "",
].join("\n"), incompleteIndex);
assert.strictEqual(incompleteDiagnostics.length, 0, "incomplete ToolRenderer surfaces and conversion helpers must fail open");

console.log("diagnostics-ok");
