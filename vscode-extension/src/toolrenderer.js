"use strict";

const fs = require("fs/promises");
const path = require("path");
const { runBridgeCli, runBridgeCommand } = require("./bridge");

const QUERY_STOPWORDS = new Set(["a", "an", "and", "for", "i", "in", "me", "my", "of", "on", "the", "to"]);
const DEFAULT_TOOLRENDERER_FRAMEWORK = "/Library/Developer/CoreSimulator/Volumes/iOS_24A5355p/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/System/Library/PrivateFrameworks/ToolRenderer.framework";

function splitTopLevelCommas(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    const prev = index > 0 ? value[index - 1] : "";
    if (quote) {
      if (ch === quote && prev !== "\\") {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function findMatchingParen(value, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < value.length; index += 1) {
    const ch = value[index];
    const prev = index > 0 ? value[index - 1] : "";
    if (quote) {
      if (ch === quote && prev !== "\\") {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseParameter(text) {
  const clean = String(text || "").replace(/,$/, "").trim();
  if (!clean || clean === "/" || clean === "*") {
    return undefined;
  }
  const hash = clean.indexOf("#");
  const body = hash >= 0 ? clean.slice(0, hash).trim() : clean;
  const comment = hash >= 0 ? clean.slice(hash + 1).trim() : "";
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$/.exec(body);
  if (!match) {
    return undefined;
  }
  return {
    pythonName: match[1],
    type: match[2] ? match[2].trim() : "",
    defaultValue: match[3] ? match[3].trim() : undefined,
    doc: comment || undefined,
    summary: comment || undefined,
  };
}

function parseParametersFromSignature(signature) {
  const openIndex = signature.indexOf("(");
  if (openIndex < 0) {
    return [];
  }
  const closeIndex = findMatchingParen(signature, openIndex);
  if (closeIndex < 0) {
    return [];
  }
  const body = signature.slice(openIndex + 1, closeIndex);
  return splitTopLevelCommas(body)
    .map(parseParameter)
    .filter(Boolean);
}

function parseReturnType(signature) {
  const openIndex = signature.indexOf("(");
  const closeIndex = openIndex >= 0 ? findMatchingParen(signature, openIndex) : -1;
  if (closeIndex < 0) {
    return "";
  }
  const tail = signature.slice(closeIndex + 1);
  const match = /->\s*([\s\S]+?)\s*:$/.exec(tail.trim());
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function docPayload(docs, endIndex) {
  const rawLines = docs.map((line) => line.replace(/\s+$/, ""));
  const cleaned = rawLines.map((line) => line.trim()).filter(Boolean);
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
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
      if (match) {
        activeParam = match[1];
        parameterDocs[activeParam] = match[2].trim();
      } else if (activeParam) {
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
    documentation: cleaned.join("\n"),
    parameterDocs,
    returnDocs: returnDocs.join("\n"),
    endIndex,
  };
}

function parseDocstring(lines, startIndex) {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  if (index >= lines.length || !lines[index].trim().startsWith('"""')) {
    return { displayName: "", summary: "", documentation: "", parameterDocs: {}, returnDocs: "", endIndex: startIndex };
  }
  const docs = [];
  let line = lines[index].trim();
  line = line.slice(3);
  if (line.endsWith('"""')) {
    docs.push(line.slice(0, -3));
    return docPayload(docs, index + 1);
  }
  if (line) {
    docs.push(line);
  }
  index += 1;
  while (index < lines.length) {
    const current = lines[index];
    const end = current.indexOf('"""');
    if (end >= 0) {
      docs.push(current.slice(0, end).trimEnd());
      return docPayload(docs, index + 1);
    }
    docs.push(current.trimEnd());
    index += 1;
  }
  return docPayload(docs, index);
}

function parseFunction(lines, startIndex, section) {
  const signatureLines = [];
  let index = startIndex;
  while (index < lines.length) {
    signatureLines.push(lines[index]);
    if (lines[index].trim().endsWith(":")) {
      break;
    }
    index += 1;
  }
  const signature = signatureLines.join("\n");
  const nameMatch = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(signatureLines[0].trim());
  if (!nameMatch) {
    return undefined;
  }
  const docs = parseDocstring(lines, index + 1);
  const pythonName = nameMatch[1];
  const parameters = parseParametersFromSignature(signature).map((parameter) => {
    const doc = docs.parameterDocs[parameter.pythonName];
    return {
      ...parameter,
      doc: parameter.doc || doc,
      summary: parameter.summary || doc,
    };
  });
  const kind = pythonName.startsWith("when_")
    ? "trigger"
    : section === "Triggers"
      ? "trigger"
      : section === "Actions"
        ? "action"
        : ["runnable", "input_fallback"].includes(pythonName)
          ? "decorator"
          : "helper";
  return {
    endIndex: Math.max(index + 1, docs.endIndex),
    item: {
      kind,
      pythonName,
      nativeIdentifier: undefined,
      displayName: docs.displayName || pythonName,
      docString: docs.documentation,
      summary: docs.summary,
      documentation: docs.documentation,
      signature,
      returnType: parseReturnType(signature),
      parameters,
      source: "ToolRenderer.pythonInterface",
    },
  };
}

function parseTypeAlias(line, priorComments) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
  if (!match) {
    return undefined;
  }
  if (["from", "import"].includes(match[1])) {
    return undefined;
  }
  return {
    kind: "typeAlias",
    pythonName: match[1],
    displayName: match[1],
    signature: line.trim(),
    aliasedTo: match[2].trim(),
    docString: priorComments.join("\n"),
    documentation: priorComments.join("\n"),
    source: "ToolRenderer.pythonInterface",
  };
}

function parseClass(lines, startIndex, priorComments) {
  const header = lines[startIndex].trim();
  const match = /^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?:\s*$/.exec(header);
  if (!match) {
    return undefined;
  }
  const pythonName = match[1];
  const bases = (match[2] || "").split(",").map((item) => item.trim()).filter(Boolean);
  const enumLike = bases.includes("Enum");
  const cases = [];
  const members = [];
  let index = startIndex + 1;
  const docs = parseDocstring(lines, index);
  index = Math.max(index, docs.endIndex);
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const trimmed = line.trim();
    const caseMatch = /^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
    if (caseMatch) {
      cases.push({
        pythonName: `${pythonName}.${caseMatch[1]}`,
        name: caseMatch[1],
        value: caseMatch[2].trim(),
      });
    }
    const methodMatch = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(?:->\s*([^:]+))?:/.exec(trimmed);
    if (methodMatch) {
      members.push({
        pythonName: `${pythonName}.${methodMatch[1]}`,
        name: methodMatch[1],
        signature: trimmed,
        returnType: methodMatch[3] ? methodMatch[3].trim() : "",
      });
    }
    index += 1;
  }
  return {
    endIndex: index,
    type: {
      kind: enumLike ? "enum" : "class",
      pythonName,
      displayName: pythonName,
      signature: header,
      bases,
      cases,
      members,
      docString: docs.documentation || priorComments.join("\n"),
      documentation: docs.documentation || priorComments.join("\n"),
      source: "ToolRenderer.pythonInterface",
    },
  };
}

function parseToolRendererInterface(source) {
  const lines = String(source || "").split(/\r?\n/);
  const actions = [];
  const triggers = [];
  const helpers = [];
  const types = [];
  let section = "Helpers";
  let priorComments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      if (trimmed === "# Actions" || trimmed === "# Tools") {
        section = "Actions";
        priorComments = [];
      } else if (trimmed === "# Triggers") {
        section = "Triggers";
        priorComments = [];
      } else if (trimmed === "# Types") {
        section = "Types";
        priorComments = [];
      } else {
        priorComments.push(trimmed.replace(/^#\s?/, ""));
      }
      continue;
    }
    if (!trimmed) {
      continue;
    }
    if (line.startsWith("def ")) {
      const parsed = parseFunction(lines, index, section);
      priorComments = [];
      if (!parsed) {
        continue;
      }
      if (parsed.item.kind === "trigger") {
        triggers.push(parsed.item);
      } else if (parsed.item.kind === "action") {
        actions.push(parsed.item);
      } else {
        helpers.push(parsed.item);
      }
      index = Math.max(index, parsed.endIndex - 1);
      continue;
    }
    if (line.startsWith("class ")) {
      const parsed = parseClass(lines, index, priorComments);
      priorComments = [];
      if (!parsed) {
        continue;
      }
      types.push(parsed.type);
      index = Math.max(index, parsed.endIndex - 1);
      continue;
    }
    if (!/^\s/.test(line)) {
      const alias = parseTypeAlias(line, priorComments);
      priorComments = [];
      if (alias) {
        types.push(alias);
      }
    }
  }
  const items = [...helpers, ...actions, ...triggers];
  return {
    ok: true,
    source: "ToolRenderer.pythonInterface",
    generatedAt: new Date().toISOString(),
    counts: {
      actions: actions.length,
      triggers: triggers.length,
      helpers: helpers.length,
      types: types.length,
      items: items.length,
    },
    items,
    actions,
    triggers,
    helpers,
    types,
    diagnostics: [],
  };
}

function toolkitItemsFor(metadataOrIndex, kind) {
  if (!metadataOrIndex) {
    return [];
  }
  const key = kind === "trigger" ? "triggers" : kind === "type" ? "types" : "actions";
  if (Array.isArray(metadataOrIndex[key])) {
    return metadataOrIndex[key];
  }
  return [];
}

function preferredToolkitItem(items, kind) {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  if (kind === "action") {
    return items.find((item) => typeof item.id === "string" && item.id.startsWith("is.workflow.actions.")) || items[0];
  }
  return items[0];
}

function preferredToolkitParameter(parameters, pythonName) {
  const candidates = (Array.isArray(parameters) ? parameters : [])
    .filter((parameter) => parameter && parameter.pythonName === pythonName && typeof parameter.key === "string");
  return candidates.find((parameter) => parameter.key.startsWith("WF")) ||
    candidates.find((parameter) => parameter.key !== pythonName) ||
    candidates[0];
}

function triggerBindingFromIdentifier(identifier) {
  if (typeof identifier !== "string") {
    return undefined;
  }
  const prefix = "com.apple.shortcuts.";
  const tail = identifier.startsWith(prefix) ? identifier.slice(prefix.length) : identifier;
  const pieces = tail.split(".");
  if (pieces.length < 2) {
    return undefined;
  }
  const variant = pieces.pop();
  const trigger = pieces.join(".");
  if (!trigger || !variant) {
    return undefined;
  }
  return { trigger: { identifier: trigger, variant } };
}

function isCatalogParameter(parameter) {
  const type = String(parameter && parameter.type || "").replace(/\s+/g, "");
  return type.includes("Resolved[") || type.includes("Picked[");
}

function catalogKind(parameter) {
  const type = String(parameter && parameter.type || "").replace(/\s+/g, "");
  if (type.includes("Picked[")) {
    return "picked";
  }
  if (type.includes("Resolved[")) {
    return "resolved";
  }
  return undefined;
}

function mergeParameter(nativeParameter, toolkitParameter, item, toolkitItem, customParameterDescriptions = {}) {
  if (!toolkitParameter) {
    return nativeParameter;
  }
  const rawKey = toolkitParameter.key || nativeParameter.rawKey || nativeParameter.key;
  const customDoc = customParameterDescriptions[rawKey] || customParameterDescriptions[nativeParameter.pythonName] || customParameterDescriptions[toolkitParameter.pythonName];
  const merged = {
    ...nativeParameter,
    displayName: nativeParameter.displayName || toolkitParameter.displayName,
    doc: nativeParameter.doc || nativeParameter.summary || toolkitParameter.summary || customDoc || undefined,
    summary: nativeParameter.summary || nativeParameter.doc || toolkitParameter.summary || customDoc || undefined,
    rawKey,
    key: rawKey,
    sortOrder: toolkitParameter.sortOrder,
  };
  if (customDoc) {
    merged.customDescription = {
      source: "ToolRenderer CustomDescriptions_Tools.json",
      text: customDoc,
    };
  }
  if (rawKey && toolkitItem && toolkitItem.id) {
    const handle = item.kind === "trigger"
      ? triggerBindingFromIdentifier(toolkitItem.id)
      : { action: { identifier: toolkitItem.id } };
    if (handle) {
      merged.binding = {
        source: "ToolKit.SharedToolDatabaseProvider metadata",
        hostAndKey: { handle, key: rawKey },
      };
    }
  }
  if (isCatalogParameter(merged)) {
    merged.catalog = {
      kind: catalogKind(merged),
      representation: "inline parameterState JSON rewritten to ref(...) plus WFParameterStateCatalog",
      bindingRequired: true,
      supported: Boolean(merged.binding),
    };
  }
  return merged;
}

function mergeOneItem(item, toolkitMetadata, customDescriptions) {
  const key = item.kind === "trigger" ? "trigger" : item.kind === "action" ? "action" : item.kind === "type" ? "type" : "";
  if (!key) {
    return item;
  }
  const candidates = toolkitItemsFor(toolkitMetadata, key).filter((candidate) => candidate.pythonName === item.pythonName);
  const toolkitItem = preferredToolkitItem(candidates, item.kind);
  if (!toolkitItem) {
    return item;
  }
  const identifier = item.nativeIdentifier || item.id || toolkitItem.id;
  const custom = item.kind === "action" && identifier
    ? customDescriptions && customDescriptions.tools && customDescriptions.tools[identifier]
    : item.kind === "trigger" && identifier
      ? customDescriptions && customDescriptions.triggers && customDescriptions.triggers[identifier]
      : undefined;
  const customParameterDescriptions = custom && custom.parameter_descriptions && typeof custom.parameter_descriptions === "object"
    ? custom.parameter_descriptions
    : {};
  const parameters = (Array.isArray(item.parameters) ? item.parameters : [])
    .map((parameter) => mergeParameter(parameter, preferredToolkitParameter(toolkitItem.parameters, parameter.pythonName), item, toolkitItem, customParameterDescriptions));
  const merged = {
    ...item,
    nativeIdentifier: item.nativeIdentifier || identifier,
    id: item.id || identifier,
    toolkitDisplayName: toolkitItem.displayName,
    displayName: item.displayName || toolkitItem.displayName || item.pythonName,
    summary: item.summary || toolkitItem.summary || custom && custom.main_description || "",
    parameters,
    bindingSource: custom
      ? "ToolRenderer.pythonInterface + ToolKit raw key metadata + ToolRenderer custom descriptions"
      : "ToolRenderer.pythonInterface + ToolKit raw key metadata",
  };
  if (custom) {
    merged.customDescription = {
      source: path.join(customDescriptions.source, item.kind === "trigger" ? "CustomDescriptions_Triggers.json" : "CustomDescriptions_Tools.json"),
      mainDescription: custom.main_description || "",
      parameterDescriptions: customParameterDescriptions,
    };
    if (!merged.documentation && custom.main_description) {
      merged.documentation = custom.main_description;
    }
    if (!merged.docString && custom.main_description) {
      merged.docString = custom.main_description;
    }
  }
  return merged;
}

function mergeToolRendererWithToolkit(metadata, toolkitMetadata, customDescriptions) {
  if (!metadata || !toolkitMetadata) {
    return metadata;
  }
  const actions = (metadata.actions || []).map((item) => mergeOneItem(item, toolkitMetadata, customDescriptions));
  const triggers = (metadata.triggers || []).map((item) => mergeOneItem(item, toolkitMetadata, customDescriptions));
  const helpers = metadata.helpers || [];
  const types = metadata.types || [];
  const items = [...helpers, ...actions, ...triggers];
  const customDescriptionCounts = {
    actions: actions.filter((item) => item.customDescription).length,
    triggers: triggers.filter((item) => item.customDescription).length,
    enumDescriptions: customDescriptions && customDescriptions.enumDescriptions ? Object.keys(customDescriptions.enumDescriptions).length : 0,
  };
  return {
    ...metadata,
    source: appendSource(
      metadata.source,
      customDescriptions
        ? "enriched with ToolKit raw keys and ToolRenderer custom descriptions"
        : "enriched with ToolKit raw keys"
    ),
    customDescriptionSource: customDescriptions ? customDescriptions.source : undefined,
    customDescriptionCounts,
    items,
    actions,
    triggers,
    helpers,
    types,
    counts: {
      ...(metadata.counts || {}),
      actions: actions.length,
      triggers: triggers.length,
      helpers: helpers.length,
      types: types.length,
      items: items.length,
    },
  };
}

async function loadOptionalJson(path) {
  if (!path) {
    return undefined;
  }
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (_) {
    return undefined;
  }
}

function appendSource(source, suffix) {
  const parts = String(source || "ToolRenderer.pythonInterface")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.includes(suffix)) {
    parts.push(suffix);
  }
  return [...new Set(parts)].join("; ");
}

async function loadToolRendererCustomDescriptions(toolRendererFrameworkPath) {
  const frameworkPath = toolRendererFrameworkPath || process.env.SHORTCUTS_IDE_TOOLRENDERER_FRAMEWORK || DEFAULT_TOOLRENDERER_FRAMEWORK;
  const read = async (name) => loadOptionalJson(path.join(frameworkPath, name));
  const [tools, triggers, enumsIOS, enumsMacOS] = await Promise.all([
    read("CustomDescriptions_Tools.json"),
    read("CustomDescriptions_Triggers.json"),
    read("CustomDescriptions_Enums_iOS.json"),
    read("CustomDescriptions_Enums_macOS.json"),
  ]);
  const enumDescriptions = {
    ...(enumsMacOS || {}),
    ...(enumsIOS || {}),
  };
  if (!tools && !triggers && Object.keys(enumDescriptions).length === 0) {
    return undefined;
  }
  return {
    source: frameworkPath,
    tools: tools || {},
    triggers: triggers || {},
    enumDescriptions,
  };
}

async function fetchToolRendererResponse(options = {}) {
  if (options.live === true) {
    try {
      return await runBridgeCommand("toolrenderer-structured-metadata", Buffer.alloc(0), options);
    } catch (error) {
      const response = await runBridgeCommand("toolrenderer-python-interface", Buffer.alloc(0), options);
      response.structured_metadata_error = error.message;
      return response;
    }
  }
  try {
    const response = await runBridgeCli(["toolrenderer-structured-metadata", "--cached"], options);
    response.cached = true;
    return response;
  } catch (cachedError) {
    if (options.allowLiveFallback === false) {
      throw cachedError;
    }
    try {
      const response = await runBridgeCommand("toolrenderer-structured-metadata", Buffer.alloc(0), options);
      response.cached_metadata_error = cachedError.message;
      return response;
    } catch (error) {
      const response = await runBridgeCommand("toolrenderer-python-interface", Buffer.alloc(0), options);
      response.cached_metadata_error = cachedError.message;
      response.structured_metadata_error = error.message;
      return response;
    }
  }
}

async function refreshToolRendererMetadata(metadataPath, options = {}) {
  let response;
  let metadata;
  response = await fetchToolRendererResponse(options);
  if (Array.isArray(response.items) && response.items.length > 0) {
    metadata = {
      ok: true,
      source: response.source || "toolrenderer-structured-metadata",
      generatedAt: response.generatedAt || new Date().toISOString(),
      counts: response.counts || {},
      items: response.items,
      actions: response.actions || response.items.filter((item) => item.kind === "action"),
      triggers: response.triggers || response.items.filter((item) => item.kind === "trigger"),
      helpers: response.helpers || response.items.filter((item) => !["action", "trigger"].includes(item.kind)),
      types: response.types || [],
      diagnostics: response.diagnostics || [],
    };
  } else {
    metadata = parseToolRendererInterface(response.python_interface || response.pythonInterface || "");
  }
  metadata.response = {
    database_source: response.database_source,
    database_provider_class: response.database_provider_class,
    database_class: response.database_class,
    python_length: response.python_length,
    contains_trigger: response.contains_trigger,
    contains_shortcut: response.contains_shortcut,
      structured_metadata_error: response.structured_metadata_error,
      cached_metadata_error: response.cached_metadata_error,
      cached: response.cached,
      provider_symbols: response.provider_symbols,
    };
  const toolkitMetadata = await loadOptionalJson(options.toolkitMetadataPath);
  const customDescriptions = await loadToolRendererCustomDescriptions(options.toolRendererFrameworkPath);
  metadata = mergeToolRendererWithToolkit(metadata, toolkitMetadata, customDescriptions);
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

async function loadToolRendererMetadata(metadataPath) {
  const data = await fs.readFile(metadataPath, "utf8");
  return JSON.parse(data);
}

function indexToolRendererMetadata(metadata) {
  const byName = new Map();
  const actions = Array.isArray(metadata && metadata.actions) ? metadata.actions : [];
  const triggers = Array.isArray(metadata && metadata.triggers) ? metadata.triggers : [];
  const helpers = Array.isArray(metadata && metadata.helpers) ? metadata.helpers : [];
  const types = Array.isArray(metadata && metadata.types) ? metadata.types : [];
  for (const item of [...helpers, ...actions, ...triggers, ...types]) {
    if (item && item.pythonName) {
      byName.set(item.pythonName, item);
      for (const enumCase of item.cases || []) {
        byName.set(enumCase.pythonName, { ...enumCase, kind: "enumCase", enumName: item.pythonName });
      }
    }
  }
  return { byName, actions, triggers, helpers, types };
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
  loadToolRendererMetadata,
  mergeToolRendererWithToolkit,
  parseToolRendererInterface,
  refreshToolRendererMetadata,
  searchToolRendererMetadata,
};
