#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { collectToolRendererDiagnostics } = require("../src/shortpyDiagnostics");
const {
  indexToolRendererMetadata,
  sanitizeToolRendererMetadata,
} = require("../src/toolrenderer");

function defaultMetadataPath() {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Code",
    "User",
    "globalStorage",
    "local.shortpy-ide",
    "toolrenderer-interface.json"
  );
}

function parseArgs(argv) {
  const options = {
    metadataPath: process.env.SHORTPY_TOOLRENDERER_METADATA || defaultMetadataPath(),
    pretty: false,
    failOnDiagnostics: false,
    sourcePath: "-",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--metadata") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--metadata requires a path");
      }
      options.metadataPath = argv[index];
    } else if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--fail-on-diagnostics") {
      options.failOnDiagnostics = true;
    } else if (arg === "-" || !arg.startsWith("-")) {
      options.sourcePath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function highlightForDiagnostic(lineText, start, end) {
  const safeStart = Math.min(Math.max(0, start), lineText.length);
  const safeEnd = Math.min(Math.max(safeStart + 1, end), Math.max(lineText.length, safeStart + 1));
  return `${lineText}\n${" ".repeat(safeStart)}${"^".repeat(Math.max(1, safeEnd - safeStart))}`;
}

function buildDiagnosticReport(source, index, details = {}) {
  const lines = String(source || "").split(/\r?\n/);
  const diagnostics = collectToolRendererDiagnostics(source, index).map((item) => {
    const sourceLine = lines[item.line] || "";
    return {
      code: item.code,
      severity: item.severity,
      message: item.message,
      commandName: item.commandName,
      range: {
        start: { line: item.line + 1, column: item.start + 1 },
        end: { line: item.line + 1, column: item.end + 1 },
      },
      zeroBasedRange: {
        start: { line: item.line, character: item.start },
        end: { line: item.line, character: item.end },
      },
      sourceLine,
      highlight: highlightForDiagnostic(sourceLine, item.start, item.end),
    };
  });
  return {
    schema: "shortpy-toolrenderer-diagnostics.v1",
    source: details.sourcePath || "stdin",
    metadata: details.metadataPath,
    diagnosticCount: diagnostics.length,
    diagnostics,
  };
}

function readSource(sourcePath) {
  return sourcePath === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(sourcePath, "utf8");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const source = readSource(options.sourcePath);
  const metadata = sanitizeToolRendererMetadata(
    JSON.parse(fs.readFileSync(options.metadataPath, "utf8"))
  );
  const report = buildDiagnosticReport(source, indexToolRendererMetadata(metadata), {
    sourcePath: options.sourcePath === "-" ? "stdin" : path.resolve(options.sourcePath),
    metadataPath: path.resolve(options.metadataPath),
  });
  process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`);
  if (options.failOnDiagnostics && report.diagnosticCount > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  buildDiagnosticReport,
  defaultMetadataPath,
  highlightForDiagnostic,
  parseArgs,
};
