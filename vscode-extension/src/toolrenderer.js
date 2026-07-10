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
  "List",
  "Literal",
  "None",
  "Optional",
  "Picked",
  "Resolved",
  "Set",
  "Tuple",
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

const SHORTPY_FILTER_TYPES = [
  {
    kind: "enum",
    pythonName: "QUERY_OPERATOR",
    displayName: "QUERY_OPERATOR",
    signature: "class QUERY_OPERATOR(Enum):",
    bases: ["Enum"],
    cases: [
      { name: "ANY", pythonName: "QUERY_OPERATOR.ANY", value: "\"ANY\"" },
      { name: "ALL", pythonName: "QUERY_OPERATOR.ALL", value: "\"ALL\"" },
    ],
    definitionBlock: [
      "class QUERY_OPERATOR(Enum):",
      "    ANY = \"ANY\"",
      "    ALL = \"ALL\"",
    ].join("\n"),
    documentation: "Controls whether any or all query filters must match.",
    source: "Shortpy.NativeToolRendererPrelude",
  },
  {
    kind: "enum",
    pythonName: "QUERY_SORT_ORDER",
    displayName: "QUERY_SORT_ORDER",
    signature: "class QUERY_SORT_ORDER(Enum):",
    bases: ["Enum"],
    cases: [
      { name: "ASCENDING", pythonName: "QUERY_SORT_ORDER.ASCENDING", value: "\"ASCENDING\"" },
      { name: "DESCENDING", pythonName: "QUERY_SORT_ORDER.DESCENDING", value: "\"DESCENDING\"" },
    ],
    definitionBlock: [
      "class QUERY_SORT_ORDER(Enum):",
      "    ASCENDING = \"ASCENDING\"",
      "    DESCENDING = \"DESCENDING\"",
    ].join("\n"),
    documentation: "Controls the sort direction for query filter actions.",
    source: "Shortpy.NativeToolRendererPrelude",
  },
];

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

function optionalType(type) {
  const clean = String(type || "").trim();
  if (!clean) {
    return "";
  }
  return /^Optional\[/.test(clean) ? clean : `Optional[${clean}]`;
}

function isQueryFilterAction(item) {
  if (item && item.filterActionSurface === "expanded-query") {
    return false;
  }
  const params = Array.isArray(item && item.parameters) ? item.parameters : [];
  return params.some((parameter) =>
    ((parameter.pythonName === "query" || parameter.name === "query" || parameter.inline) &&
      /^query_/.test(String(parameter.type || ""))) ||
    compilerParameterNames(parameter).includes("wfcontentitemfilter") ||
    parameter.key === "WFContentItemFilter" ||
    parameter.rawKey === "WFContentItemFilter"
  );
}

function queryFilterScopeParameter(parameters) {
  const explicit = parameters.find((parameter) => {
    const name = parameter && parameter.pythonName;
    const type = String(parameter && parameter.type || "");
    if (!parameter || ["query", "sort_by", "limit", "get"].includes(name)) {
      return false;
    }
    return /_wfcontent_item_input_parameter\b/.test(type) ||
      allParameterNames(parameter).includes("WFContentItemInputParameter");
  });
  if (explicit) {
    return explicit;
  }
  const compoundIndex = parameters.findIndex((parameter) =>
    compilerParameterNames(parameter).includes("wfcompoundtype") ||
    parameter.key === "WFCompoundType" ||
    parameter.rawKey === "WFCompoundType"
  );
  return compoundIndex >= 0 ? parameters[compoundIndex + 1] : undefined;
}

function queryFilterParameter(parameters, name) {
  return parameters.find((parameter) => {
    if (allParameterNames(parameter).includes(name) || compilerParameterNames(parameter).includes(name)) {
      return true;
    }
    return name === "query" && (
      compilerParameterNames(parameter).includes("wfcontentitemfilter") ||
      parameter.key === "WFContentItemFilter" ||
      parameter.rawKey === "WFContentItemFilter"
    );
  });
}

function normalizeQueryFilterAction(item) {
  if (!isQueryFilterAction(item)) {
    return item;
  }
  const parameters = Array.isArray(item.parameters) ? item.parameters : [];
  const query = queryFilterParameter(parameters, "query") || parameters.find((parameter) => /^query_/.test(String(parameter.type || "")));
  if (!query) {
    return item;
  }
  const sortBy = queryFilterParameter(parameters, "sort_by");
  const nativeLimit = queryFilterParameter(parameters, "limit");
  const nativeGet = queryFilterParameter(parameters, "get");
  const nativeScope = queryFilterScopeParameter(parameters);
  const queryType = String(query.type || "Any").trim();
  const outputParameters = [
    {
      ...query,
      pythonName: "query",
      name: "query",
      type: `List[${queryType}]`,
      defaultValue: undefined,
      inline: false,
      positional: false,
      doc: "The filter conditions.",
      summary: "The filter conditions.",
      aliases: uniqueStrings(["query", compilerParameterNames(query)]),
      acceptedNames: uniqueStrings(["query", compilerParameterNames(query)]),
    },
    {
      pythonName: "query_operator",
      name: "query_operator",
      type: "QUERY_OPERATOR",
      defaultValue: "QUERY_OPERATOR.ALL",
      doc: "If QUERY_OPERATOR.ALL, all filters must be satisfied. If QUERY_OPERATOR.ANY, any filter is sufficient.",
      summary: "If QUERY_OPERATOR.ALL, all filters must be satisfied. If QUERY_OPERATOR.ANY, any filter is sufficient.",
      aliases: ["query_operator"],
      acceptedNames: ["query_operator"],
    },
  ];
  if (sortBy) {
    outputParameters.push({
      ...sortBy,
      pythonName: "sort_by",
      name: "sort_by",
      type: optionalType(sortBy.type),
      defaultValue: "None",
      inline: false,
      positional: false,
      aliases: uniqueStrings(["sort_by", compilerParameterNames(sortBy)]),
      acceptedNames: uniqueStrings(["sort_by", compilerParameterNames(sortBy)]),
    });
    outputParameters.push({
      pythonName: "query_sort_order",
      name: "query_sort_order",
      type: "QUERY_SORT_ORDER",
      defaultValue: "QUERY_SORT_ORDER.ASCENDING",
      doc: "The sort order of the query.",
      summary: "The sort order of the query.",
      aliases: ["query_sort_order"],
      acceptedNames: ["query_sort_order"],
    });
  }
  outputParameters.push({
    pythonName: "limit",
    name: "limit",
    type: "Optional[int]",
    defaultValue: "None",
    doc: (nativeGet && (nativeGet.doc || nativeGet.summary)) || "The maximum number of results.",
    summary: (nativeGet && (nativeGet.doc || nativeGet.summary)) || "The maximum number of results.",
    aliases: uniqueStrings(["limit", "get", compilerParameterNames(nativeLimit), compilerParameterNames(nativeGet)]),
    acceptedNames: uniqueStrings(["limit", "get", compilerParameterNames(nativeLimit), compilerParameterNames(nativeGet)]),
  });
  if (nativeScope) {
    outputParameters.push({
      ...nativeScope,
      pythonName: "scope",
      name: "scope",
      type: optionalType(nativeScope.type),
      defaultValue: "None",
      inline: false,
      positional: false,
      doc: nativeScope.doc || nativeScope.summary || "The scope of the query.",
      summary: nativeScope.summary || nativeScope.doc || "The scope of the query.",
      aliases: uniqueStrings(["scope", compilerParameterNames(nativeScope)]),
      acceptedNames: uniqueStrings(["scope", compilerParameterNames(nativeScope)]),
    });
  }
  return {
    ...item,
    parameters: outputParameters,
    filterActionSurface: "expanded-query",
  };
}

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
  const inlineMatch = /^:\s*([^=]+?)(?:\s*=\s*(.+))?$/.exec(body);
  if (inlineMatch) {
    const inlineType = inlineMatch[1] ? inlineMatch[1].trim() : "";
    const preferredName = /^query_/.test(inlineType) ? "query" : "";
    return {
      pythonName: preferredName,
      name: "",
      type: inlineType,
      defaultValue: inlineMatch[2] ? inlineMatch[2].trim() : undefined,
      doc: comment || undefined,
      summary: comment || undefined,
      positional: true,
      inline: true,
    };
  }
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
    .filter(Boolean)
    .map((parameter, index) => ({ ...parameter, positionalIndex: index }));
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
  const parsed = parseDocSections(rawLines);
  return {
    displayName: parsed.displayName || cleaned[0] || "",
    summary: parsed.summary,
    documentation: cleaned.join("\n"),
    narrative: parsed.narrative,
    parameterDocs: parsed.parameterDocs,
    returnDocs: parsed.returnDocs,
    endIndex,
  };
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
    const doc = docs.parameterDocs[parameter.pythonName] || (parameter.inline ? docs.parameterDocs[""] : undefined);
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
  const endIndex = Math.max(index + 1, docs.endIndex);
  const definitionBlock = lines.slice(startIndex, endIndex).join("\n").trimEnd();
  return {
    endIndex,
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
      returnDocs: docs.returnDocs,
      parameters,
      docSections: {
        narrative: docs.narrative,
        parameterDocs: docs.parameterDocs,
        returnDocs: docs.returnDocs,
      },
      definitionBlock,
      startLine: startIndex + 1,
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
    definitionBlock: [
      ...priorComments.map((comment) => `# ${comment}`),
      line.trim(),
    ].filter(Boolean).join("\n"),
    startLine: undefined,
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
      docSections: {
        narrative: docs.narrative,
        parameterDocs: docs.parameterDocs,
        returnDocs: docs.returnDocs,
      },
      definitionBlock: lines.slice(startIndex, index).join("\n").trimEnd(),
      startLine: startIndex + 1,
      source: "ToolRenderer.pythonInterface",
    },
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

function mergeStructuredMetadataFromSource(metadata, source) {
  if (!source) {
    return metadata;
  }
  const parsed = parseToolRendererInterface(source);
  const parsedByName = new Map();
  for (const item of [
    ...(parsed.helpers || []),
    ...(parsed.actions || []),
    ...(parsed.triggers || []),
    ...(parsed.types || []),
  ]) {
    if (item && item.pythonName) {
      parsedByName.set(item.pythonName, item);
    }
  }
  const mergeItems = (items) => (Array.isArray(items) ? items : []).map((item) => {
    const parsedItem = parsedByName.get(item && item.pythonName);
    return parsedItem
      ? mergeDocSections({ ...parsedItem, ...item, definitionBlock: item.definitionBlock || parsedItem.definitionBlock })
      : mergeDocSections(item);
  });
  return {
    ...metadata,
    helpers: mergeItems(metadata.helpers),
    actions: mergeItems(metadata.actions),
    triggers: mergeItems(metadata.triggers),
    types: mergeItems(metadata.types),
  };
}

function extractTypeNames(value) {
  const names = new Set();
  const text = String(value || "");
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
  for (const source of [item && item.signature, item && item.returnType, item && item.aliasedTo]) {
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
  const normalized = normalizeQueryFilterAction(item);
  const clean = {};
  for (const [key, value] of Object.entries(normalized)) {
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

async function refreshToolRendererMetadata(metadataPath, options = {}) {
  let response;
  let metadata;
  response = await fetchToolRendererResponse(options);
  const sourceInterface = response.python_interface || response.pythonInterface || "";
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
    metadata = mergeStructuredMetadataFromSource(metadata, sourceInterface);
  } else {
    metadata = parseToolRendererInterface(sourceInterface);
  }
  metadata.response = {
    python_length: response.python_length,
    contains_trigger: response.contains_trigger,
    contains_shortcut: response.contains_shortcut,
    structured_metadata_error: response.structured_metadata_error,
    cached_metadata_error: response.cached_metadata_error,
    cached: response.cached,
    provider_symbols: response.provider_symbols,
  };
  metadata = sanitizeToolRendererMetadata(metadata);
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

async function loadToolRendererMetadata(metadataPath) {
  const data = await fs.readFile(metadataPath, "utf8");
  return sanitizeToolRendererMetadata(JSON.parse(data));
}

function indexToolRendererMetadata(metadata) {
  const byName = new Map();
  const itemByPythonName = new Map();
  const parameterByItemAndName = new Map();
  const typeByPythonName = new Map();
  const definitionBlocks = new Map();
  const directDependencies = new Map();
  const actions = (Array.isArray(metadata && metadata.actions) ? metadata.actions : [])
    .map(normalizeQueryFilterAction);
  const triggers = Array.isArray(metadata && metadata.triggers) ? metadata.triggers : [];
  const metadataHelpers = Array.isArray(metadata && metadata.helpers) ? metadata.helpers : [];
  const helperNames = new Set(metadataHelpers.map((item) => item && item.pythonName).filter(Boolean));
  const helpers = [
    ...metadataHelpers,
    ...SHORTPY_BUILTIN_HELPERS.filter((item) => !helperNames.has(item.pythonName)),
  ].map(normalizeQueryFilterAction);
  const metadataTypes = Array.isArray(metadata && metadata.types) ? metadata.types : [];
  const metadataTypeNames = new Set(metadataTypes.map((item) => item && item.pythonName).filter(Boolean));
  const types = [
    ...metadataTypes,
    ...SHORTPY_FILTER_TYPES.filter((item) => !metadataTypeNames.has(item.pythonName)),
  ];
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
  parseToolRendererInterface,
  refreshToolRendererMetadata,
  sanitizeToolRendererMetadata,
  searchToolRendererMetadata,
};
