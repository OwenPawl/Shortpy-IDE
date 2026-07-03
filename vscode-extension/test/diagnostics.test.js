"use strict";

const assert = require("assert");
const { parseAppleDiagnostic } = require("../src/diagnostics");
const { collectToolRendererDiagnostics, parameterInfoAt } = require("../src/shortpyDiagnostics");
const { indexToolRendererMetadata } = require("../src/toolrenderer");

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
      parameters: [{ pythonName: "title" }],
    },
    {
      kind: "action",
      pythonName: "com_native_widened_action",
      parameters: [{ pythonName: "message" }],
    },
    {
      kind: "action",
      pythonName: "messages_find_conversation",
      parameters: [
        {
          pythonName: "",
          type: "query_com_apple_mobile_sms_conversation_entity",
          inline: true,
          positional: true,
        },
        { pythonName: "sort_by" },
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
  "    messages_find_conversation(query_com_apple_mobile_sms_conversation_entity(), sort_by=None)",
  "",
].join("\n");
const inlineColumn = inlineSource.split(/\r?\n/)[1].indexOf("query_com_apple") + 8;
const inlineInfo = parameterInfoAt(inlineSource, 1, inlineColumn, [toolRenderer]);
assert(inlineInfo, "inline positional argument should resolve to a parameter hover");
assert.strictEqual(inlineInfo.name, "inline argument");
assert.strictEqual(inlineInfo.parameter.type, "query_com_apple_mobile_sms_conversation_entity");
const sortByColumn = inlineSource.split(/\r?\n/)[1].indexOf("sort_by") + 2;
const sortByInfo = parameterInfoAt(inlineSource, 1, sortByColumn, [toolRenderer]);
assert(sortByInfo, "keyword argument should still resolve to a parameter hover");
assert.strictEqual(sortByInfo.name, "sort_by");

console.log("diagnostics-ok");
