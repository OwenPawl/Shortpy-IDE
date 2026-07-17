"use strict";

const CUSTOM_EDITOR_VIEW_TYPE = "shortcutsRuntimeIDE.workflowEditor";
const CUSTOM_EDITOR_TIER_ORDER = ["session", "authoring", "sync"];

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
    commandPalette: { when: "shortcutsRuntimeIDE.bridgeCanConnect" },
  },
  {
    key: "disconnectBridge",
    command: "shortcutsRuntimeIDE.disconnectBridge",
    title: "Shortcuts IDE: Disconnect Bridge",
    commandPalette: { when: "shortcutsRuntimeIDE.bridgeCanDisconnect" },
  },
  {
    key: "saveRuntimePlistFromPython",
    command: "shortcutsRuntimeIDE.saveRuntimePlistFromPython",
    title: "Shortcuts IDE: Build Shortcut From Python",
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
    customEditor: { message: "validate", label: "Validate", tier: "authoring", order: 40 },
  },
  {
    key: "showCompilerTrace",
    command: "shortcutsRuntimeIDE.showCompilerTrace",
    title: "Shortcuts IDE: Show Compiler Trace",
  },
  {
    key: "syncToHostShortcuts",
    command: "shortcutsRuntimeIDE.syncToHostShortcuts",
    title: "Shortcuts IDE: Sync With Host Shortcuts",
    editorContext: { when: "editorLangId == python", group: "navigation@49" },
    customEditor: { message: "syncHost", label: "Sync With Host", tier: "sync", order: 60 },
  },
  {
    key: "toggleLiveSync",
    command: "shortcutsRuntimeIDE.toggleLiveSync",
    title: "Shortcuts IDE: Toggle Live Sync",
    editorContext: { when: "editorLangId == python", group: "navigation@48" },
    customEditor: { message: "toggleLiveSync", label: "Live Sync", tier: "sync", order: 70 },
  },
  {
    key: "openHostShortcutEditor",
    command: "shortcutsRuntimeIDE.openHostShortcutEditor",
    title: "Shortcuts IDE: Open Shortcut Editor",
    editorContext: { when: "editorLangId == python", group: "navigation@47" },
    customEditor: { message: "openHostShortcutEditor", label: "Open in Shortcuts", tier: "session", order: 21 },
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
    customEditor: { message: "searchActions", label: "Search Actions", tier: "authoring", order: 30 },
  },
  {
    key: "searchTriggers",
    command: "shortcutsRuntimeIDE.searchTriggers",
    title: "Shortcuts IDE: Retrieve Relevant Triggers",
    customEditor: { message: "searchTriggers", label: "Search Triggers", tier: "authoring", order: 31 },
  },
  {
    key: "loadToolkitSqlite",
    command: "shortcutsRuntimeIDE.loadToolkitSqlite",
    title: "Shortcuts IDE: Load ToolKit SQLite",
    customEditor: {
      message: "loadToolkit",
      label: "Load ToolKit",
      tier: "sync",
      order: 80,
      conditional: "toolkitMissing",
    },
  },
];

const CUSTOM_EDITOR_LOCAL_ACTIONS = [
  { message: "toggleBridge", label: "Connect", tier: "session", order: 10, bridgeToggle: true },
  { message: "openPython", label: "Open Python Editor", primary: true, tier: "session", order: 20 },
  { message: "export", label: "Build Shortcut", primary: true, tier: "authoring", order: 50 },
  { message: "import", label: "Reload Python from Shortcut", tier: "sync", order: 90, overflow: true },
];

function customEditorActions() {
  return [
    ...VISIBLE_COMMANDS
      .filter((item) => item.customEditor)
      .map((item) => ({ ...item.customEditor, key: item.key })),
    ...CUSTOM_EDITOR_LOCAL_ACTIONS,
  ].sort((left, right) => (left.order || 0) - (right.order || 0));
}

function customEditorActionTiers() {
  const actions = customEditorActions();
  return CUSTOM_EDITOR_TIER_ORDER.map((id) => ({
    id,
    actions: actions.filter((action) => action.tier === id),
  }));
}

function packageActivationEvents() {
  return [
    ...BASE_ACTIVATION_EVENTS,
    ...VISIBLE_COMMANDS.map((item) => `onCommand:${item.command}`),
  ];
}

function packageCommands() {
  return VISIBLE_COMMANDS.map((item) => ({ command: item.command, title: item.title }));
}

function packageMenus() {
  const surfaces = [
    ["commandPalette", "commandPalette"],
    ["editor/context", "editorContext"],
    ["explorer/context", "explorerContext"],
  ];
  return Object.fromEntries(surfaces.map(([menu, field]) => [
    menu,
    VISIBLE_COMMANDS
      .filter((item) => item[field])
      .map((item) => ({ command: item.command, ...item[field] })),
  ]));
}

module.exports = {
  BASE_ACTIVATION_EVENTS,
  CUSTOM_EDITOR_VIEW_TYPE,
  VISIBLE_COMMANDS,
  customEditorActionTiers,
  packageActivationEvents,
  packageCommands,
  packageMenus,
};
