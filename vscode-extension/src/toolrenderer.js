"use strict";

const fs = require("fs/promises");
const { runBridgeCli } = require("./bridge");

const QUERY_STOPWORDS = new Set(["a", "an", "and", "for", "i", "in", "me", "my", "of", "on", "the", "to"]);
const STABLE_ENUMS_WITH_CASES = new Set([
  "RunSurface",
  "InputFallback",
  "QUERY_OPERATOR",
  "QUERY_SORT_ORDER",
  "DateUnit",
]);
const TYPE_DEPENDENCY_WRAPPERS = new Set([
  "Any",
  "Callable",
  "Dict",
  "Enum",
  "Generic",
  "List",
  "Literal",
  "None",
  "Optional",
  "Picked",
  "Resolved",
  "Set",
  "Tuple",
  "TypeVar",
  "Union",
  "bool",
  "bytes",
  "dict",
  "float",
  "int",
  "list",
  "set",
  "str",
  "tuple",
]);
const VISIBLE_ITEM_DENYLIST = new Set([
  "bindingSource",
  "canonicalizedFrom",
  "canonicalizationSource",
  "customDescription",
  "toolkitDisplayName",
]);
const VISIBLE_PARAMETER_DENYLIST = new Set([
  "binding",
  "catalog",
  "customDescription",
  "key",
  "rawKey",
  "sortOrder",
]);

const SHORTPY_BUILTIN_HELPERS = [
  {
    pythonName: "shortcuts_builtin_ask",
    displayName: "Ask Each Time",
    signature: "def shortcuts_builtin_ask(prompt: Optional[str] = None) -> Any:",
    returnType: "Any",
    parameters: [
      {
        pythonName: "prompt",
        type: "Optional[str]",
        defaultValue: "None",
        doc: "The str used to prompt the user.",
      },
    ],
    documentation: [
      "Ask Each Time",
      "Represents a value which will be chosen by the user at runtime.",
      "The prompt string is shown to the user at runtime to give the user context as they choose a value.",
      "This function must only be used as a parameter to another function or inside a f-string.",
      "It can not be used directly in either a variable assignment or a control flow statement.",
      "The return type is always the type expected by the parameter of the function this value is passed to.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_ask(",
      "    prompt: Optional[str] = None,",
      ") -> Any:",
      "    \"\"\"Ask Each Time",
      "    Represents a value which will be chosen by the user at runtime.",
      "    The prompt string is shown to the user at runtime to give the user context as they choose a value.",
      "    This function must only be used as a parameter to another function or inside a f-string.",
      "    It can not be used directly in either a variable assignment or a control flow statement.",
      "",
      "    The return type is always the type expected by the parameter of the function this value is passed to.",
      "    Args:",
      "        prompt: The str used to prompt the user",
      "    Returns:",
      "        Any",
      "    \"\"\"",
    ].join("\n"),
  },
  {
    pythonName: "shortcuts_builtin_current_date",
    displayName: "Current Date",
    signature: "def shortcuts_builtin_current_date() -> DateTime:",
    returnType: "DateTime",
    documentation: [
      "Current Date",
      "A shortcut can access the current date as a variable.",
      "Returns the current date.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_current_date() -> DateTime:",
      "    \"\"\"Current Date",
      "    A shortcut can access the current date as a variable.",
      "    Returns the current date.",
      "    Returns:",
      "        DateTime",
      "    \"\"\"",
    ].join("\n"),
  },
  {
    pythonName: "shortcuts_builtin_current_app",
    displayName: "Current App",
    signature: "def shortcuts_builtin_current_app() -> App:",
    returnType: "App",
    documentation: [
      "Current App",
      "A shortcut can access the current foreground app as a variable.",
      "Returns the current app that is in the foreground.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_current_app() -> App:",
      "    \"\"\"Current App",
      "    A shortcut can access the current foreground app as a variable.",
      "    Returns the current app that is in the foreground.",
      "    Returns:",
      "        App",
      "    \"\"\"",
    ].join("\n"),
  },
  {
    pythonName: "shortcuts_builtin_clipboard",
    displayName: "Clipboard",
    signature: "def shortcuts_builtin_clipboard() -> str:",
    returnType: "str",
    documentation: [
      "Clipboard",
      "A shortcut can access the clipboard contents as a variable.",
      "Returns the clipboard contents.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_clipboard() -> str:",
      "    \"\"\"Clipboard",
      "    A shortcut can access the clipboard contents as a variable.",
      "    Returns the clipboard contents.",
      "    Returns:",
      "        str",
      "    \"\"\"",
    ].join("\n"),
  },
  {
    pythonName: "shortcuts_builtin_device",
    displayName: "Device",
    signature: "def shortcuts_builtin_device() -> getdevicedetails_wfdevice_detail:",
    returnType: "getdevicedetails_wfdevice_detail",
    documentation: [
      "Device",
      "Returns an object containing details about the current device.",
      "The object has properties like device type (Phone, Mac, etc.) and OS version.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_device() -> getdevicedetails_wfdevice_detail:",
      "    \"\"\"Device",
      "    Returns an object containing details about the current device",
      "    The object has properties like device type (Phone, Mac, etc.) and OS version.",
      "    Returns:",
      "        getdevicedetails_wfdevice_detail",
      "    \"\"\"",
    ].join("\n"),
  },
  {
    pythonName: "shortcuts_builtin_choose",
    displayName: "Choose",
    signature: "def shortcuts_builtin_choose(prompt: Optional[str] = None) -> str:",
    returnType: "str",
    parameters: [
      {
        pythonName: "prompt",
        type: "Optional[str]",
        defaultValue: "None",
        doc: "Prompt shown to the user to give them context for their choice.",
      },
    ],
    documentation: [
      "Choose",
      "Prompts the user to choose from one of several choices.",
      "This function is only valid when used in a Python match-case construct.",
      "The cases are presented to the user as choices.",
    ].join("\n"),
    definitionBlock: [
      "def shortcuts_builtin_choose(",
      "    prompt: Optional[str] = None,",
      ") -> str:",
      "    \"\"\"Choose",
      "    Prompts the user to choose from one of several choices.",
      "    This function is only valid when used in a Python match-case construct.",
      "    The cases are presented to the user as choices.",
      "    Args:",
      "        prompt: Prompt shown to the user to give them context for their choice",
      "    Returns:",
      "        str",
      "    \"\"\"",
    ].join("\n"),
  },
].map((item) => ({
  kind: "helper",
  source: "shortpy-builtin",
  ...item,
}));

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (Array.isArray(value)) {
      for (const nested of value) {
        if (typeof nested === "string" && nested && !seen.has(nested)) {
          seen.add(nested);
          out.push(nested);
        }
      }
      continue;
    }
    if (typeof value === "string" && value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function allParameterNames(parameter) {
  if (!parameter || typeof parameter !== "object") {
    return [];
  }
  return uniqueStrings([
    parameter.pythonName,
    parameter.name,
    parameter.key,
    parameter.rawKey,
    parameter.aliases,
    parameter.acceptedNames,
  ]);
}

function pythonNameFromLabel(value) {
  if (typeof value !== "string") {
    return "";
  }
  const words = [];
  for (let token of value.match(/[0-9A-Za-z]+/g) || []) {
    if (/^[A-Z0-9]+$/.test(token) || (/^[A-Z0-9]+s$/.test(token) && token.length > 1)) {
      words.push(token.toLowerCase());
      continue;
    }
    token = token.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
    token = token.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    words.push(...token.split("_").filter(Boolean).map((part) => part.toLowerCase()));
  }
  return words.join("_");
}

function compilerParameterNames(parameter) {
  if (!parameter || typeof parameter !== "object") {
    return [];
  }
  const names = uniqueStrings([
    parameter.pythonName,
    parameter.name,
    parameter.aliases,
    parameter.acceptedNames,
  ]).filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
  for (const rawName of uniqueStrings([parameter.key, parameter.rawKey])) {
    const withoutPrefix = rawName.startsWith("WF") ? rawName.slice(2) : rawName;
    const normalized = pythonNameFromLabel(withoutPrefix);
    if (normalized && !names.includes(normalized)) {
      names.push(normalized);
    }
  }
  return names;
}

function parseDocSections(documentation) {
  const rawLines = Array.isArray(documentation)
    ? documentation
    : String(documentation || "").split(/\r?\n/);
  const cleaned = rawLines.map((line) => String(line || "").trim()).filter(Boolean);
  const narrative = [];
  const parameterDocs = {};
  const returnDocs = [];
  let section = "narrative";
  let activeParam = "";
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "Args:") {
      section = "args";
      activeParam = "";
      continue;
    }
    if (trimmed === "Returns:") {
      section = "returns";
      activeParam = "";
      continue;
    }
    if (section === "args") {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)?\s*:\s*(.*)$/.exec(trimmed);
      if (match) {
        activeParam = match[1] || "";
        parameterDocs[activeParam] = match[2].trim();
      } else if (activeParam || Object.prototype.hasOwnProperty.call(parameterDocs, "")) {
        parameterDocs[activeParam] = `${parameterDocs[activeParam]} ${trimmed}`.trim();
      }
      continue;
    }
    if (section === "returns") {
      returnDocs.push(trimmed);
      continue;
    }
    narrative.push(trimmed);
  }
  const displayName = narrative[0] || cleaned[0] || "";
  const summary = narrative.slice(1).join("\n");
  return {
    displayName,
    summary,
    narrative,
    parameterDocs,
    returnDocs: returnDocs.join("\n"),
  };
}

function isStableEnumWithCases(itemOrName) {
  const name = typeof itemOrName === "string"
    ? itemOrName
    : String(itemOrName && itemOrName.pythonName || "");
  return STABLE_ENUMS_WITH_CASES.has(name);
}

function isRuntimeSpecificMetadata(itemOrName) {
  if (typeof itemOrName === "string") {
    return itemOrName.toLowerCase().includes("dynamic");
  }
  const item = itemOrName || {};
  const haystack = [
    item.pythonName,
    item.nativeIdentifier,
    item.id,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return haystack.includes("dynamic");
}

function shouldExposeEnumCases(item) {
  return Boolean(item && item.kind === "enum");
}

function mergeDocSections(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  const docs = String(item.documentation || item.docString || "");
  const sections = {
    ...parseDocSections(docs),
    ...(item.docSections || {}),
  };
  const clean = {
    ...item,
    docSections: sections,
    definitionBlock: item.definitionBlock || "",
  };
  if (!clean.displayName && sections.displayName) {
    clean.displayName = sections.displayName;
  }
  if (!clean.summary && sections.summary) {
    clean.summary = sections.summary;
  }
  if (!clean.returnDocs && sections.returnDocs) {
    clean.returnDocs = sections.returnDocs;
  }
  if (Array.isArray(clean.parameters)) {
    clean.parameters = clean.parameters.map((parameter) => {
      if (!parameter || typeof parameter !== "object") {
        return parameter;
      }
      const name = parameter.pythonName || parameter.name;
      const doc = name ? sections.parameterDocs[name] : undefined;
      return {
        ...parameter,
        doc: parameter.doc || parameter.summary || doc,
        summary: parameter.summary || parameter.doc || doc,
      };
    });
  }
  return clean;
}

function extractTypeNames(value) {
  const names = new Set();
  const text = String(value || "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name = match[0];
    if (!TYPE_DEPENDENCY_WRAPPERS.has(name)) {
      names.add(name);
    }
  }
  return [...names];
}

function directDependenciesForItem(item, typeByPythonName) {
  const names = new Set();
  for (const source of [item && item.returnType, item && item.aliasedTo, ...(item && item.bases || [])]) {
    for (const name of extractTypeNames(source)) {
      names.add(name);
    }
  }
  for (const parameter of Array.isArray(item && item.parameters) ? item.parameters : []) {
    for (const source of [parameter.type, parameter.defaultValue]) {
      for (const name of extractTypeNames(source)) {
        names.add(name);
      }
    }
  }
  names.delete(item && item.pythonName);
  return [...names].filter((name) => !typeByPythonName || typeByPythonName.has(name)).sort();
}

function validateToolRendererTypeReferences(metadata) {
  const types = Array.isArray(metadata && metadata.types) ? metadata.types : [];
  const knownTypes = new Set(types.map((item) => item && item.pythonName).filter(Boolean));
  const missing = new Map();
  for (const item of [
    ...(metadata && metadata.helpers || []),
    ...(metadata && metadata.actions || []),
    ...(metadata && metadata.triggers || []),
    ...types,
  ]) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const owner = String(item.pythonName || "<unnamed>");
    const sources = [item.returnType, item.aliasedTo, ...(item.bases || [])];
    for (const parameter of Array.isArray(item.parameters) ? item.parameters : []) {
      sources.push(parameter && parameter.type);
    }
    for (const source of sources) {
      for (const name of extractTypeNames(source)) {
        if (!knownTypes.has(name) && !name.startsWith("query_")) {
          if (!missing.has(name)) {
            missing.set(name, new Set());
          }
          missing.get(name).add(owner);
        }
      }
    }
  }
  if (missing.size > 0) {
    const details = [...missing.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, owners]) => `${name} referenced by ${[...owners].sort().slice(0, 5).join(", ")}`)
      .join("; ");
    const error = new Error(`ToolRenderer structured metadata is missing native type definitions: ${details}`);
    error.code = "missing_toolrenderer_type_definitions";
    throw error;
  }
}

async function fetchToolRendererResponse(options = {}) {
  if (options.live === true) {
    return runBridgeCli(["toolrenderer-structured-metadata"], options);
  }
  try {
    const response = await runBridgeCli(["toolrenderer-structured-metadata", "--cached"], options);
    response.cached = true;
    return response;
  } catch (cachedError) {
    if (options.allowLiveFallback === false) {
      throw cachedError;
    }
    const response = await runBridgeCli(["toolrenderer-structured-metadata"], options);
    response.cached_metadata_error = cachedError.message;
    return response;
  }
}

function sanitizeToolRendererParameter(parameter) {
  if (!parameter || typeof parameter !== "object") {
    return parameter;
  }
  const clean = {};
  for (const [key, value] of Object.entries(parameter)) {
    if (!VISIBLE_PARAMETER_DENYLIST.has(key)) {
      clean[key] = value;
    }
  }
  const acceptedNames = compilerParameterNames(parameter);
  if (acceptedNames.length > 0) {
    clean.acceptedNames = acceptedNames;
  }
  return clean;
}

function sanitizeToolRendererItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  const clean = {};
  for (const [key, value] of Object.entries(item)) {
    if (!VISIBLE_ITEM_DENYLIST.has(key)) {
      clean[key] = value;
    }
  }
  if (Array.isArray(clean.parameters)) {
    clean.parameters = clean.parameters.map(sanitizeToolRendererParameter);
  }
  return mergeDocSections(clean);
}

function sanitizeToolRendererMetadata(metadata) {
  const input = metadata || {};
  const helpers = (Array.isArray(input.helpers) ? input.helpers : []).map(sanitizeToolRendererItem);
  const actions = (Array.isArray(input.actions) ? input.actions : []).map(sanitizeToolRendererItem);
  const triggers = (Array.isArray(input.triggers) ? input.triggers : []).map(sanitizeToolRendererItem);
  const types = (Array.isArray(input.types) ? input.types : []).map(sanitizeToolRendererItem);
  const items = [...helpers, ...actions, ...triggers];
  return {
    ...input,
    source: "ToolRenderer.pythonInterface",
    helpers,
    actions,
    triggers,
    types,
    items,
    counts: {
      ...(input.counts || {}),
      helpers: helpers.length,
      actions: actions.length,
      triggers: triggers.length,
      types: types.length,
      items: items.length,
    },
    customDescriptionSource: undefined,
    customDescriptionCounts: undefined,
  };
}

function metadataFromStructuredResponse(response) {
  if (!response || !Array.isArray(response.items)) {
    const error = new Error("bridgectl returned no structured ToolRenderer items");
    error.code = "missing_structured_toolrenderer_metadata";
    throw error;
  }
  const items = response.items;
  const metadata = {
    ok: true,
    source: response.source || "toolrenderer-structured-metadata",
    generatedAt: response.generatedAt || new Date().toISOString(),
    counts: response.counts || {},
    items,
    actions: Array.isArray(response.actions)
      ? response.actions
      : items.filter((item) => item.kind === "action"),
    triggers: Array.isArray(response.triggers)
      ? response.triggers
      : items.filter((item) => item.kind === "trigger"),
    helpers: Array.isArray(response.helpers)
      ? response.helpers
      : items.filter((item) => !["action", "trigger"].includes(item.kind)),
    types: Array.isArray(response.types) ? response.types : [],
    diagnostics: Array.isArray(response.diagnostics) ? response.diagnostics : [],
    response: {
      python_length: response.python_length,
      contains_trigger: response.contains_trigger,
      contains_shortcut: response.contains_shortcut,
      structured_metadata_error: response.structured_metadata_error,
      cached_metadata_error: response.cached_metadata_error,
      cached: response.cached,
      provider_symbols: response.provider_symbols,
    },
  };
  validateToolRendererTypeReferences(metadata);
  return metadata;
}

async function refreshToolRendererMetadata(metadataPath, options = {}) {
  const response = await fetchToolRendererResponse(options);
  const metadata = sanitizeToolRendererMetadata(metadataFromStructuredResponse(response));
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

async function loadToolRendererMetadata(metadataPath) {
  const data = await fs.readFile(metadataPath, "utf8");
  const metadata = JSON.parse(data);
  validateToolRendererTypeReferences(metadata);
  return sanitizeToolRendererMetadata(metadata);
}

function indexToolRendererMetadata(metadata) {
  const byName = new Map();
  const itemByPythonName = new Map();
  const parameterByItemAndName = new Map();
  const typeByPythonName = new Map();
  const definitionBlocks = new Map();
  const directDependencies = new Map();
  const actions = Array.isArray(metadata && metadata.actions) ? metadata.actions : [];
  const triggers = Array.isArray(metadata && metadata.triggers) ? metadata.triggers : [];
  const metadataHelpers = Array.isArray(metadata && metadata.helpers) ? metadata.helpers : [];
  const helperNames = new Set(metadataHelpers.map((item) => item && item.pythonName).filter(Boolean));
  const helpers = [
    ...metadataHelpers,
    ...SHORTPY_BUILTIN_HELPERS.filter((item) => !helperNames.has(item.pythonName)),
  ];
  const metadataTypes = Array.isArray(metadata && metadata.types) ? metadata.types : [];
  const types = metadataTypes;
  for (const type of types) {
    if (type && type.pythonName) {
      typeByPythonName.set(type.pythonName, type);
    }
  }
  for (const item of [...helpers, ...actions, ...triggers, ...types]) {
    if (item && item.pythonName) {
      byName.set(item.pythonName, item);
      itemByPythonName.set(item.pythonName, item);
      if (item.definitionBlock) {
        definitionBlocks.set(item.pythonName, item.definitionBlock);
      }
      directDependencies.set(item.pythonName, directDependenciesForItem(item, typeByPythonName));
      for (const parameter of Array.isArray(item.parameters) ? item.parameters : []) {
        for (const parameterName of allParameterNames(parameter)) {
          if (parameterName) {
            parameterByItemAndName.set(`${item.pythonName}.${parameterName}`, { item, parameter });
          }
        }
      }
      if (shouldExposeEnumCases(item)) {
        for (const enumCase of item.cases || []) {
          if (!enumCase || !enumCase.pythonName) {
            continue;
          }
        byName.set(enumCase.pythonName, { ...enumCase, kind: "enumCase", enumName: item.pythonName });
          itemByPythonName.set(enumCase.pythonName, { ...enumCase, kind: "enumCase", enumName: item.pythonName });
        }
      }
    }
  }
  return {
    byName,
    itemByPythonName,
    parameterByItemAndName,
    typeByPythonName,
    definitionBlocks,
    directDependencies,
    actions,
    triggers,
    helpers,
    types,
  };
}

function queryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term && !QUERY_STOPWORDS.has(term));
}

function itemSearchKind(item) {
  if (!item) {
    return "helper";
  }
  if (item.kind === "action") {
    return "tool";
  }
  if (item.kind === "trigger") {
    return "trigger";
  }
  return item.kind || "helper";
}

function scoreToolRendererItem(item, terms) {
  const name = String(item.pythonName || "").toLowerCase();
  const display = String(item.displayName || "").toLowerCase();
  const docs = String(item.documentation || item.docString || item.summary || "").toLowerCase();
  const signature = String(item.signature || "").toLowerCase();
  const enumCases = (item.cases || []).map((entry) => `${entry.name} ${entry.value}`).join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) {
      score += 12;
    }
    if (display.includes(term)) {
      score += 8;
    }
    if (signature.includes(term)) {
      score += 3;
    }
    if (enumCases.includes(term)) {
      score += 2;
    }
    if (docs.includes(term)) {
      score += 1;
    }
  }
  const haystack = `${name} ${display} ${signature} ${docs} ${enumCases}`;
  if (terms.length > 0 && terms.every((term) => haystack.includes(term))) {
    score += 10;
  }
  return score;
}

function allIndexedItems(indexOrMetadata) {
  const index = indexOrMetadata && indexOrMetadata.byName
    ? indexOrMetadata
    : indexToolRendererMetadata(indexOrMetadata || {});
  return [
    ...(Array.isArray(index.helpers) ? index.helpers : []),
    ...(Array.isArray(index.actions) ? index.actions : []),
    ...(Array.isArray(index.triggers) ? index.triggers : []),
    ...(Array.isArray(index.types) ? index.types : []),
  ];
}

function searchToolRendererMetadata(indexOrMetadata, query, kind = "all", limit = 20) {
  const terms = queryTerms(query);
  const allowed = kind === "tool"
    ? new Set(["tool"])
    : kind === "trigger"
      ? new Set(["trigger"])
      : kind === "type"
        ? new Set(["class", "enum", "typeAlias"])
        : new Set(["tool", "trigger", "helper", "decorator", "class", "enum", "typeAlias"]);
  const ranked = [];
  for (const item of allIndexedItems(indexOrMetadata)) {
    const searchKind = itemSearchKind(item);
    if (!allowed.has(searchKind)) {
      continue;
    }
    const score = scoreToolRendererItem(item, terms);
    if (score > 0 || terms.length === 0) {
      ranked.push({ ...item, searchKind, score });
    }
  }
  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.searchKind !== right.searchKind) {
      return left.searchKind.localeCompare(right.searchKind);
    }
    return String(left.pythonName || "").localeCompare(String(right.pythonName || ""));
  });
  return ranked.slice(0, Math.max(1, Number(limit) || 20));
}

module.exports = {
  indexToolRendererMetadata,
  isRuntimeSpecificMetadata,
  isStableEnumWithCases,
  loadToolRendererMetadata,
  metadataFromStructuredResponse,
  refreshToolRendererMetadata,
  sanitizeToolRendererMetadata,
  searchToolRendererMetadata,
};
