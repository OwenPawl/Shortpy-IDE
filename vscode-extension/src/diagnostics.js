"use strict";

function collectBulletSection(lines, header) {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return [];
  }
  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      if (output.length > 0) {
        break;
      }
      continue;
    }
    if (/^[A-Z][A-Za-z -]+:/.test(line.trim())) {
      break;
    }
    const bullet = /^-\s+(.+)$/.exec(line.trim());
    if (bullet) {
      output.push(bullet[1]);
    }
  }
  return output;
}

function collectFixIts(lines) {
  const start = lines.findIndex((line) => line.trim() === "Fix-its:");
  if (start < 0) {
    return [];
  }
  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      if (output.length > 0) {
        break;
      }
      continue;
    }
    if (/^[A-Z][A-Za-z -]+:/.test(line.trim())) {
      break;
    }
    const fix = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (fix) {
      output.push(parseFixIt(fix[2], Number(fix[1])));
    }
  }
  return output;
}

function parseFixIt(text, index = 0) {
  const replaceWith = /^Replace with '([^']*)'$/.exec(text);
  if (replaceWith) {
    return {
      index,
      kind: "replace-word",
      text,
      replacement: replaceWith[1],
    };
  }

  const replaceText = /^Replace '([^']*)' with '([^']*)'$/.exec(text);
  if (replaceText) {
    return {
      index,
      kind: "replace-text",
      text,
      target: replaceText[1],
      replacement: replaceText[2],
    };
  }

  const insertText = /^Insert '([^']*)'$/.exec(text);
  if (insertText) {
    return {
      index,
      kind: "insert",
      text,
      insertion: insertText[1],
    };
  }

  const removeText = /^Remove '([^']*)'$/.exec(text);
  if (removeText) {
    return {
      index,
      kind: "remove-text",
      text,
      target: removeText[1],
    };
  }

  return {
    index,
    kind: "unknown",
    text,
  };
}

function parseAppleDiagnostic(message) {
  const text = String(message || "");
  const lines = text.split(/\r?\n/);
  const location = /Error at Line (\d+), Column (\d+)/.exec(text);
  const code = /\[([A-Z]\d{4})\]/.exec(text);
  const marker = /\|>\s*([^\[]+)\s*\[([A-Z]\d{4})\]/.exec(text);
  const descriptionIndex = lines.findIndex((line) => line.trim() && !line.startsWith(" ") && !line.startsWith("|") && !line.startsWith("Error at"));
  return {
    line: location ? Number(location[1]) : undefined,
    column: location ? Number(location[2]) : undefined,
    code: code ? code[1] : undefined,
    marker: marker ? marker[1].trim() : undefined,
    title: descriptionIndex >= 0 ? lines[descriptionIndex].trim() : "Shortcuts compiler diagnostic",
    hints: collectBulletSection(lines, "Hints:"),
    fixIts: collectFixIts(lines),
    raw: text,
  };
}

module.exports = {
  parseAppleDiagnostic,
  parseFixIt,
};
