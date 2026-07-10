"use strict";

const CUSTOM_EDITOR_VIEW_TYPE = "shortcutsRuntimeIDE.workflowEditor";

const BASE_ACTIVATION_EVENTS = [
  "onStartupFinished",
  "onLanguage:python",
  `onCustomEditor:${CUSTOM_EDITOR_VIEW_TYPE}`,
];

const VISIBLE_COMMANDS = [
  {
    key: "connectBridge",
    command: "shortcutsRuntimeIDE.connectBridge",
    title: "Shortcuts IDE: Connect To Bridge",
    customEditor: { message: "connect", label: "Connect", order: 10 },
  },
  {
    key: "saveRuntimePlistFromPython",
    command: "shortcutsRuntimeIDE.saveRuntimePlistFromPython",
    title: "Shortcuts IDE: Export Python To Shortcut",
    editorContext: { when: "editorLangId == python", group: "navigation@50" },
  },
  {
    key: "writeSiblingRuntimePlistFromPython",
    command: "shortcutsRuntimeIDE.writeSiblingRuntimePlistFromPython",
    title: "Shortcuts IDE: Write Sibling Shortcut",
    editorContext: { when: "editorLangId == python", group: "navigation@51" },
  },
  {
    key: "validatePython",
    command: "shortcutsRuntimeIDE.validatePython",
    title: "Shortcuts IDE: Validate With Apple Runtime",
    editorContext: { when: "editorLangId == python", group: "navigation@52" },
    customEditor: { message: "validate", label: "Validate", primary: true, order: 30 },
  },
  {
    key: "syncToHostShortcuts",
    command: "shortcutsRuntimeIDE.syncToHostShortcuts",
    title: "Shortcuts IDE: Sync To Host Shortcuts",
    editorContext: { when: "editorLangId == python", group: "navigation@49" },
    customEditor: { message: "syncHost", label: "Sync To Host", primary: true, order: 45 },
  },
  {
    key: "openWorkflowPlistFromPython",
    command: "shortcutsRuntimeIDE.openWorkflowPlistFromPython",
    title: "Shortcuts IDE: Open Workflow Plist From Python",
    editorContext: { when: "editorLangId == python", group: "navigation@53" },
  },
  {
    key: "pythonToPlistDebugJson",
    command: "shortcutsRuntimeIDE.pythonToPlistDebugJson",
    title: "Shortcuts IDE: Python To Plist Debug JSON",
  },
  {
    key: "loadPythonFromPlist",
    command: "shortcutsRuntimeIDE.loadPythonFromPlist",
    title: "Shortcuts IDE: Import Plist As Python",
    editorContext: { group: "navigation@57" },
    explorerContext: { when: "resourceExtname == .shortcut || resourceExtname == .plist", group: "navigation@50" },
  },
  {
    key: "importICloudShortcutLink",
    command: "shortcutsRuntimeIDE.importICloudShortcutLink",
    title: "Shortcuts IDE: Import iCloud Link As Python",
    editorContext: { group: "navigation@58" },
  },
  {
    key: "searchActions",
    command: "shortcutsRuntimeIDE.searchActions",
    title: "Shortcuts IDE: Retrieve Relevant Actions",
    editorContext: { when: "editorLangId == python", group: "navigation@54" },
    customEditor: { message: "searchActions", label: "Search Actions", order: 60 },
  },
  {
    key: "searchTriggers",
    command: "shortcutsRuntimeIDE.searchTriggers",
    title: "Shortcuts IDE: Retrieve Relevant Triggers",
    editorContext: { when: "editorLangId == python", group: "navigation@55" },
    customEditor: { message: "searchTriggers", label: "Search Triggers", order: 70 },
  },
  {
    key: "refreshToolMetadata",
    command: "shortcutsRuntimeIDE.refreshToolMetadata",
    title: "Shortcuts IDE: Refresh ToolRenderer Metadata",
    editorContext: { when: "editorLangId == python", group: "navigation@56" },
    customEditor: { message: "refreshMetadata", label: "Refresh Metadata", order: 80 },
  },
  {
    key: "loadToolkitSqlite",
    command: "shortcutsRuntimeIDE.loadToolkitSqlite",
    title: "Shortcuts IDE: Load ToolKit SQLite",
    editorContext: { group: "navigation@59" },
    customEditor: { message: "loadToolkit", label: "Load ToolKit", order: 85 },
  },
  {
    key: "refreshToolRendererInterface",
    command: "shortcutsRuntimeIDE.refreshToolRendererInterface",
    title: "Shortcuts IDE: Refresh Native ToolRenderer Interface",
  },
];

const CUSTOM_EDITOR_LOCAL_ACTIONS = [
  { message: "openPython", label: "Open Python Editor", primary: true, order: 20 },
  { message: "export", label: "Export Plist", primary: true, order: 40 },
  { message: "import", label: "Reimport", order: 50 },
];

function customEditorActions() {
  return [
    ...VISIBLE_COMMANDS
      .filter((item) => item.customEditor)
      .map((item) => ({ ...item.customEditor, key: item.key })),
    ...CUSTOM_EDITOR_LOCAL_ACTIONS,
  ].sort((left, right) => (left.order || 0) - (right.order || 0));
}

function packageActivationEvents() {
  return [
    ...BASE_ACTIVATION_EVENTS,
    ...VISIBLE_COMMANDS.map((item) => `onCommand:${item.command}`),
  ];
}

function packageCommands() {
  return VISIBLE_COMMANDS.map((item) => ({
    command: item.command,
    title: item.title,
  }));
}

function packageMenus() {
  const editorContext = VISIBLE_COMMANDS
    .filter((item) => item.editorContext)
    .map((item) => ({ command: item.command, ...item.editorContext }));
  const explorerContext = VISIBLE_COMMANDS
    .filter((item) => item.explorerContext)
    .map((item) => ({ command: item.command, ...item.explorerContext }));
  return { "editor/context": editorContext, "explorer/context": explorerContext };
}

module.exports = {
  BASE_ACTIVATION_EVENTS,
  CUSTOM_EDITOR_VIEW_TYPE,
  VISIBLE_COMMANDS,
  customEditorActions,
  packageActivationEvents,
  packageCommands,
  packageMenus,
};
