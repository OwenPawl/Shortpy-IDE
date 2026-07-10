"use strict";

const BUILTIN_NAMES = new Set([
  "bool",
  "dict",
  "float",
  "int",
  "isinstance",
  "len",
  "list",
  "print",
  "range",
  "ref",
  "set",
  "str",
  "tuple",
]);

const CONTROL_NAMES = new Set([
  "class",
  "def",
  "elif",
  "for",
  "if",
  "return",
  "while",
  "with",
]);

function localDefinitions(source) {
  const names = new Set();
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

function combinedItem(indexes, name) {
  for (const index of indexes || []) {
    if (index && index.byName && index.byName.has(name)) {
      return index.byName.get(name);
    }
  }
  return undefined;
}

function actionLikeName(name, decorator) {
  if (decorator) {
    return name.startsWith("when_");
  }
  return name.startsWith("com_") ||
    name.startsWith("when_") ||
    name.startsWith("shortcuts_builtin_");
}

function hasClosedParameterSurface(item) {
  if (!item || item.parameterValidation === "open") {
    return false;
  }
  if (item.parameterValidation === "closed") {
    return true;
  }
  if (item.definitionMissing || (!item.definitionBlock && !item.signature)) {
    return false;
  }
  const names = (Array.isArray(item.parameters) ? item.parameters : [])
    .map((parameter) => parameter && parameter.pythonName)
    .filter(Boolean);
  return new Set(names).size === names.length;
}

function signatureEnd(line, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < line.length; index += 1) {
    const ch = line[index];
    const prev = index > 0 ? line[index - 1] : "";
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
  return line.length;
}

function parameterMap(item) {
  const map = new Map();
  for (const parameter of Array.isArray(item && item.parameters) ? item.parameters : []) {
    const names = [
      parameter.pythonName,
      parameter.key,
      parameter.name,
      parameter.rawKey,
      ...(Array.isArray(parameter.aliases) ? parameter.aliases : []),
      ...(Array.isArray(parameter.acceptedNames) ? parameter.acceptedNames : []),
    ].filter(Boolean);
    for (const name of names) {
      map.set(name, parameter);
    }
  }
  return map;
}

function topLevelKeywordArguments(args) {
  return topLevelArguments(args)
    .filter((argument) => argument.keywordName)
    .map((argument) => ({
      name: argument.keywordName,
      index: argument.keywordStart,
    }));
}

function topLevelArguments(args) {
  const ranges = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < args.length; index += 1) {
    const ch = args[index];
    const prev = index > 0 ? args[index - 1] : "";
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
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: args.length });
  return ranges.map((range, position) => {
    const raw = args.slice(range.start, range.end);
    const leftTrim = raw.length - raw.replace(/^\s+/, "").length;
    const rightTrim = raw.length - raw.replace(/\s+$/, "").length;
    const startIndex = range.start + leftTrim;
    const endIndex = range.end - rightTrim;
    const text = args.slice(startIndex, endIndex);
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text);
    return {
      text,
      index: startIndex,
      start: startIndex,
      end: endIndex,
      position,
      keywordName: keyword ? keyword[1] : "",
      keywordStart: startIndex,
      keywordEnd: keyword ? startIndex + keyword[1].length : startIndex,
    };
  }).filter((argument) => argument.text);
}

function collectToolRendererDiagnostics(source, index) {
  const diagnostics = [];
  const locals = localDefinitions(source);
  const lines = String(source || "").split(/\r?\n/);
  const indexes = Array.isArray(index) ? index : [index];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const code = line.replace(/#.*/, "");
    const callRe = /(@?)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match;
    while ((match = callRe.exec(code)) !== null) {
      const at = match[1] === "@";
      const name = match[2];
      const nameStart = match.index + (at ? 1 : 0);
      const prefix = code.slice(0, match.index).trimEnd();
      if (prefix.endsWith(".") || CONTROL_NAMES.has(name) || BUILTIN_NAMES.has(name)) {
        continue;
      }
      if (!at && locals.has(name)) {
        continue;
      }
      const item = combinedItem(indexes, name);
      if (!item) {
        if (!actionLikeName(name, at)) {
          continue;
        }
        diagnostics.push({
          code: "unknownShortcutsCommand",
          message: `Unknown Shortcuts ${at || name.startsWith("when_") ? "trigger" : "action"} '${name}'.`,
          severity: "error",
          line: lineNumber,
          start: nameStart,
          end: nameStart + name.length,
        });
        continue;
      }
      if (!hasClosedParameterSurface(item)) {
        continue;
      }
      const params = parameterMap(item);
      if (params.size === 0) {
        continue;
      }
      const openIndex = code.indexOf("(", match.index);
      const endIndex = signatureEnd(code, openIndex);
      const args = code.slice(openIndex + 1, endIndex);
      for (const keyword of topLevelKeywordArguments(args)) {
        const paramName = keyword.name;
        if (params.has(paramName)) {
          continue;
        }
        const start = openIndex + 1 + keyword.index;
        diagnostics.push({
          code: "unknownShortcutsParameter",
          message: `Unknown parameter '${paramName}' for ${name}.`,
          severity: "error",
          line: lineNumber,
          start,
          end: start + paramName.length,
          commandName: name,
        });
      }
    }
  }
  return diagnostics;
}

function functionCallAtLine(line, character) {
  const upto = line.slice(0, character);
  let depth = 0;
  for (let index = upto.length - 1; index >= 0; index -= 1) {
    const ch = upto[index];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const prefix = upto.slice(0, index);
      const match = /@?([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(prefix);
      return match ? match[1] : undefined;
    }
  }
  return undefined;
}

function functionCallContextAtLine(line, character) {
  const upto = line.slice(0, character);
  let depth = 0;
  for (let index = upto.length - 1; index >= 0; index -= 1) {
    const ch = upto[index];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const prefix = upto.slice(0, index);
      const match = /@?([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(prefix);
      return match ? { name: match[1], openIndex: index } : undefined;
    }
  }
  return undefined;
}

function functionCallContextsAtLine(line, character) {
  const contexts = [];
  const callRe = /@?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(line)) !== null) {
    const openIndex = line.indexOf("(", match.index);
    if (openIndex < 0 || character <= openIndex) {
      continue;
    }
    const closeIndex = signatureEnd(line, openIndex);
    if (character <= closeIndex) {
      contexts.push({ name: match[1], openIndex, closeIndex });
    }
  }
  return contexts.sort((a, b) => b.openIndex - a.openIndex);
}

function parameterNameAt(line, character) {
  const before = line.slice(0, character);
  const after = line.slice(character);
  const left = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  const right = /^([A-Za-z0-9_]*)/.exec(after);
  const name = `${left ? left[1] : ""}${right ? right[1] : ""}`;
  if (!name) {
    return undefined;
  }
  const start = character - (left ? left[1].length : 0);
  const equals = line.slice(start + name.length).match(/^\s*=/);
  return equals ? { name, start, end: start + name.length } : undefined;
}

function topLevelParameterNameAt(line, character, openIndex, closeIndex) {
  if (openIndex < 0 || character <= openIndex || character > closeIndex) {
    return undefined;
  }
  for (const keyword of topLevelKeywordArguments(line.slice(openIndex + 1, closeIndex))) {
    const start = openIndex + 1 + keyword.index;
    const end = start + keyword.name.length;
    if (character >= start && character <= end) {
      return { name: keyword.name, start, end };
    }
  }
  return undefined;
}

function topLevelArgumentAt(line, character, openIndex, closeIndex) {
  if (openIndex < 0 || character <= openIndex || character > closeIndex) {
    return undefined;
  }
  for (const argument of topLevelArguments(line.slice(openIndex + 1, closeIndex))) {
    const start = openIndex + 1 + argument.start;
    const end = openIndex + 1 + argument.end;
    if (character >= start && character <= end) {
      return {
        ...argument,
        start,
        end,
        keywordStart: openIndex + 1 + argument.keywordStart,
        keywordEnd: openIndex + 1 + argument.keywordEnd,
      };
    }
  }
  return undefined;
}

function parameterInfoAt(source, lineNumber, character, indexes) {
  const lines = String(source || "").split(/\r?\n/);
  const line = lines[lineNumber] || "";
  for (const context of functionCallContextsAtLine(line, character)) {
    const closeIndex = context.closeIndex;
    const item = combinedItem(indexes, context.name);
    if (!item || !Array.isArray(item.parameters)) {
      continue;
    }
    const parameter = topLevelParameterNameAt(line, character, context.openIndex, closeIndex);
    if (parameter) {
      const info = parameterMap(item).get(parameter.name);
      if (info) {
        return { item, parameter: info, name: parameter.name, start: parameter.start, end: parameter.end };
      }
      continue;
    }
    const argument = topLevelArgumentAt(line, character, context.openIndex, closeIndex);
    if (!argument || argument.keywordName) {
      continue;
    }
    const info = item.parameters[argument.position];
    if (!info) {
      continue;
    }
    const name = info.pythonName || info.name || info.displayName || "inline argument";
    return { item, parameter: info, name, start: argument.start, end: argument.end, positional: true };
  }
  return undefined;
}

module.exports = {
  collectToolRendererDiagnostics,
  hasClosedParameterSurface,
  parameterInfoAt,
};
