"use strict";

const assert = require("assert");
const { parseAppleDiagnostic } = require("../src/diagnostics");

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

console.log("diagnostics-ok");
