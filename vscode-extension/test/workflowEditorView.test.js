"use strict";

const assert = require("assert");
const { workflowEditorHtml, workflowEditorToolbarHtml } = require("../src/workflowEditorView");

const toolbar = workflowEditorToolbarHtml("A & B.shortcut");
const tierOffsets = ["session", "authoring", "sync"].map((tier) =>
  toolbar.indexOf(`data-tier="${tier}"`)
);
assert(tierOffsets.every((offset) => offset >= 0), "all three toolbar tiers must render");
assert(tierOffsets[0] < tierOffsets[1] && tierOffsets[1] < tierOffsets[2], "toolbar tiers must keep their intended order");
for (const label of ["Search Actions", "Search Triggers", "Validate", "Build Shortcut"]) {
  assert(toolbar.includes(`>${label}</button>`), `${label} must be a labeled authoring control`);
}
assert(toolbar.includes('data-command="loadToolkit"'));
const toolkitButton = toolbar.match(/<button[^>]*data-command="loadToolkit"[^>]*>/);
assert(toolkitButton && /\shidden(?:\s|>)/.test(toolkitButton[0]), "conditional ToolKit control must start hidden until state arrives");
assert(toolbar.includes("A &amp; B.shortcut"), "status text must be HTML escaped");

const html = workflowEditorHtml("Example.shortcut", "test-nonce-123");
assert(html.includes("default-src 'none'"), "webview must default-deny content sources");
assert(html.includes("script-src 'nonce-test-nonce-123'"), "webview script must use its CSP nonce");
assert(html.includes('<script nonce="test-nonce-123">'));
assert(html.includes('role="toolbar" aria-label="Shortcut authoring"'));
assert.throws(() => workflowEditorHtml("Example.shortcut", "bad nonce"), /CSP-safe webview nonce/);

console.log("workflow-editor-view-ok");
