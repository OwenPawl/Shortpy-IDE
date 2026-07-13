#!/usr/bin/env python3
import argparse
import ast
import base64
import hashlib
import json
import os
import plistlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_SOCKET = "/tmp/shortcuts-ide-bridge-sim.sock"
SOCKET_NAME = "shortcuts-ide-bridge-sim.sock"
DEFAULT_SHORTCUTS_CLI = "/usr/bin/shortcuts"
DEFAULT_AEA_CLI = "/usr/bin/aea"
DEFAULT_AA_CLI = "/usr/bin/aa"
DEFAULT_OPENSSL_CLI = "/usr/bin/openssl"
ICLOUD_SHORTCUTS_HOST = "www.icloud.com"
ICLOUD_SHORTCUTS_API_PREFIX = "/shortcuts/api/records/"
ICLOUD_SHORTCUTS_LINK_PREFIX = "/shortcuts/"
ICLOUD_FETCH_TIMEOUT = 30
QUERY_STOPWORDS = {
    "a",
    "an",
    "and",
    "for",
    "i",
    "in",
    "me",
    "my",
    "of",
    "on",
    "the",
    "to",
}


def socket_candidates() -> list[str]:
    candidates = [DEFAULT_SOCKET]
    import os
    import subprocess

    explicit = os.environ.get("SHORTCUTS_IDE_SIM_SOCKET")
    if explicit:
        candidates.append(explicit)

    tmpdir = os.environ.get("TMPDIR")
    if tmpdir:
        candidates.append(str(Path(tmpdir) / SOCKET_NAME))
    try:
        pids = subprocess.run(
            [
                "pgrep",
                "-f",
                "CoreSimulator.*RuntimeRoot/Applications/Shortcuts.app/Shortcuts",
            ],
            check=False,
            capture_output=True,
            text=True,
        ).stdout.split()
        for pid in pids:
            env = subprocess.run(
                ["ps", "eww", "-p", pid],
                check=False,
                capture_output=True,
                text=True,
            ).stdout
            for token in env.split():
                if token.startswith("TMPDIR="):
                    candidates.append(str(Path(token.removeprefix("TMPDIR=")) / SOCKET_NAME))
                    break
    except OSError:
        pass
    containers = Path.home() / "Library" / "Containers"
    for pattern in [
        "com.apple.shortcuts/Data/tmp",
        "com.apple.shortcuts*/Data/tmp",
        "*Shortcuts*/Data/tmp",
    ]:
        for directory in containers.glob(pattern):
            candidates.append(str(directory / SOCKET_NAME))
    seen = []
    for item in candidates:
        if item not in seen:
            seen.append(item)
    return seen


def resolve_sockets(path: str) -> list[str]:
    if path != "auto":
        return [path]
    existing = [candidate for candidate in socket_candidates() if Path(candidate).exists()]
    return existing or [DEFAULT_SOCKET]


def send_command(path: str, command: str) -> str:
    last_error = None
    for resolved in resolve_sockets(path):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                sock.connect(resolved)
                sock.sendall(command.encode("utf-8") + b"\n")
                chunks = []
                while True:
                    data = sock.recv(65536)
                    if not data:
                        break
                    chunks.append(data)
            return b"".join(chunks).decode("utf-8", errors="replace").strip()
        except OSError as exc:
            last_error = exc
            continue
    raise last_error or FileNotFoundError(path)


def print_response(raw: str, pretty: bool) -> None:
    if not pretty:
        print(raw)
        return
    try:
        print(json.dumps(json.loads(raw), indent=2, sort_keys=True))
    except json.JSONDecodeError:
        print(raw)


def parse_bridge_json_response(raw: str, mode: str) -> dict:
    if not raw or not raw.strip():
        return {
            "ok": False,
            "mode": mode,
            "error": f"{mode} returned an empty response from the bridge socket",
            "error_type": "EmptyBridgeResponse",
        }
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "mode": mode,
            "error": f"{mode} returned a non-JSON response from the bridge socket",
            "error_type": type(exc).__name__,
            "decode_error": str(exc),
            "raw_prefix": raw[:500],
            "raw_length": len(raw),
        }


def parse_toolrenderer_items(source: str) -> list[dict]:
    lines = str(source or "").splitlines()
    items: list[dict] = []
    section = "helper"
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if stripped in {"# Actions", "# Tools"}:
            section = "tool"
            index += 1
            continue
        if stripped == "# Triggers":
            section = "trigger"
            index += 1
            continue
        if not lines[index].startswith("def "):
            index += 1
            continue
        start = index
        signature_lines = []
        while index < len(lines):
            signature_lines.append(lines[index])
            if lines[index].strip().endswith(":"):
                break
            index += 1
        signature = "\n".join(signature_lines)
        match = re.match(r"\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", signature_lines[0])
        if not match:
            index += 1
            continue
        name = match.group(1)
        doc_lines = []
        doc_index = index + 1
        while doc_index < len(lines) and not lines[doc_index].strip():
            doc_index += 1
        if doc_index < len(lines) and lines[doc_index].strip().startswith('"""'):
            first = lines[doc_index].strip()[3:]
            if first.endswith('"""'):
                doc_lines.append(first[:-3])
                doc_index += 1
            else:
                if first:
                    doc_lines.append(first)
                doc_index += 1
                while doc_index < len(lines):
                    current = lines[doc_index]
                    end = current.find('"""')
                    if end >= 0:
                        doc_lines.append(current[:end].strip())
                        doc_index += 1
                        break
                    doc_lines.append(current.strip())
                    doc_index += 1
        docs = [line.strip() for line in doc_lines if line.strip()]
        item_kind = "trigger" if section == "trigger" or name.startswith("when_") else section
        items.append(
            {
                "pythonName": name,
                "kind": item_kind,
                "displayName": docs[0] if docs else name,
                "documentation": "\n".join(docs),
                "signature": signature,
                "startLine": start + 1,
            }
        )
        index = max(index + 1, doc_index)
    return items


def split_top_level_commas(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote = ""
    for index, ch in enumerate(value):
        prev = value[index - 1] if index > 0 else ""
        if quote:
            if ch == quote and prev != "\\":
                quote = ""
            continue
        if ch in {"'", '"'}:
            quote = ch
            continue
        if ch in "([{":
            depth += 1
            continue
        if ch in ")]}":
            depth = max(0, depth - 1)
            continue
        if ch == "," and depth == 0:
            part = value[start:index].strip()
            if part:
                parts.append(part)
            start = index + 1
    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def matching_paren(value: str, open_index: int) -> int:
    depth = 0
    quote = ""
    for index in range(open_index, len(value)):
        ch = value[index]
        prev = value[index - 1] if index > 0 else ""
        if quote:
            if ch == quote and prev != "\\":
                quote = ""
            continue
        if ch in {"'", '"'}:
            quote = ch
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return index
    return -1


def parse_signature_parameters(signature: str) -> list[dict]:
    open_index = signature.find("(")
    if open_index < 0:
        return []
    close_index = matching_paren(signature, open_index)
    if close_index < 0:
        return []
    parameters = []
    for position, part in enumerate(split_top_level_commas(signature[open_index + 1:close_index])):
        if part in {"/", "*"}:
            continue
        inline_match = re.match(r"^:\s*([^=]+?)(?:\s*=\s*(.+))?$", part)
        if inline_match:
            inline_type = (inline_match.group(1) or "").strip()
            preferred_name = "query" if inline_type.startswith("query_") else ""
            parameters.append({
                "pythonName": preferred_name,
                "name": "",
                "type": inline_type,
                "defaultValue": (inline_match.group(2) or "").strip() or None,
                "positional": True,
                "inline": True,
                "positionalIndex": position,
            })
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$", part)
        if not match:
            continue
        parameters.append({
            "pythonName": match.group(1),
            "type": (match.group(2) or "").strip(),
            "defaultValue": (match.group(3) or "").strip() or None,
            "positionalIndex": position,
        })
    return parameters


def parse_return_type(signature: str) -> str:
    open_index = signature.find("(")
    close_index = matching_paren(signature, open_index) if open_index >= 0 else -1
    if close_index < 0:
        return ""
    match = re.search(r"->\s*([\s\S]+?)\s*:$", signature[close_index + 1:].strip())
    return re.sub(r"\s+", " ", match.group(1)).strip() if match else ""


def parse_doc_sections(doc_lines: list[str]) -> dict:
    narrative: list[str] = []
    parameter_docs: dict[str, str] = {}
    return_docs: list[str] = []
    section = "narrative"
    active_param = ""
    for raw_line in doc_lines:
        line = str(raw_line or "").strip()
        if not line:
            continue
        if line == "Args:":
            section = "args"
            active_param = ""
            continue
        if line == "Returns:":
            section = "returns"
            active_param = ""
            continue
        if section == "args":
            match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)?\s*:\s*(.*)$", line)
            if match:
                active_param = match.group(1) or ""
                parameter_docs[active_param] = match.group(2).strip()
            elif active_param or "" in parameter_docs:
                parameter_docs[active_param] = f"{parameter_docs[active_param]} {line}".strip()
            continue
        if section == "returns":
            return_docs.append(line)
            continue
        narrative.append(line)
    return {
        "displayName": narrative[0] if narrative else "",
        "summary": "\n".join(narrative[1:]),
        "narrative": narrative,
        "parameterDocs": parameter_docs,
        "returnDocs": "\n".join(return_docs),
    }


def parse_toolrenderer_structured_from_source(source: str) -> dict:
    lines = str(source or "").splitlines()
    actions: list[dict] = []
    triggers: list[dict] = []
    helpers: list[dict] = []
    types: list[dict] = []
    section = "helper"
    comments: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if stripped in {"# Actions", "# Tools"}:
            section = "action"
            comments = []
            index += 1
            continue
        if stripped == "# Triggers":
            section = "trigger"
            comments = []
            index += 1
            continue
        if stripped == "# Types":
            section = "type"
            comments = []
            index += 1
            continue
        if stripped.startswith("#"):
            comments.append(stripped.removeprefix("#").strip())
            index += 1
            continue
        if not stripped:
            index += 1
            continue
        if line.startswith("class "):
            start = index
            match = re.match(r"class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?:", stripped)
            if match:
                name = match.group(1)
                bases = [item.strip() for item in (match.group(2) or "").split(",") if item.strip()]
                cases = []
                cursor = index + 1
                while cursor < len(lines) and (not lines[cursor].strip() or lines[cursor].startswith((" ", "\t"))):
                    case_match = re.match(r"\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)$", lines[cursor])
                    if case_match:
                        cases.append({
                            "pythonName": f"{name}.{case_match.group(1)}",
                            "name": case_match.group(1),
                            "value": case_match.group(2).strip(),
                        })
                    cursor += 1
                definition_block = "\n".join(lines[start:cursor]).rstrip()
                types.append({
                    "kind": "enum" if "Enum" in bases else "class",
                    "pythonName": name,
                    "displayName": name,
                    "signature": stripped,
                    "bases": bases,
                    "cases": cases,
                    "docString": "\n".join(comments),
                    "documentation": "\n".join(comments),
                    "docSections": parse_doc_sections(comments),
                    "definitionBlock": definition_block,
                    "source": "ToolRenderer.pythonInterface",
                    "startLine": start + 1,
                })
                comments = []
                index = max(index + 1, cursor)
                continue
        alias_match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$", stripped)
        if alias_match and not line.startswith((" ", "\t")):
            types.append({
                "kind": "typeAlias",
                "pythonName": alias_match.group(1),
                "displayName": alias_match.group(1),
                "signature": stripped,
                "aliasedTo": alias_match.group(2).strip(),
                "docString": "\n".join(comments),
                "documentation": "\n".join(comments),
                "docSections": parse_doc_sections(comments),
                "definitionBlock": "\n".join([*(f"# {comment}" for comment in comments), stripped]).strip(),
                "source": "ToolRenderer.pythonInterface",
                "startLine": index + 1,
            })
            comments = []
            index += 1
            continue
        if not line.startswith("def "):
            comments = []
            index += 1
            continue
        start = index
        signature_lines = []
        while index < len(lines):
            signature_lines.append(lines[index])
            if lines[index].strip().endswith(":"):
                break
            index += 1
        signature = "\n".join(signature_lines)
        match = re.match(r"\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", signature_lines[0])
        if not match:
            index += 1
            continue
        name = match.group(1)
        doc_lines = []
        doc_index = index + 1
        while doc_index < len(lines) and not lines[doc_index].strip():
            doc_index += 1
        if doc_index < len(lines) and lines[doc_index].strip().startswith('"""'):
            first = lines[doc_index].strip()[3:]
            if first.endswith('"""'):
                doc_lines.append(first[:-3])
                doc_index += 1
            else:
                if first:
                    doc_lines.append(first)
                doc_index += 1
                while doc_index < len(lines):
                    current = lines[doc_index]
                    end = current.find('"""')
                    if end >= 0:
                        doc_lines.append(current[:end].strip())
                        doc_index += 1
                        break
                    doc_lines.append(current.strip())
                    doc_index += 1
        docs = [item for item in (line.strip() for line in doc_lines) if item]
        doc_sections = parse_doc_sections(docs)
        parameters = parse_signature_parameters(signature)
        for parameter in parameters:
            doc = doc_sections["parameterDocs"].get(parameter.get("pythonName", ""))
            if not doc and parameter.get("inline"):
                doc = doc_sections["parameterDocs"].get("")
            if doc:
                parameter["doc"] = doc
                parameter["summary"] = doc
        kind = "trigger" if section == "trigger" or name.startswith("when_") else section
        if name in {"runnable", "input_fallback"}:
            kind = "decorator"
        end = max(index + 1, doc_index)
        item = {
            "kind": kind,
            "pythonName": name,
            "nativeIdentifier": None,
            "displayName": doc_sections["displayName"] if docs else name,
            "docString": "\n".join(docs),
            "documentation": "\n".join(docs),
            "summary": doc_sections["summary"],
            "signature": signature,
            "returnType": parse_return_type(signature),
            "returnDocs": doc_sections["returnDocs"],
            "parameters": parameters,
            "docSections": doc_sections,
            "definitionBlock": "\n".join(lines[start:end]).rstrip(),
            "source": "ToolRenderer.pythonInterface",
            "startLine": start + 1,
        }
        if kind == "trigger":
            triggers.append(item)
        elif kind == "action":
            actions.append(item)
        else:
            helpers.append(item)
        comments = []
        index = end
    items = helpers + actions + triggers
    return {
        "ok": True,
        "mode": "toolrenderer-structured-metadata",
        "source": "ToolRenderer.pythonInterface parsed by bridgectl.py",
        "generatedAt": None,
        "items": items,
        "actions": actions,
        "triggers": triggers,
        "helpers": helpers,
        "types": types,
        "counts": {
            "actions": len(actions),
            "triggers": len(triggers),
            "helpers": len(helpers),
            "types": len(types),
            "items": len(items),
        },
        "diagnostics": [],
    }


def cached_toolrenderer_items() -> tuple[list[dict], str] | tuple[None, None]:
    root = Path(__file__).resolve().parents[1]
    logs = root / "logs"
    metadata_path = logs / "vscode-extension-toolrenderer-interface.json"
    if metadata_path.exists():
        metadata = visible_toolrenderer_metadata(json.loads(metadata_path.read_text()))
        items = []
        for source_kind, output_kind, key in [
            ("helper", "helper", "helpers"),
            ("action", "tool", "actions"),
            ("trigger", "trigger", "triggers"),
        ]:
            for item in metadata.get(key, []) or []:
                clean_item = visible_toolrenderer_item(item)
                items.append(
                    {
                        "pythonName": clean_item.get("pythonName", ""),
                        "kind": output_kind,
                        "displayName": clean_item.get("displayName") or clean_item.get("pythonName", ""),
                        "documentation": clean_item.get("documentation") or clean_item.get("summary") or "",
                        "signature": clean_item.get("signature", ""),
                        "parameters": clean_item.get("parameters", []),
                        "sourceKind": source_kind,
                    }
                )
        return items, str(metadata_path)
    raw_path = logs / "toolrenderer-python-interface.py"
    if raw_path.exists():
        return parse_toolrenderer_items(raw_path.read_text()), str(raw_path)
    return None, None


VISIBLE_TOOLKIT_ITEM_KEYS = {
    "bindingSource",
    "canonicalizedFrom",
    "canonicalizationSource",
    "customDescription",
    "toolkitDisplayName",
}

VISIBLE_TOOLKIT_PARAMETER_KEYS = {
    "binding",
    "catalog",
    "customDescription",
    "key",
    "rawKey",
    "sortOrder",
}

FILTER_ENUM_TYPES = [
    {
        "kind": "enum",
        "pythonName": "QUERY_OPERATOR",
        "displayName": "QUERY_OPERATOR",
        "signature": "class QUERY_OPERATOR(Enum):",
        "bases": ["Enum"],
        "cases": [
            {"name": "ANY", "pythonName": "QUERY_OPERATOR.ANY", "value": '"ANY"'},
            {"name": "ALL", "pythonName": "QUERY_OPERATOR.ALL", "value": '"ALL"'},
        ],
        "definitionBlock": 'class QUERY_OPERATOR(Enum):\n    ANY = "ANY"\n    ALL = "ALL"',
        "documentation": "Controls whether any or all query filters must match.",
        "source": "Shortpy.NativeToolRendererPrelude",
    },
    {
        "kind": "enum",
        "pythonName": "QUERY_SORT_ORDER",
        "displayName": "QUERY_SORT_ORDER",
        "signature": "class QUERY_SORT_ORDER(Enum):",
        "bases": ["Enum"],
        "cases": [
            {"name": "ASCENDING", "pythonName": "QUERY_SORT_ORDER.ASCENDING", "value": '"ASCENDING"'},
            {"name": "DESCENDING", "pythonName": "QUERY_SORT_ORDER.DESCENDING", "value": '"DESCENDING"'},
        ],
        "definitionBlock": 'class QUERY_SORT_ORDER(Enum):\n    ASCENDING = "ASCENDING"\n    DESCENDING = "DESCENDING"',
        "documentation": "Controls the sort direction for query filter actions.",
        "source": "Shortpy.NativeToolRendererPrelude",
    },
]


def unique_strings(values: list[object]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        if isinstance(value, list):
            iterable = value
        else:
            iterable = [value]
        for item in iterable:
            if isinstance(item, str) and item and item not in seen:
                seen.add(item)
                output.append(item)
    return output


def parameter_names(parameter: object) -> list[str]:
    if not isinstance(parameter, dict):
        return []
    return unique_strings([
        parameter.get("pythonName"),
        parameter.get("name"),
        parameter.get("key"),
        parameter.get("rawKey"),
        parameter.get("aliases"),
        parameter.get("acceptedNames"),
    ])


def optional_type(type_name: object) -> str:
    clean = str(type_name or "").strip()
    if not clean:
        return ""
    if clean.startswith("Optional["):
        return clean
    return f"Optional[{clean}]"


def query_filter_parameter(parameters: list[dict], name: str) -> dict | None:
    for parameter in parameters:
        if name in parameter_names(parameter):
            return parameter
        if name == "query" and (
            parameter.get("key") == "WFContentItemFilter"
            or parameter.get("rawKey") == "WFContentItemFilter"
            or "wfcontentitemfilter" in parameter_names(parameter)
        ):
            return parameter
    return None


def query_filter_scope_parameter(parameters: list[dict]) -> dict | None:
    for parameter in parameters:
        name = parameter.get("pythonName")
        type_name = str(parameter.get("type") or "")
        if name in {"query", "sort_by", "limit", "get"}:
            continue
        if "_wfcontent_item_input_parameter" in type_name or "WFContentItemInputParameter" in parameter_names(parameter):
            return parameter
    compound_index = next((
        index
        for index, parameter in enumerate(parameters)
        if parameter.get("key") == "WFCompoundType"
        or parameter.get("rawKey") == "WFCompoundType"
        or "wfcompoundtype" in parameter_names(parameter)
    ), -1)
    return parameters[compound_index + 1] if 0 <= compound_index < len(parameters) - 1 else None


def is_query_filter_item(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    if item.get("filterActionSurface") == "expanded-query":
        return False
    for parameter in item.get("parameters") or []:
        if not isinstance(parameter, dict):
            continue
        if (parameter.get("pythonName") == "query" or parameter.get("name") == "query" or parameter.get("inline")) and str(parameter.get("type") or "").startswith("query_"):
            return True
        if (
            parameter.get("key") == "WFContentItemFilter"
            or parameter.get("rawKey") == "WFContentItemFilter"
            or "wfcontentitemfilter" in parameter_names(parameter)
        ):
            return True
    return False


def normalize_query_filter_item(item: object) -> object:
    if not is_query_filter_item(item):
        return item
    assert isinstance(item, dict)
    parameters = [parameter for parameter in item.get("parameters") or [] if isinstance(parameter, dict)]
    query = query_filter_parameter(parameters, "query")
    if not query:
        query = next((parameter for parameter in parameters if str(parameter.get("type") or "").startswith("query_")), None)
    if not query:
        return item
    sort_by = query_filter_parameter(parameters, "sort_by")
    native_limit = query_filter_parameter(parameters, "limit")
    native_get = query_filter_parameter(parameters, "get")
    native_scope = query_filter_scope_parameter(parameters)
    query_type = str(query.get("type") or "Any").strip()
    output_parameters: list[dict] = [
        {
            **query,
            "pythonName": "query",
            "name": "query",
            "type": f"List[{query_type}]",
            "defaultValue": None,
            "inline": False,
            "positional": False,
            "doc": "The filter conditions.",
            "summary": "The filter conditions.",
            "aliases": unique_strings(["query", visible_compiler_parameter_names(query)]),
            "acceptedNames": unique_strings(["query", visible_compiler_parameter_names(query)]),
        },
        {
            "pythonName": "query_operator",
            "name": "query_operator",
            "type": "QUERY_OPERATOR",
            "defaultValue": "QUERY_OPERATOR.ALL",
            "doc": "If QUERY_OPERATOR.ALL, all filters must be satisfied. If QUERY_OPERATOR.ANY, any filter is sufficient.",
            "summary": "If QUERY_OPERATOR.ALL, all filters must be satisfied. If QUERY_OPERATOR.ANY, any filter is sufficient.",
            "aliases": ["query_operator"],
            "acceptedNames": ["query_operator"],
        },
    ]
    if sort_by:
        output_parameters.append({
            **sort_by,
            "pythonName": "sort_by",
            "name": "sort_by",
            "type": optional_type(sort_by.get("type")),
            "defaultValue": "None",
            "inline": False,
            "positional": False,
            "aliases": unique_strings(["sort_by", visible_compiler_parameter_names(sort_by)]),
            "acceptedNames": unique_strings(["sort_by", visible_compiler_parameter_names(sort_by)]),
        })
        output_parameters.append({
            "pythonName": "query_sort_order",
            "name": "query_sort_order",
            "type": "QUERY_SORT_ORDER",
            "defaultValue": "QUERY_SORT_ORDER.ASCENDING",
            "doc": "The sort order of the query.",
            "summary": "The sort order of the query.",
            "aliases": ["query_sort_order"],
            "acceptedNames": ["query_sort_order"],
        })
    limit_doc = (native_get or {}).get("doc") or (native_get or {}).get("summary") or "The maximum number of results."
    output_parameters.append({
        "pythonName": "limit",
        "name": "limit",
        "type": "Optional[int]",
        "defaultValue": "None",
        "doc": limit_doc,
        "summary": limit_doc,
        "aliases": unique_strings(["limit", "get", visible_compiler_parameter_names(native_limit or {}), visible_compiler_parameter_names(native_get or {})]),
        "acceptedNames": unique_strings(["limit", "get", visible_compiler_parameter_names(native_limit or {}), visible_compiler_parameter_names(native_get or {})]),
    })
    if native_scope:
        scope_doc = native_scope.get("doc") or native_scope.get("summary") or "The scope of the query."
        output_parameters.append({
            **native_scope,
            "pythonName": "scope",
            "name": "scope",
            "type": optional_type(native_scope.get("type")),
            "defaultValue": "None",
            "inline": False,
            "positional": False,
            "doc": scope_doc,
            "summary": scope_doc,
            "aliases": unique_strings(["scope", visible_compiler_parameter_names(native_scope)]),
            "acceptedNames": unique_strings(["scope", visible_compiler_parameter_names(native_scope)]),
        })
    return {
        **item,
        "parameters": output_parameters,
        "filterActionSurface": "expanded-query",
    }


def python_name_from_label(value: object) -> str:
    """Normalize native parameter keys for metadata aliases only."""
    if not isinstance(value, str):
        return ""
    words = []
    for token in re.findall(r"[0-9A-Za-z]+", value):
        if token.isupper() or (len(token) > 1 and token[:-1].isupper() and token[-1] == "s"):
            words.append(token.lower())
            continue
        token = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", token)
        token = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", token)
        words.extend(part.lower() for part in token.split("_") if part)
    return "_".join(words)


def visible_compiler_parameter_names(parameter: dict) -> list[str]:
    names = [
        name
        for name in unique_strings([
            parameter.get("pythonName"),
            parameter.get("name"),
            parameter.get("aliases"),
            parameter.get("acceptedNames"),
        ])
        if re.fullmatch(r"[a-z_][a-z0-9_]*", name)
    ]
    for raw_name in unique_strings([parameter.get("key"), parameter.get("rawKey")]):
        normalized = python_name_from_label(raw_name[2:] if raw_name.startswith("WF") else raw_name)
        if normalized and normalized not in names:
            names.append(normalized)
    return names


def visible_toolrenderer_parameter(parameter: object) -> object:
    if not isinstance(parameter, dict):
        return parameter
    output = {
        key: value
        for key, value in parameter.items()
        if key not in VISIBLE_TOOLKIT_PARAMETER_KEYS
    }
    accepted_names = visible_compiler_parameter_names(parameter)
    if accepted_names:
        output["acceptedNames"] = accepted_names
    return output


def visible_toolrenderer_item(item: object) -> object:
    if not isinstance(item, dict):
        return item
    item = normalize_query_filter_item(item)
    output = {
        key: value
        for key, value in item.items()
        if key not in VISIBLE_TOOLKIT_ITEM_KEYS
    }
    if isinstance(output.get("parameters"), list):
        output["parameters"] = [visible_toolrenderer_parameter(parameter) for parameter in output["parameters"]]
    return output


def merge_toolkit_parameter_aliases(item: dict, toolkit_item: dict) -> dict:
    rendered = item.get("parameters")
    toolkit = toolkit_item.get("parameters")
    if not isinstance(rendered, list) or not isinstance(toolkit, list):
        return item

    toolkit_by_name: dict[str, list[dict]] = {}
    for toolkit_parameter in toolkit:
        if not isinstance(toolkit_parameter, dict):
            continue
        for name in visible_compiler_parameter_names(toolkit_parameter):
            toolkit_by_name.setdefault(name, []).append(toolkit_parameter)

    rendered_names = [parameter.get("pythonName") if isinstance(parameter, dict) else None for parameter in rendered]
    toolkit_names = [parameter.get("pythonName") if isinstance(parameter, dict) else None for parameter in toolkit]
    positionally_aligned = len(rendered) == len(toolkit) and rendered_names == toolkit_names

    parameters = []
    for index, rendered_parameter in enumerate(rendered):
        if not isinstance(rendered_parameter, dict):
            return item
        parameter = dict(rendered_parameter)
        if positionally_aligned:
            toolkit_parameter = toolkit[index]
        else:
            candidates: dict[int, dict] = {}
            for name in visible_compiler_parameter_names(rendered_parameter):
                for candidate in toolkit_by_name.get(name, []):
                    candidates[id(candidate)] = candidate
            toolkit_parameter = next(iter(candidates.values())) if len(candidates) == 1 else None
        if not toolkit_parameter:
            parameters.append(parameter)
            continue

        accepted_names = unique_strings([
            visible_compiler_parameter_names(rendered_parameter),
            visible_compiler_parameter_names(toolkit_parameter),
        ])
        if accepted_names:
            parameter["acceptedNames"] = accepted_names
        raw_key = toolkit_parameter.get("key") or toolkit_parameter.get("rawKey")
        if isinstance(raw_key, str) and raw_key:
            parameter["rawKey"] = raw_key
        parameters.append(parameter)
    return {**item, "parameters": parameters}


def current_toolkit_metadata() -> dict:
    try:
        return load_toolkit_metadata()
    except Exception:
        return {}


def toolkit_items_by_id(kind: str) -> dict[str, dict]:
    metadata = current_toolkit_metadata()
    items = metadata.get(kind, [])
    if not isinstance(items, list):
        return {}
    by_id: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        identifier = item.get("id")
        python_name = item.get("pythonName")
        if not isinstance(identifier, str) or not identifier:
            continue
        if not isinstance(python_name, str) or not python_name:
            continue
        by_id[identifier] = item
    return by_id


def align_toolrenderer_items_by_exact_name(items: list[dict], kind: str) -> tuple[list[dict], dict]:
    toolkit_by_id = toolkit_items_by_id(kind)
    toolrenderer_by_name: dict[str, dict | None] = {}
    for item in items:
        name = item.get("pythonName")
        if isinstance(name, str) and name:
            if name in toolrenderer_by_name:
                toolrenderer_by_name[name] = None
            else:
                toolrenderer_by_name[name] = item

    output: list[dict] = []
    matched = 0
    missing_definitions = 0

    for identifier in sorted(toolkit_by_id):
        toolkit_item = toolkit_by_id[identifier]
        name = toolkit_item.get("pythonName")
        if not isinstance(name, str) or not name:
            continue
        template = toolrenderer_by_name.get(name)
        if template:
            clone = dict(template)
            clone = merge_toolkit_parameter_aliases(clone, toolkit_item)
            clone["id"] = identifier
            clone["nativeIdentifier"] = identifier
            clone["metadataMatchSource"] = "exact-pythonName"
            output.append(clone)
            matched += 1
            continue
        missing_definitions += 1
        output.append({
            "kind": "action" if kind == "actions" else "trigger",
            "pythonName": name,
            "nativeIdentifier": identifier,
            "id": identifier,
            "displayName": toolkit_item.get("displayName") or name,
            "summary": toolkit_item.get("summary") or "",
            "documentation": toolkit_item.get("summary") or "",
            "parameters": toolkit_item.get("parameters") or [],
            "source": "sqlite-pythonName",
            "definitionMissing": True,
        })

    return output, {
        "source": "ToolRenderer.pythonInterface exact pythonName",
        "matchedDefinitions": matched,
        "missingDefinitions": missing_definitions,
    }


def align_toolrenderer_metadata_by_exact_name(metadata: dict) -> dict:
    actions = [item for item in metadata.get("actions", []) or [] if isinstance(item, dict)]
    triggers = [item for item in metadata.get("triggers", []) or [] if isinstance(item, dict)]
    aligned_actions, action_summary = align_toolrenderer_items_by_exact_name(actions, "actions")
    aligned_triggers, trigger_summary = align_toolrenderer_items_by_exact_name(triggers, "triggers")
    summary = {
        "source": "ToolRenderer.pythonInterface exact pythonName",
        "actionMatchedDefinitions": action_summary["matchedDefinitions"],
        "actionMissingDefinitions": action_summary["missingDefinitions"],
        "triggerMatchedDefinitions": trigger_summary["matchedDefinitions"],
        "triggerMissingDefinitions": trigger_summary["missingDefinitions"],
    }
    output = {
        **metadata,
        "actions": aligned_actions,
        "triggers": aligned_triggers,
        "nativeNameAlignment": summary,
    }
    return output


def visible_toolrenderer_metadata(metadata: dict) -> dict:
    metadata = align_toolrenderer_metadata_by_exact_name(metadata)
    output = {
        key: value
        for key, value in metadata.items()
        if key not in {"customDescriptionSource", "customDescriptionCounts"}
    }
    actions = [visible_toolrenderer_item(item) for item in output.get("actions", []) or []]
    triggers = [visible_toolrenderer_item(item) for item in output.get("triggers", []) or []]
    helpers = [visible_toolrenderer_item(item) for item in output.get("helpers", []) or []]
    types = [visible_toolrenderer_item(item) for item in output.get("types", []) or []]
    type_names = {item.get("pythonName") for item in types if isinstance(item, dict)}
    for enum_type in FILTER_ENUM_TYPES:
        if enum_type["pythonName"] not in type_names:
            types.append(enum_type)
    output.update({
        "source": "ToolRenderer.pythonInterface",
        "actions": actions,
        "triggers": triggers,
        "helpers": helpers,
        "types": types,
        "items": helpers + actions + triggers,
        "counts": {
            **(output.get("counts", {}) or {}),
            "actions": len(actions),
            "triggers": len(triggers),
            "helpers": len(helpers),
            "types": len(types),
            "items": len(helpers) + len(actions) + len(triggers),
        },
    })
    return output


def enrich_toolrenderer_metadata_from_source(metadata: dict, source: str) -> dict:
    if not source:
        return metadata
    parsed = parse_toolrenderer_structured_from_source(source)
    parsed_by_name = {
        item.get("pythonName"): item
        for item in [
            *(parsed.get("helpers") or []),
            *(parsed.get("actions") or []),
            *(parsed.get("triggers") or []),
            *(parsed.get("types") or []),
        ]
        if item.get("pythonName")
    }

    def merge_items(items: object) -> list[dict]:
        merged: list[dict] = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            parsed_item = parsed_by_name.get(item.get("pythonName"))
            if parsed_item:
                output = {**parsed_item, **item}
                output["definitionBlock"] = item.get("definitionBlock") or parsed_item.get("definitionBlock", "")
                output["docSections"] = item.get("docSections") or parsed_item.get("docSections", {})
                if not output.get("returnDocs"):
                    output["returnDocs"] = parsed_item.get("returnDocs", "")
                if isinstance(output.get("parameters"), list) and isinstance(parsed_item.get("parameters"), list):
                    parsed_params = {
                        parameter.get("pythonName"): parameter
                        for parameter in parsed_item["parameters"]
                        if isinstance(parameter, dict) and parameter.get("pythonName")
                    }
                    fixed_params = []
                    for parameter in output["parameters"]:
                        if not isinstance(parameter, dict):
                            fixed_params.append(parameter)
                            continue
                        parsed_param = parsed_params.get(parameter.get("pythonName"))
                        fixed_params.append({**(parsed_param or {}), **parameter})
                    output["parameters"] = fixed_params
                merged.append(output)
            else:
                merged.append(item)
        return merged

    return {
        **metadata,
        "helpers": merge_items(metadata.get("helpers")),
        "actions": merge_items(metadata.get("actions")),
        "triggers": merge_items(metadata.get("triggers")),
        "types": merge_items(metadata.get("types")),
    }


def toolrenderer_structured_metadata(socket_path: str, refresh: bool = True) -> dict:
    response = None
    if refresh:
        try:
            raw = send_command(socket_path, "toolrenderer-structured-metadata")
            response = parse_bridge_json_response(raw, "toolrenderer-structured-metadata")
        except OSError as exc:
            response = {
                "ok": False,
                "mode": "toolrenderer-structured-metadata",
                "error": str(exc),
                "error_type": type(exc).__name__,
            }
        if not response.get("ok"):
            return response
        if response.get("ok") and response.get("items"):
            return visible_toolrenderer_metadata(
                enrich_toolrenderer_metadata_from_source(
                    response,
                    response.get("python_interface") or response.get("pythonInterface") or "",
                )
            )
        if response.get("ok"):
            structured = parse_toolrenderer_structured_from_source(
                response.get("python_interface") or response.get("pythonInterface") or ""
            )
            structured["generatedAt"] = response.get("generatedAt")
            structured["source"] = response.get("source") or structured["source"]
            structured["response"] = {
                "database_source": response.get("database_source"),
                "database_provider_class": response.get("database_provider_class"),
                "database_class": response.get("database_class"),
                "python_length": response.get("python_length"),
                "provider_symbols": response.get("provider_symbols"),
            }
            structured["diagnostics"] = (response.get("diagnostics") or []) + structured.get("diagnostics", [])
            return visible_toolrenderer_metadata(structured)
    metadata_path = Path(__file__).resolve().parents[1] / "logs" / "vscode-extension-toolrenderer-interface.json"
    raw_path = Path(__file__).resolve().parents[1] / "logs" / "toolrenderer-python-interface.py"
    if metadata_path.exists():
        cached = json.loads(metadata_path.read_text())
        cached["ok"] = True
        cached.setdefault("mode", "toolrenderer-structured-metadata")
        cached.setdefault("source", f"cached {metadata_path}")
        cached.setdefault("diagnostics", [])
        return visible_toolrenderer_metadata(cached)
    if raw_path.exists():
        return visible_toolrenderer_metadata(parse_toolrenderer_structured_from_source(raw_path.read_text()))
    if response is not None:
        return response
    return {
        "ok": False,
        "mode": "toolrenderer-structured-metadata",
        "error": "No live or cached ToolRenderer interface is available",
    }


def query_terms(query: str) -> list[str]:
    return [
        term
        for term in re.split(r"[^a-z0-9_]+", query.lower())
        if term and term not in QUERY_STOPWORDS
    ]


def score_toolrenderer_item(item: dict, terms: list[str]) -> int:
    name = item.get("pythonName", "").lower()
    display = item.get("displayName", "").lower()
    docs = item.get("documentation", "").lower()
    signature = item.get("signature", "").lower()
    score = 0
    for term in terms:
        if term in name:
            score += 12
        if term in display:
            score += 8
        if term in signature:
            score += 3
        if term in docs:
            score += 1
    haystack = f"{name} {display} {signature} {docs}"
    if all(term in haystack for term in terms):
        score += 10
    return score


def dedupe_toolrenderer_items(items: list[dict], kind: str) -> tuple[list[dict], dict]:
    merged: dict[tuple[str, str], dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_kind = item.get("kind")
        python_name = item.get("pythonName")
        if not isinstance(item_kind, str) or not isinstance(python_name, str) or not python_name:
            continue
        normalized_kind = "tool" if item_kind == "action" else item_kind
        if kind == "tool" and normalized_kind != "tool":
            continue
        if kind == "trigger" and normalized_kind != "trigger":
            continue
        result = dict(item)
        if not result.get("sourceKind"):
            result["sourceKind"] = item.get("sourceKind") or "ToolRenderer.pythonInterface"
        merged[(normalized_kind, python_name)] = result
    return list(merged.values()), {
        "toolrenderer_items": len(merged),
    }


def load_toolrenderer_items(socket_path: str, refresh: bool) -> tuple[list[dict], str, dict | None]:
    if not refresh:
        cached, source = cached_toolrenderer_items()
        if cached is not None:
            return cached, f"cached {source}", None
    if refresh:
        response = toolrenderer_structured_metadata(socket_path, refresh=True)
        if response.get("ok"):
            return response.get("items", []), response.get("source", "live toolrenderer-structured-metadata"), None
        cached, source = cached_toolrenderer_items()
        if cached is not None:
            return cached, f"cached {source}", response
        return [], "live toolrenderer-structured-metadata", response
    raw = send_command(socket_path, "toolrenderer-python-interface")
    response = parse_bridge_json_response(raw, "toolrenderer-python-interface")
    if response.get("ok"):
        return parse_toolrenderer_items(response.get("python_interface", "")), "live ToolRenderer.pythonInterface", None
    cached, source = cached_toolrenderer_items()
    if cached is not None:
        return cached, f"cached {source}", response
    return [], "live ToolRenderer.pythonInterface", response


def safe_toolrenderer_search(socket_path: str, query: str, kind: str, limit: int, refresh: bool = False) -> dict:
    items, source, refresh_error = load_toolrenderer_items(socket_path, refresh)
    index_notes: dict = {}
    try:
        items, index_notes = dedupe_toolrenderer_items(items, kind)
    except Exception as exc:
        index_notes = {"toolrenderer_index_error": str(exc)}
    if refresh_error is not None and not items:
        return refresh_error
    terms = query_terms(query)
    if kind == "tool":
        allowed = {"tool", "action"}
    elif kind == "trigger":
        allowed = {"trigger"}
    else:
        allowed = {"tool", "action", "trigger", "helper"}
    ranked = []
    for item in items:
        if item["kind"] not in allowed:
            continue
        score = score_toolrenderer_item(item, terms)
        if score > 0 or not terms:
            ranked.append({**item, "score": score})
    ranked.sort(key=lambda item: (-item["score"], item["kind"], item["pythonName"]))
    payload = {
        "ok": True,
        "mode": "agent-tool-search",
        "source": source,
        "query": query,
        "kind": kind,
        "limit": max(1, limit),
        "tool_visibility_source": "active-toolkit-sqlite",
        "native_agent_toolbox_status": "guarded behind --native",
        "notes": [
            "Search uses Apple's ToolRenderer.pythonInterface from the active simulator ToolKit database.",
            "The active ToolKit sqlite is adjusted before bridge launch so rows have visibleForShortcuts and approved visibility bits.",
            "Native AgentToolbox.query remains guarded because ToolKit dispatch-precondition evidence shows a null queue crash in this bridge context.",
        ],
        "counts": {
            "items": len(items),
            "matched": len(ranked),
            **index_notes,
        },
        "results": ranked[: max(1, limit)],
    }
    if refresh_error is not None:
        payload["refresh_error"] = refresh_error
    return payload


def normalize_catalog_metadata(value: object) -> list[dict]:
    entries: list[dict] = []

    def add_entry(tag: object, metadata: object, source: str, extra: dict | None = None) -> None:
        if tag is None:
            return
        tag_text = str(tag)
        if tag_text.startswith("ref("):
            match = re.search(r"0x[0-9a-fA-F]+", tag_text)
            tag_text = match.group(0) if match else tag_text
        if not tag_text.startswith("0x"):
            tag_text = f"0x{tag_text}"
        normalized = {
            "tag": tag_text.upper().replace("X", "x", 1),
            "metadata": metadata,
            "source": source,
        }
        if isinstance(metadata, str):
            try:
                normalized["metadata_json"] = json.loads(metadata)
            except json.JSONDecodeError:
                pass
        elif isinstance(metadata, dict):
            normalized["metadata_json"] = metadata
            normalized["metadata"] = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
        if extra:
            normalized.update(extra)
        entries.append(normalized)

    def walk(node: object, source: str = "catalog_metadata") -> None:
        if isinstance(node, dict):
            if "catalog_metadata" in node:
                walk(node["catalog_metadata"], f"{source}.catalog_metadata")
            for key in ("results", "entities", "candidates", "entries"):
                if key in node:
                    walk(node[key], f"{source}.{key}")
            if "tag" in node and ("metadata" in node or "metadata_json" in node):
                add_entry(
                    node.get("tag"),
                    node.get("metadata", node.get("metadata_json")),
                    source,
                    {k: v for k, v in node.items() if k not in {"tag", "metadata", "metadata_json"}},
                )
            if node and all(isinstance(k, str) and k.startswith("0x") for k in node.keys()):
                for tag, metadata in node.items():
                    add_entry(tag, metadata, source)
        elif isinstance(node, list):
            for item in node:
                walk(item, source)

    walk(value)
    deduped: dict[str, dict] = {}
    for entry in entries:
        deduped[entry["tag"]] = entry
    return list(deduped.values())


def refs_in_source(source: bytes) -> list[str]:
    text = source.decode("utf-8", errors="ignore")
    return [f"0x{match.upper()}" for match in re.findall(r"ref\(0x([0-9a-fA-F]+)\)", text)]


def native_catalog_json(value: object) -> dict | None:
    if isinstance(value, dict):
        encoded = value.get("encoded_catalog")
        if isinstance(encoded, dict) and isinstance(encoded.get("json"), dict):
            return encoded["json"]
        if value and all(isinstance(k, str) and k.startswith("0x") for k in value.keys()):
            if all(isinstance(v, dict) and "parameterState" in v for v in value.values()):
                return value
    return None


class InlineCatalogError(Exception):
    def __init__(self, diagnostics: list[dict]):
        self.diagnostics = diagnostics
        super().__init__("; ".join(item.get("message", "inline catalog error") for item in diagnostics))


class ShortcutSigningError(Exception):
    def __init__(self, message: str, details: dict):
        self.details = details
        super().__init__(message)


def call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def literal_json_value(node: ast.AST) -> object:
    value = ast.literal_eval(node)
    json.dumps(value)
    return value


TOOLKIT_METADATA_CACHE: dict | None = None
TOOLRENDERER_PARAMETER_CACHE: dict[tuple[str, str], dict] | None = None


def load_toolkit_metadata() -> dict:
    global TOOLKIT_METADATA_CACHE
    if TOOLKIT_METADATA_CACHE is not None:
        return TOOLKIT_METADATA_CACHE
    metadata_path = Path(__file__).resolve().parents[1] / "logs" / "vscode-extension-toolkit-metadata.json"
    selection_path = Path(__file__).resolve().parents[1] / "logs" / "shortpy-toolkit-selection.json"
    selected_sqlite = None
    try:
        selection = json.loads(selection_path.read_text())
        if isinstance(selection, dict):
            for key in ("target", "active", "prepared", "source"):
                section = selection.get(key)
                path_value = None
                if isinstance(section, dict):
                    for path_key in ("resolved", "path"):
                        value = section.get(path_key)
                        if isinstance(value, str) and value:
                            path_value = value
                            break
                if isinstance(path_value, str) and path_value:
                    selected_sqlite = path_value
                    break
    except Exception:
        selected_sqlite = None
    try:
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            str(Path(__file__).with_name("toolkitctl.py")),
            "--quiet",
            "metadata",
            "--out",
            str(metadata_path),
        ]
        if selected_sqlite:
            command.extend(["--sqlite", selected_sqlite])
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    try:
        parsed = json.loads(metadata_path.read_text())
        if isinstance(parsed, dict):
            TOOLKIT_METADATA_CACHE = parsed
            return parsed
    except Exception:
        pass
    TOOLKIT_METADATA_CACHE = {}
    return TOOLKIT_METADATA_CACHE


def toolkit_items(kind: str, python_name: str) -> list[dict]:
    metadata = load_toolkit_metadata()
    items = metadata.get(kind, [])
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("pythonName") == python_name]


def toolrenderer_parameter_cache() -> dict[tuple[str, str], dict]:
    global TOOLRENDERER_PARAMETER_CACHE
    if TOOLRENDERER_PARAMETER_CACHE is not None:
        return TOOLRENDERER_PARAMETER_CACHE
    cache: dict[tuple[str, str], dict] = {}
    items, _source = cached_toolrenderer_items()
    for item in items or []:
        name = item.get("pythonName")
        if not isinstance(name, str) or not name:
            continue
        for parameter in item.get("parameters", []) or []:
            if not isinstance(parameter, dict):
                continue
            parameter_name = parameter.get("pythonName")
            parameter_type = parameter.get("type")
            if isinstance(parameter_name, str) and isinstance(parameter_type, str):
                cache[(name, parameter_name)] = {
                    "type": parameter_type,
                    "source": item.get("source") or item.get("sourceKind") or "ToolRenderer.pythonInterface",
                    "kind": item.get("kind"),
                }
    TOOLRENDERER_PARAMETER_CACHE = cache
    return cache


def catalog_parameter_info(action_name: str, parameter_name: str) -> dict | None:
    info = toolrenderer_parameter_cache().get((action_name, parameter_name))
    if not info:
        return None
    type_text = str(info.get("type", ""))
    compact = re.sub(r"\s+", "", type_text)
    is_resolved = "Resolved[" in compact
    is_picked = "Picked[" in compact
    if not is_resolved and not is_picked:
        return None
    is_list = bool(re.search(r"(?:^|[\[,])(?:List|ContentCollection|Collection|Set|Sequence)\[(?:Resolved|Picked)\[", compact))
    return {
        **info,
        "catalogKind": "picked" if is_picked else "resolved",
        "isList": is_list,
    }


def preferred_action_item(action_name: str) -> dict | None:
    items = toolkit_items("actions", action_name)
    for item in items:
        identifier = item.get("id")
        if isinstance(identifier, str) and identifier.startswith("is.workflow.actions."):
            return item
    return items[0] if items else None


def preferred_parameter_key(item: dict, parameter_name: str) -> str | None:
    parameters = item.get("parameters", [])
    if not isinstance(parameters, list):
        return None
    candidates = [
        parameter
        for parameter in parameters
        if isinstance(parameter, dict) and parameter.get("pythonName") == parameter_name and isinstance(parameter.get("key"), str)
    ]
    for parameter in candidates:
        key = parameter["key"]
        if key.startswith("WF"):
            return key
    for parameter in candidates:
        key = parameter["key"]
        if key != parameter_name:
            return key
    return candidates[0]["key"] if candidates else None


def trigger_identifier_and_variant(item: dict) -> tuple[str, str] | None:
    identifier = item.get("id")
    if not isinstance(identifier, str):
        return None
    prefix = "com.apple.shortcuts."
    if identifier.startswith(prefix):
        tail = identifier[len(prefix):]
    else:
        tail = identifier
    parts = tail.rsplit(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def active_tool_database_binding_for_context(action_name: str, parameter_name: str) -> dict:
    """Build the native catalog host/key from the active ToolKit identity.

    ToolRenderer.ParameterMetadataProvider.binding(toolID:) returns parameter
    annotation/default callbacks, not a WFParameterStateCatalogEntryHandle.
    The catalog handle's durable identity is the native tool/trigger ID plus
    the raw parameter key from the active Tool database.
    """
    trigger_items = toolkit_items("triggers", action_name)
    if trigger_items:
        trigger_item = trigger_items[0]
        parsed = trigger_identifier_and_variant(trigger_item)
        key = preferred_parameter_key(trigger_item, parameter_name)
        if parsed and key:
            identifier, variant = parsed
            return {
                "source": "active-tool-database",
                "hostAndKey": {
                    "handle": {
                        "trigger": {
                            "identifier": identifier,
                            "variant": variant,
                        }
                    },
                    "key": key,
                }
            }
    action_item = preferred_action_item(action_name)
    if action_item:
        identifier = action_item.get("id")
        key = preferred_parameter_key(action_item, parameter_name)
        if isinstance(identifier, str) and key:
            return {
                "source": "active-tool-database",
                "hostAndKey": {
                    "handle": {
                        "action": {
                            "identifier": identifier,
                        }
                    },
                    "key": key,
                }
            }
    raise InlineCatalogError([
        {
            "code": "unsupportedInlineCatalogContext",
            "message": f"Inline catalog metadata for {action_name}.{parameter_name} has no native tool/trigger ID and raw parameter key in the active Tool database; refusing to guess a catalog host/key.",
            "actionName": action_name,
            "actionParameter": parameter_name,
        }
    ])


def catalog_host_binding_for_context(action_name: str, parameter_name: str) -> dict:
    return active_tool_database_binding_for_context(action_name, parameter_name)


def stable_ref_tag(entry: dict, used: set[str]) -> str:
    seed = json.dumps(
        {
            "actionName": entry["actionName"],
            "actionParameter": entry["actionParameter"],
            "parameterType": entry.get("parameterType"),
            "handle": entry["handle"],
            "bindingSource": entry.get("bindingSource"),
            "metadata": entry["metadata"],
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    base = int(hashlib.sha256(seed).hexdigest()[:4], 16)
    for offset in range(0x10000):
        candidate = f"0x{((base + offset) & 0xFFFF):04X}"
        if candidate not in used:
            used.add(candidate)
            return candidate
    raise InlineCatalogError([
        {
            "code": "inlineCatalogRefExhausted",
            "message": "Unable to allocate a unique 16-bit catalog ref for inline metadata.",
        }
    ])


def line_offsets_for(text: str) -> list[int]:
    offsets = []
    cursor = 0
    for line in text.splitlines(keepends=True):
        offsets.append(cursor)
        cursor += len(line)
    if not offsets:
        offsets.append(0)
    return offsets


def node_span(node: ast.AST, line_offsets: list[int]) -> tuple[int, int]:
    if not hasattr(node, "lineno") or not hasattr(node, "end_lineno"):
        raise InlineCatalogError([
            {
                "code": "inlineCatalogParserSpanMissing",
                "message": "Python parser did not provide source spans for inline catalog metadata.",
            }
        ])
    start = line_offsets[node.lineno - 1] + node.col_offset
    end = line_offsets[node.end_lineno - 1] + node.end_col_offset
    return start, end


def _empty_list_assignment_name(statement: ast.stmt) -> str | None:
    if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
        return None
    target = statement.targets[0]
    if not isinstance(target, ast.Name):
        return None
    if not isinstance(statement.value, ast.List) or statement.value.elts:
        return None
    return target.id


def _direct_append(statement: ast.stmt) -> tuple[str, ast.AST] | None:
    if not isinstance(statement, ast.Expr) or not isinstance(statement.value, ast.Call):
        return None
    call = statement.value
    if call.keywords or len(call.args) != 1:
        return None
    function = call.func
    if (
        not isinstance(function, ast.Attribute)
        or function.attr != "append"
        or not isinstance(function.value, ast.Name)
    ):
        return None
    return function.value.id, call.args[0]


def _loads_name(statements: list[ast.stmt], name: str) -> bool:
    return any(
        isinstance(node, ast.Name)
        and isinstance(node.ctx, ast.Load)
        and node.id == name
        for statement in statements
        for node in ast.walk(statement)
    )


def _statement_blocks(node: ast.AST) -> list[list[ast.stmt]]:
    blocks: list[list[ast.stmt]] = []
    seen: set[int] = set()

    def visit(value: object) -> None:
        if isinstance(value, ast.AST):
            for _field, child in ast.iter_fields(value):
                visit(child)
            return
        if not isinstance(value, list):
            return
        if value and all(isinstance(item, ast.stmt) for item in value):
            block_id = id(value)
            if block_id not in seen:
                seen.add(block_id)
                blocks.append(value)
        for item in value:
            visit(item)

    visit(node)
    return blocks


def _repeat_output_candidates(tree: ast.AST) -> list[dict]:
    candidates: list[dict] = []
    for block in _statement_blocks(tree):
        empty_assignments: dict[str, int] = {}
        for index, statement in enumerate(block):
            assigned_name = _empty_list_assignment_name(statement)
            if assigned_name is not None:
                empty_assignments[assigned_name] = index
                continue
            if not isinstance(statement, ast.For):
                continue
            direct_appends: dict[str, list[tuple[int, ast.stmt, ast.AST]]] = {}
            for body_index, body_statement in enumerate(statement.body):
                append = _direct_append(body_statement)
                if append is not None:
                    target, argument = append
                    direct_appends.setdefault(target, []).append(
                        (body_index, body_statement, argument)
                    )
            for accumulator, appends in direct_appends.items():
                assignment_index = empty_assignments.get(accumulator)
                if (
                    assignment_index is None
                    or len(appends) != 1
                    or appends[0][0] != len(statement.body) - 1
                ):
                    continue
                if not _loads_name(block[index + 1 :], accumulator):
                    continue
                append_index, append_statement, argument = appends[0]
                candidates.append(
                    {
                        "block": block,
                        "assignment_index": assignment_index,
                        "loop_index": index,
                        "loop": statement,
                        "accumulator": accumulator,
                        "append_index": append_index,
                        "append_statement": append_statement,
                        "argument": argument,
                    }
                )
    return candidates


def _conditional_leaf_bodies(statement: ast.If) -> list[list[ast.stmt]] | None:
    if not statement.body or not statement.orelse:
        return None
    bodies = [statement.body]
    current = statement
    while (
        len(current.orelse) == 1
        and isinstance(current.orelse[0], ast.If)
    ):
        current = current.orelse[0]
        if not current.body or not current.orelse:
            return None
        bodies.append(current.body)
    bodies.append(current.orelse)
    return bodies


def _branch_result_appends(
    statement: ast.stmt,
) -> tuple[str, list[tuple[ast.stmt, ast.AST]]] | None:
    if isinstance(statement, ast.If):
        bodies = _conditional_leaf_bodies(statement)
        if bodies is None:
            return None
    elif isinstance(statement, ast.Match):
        bodies = [case.body for case in statement.cases]
        if not bodies or any(not body for body in bodies):
            return None
    else:
        return None

    appends: list[tuple[ast.stmt, ast.AST]] = []
    target: str | None = None
    for body in bodies:
        append = _direct_append(body[-1])
        if append is None:
            return None
        candidate_target, argument = append
        if target is None:
            target = candidate_target
        elif target != candidate_target:
            return None
        appends.append((body[-1], argument))
    return (target, appends) if target is not None else None


def _variable_atom_requires_explicit_action(node: ast.AST) -> bool:
    def classify(value: ast.AST) -> tuple[bool, bool]:
        if isinstance(value, ast.Name):
            return True, False
        if isinstance(value, ast.Attribute):
            return classify(value.value)
        if isinstance(value, ast.Subscript):
            valid, _requires_explicit = classify(value.value)
            return valid, valid
        if (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and not value.args
            and len(value.keywords) == 1
            and value.keywords[0].arg == "_from"
        ):
            valid, requires_explicit = classify(value.keywords[0].value)
            return valid, valid or requires_explicit
        return False, False

    valid, requires_explicit = classify(node)
    return valid and requires_explicit


def inline_catalog_literals(value_node: ast.AST, parameter_info: dict) -> list[ast.Dict]:
    if isinstance(value_node, ast.Dict) and not parameter_info.get("isList"):
        return [value_node]
    if isinstance(value_node, (ast.List, ast.Tuple)) and parameter_info.get("isList"):
        matches = []
        for item in value_node.elts:
            if not isinstance(item, ast.Dict):
                continue
            try:
                literal_json_value(item)
            except Exception:
                continue
            matches.append(item)
        return matches
    return []


def rewrite_inline_catalog_metadata(source: bytes) -> dict:
    text = source.decode("utf-8")
    tree = ast.parse(text)
    line_offsets = line_offsets_for(text)
    used_tags: set[str] = set(refs_in_source(source))
    entries: list[dict] = []
    replacements: list[tuple[int, int, str]] = []
    diagnostics: list[dict] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        action_name = call_name(node.func)
        if not action_name:
            continue
        for keyword in node.keywords:
            if not keyword.arg:
                continue
            parameter_info = catalog_parameter_info(action_name, keyword.arg)
            if parameter_info is None:
                continue
            literal_nodes = inline_catalog_literals(keyword.value, parameter_info)
            for literal_node in literal_nodes:
                try:
                    metadata = literal_json_value(literal_node)
                    binding = catalog_host_binding_for_context(action_name, keyword.arg)
                    entry = {
                        "actionName": action_name,
                        "actionParameter": keyword.arg,
                        "parameterType": parameter_info["type"],
                        "catalogKind": parameter_info["catalogKind"],
                        "isList": parameter_info["isList"],
                        "handle": {"hostAndKey": binding["hostAndKey"]},
                        "bindingSource": binding.get("source"),
                        "metadata": metadata,
                    }
                    tag = stable_ref_tag(entry, used_tags)
                    entry["tag"] = tag
                    start, end = node_span(literal_node, line_offsets)
                    entries.append(entry)
                    replacements.append((start, end, f"ref({tag})"))
                except InlineCatalogError as exc:
                    for diagnostic in exc.diagnostics:
                        enriched = dict(diagnostic)
                        enriched.setdefault("actionName", action_name)
                        enriched.setdefault("actionParameter", keyword.arg)
                        enriched.setdefault("parameterType", parameter_info.get("type"))
                        diagnostics.append(enriched)
                except Exception as exc:
                    diagnostics.append(
                        {
                            "code": "invalidInlineCatalogMetadata",
                            "message": f"Invalid inline catalog metadata for {action_name}.{keyword.arg}: {exc}",
                            "actionName": action_name,
                            "actionParameter": keyword.arg,
                        }
                    )

    if diagnostics:
        raise InlineCatalogError(diagnostics)
    if not entries:
        return {
            "source": source,
            "source_text": text,
            "entries": [],
            "rewritten": False,
        }
    rewritten = text
    for start, end, replacement in sorted(replacements, key=lambda item: item[0], reverse=True):
        rewritten = rewritten[:start] + replacement + rewritten[end:]
    return {
        "source": rewritten.encode("utf-8"),
        "source_text": rewritten,
        "entries": entries,
        "rewritten": True,
    }


def expand_inline_catalog(socket_path: str, entries: list[dict]) -> dict:
    request = {"version": 1, "entries": entries}
    payload = base64.b64encode(
        json.dumps(request, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    response = json.loads(send_command(socket_path, f"expand-inline-catalog-b64 {payload}"))
    if not response.get("ok"):
        raise InlineCatalogError([
            {
                "code": "inlineCatalogExpansionFailed",
                "message": response.get("diagnostic") or response.get("error") or json.dumps(response, sort_keys=True),
                "bridge_response": response,
            }
        ])
    return response


def attach_inline_catalog_summary(response: dict, prepared: dict, expand_response: dict | None) -> dict:
    if not prepared.get("entries"):
        return response
    response["inline_catalog_metadata"] = {
        "present": True,
        "entry_count": len(prepared["entries"]),
        "rewritten_for_compiler": True,
        "compiler_refs": [entry["tag"] for entry in prepared["entries"]],
        "agent_catalog_metadata": (expand_response or {}).get("agent_catalog_metadata", {}),
        "contexts": [
            {
                "tag": entry["tag"],
                "actionName": entry["actionName"],
                "actionParameter": entry["actionParameter"],
                "parameterType": entry.get("parameterType"),
                "catalogKind": entry.get("catalogKind"),
                "bindingSource": entry.get("bindingSource"),
            }
            for entry in prepared["entries"]
        ],
    }
    if not response.get("ok") and response.get("diagnostic") == "malformedStateData":
        response["inline_catalog_metadata"]["parameter_state_diagnostic"] = {
            "status": "nativeRejectedParameterState",
            "message": (
                "Inline metadata was rewritten to refs and catalog handles, but "
                "WFPythonWorkflowProxy.decodeCatalog(from:) rejected the archived "
                "parameterState. This entity family likely needs a native "
                "parameter-state adapter beyond the agent-facing JSON metadata."
            ),
        }
    return response


def _compile_prepared_python_to_bplist(
    socket_path: str,
    prepared: dict,
    flags: int,
    catalog_payload: object | None,
    pipeline: str = "shortpy",
) -> dict:
    native_catalog_payload = (
        native_catalog_json(catalog_payload)
        if catalog_payload is not None
        else None
    )
    expand_response = None
    if prepared.get("entries"):
        expand_response = expand_inline_catalog(socket_path, prepared["entries"])
        native_catalog_payload = expand_response.get("catalog")
    payload = base64.b64encode(prepared["source"]).decode("ascii")
    pipeline_raw = {"native": 0, "shortpy": 1}[pipeline]
    if native_catalog_payload is not None:
        catalog_text = json.dumps(
            native_catalog_payload, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        catalog_b64 = base64.b64encode(catalog_text).decode("ascii")
        raw = send_command(
            socket_path,
            f"pipeline-python-to-bplist-catalog-b64-flags {pipeline_raw} {flags} {payload} {catalog_b64}",
        )
    else:
        raw = send_command(
            socket_path,
            f"pipeline-python-to-bplist-b64-flags {pipeline_raw} {flags} {payload}",
        )
    return attach_inline_catalog_summary(
        json.loads(raw), prepared, expand_response
    )


def compile_python_to_bplist(
    socket_path: str,
    source: bytes,
    flags: int,
    catalog_payload: object | None = None,
    pipeline: str = "shortpy",
) -> dict:
    prepared = rewrite_inline_catalog_metadata(source)
    return _compile_prepared_python_to_bplist(
        socket_path, prepared, flags, catalog_payload, pipeline
    )


def sign_shortcut_response(
    response: dict,
    signing_mode: str = "anyone",
    shortcuts_cli: str = DEFAULT_SHORTCUTS_CLI,
) -> dict:
    if not response.get("ok"):
        return response
    payload = response.get("plist_payload")
    if not isinstance(payload, dict) or payload.get("encoding") != "base64" or not isinstance(payload.get("data"), str):
        raise ShortcutSigningError(
            "bridge response did not include a base64 workflow plist payload to sign",
            {"payload_present": isinstance(payload, dict)},
        )
    try:
        unsigned_bytes = base64.b64decode(payload["data"], validate=True)
    except Exception as exc:
        raise ShortcutSigningError(
            f"workflow plist payload was not valid base64: {exc}",
            {"payload_length": len(payload.get("data", ""))},
        ) from exc

    cli = Path(shortcuts_cli)
    if not cli.exists():
        raise ShortcutSigningError(
            f"shortcuts CLI not found: {cli}",
            {"tool": str(cli), "mode": signing_mode},
        )

    with tempfile.TemporaryDirectory(prefix="shortpy-sign-") as tmp:
        tmpdir = Path(tmp)
        unsigned_path = tmpdir / "unsigned.shortcut"
        signed_path = tmpdir / "signed.shortcut"
        unsigned_path.write_bytes(unsigned_bytes)
        command = [
            str(cli),
            "sign",
            "--mode",
            signing_mode,
            "--input",
            str(unsigned_path),
            "--output",
            str(signed_path),
        ]
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not signed_path.exists():
            raise ShortcutSigningError(
                "shortcuts sign failed",
                {
                    "tool": str(cli),
                    "mode": signing_mode,
                    "returncode": result.returncode,
                    "stdout": result.stdout.strip(),
                    "stderr": result.stderr.strip(),
                },
            )
        signed_bytes = signed_path.read_bytes()

    response["shortcut_signing"] = {
        "ok": True,
        "tool": str(cli),
        "mode": signing_mode,
        "unsigned_length": len(unsigned_bytes),
        "signed_length": len(signed_bytes),
        "signed_header_ascii": signed_bytes[:8].decode("ascii", errors="replace"),
        "signed_header_hex": signed_bytes[:8].hex(),
        "looks_like_aea1": signed_bytes.startswith(b"AEA1"),
    }
    response["shortcut_payload"] = {
        "format": "com.apple.shortcut.signed",
        "encoding": "base64",
        "length": len(signed_bytes),
        "signing_mode": signing_mode,
        "source": "macOS shortcuts sign",
        "data": base64.b64encode(signed_bytes).decode("ascii"),
    }
    return response


def is_signed_shortcut_bytes(data: bytes) -> bool:
    return data.startswith(b"AEA1")


def run_required(command: list[str], failure: str) -> subprocess.CompletedProcess:
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise RuntimeError(f"{failure}: {detail}")
    return result


def read_aea_auth_data_plist(signed_shortcut: bytes) -> dict:
    if len(signed_shortcut) < 12 or not is_signed_shortcut_bytes(signed_shortcut):
        raise RuntimeError("not an AEA1 signed shortcut")
    auth_data_size = int.from_bytes(signed_shortcut[8:12], "little")
    auth_start = 12
    auth_end = auth_start + auth_data_size
    if auth_data_size <= 0 or auth_end > len(signed_shortcut):
        raise RuntimeError("signed shortcut has an invalid AEA auth-data size")
    auth_data = signed_shortcut[auth_start:auth_end]
    try:
        value = plistlib.loads(auth_data)
    except Exception as exc:
        raise RuntimeError(f"signed shortcut auth data is not a plist: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("signed shortcut auth data plist is not a dictionary")
    return value


def p256_public_key_pem(raw_key: bytes) -> str:
    if len(raw_key) != 65 or raw_key[0] != 0x04:
        raise RuntimeError(
            "signed shortcut SigningPublicKey is not an uncompressed P-256 public key"
        )
    spki_prefix = bytes.fromhex(
        "3059301306072a8648ce3d020106082a8648ce3d030107034200"
    )
    encoded = base64.encodebytes(spki_prefix + raw_key).decode("ascii")
    body = "\n".join(line for line in encoded.splitlines() if line)
    return f"-----BEGIN PUBLIC KEY-----\n{body}\n-----END PUBLIC KEY-----\n"


def extract_signing_public_key_pem(auth_data: dict, tmpdir: Path, openssl_cli: str) -> tuple[str, str, int]:
    certificate_chain = auth_data.get("SigningCertificateChain")
    if isinstance(certificate_chain, list) and certificate_chain:
        leaf_cert = certificate_chain[0]
        if not isinstance(leaf_cert, (bytes, bytearray)):
            raise RuntimeError("SigningCertificateChain leaf certificate is not DER bytes")
        cert_path = tmpdir / "leaf.der"
        cert_path.write_bytes(bytes(leaf_cert))
        public_key_result = run_required(
            [
                openssl_cli,
                "x509",
                "-inform",
                "DER",
                "-in",
                str(cert_path),
                "-pubkey",
                "-noout",
            ],
            "failed to extract signing public key from shortcut certificate",
        )
        return public_key_result.stdout, "SigningCertificateChain", len(certificate_chain)

    signing_public_key = auth_data.get("SigningPublicKey")
    if isinstance(signing_public_key, (bytes, bytearray)):
        return p256_public_key_pem(bytes(signing_public_key)), "SigningPublicKey", 0

    raise RuntimeError("signed shortcut auth data did not contain a supported signing public key")


# Narrow extraction path credited to 0xilis (Snoolie). It mirrors the MIT-licensed
# libshortcutsign extract_signed_shortcut concept without vendoring the full library:
# decrypt the AEA1 envelope, then unwrap Shortcut.wflow from the embedded Apple Archive.
def extract_signed_shortcut(
    signed_shortcut_path: Path,
    dest_path: Path,
    aea_cli: str = DEFAULT_AEA_CLI,
    aa_cli: str = DEFAULT_AA_CLI,
    openssl_cli: str = DEFAULT_OPENSSL_CLI,
) -> dict:
    signed_bytes = signed_shortcut_path.read_bytes()
    auth_data = read_aea_auth_data_plist(signed_bytes)

    with tempfile.TemporaryDirectory(prefix="shortpy-extract-") as tmp:
        tmpdir = Path(tmp)
        public_key_path = tmpdir / "leaf-public.pem"
        aar_path = tmpdir / "shortcut.aar"
        extract_dir = tmpdir / "extract"
        extract_dir.mkdir()

        public_key_pem, signing_key_source, signing_certificate_count = extract_signing_public_key_pem(
            auth_data,
            tmpdir,
            openssl_cli,
        )
        public_key_path.write_text(public_key_pem)
        run_required(
            [
                aea_cli,
                "decrypt",
                "-i",
                str(signed_shortcut_path),
                "-o",
                str(aar_path),
                "-sign-pub",
                str(public_key_path),
            ],
            "failed to decrypt signed shortcut AEA envelope",
        )
        run_required(
            [
                aa_cli,
                "extract",
                "-i",
                str(aar_path),
                "-d",
                str(extract_dir),
                "-include-path",
                "Shortcut.wflow",
            ],
            "failed to extract Shortcut.wflow from signed shortcut archive",
        )
        extracted = extract_dir / "Shortcut.wflow"
        if not extracted.exists():
            raise RuntimeError("signed shortcut archive did not contain Shortcut.wflow")
        shutil.copyfile(extracted, dest_path)

    return {
        "ok": True,
        "source": "AEA1 signed shortcut",
        "credit": "Narrow extraction flow based on MIT-licensed libshortcutsign extract_signed_shortcut by 0xilis (Snoolie).",
        "auth_data_keys": sorted(str(key) for key in auth_data.keys()),
        "signing_key_source": signing_key_source,
        "certificate_count": signing_certificate_count,
        "apple_id_certificate_count": len(auth_data.get("AppleIDCertificateChain") or []),
        "workflow_plist_length": dest_path.stat().st_size,
        "tools": {
            "aea": aea_cli,
            "aa": aa_cli,
            "openssl": openssl_cli,
        },
    }


def workflow_plist_bytes_for_import(input_bytes: bytes) -> tuple[bytes, dict | None]:
    if not is_signed_shortcut_bytes(input_bytes):
        return input_bytes, None
    with tempfile.TemporaryDirectory(prefix="shortpy-signed-import-") as tmp:
        tmpdir = Path(tmp)
        signed_path = tmpdir / "signed.shortcut"
        workflow_path = tmpdir / "Shortcut.wflow"
        signed_path.write_bytes(input_bytes)
        metadata = extract_signed_shortcut(signed_path, workflow_path)
        return workflow_path.read_bytes(), metadata


def text_icloud_shortcut_uuid(input_bytes: bytes) -> str | None:
    try:
        text = input_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    if not text:
        return None
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme != "https" or parsed.netloc.lower() != ICLOUD_SHORTCUTS_HOST:
        return None
    path = parsed.path.rstrip("/")
    if path.startswith(ICLOUD_SHORTCUTS_API_PREFIX):
        candidate = path[len(ICLOUD_SHORTCUTS_API_PREFIX):]
    elif path.startswith(ICLOUD_SHORTCUTS_LINK_PREFIX):
        candidate = path[len(ICLOUD_SHORTCUTS_LINK_PREFIX):]
    else:
        return None
    if "/" in candidate or not re.fullmatch(r"[A-Fa-f0-9-]{32,40}", candidate):
        raise RuntimeError(f"invalid iCloud shortcut identifier in URL: {text}")
    return candidate


def fetch_url_bytes(url: str, allow_http_error_body: bool = False) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, application/octet-stream, */*",
            "User-Agent": "Shortpy-IDE/0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=ICLOUD_FETCH_TIMEOUT) as response:
            final_url = response.geturl()
            return response.read(), final_url
    except urllib.error.HTTPError as exc:
        body = exc.read()
        if allow_http_error_body:
            return body, exc.url or url
        detail = body.decode("utf-8", errors="replace").strip()
        if len(detail) > 500:
            detail = f"{detail[:500]}..."
        raise RuntimeError(f"HTTP {exc.code} fetching {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"failed to fetch {url}: {exc.reason}") from exc


def workflow_plist_bytes_from_icloud_link(input_bytes: bytes) -> tuple[bytes, dict] | None:
    shortcut_uuid = text_icloud_shortcut_uuid(input_bytes)
    if shortcut_uuid is None:
        return None
    record_url = f"https://{ICLOUD_SHORTCUTS_HOST}{ICLOUD_SHORTCUTS_API_PREFIX}{shortcut_uuid}"
    record_data, final_record_url = fetch_url_bytes(record_url, allow_http_error_body=True)
    try:
        record = json.loads(record_data.decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"iCloud shortcut record response was not JSON: {exc}") from exc
    if not isinstance(record, dict):
        raise RuntimeError("iCloud shortcut record response was not an object")
    if record.get("error") is True:
        reason = record.get("reason") or "unknown error"
        raise RuntimeError(f"iCloud shortcut record error: {reason}")
    download_url = (((record.get("fields") or {}).get("shortcut") or {}).get("value") or {}).get("downloadURL")
    if not isinstance(download_url, str) or not download_url:
        raise RuntimeError("iCloud shortcut record did not contain fields.shortcut.value.downloadURL")
    parsed_download = urllib.parse.urlparse(download_url)
    if parsed_download.scheme != "https":
        raise RuntimeError("iCloud shortcut downloadURL was not HTTPS")
    plist_data, final_download_url = fetch_url_bytes(download_url)
    metadata = {
        "ok": True,
        "source": "iCloud shortcut link",
        "shortcut_id": shortcut_uuid,
        "record_url": record_url,
        "final_record_url": final_record_url,
        "download_url": download_url,
        "final_download_url": final_download_url,
        "workflow_plist_length": len(plist_data),
    }
    return plist_data, metadata


def workflow_import_source_bytes(input_bytes: bytes) -> tuple[bytes, dict | None, dict | None]:
    icloud_import = workflow_plist_bytes_from_icloud_link(input_bytes)
    if icloud_import is not None:
        plist_data, metadata = icloud_import
        plist_data, signed_metadata = workflow_plist_bytes_for_import(plist_data)
        if signed_metadata is not None:
            metadata["signed_shortcut_import"] = signed_metadata
        return plist_data, None, metadata
    plist_data, signed_metadata = workflow_plist_bytes_for_import(input_bytes)
    return plist_data, signed_metadata, None


def compile_python_record_file_probe(
    socket_path: str,
    source: bytes,
    flags: int,
    catalog_payload: object | None = None,
) -> dict:
    prepared = rewrite_inline_catalog_metadata(source)
    native_catalog_payload = native_catalog_json(catalog_payload) if catalog_payload is not None else None
    expand_response = None
    if prepared.get("entries"):
        expand_response = expand_inline_catalog(socket_path, prepared["entries"])
        native_catalog_payload = expand_response.get("catalog")

    payload = base64.b64encode(prepared["source"]).decode("ascii")
    if native_catalog_payload is not None:
        catalog_text = json.dumps(native_catalog_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        catalog_b64 = base64.b64encode(catalog_text).decode("ascii")
        raw = send_command(socket_path, f"record-file-probe-catalog-b64-flags {flags} {payload} {catalog_b64}")
    else:
        raw = send_command(socket_path, f"record-file-probe-b64-flags {flags} {payload}")
    return attach_inline_catalog_summary(json.loads(raw), prepared, expand_response)


def python_literal(value: object) -> str:
    if isinstance(value, dict):
        return "{" + ", ".join(
            f"{json.dumps(str(key))}: {python_literal(item)}"
            for key, item in value.items()
        ) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(python_literal(item) for item in value) + "]"
    if isinstance(value, tuple):
        return "(" + ", ".join(python_literal(item) for item in value) + ("," if len(value) == 1 else "") + ")"
    if isinstance(value, str):
        return json.dumps(value)
    if value is True:
        return "True"
    if value is False:
        return "False"
    if value is None:
        return "None"
    return repr(value)


def decoded_catalog_metadata_from_latest_import(socket_path: str) -> tuple[dict[str, object], dict]:
    response = json.loads(send_command(socket_path, "catalog-encode-latest-debug"))
    catalog = native_catalog_json(response) or {}
    metadata_by_tag: dict[str, object] = {}
    for tag, entry in catalog.items():
        if not isinstance(entry, dict):
            continue
        if "parameterStateObject" in entry:
            metadata_by_tag[tag] = entry["parameterStateObject"]
            continue
        model = entry.get("modelDescription")
        if not isinstance(model, str):
            continue
        try:
            metadata_by_tag[tag] = json.loads(model)
        except json.JSONDecodeError:
            continue
    return metadata_by_tag, response


def replace_refs_with_inline_metadata(source: str, metadata_by_tag: dict[str, object]) -> tuple[str, list[dict]]:
    replacements: list[dict] = []

    def repl(match: re.Match) -> str:
        tag = match.group(1).upper().replace("X", "x", 1)
        metadata = metadata_by_tag.get(tag)
        if metadata is None:
            return match.group(0)
        literal = python_literal(metadata)
        replacements.append({"tag": tag, "replacement": literal})
        return literal

    return re.sub(r"ref\((0x[0-9a-fA-F]+)\)", repl, source), replacements


def inline_catalog_import_response(socket_path: str, response: dict) -> dict:
    source = response.get("python_code")
    if not isinstance(source, str) or "ref(0x" not in source:
        return response
    metadata_by_tag, catalog_response = decoded_catalog_metadata_from_latest_import(socket_path)
    rewritten, replacements = replace_refs_with_inline_metadata(source, metadata_by_tag)
    if replacements:
        response["raw_python_code"] = source
        response["python_code"] = rewritten
        response["python_length"] = len(rewritten.encode("utf-8"))
        response["inline_catalog_metadata"] = {
            "present": True,
            "source": "WFPythonWorkflowProxy.encode(catalog:) parameterStateObject",
            "replacement_count": len(replacements),
            "replacements": replacements,
            "unresolved_refs": [
                tag for tag in refs_in_source(rewritten.encode("utf-8")) if tag not in metadata_by_tag
            ],
        }
    else:
        response["inline_catalog_metadata"] = {
            "present": bool(metadata_by_tag),
            "source": "WFPythonWorkflowProxy.encode(catalog:) parameterStateObject",
            "replacement_count": 0,
            "unresolved_refs": refs_in_source(source.encode("utf-8")),
            "catalog_encode_ok": bool(catalog_response.get("ok")),
            "catalog_diagnostic": catalog_response.get("diagnostic"),
        }
    return response


def transpiler_feedback(socket_path: str, source: bytes, flags: int, catalog_metadata: Path | None) -> dict:
    catalog_payload = None
    catalog_entries: list[dict] = []
    if catalog_metadata is not None:
        catalog_payload = json.loads(catalog_metadata.read_text())
        catalog_entries = normalize_catalog_metadata(catalog_payload)
    response = compile_python_to_bplist(socket_path, source, flags, catalog_payload)
    valid = bool(response.get("ok"))
    refs = refs_in_source(source)
    catalog_tags = {entry["tag"] for entry in catalog_entries}
    missing_metadata_tags = [tag for tag in refs if tag not in catalog_tags]
    compiler_feedback = response.get("diagnostic") or response.get("error") or json.dumps(response, sort_keys=True)
    native_injection_pending = bool(catalog_entries and refs and not valid and "noSuchCatalogEntry" in compiler_feedback)
    return {
        "ok": True,
        "mode": "get_transpiler_feedback",
        "agent_tool": "get_transpiler_feedback",
        "valid": valid,
        "feedback": "No transpiler errors." if valid else compiler_feedback,
        "catalog_metadata_input": {
            "present": catalog_metadata is not None,
            "status": (
                "parsed; native catalog JSON is decoded by WFPythonWorkflowProxy.decodeCatalog(from:) when available"
                if catalog_metadata is not None
                else "not supplied"
            ),
            "entry_count": len(catalog_entries),
            "entries": catalog_entries,
            "native_catalog_json_present": native_catalog_json(catalog_payload) is not None if catalog_payload is not None else False,
            "source_refs": refs,
            "missing_metadata_tags": missing_metadata_tags,
            "native_injection_pending": native_injection_pending,
            "inline_catalog_metadata": response.get("inline_catalog_metadata"),
        },
        "compiler_response": response,
    }


def resolve_entity_native(
    socket_path: str,
    method_parameter_type: str,
    query: str,
    method_name: str,
    method_parameter_name: str,
    workflow_id: str | None,
    debug_native_find_entities: bool = False,
) -> dict:
    request = {
        "method_name": method_name,
        "method_parameter_name": method_parameter_name,
        "method_parameter_type": method_parameter_type,
        "query": query,
        "debug_native_find_entities": debug_native_find_entities,
    }
    if workflow_id:
        request["workflow_id"] = workflow_id
    payload = base64.b64encode(
        json.dumps(request, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    raw = send_command(socket_path, f"resolve-entity-b64 {payload}")
    return json.loads(raw)


def add_source_args(parser: argparse.ArgumentParser) -> argparse._MutuallyExclusiveGroup:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", type=Path)
    group.add_argument("--text")
    return group


def read_source(args: argparse.Namespace) -> bytes:
    if args.file:
        return args.file.read_bytes()
    return args.text.encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Control the injected Shortcuts IDE bridge."
    )
    parser.add_argument(
        "--socket",
        default="auto",
        help=f"UNIX socket path, or auto [{DEFAULT_SOCKET} plus Shortcuts container tmp]",
    )
    parser.add_argument(
        "--raw", action="store_true", help="Print bridge JSON response on one line"
    )
    parser.add_argument(
        "--pipeline",
        choices=["shortpy", "native"],
        default=os.environ.get("SHORTPY_RUNTIME_PIPELINE", "shortpy"),
        help="Runtime conversion pipeline [shortpy]",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("last")
    sub.add_parser("clear")
    set_source = sub.add_parser("set-source")
    add_source_args(set_source)
    python_to_plist = sub.add_parser(
        "python-to-plist",
        help="Compile Python through ShortcutsLanguage and return the WFWorkflowFile plist dictionary",
    )
    add_source_args(python_to_plist)
    python_to_plist.add_argument(
        "--flags",
        type=int,
        default=0,
        help="Bridge transport flags passed to the selected runtime pipeline [0]",
    )
    python_to_bplist = sub.add_parser(
        "python-to-bplist",
        help="Compile Python through ShortcutsLanguage and return unsigned plist plus signed .shortcut payloads",
    )
    add_source_args(python_to_bplist)
    python_to_bplist.add_argument(
        "--flags",
        type=int,
        default=0,
        help="Bridge transport flags passed to the selected runtime pipeline [0]",
    )
    python_to_bplist.add_argument(
        "--sign",
        dest="sign_shortcut",
        action="store_true",
        default=True,
        help="Sign the compiled workflow with macOS shortcuts sign [default]",
    )
    python_to_bplist.add_argument(
        "--no-sign",
        dest="sign_shortcut",
        action="store_false",
        help="Return only the unsigned workflow plist payload",
    )
    python_to_bplist.add_argument(
        "--sign-mode",
        choices=["anyone", "people-who-know-me"],
        default="anyone",
        help="macOS shortcuts sign mode [anyone]",
    )
    python_to_bplist.add_argument(
        "--shortcuts-cli",
        default=os.environ.get("SHORTPY_SHORTCUTS_CLI", DEFAULT_SHORTCUTS_CLI),
        help=f"Path to macOS shortcuts CLI [{DEFAULT_SHORTCUTS_CLI}]",
    )
    record_file_probe = sub.add_parser(
        "record-file-probe",
        help="Debug probe: compile Python, then serialize via WFWorkflowRecord.fileRepresentation",
    )
    add_source_args(record_file_probe)
    record_file_probe.add_argument(
        "--flags",
        type=int,
        default=0,
        help="Bridge transport flags passed to record-file-probe-b64-flags [0]",
    )
    plist_to_python = sub.add_parser(
        "plist-to-python",
        help="Convert a shortcut plist JSON dictionary back to edit-mode Python",
    )
    add_source_args(plist_to_python)
    plist_data_to_python = sub.add_parser(
        "plist-data-to-python",
        help="Convert binary or XML plist bytes back to edit-mode Python",
    )
    add_source_args(plist_data_to_python)
    agent_toolbox_query = sub.add_parser(
        "agent-toolbox-query",
        help="Query ShortcutsAgent.AgentToolbox and return Result.stringRepresentation",
    )
    agent_toolbox_query.add_argument("query")
    agent_toolbox_query.add_argument(
        "--kind",
        choices=["trigger", "tool"],
        default="trigger",
        help="AgentToolbox embedding type to limit [trigger]",
    )
    agent_toolbox_query.add_argument(
        "--limit",
        type=int,
        default=3,
        help="Maximum render count for the selected kind [3]",
    )
    agent_toolbox_query.add_argument(
        "--mainactor",
        action="store_true",
        help="With --native, run the experimental native query from a MainActor task",
    )
    agent_toolbox_query.add_argument(
        "--native",
        action="store_true",
        help="Use the unsafe private AgentToolbox.query endpoint instead of stable ToolRenderer search",
    )
    agent_toolbox_query.add_argument(
        "--refresh-interface",
        action="store_true",
        help="Refresh ToolRenderer.pythonInterface through the live bridge before searching; cached metadata is used by default",
    )
    retrieve_actions = sub.add_parser(
        "retrieve-relevant-actions",
        help="Agent-compatible action retrieval over native ToolRenderer Python definitions",
    )
    retrieve_actions.add_argument("query")
    retrieve_actions.add_argument("--limit", type=int, default=10)
    retrieve_actions.add_argument("--refresh-interface", action="store_true")
    retrieve_triggers = sub.add_parser(
        "retrieve-relevant-triggers",
        help="Agent-compatible trigger retrieval over native ToolRenderer decorator definitions",
    )
    retrieve_triggers.add_argument("query")
    retrieve_triggers.add_argument("--limit", type=int, default=10)
    retrieve_triggers.add_argument("--refresh-interface", action="store_true")
    transpiler = sub.add_parser(
        "get-transpiler-feedback",
        help="Agent-compatible wrapper around ShortpyToShortcut validation",
    )
    add_source_args(transpiler)
    transpiler.add_argument("--flags", type=int, default=0)
    transpiler.add_argument("--catalog-metadata", type=Path)
    resolve_entity = sub.add_parser(
        "resolve-entity",
        help="Resolve an entity ref through ShortcutsAgent.FindEntitiesTool",
    )
    resolve_entity.add_argument("method_parameter_type")
    resolve_entity.add_argument("query")
    resolve_entity.add_argument("--method-name", default="")
    resolve_entity.add_argument("--method-parameter-name", default="")
    resolve_entity.add_argument("--workflow-id")
    resolve_entity.add_argument(
        "--native-find-entities",
        action="store_true",
        help="Debug only: call ShortcutsAgent.FindEntitiesTool.call directly; this path can crash while ABI work is in progress",
    )
    sub.add_parser(
        "agent-toolbox-init-dump",
        help="Dump raw AgentToolbox.init storage words without running query",
    )
    sub.add_parser(
        "toolrenderer-python-interface",
        help="Render the full ToolRenderer Python interface",
    )
    structured = sub.add_parser(
        "toolrenderer-structured-metadata",
        help="Render ToolRenderer-only visible metadata for IDE hovers, completions, signatures, and diagnostics",
    )
    structured.add_argument(
        "--cached",
        action="store_true",
        help="Use cached ToolRenderer metadata/interface instead of refreshing through the live bridge",
    )
    sub.add_parser(
        "catalog-dump-latest",
        help="Dump the latest imported WFParameterStateCatalog using WorkflowKit encoders",
    )
    sub.add_parser(
        "catalog-encode-latest-debug",
        help="Debug only: call WFPythonWorkflowProxy.encode(catalog:) for the latest imported catalog",
    )
    args = parser.parse_args()

    if args.command in {"status", "last", "clear"}:
        raw = send_command(args.socket, args.command)
        print_response(raw, not args.raw)
        return 0

    if args.command == "set-source":
        source = read_source(args)
        payload = base64.b64encode(source).decode("ascii")
        raw = send_command(args.socket, f"set-source-b64 {payload}")
        print_response(raw, not args.raw)
        return 0

    if args.command == "python-to-plist":
        response = compile_python_to_bplist(
            args.socket,
            read_source(args),
            args.flags,
            pipeline=args.pipeline,
        )
        payload = response.get("plist_payload", {}).get("data")
        if response.get("ok") and isinstance(payload, str):
            response["mode"] = "python-to-workflow-plist"
            response["plist"] = plistlib.loads(base64.b64decode(payload))
        print_response(json.dumps(response), not args.raw)
        return 0

    if args.command == "python-to-bplist":
        try:
            response = compile_python_to_bplist(
                args.socket,
                read_source(args),
                args.flags,
                pipeline=args.pipeline,
            )
            if args.sign_shortcut:
                response = sign_shortcut_response(response, args.sign_mode, args.shortcuts_cli)
        except InlineCatalogError as exc:
            response = {
                "ok": False,
                "mode": "python-to-workflow-file-data",
                "diagnostic": str(exc),
                "inline_catalog_diagnostics": exc.diagnostics,
            }
        except ShortcutSigningError as exc:
            response = {
                "ok": False,
                "mode": "python-to-workflow-file-data",
                "diagnostic": str(exc),
                "shortcut_signing": {
                    "ok": False,
                    **exc.details,
                },
            }
        print_response(json.dumps(response, sort_keys=True), not args.raw)
        return 0

    if args.command == "record-file-probe":
        try:
            response = compile_python_record_file_probe(args.socket, read_source(args), args.flags)
        except InlineCatalogError as exc:
            response = {
                "ok": False,
                "mode": "workflow-record-file-representation-probe",
                "diagnostic": str(exc),
                "inline_catalog_diagnostics": exc.diagnostics,
            }
        print_response(json.dumps(response, sort_keys=True), not args.raw)
        return 0

    if args.command == "plist-to-python":
        plist_json = read_source(args)
        payload = base64.b64encode(plist_json).decode("ascii")
        pipeline_raw = {"native": 0, "shortpy": 1}[args.pipeline]
        response = json.loads(send_command(
            args.socket,
            f"pipeline-plist-to-python-b64 {pipeline_raw} {payload}",
        ))
        response = inline_catalog_import_response(args.socket, response)
        print_response(json.dumps(response, sort_keys=True), not args.raw)
        return 0

    if args.command == "plist-data-to-python":
        try:
            plist_data, signed_import, icloud_import = workflow_import_source_bytes(read_source(args))
            payload = base64.b64encode(plist_data).decode("ascii")
            pipeline_raw = {"native": 0, "shortpy": 1}[args.pipeline]
            response = json.loads(send_command(
                args.socket,
                f"pipeline-plist-data-to-python-b64 {pipeline_raw} {payload}",
            ))
            response = inline_catalog_import_response(args.socket, response)
            if signed_import is not None:
                response["signed_shortcut_import"] = signed_import
            if icloud_import is not None:
                response["icloud_shortcut_import"] = icloud_import
        except Exception as exc:
            response = {
                "ok": False,
                "mode": "plist-data-to-python",
                "diagnostic": str(exc),
            }
        print_response(json.dumps(response, sort_keys=True), not args.raw)
        return 0

    if args.command == "agent-toolbox-query":
        if not args.native:
            payload = safe_toolrenderer_search(
                args.socket,
                args.query,
                args.kind,
                max(1, args.limit),
                refresh=args.refresh_interface,
            )
            print_response(json.dumps(payload, sort_keys=True), not args.raw)
            return 0
        payload = base64.b64encode(args.query.encode("utf-8")).decode("ascii")
        command = (
            "agent-toolbox-query-mainactor-b64"
            if args.mainactor
            else "agent-toolbox-query-b64"
        )
        raw = send_command(
            args.socket,
            f"{command} {args.kind} {max(1, args.limit)} {payload}",
        )
        print_response(raw, not args.raw)
        return 0

    if args.command == "retrieve-relevant-actions":
        payload = safe_toolrenderer_search(
            args.socket,
            args.query,
            "tool",
            max(1, args.limit),
            refresh=args.refresh_interface,
        )
        payload["mode"] = "retrieve_relevant_actions"
        payload["agent_tool"] = "retrieve_relevant_actions"
        print_response(json.dumps(payload, sort_keys=True), not args.raw)
        return 0

    if args.command == "retrieve-relevant-triggers":
        payload = safe_toolrenderer_search(
            args.socket,
            args.query,
            "trigger",
            max(1, args.limit),
            refresh=args.refresh_interface,
        )
        payload["mode"] = "retrieve_relevant_triggers"
        payload["agent_tool"] = "retrieve_relevant_triggers"
        print_response(json.dumps(payload, sort_keys=True), not args.raw)
        return 0

    if args.command == "get-transpiler-feedback":
        try:
            payload = transpiler_feedback(
                args.socket,
                read_source(args),
                args.flags,
                args.catalog_metadata,
            )
        except InlineCatalogError as exc:
            payload = {
                "ok": True,
                "mode": "get_transpiler_feedback",
                "agent_tool": "get_transpiler_feedback",
                "valid": False,
                "feedback": str(exc),
                "inline_catalog_diagnostics": exc.diagnostics,
            }
        print_response(json.dumps(payload, sort_keys=True), not args.raw)
        return 0

    if args.command == "resolve-entity":
        payload = resolve_entity_native(
            args.socket,
            args.method_parameter_type,
            args.query,
            args.method_name,
            args.method_parameter_name,
            args.workflow_id,
            args.native_find_entities,
        )
        print_response(json.dumps(payload, sort_keys=True), not args.raw)
        return 0

    if args.command == "agent-toolbox-init-dump":
        raw = send_command(args.socket, "agent-toolbox-init-dump")
        print_response(raw, not args.raw)
        return 0

    if args.command == "toolrenderer-python-interface":
        raw = send_command(args.socket, "toolrenderer-python-interface")
        print_response(raw, not args.raw)
        return 0

    if args.command == "toolrenderer-structured-metadata":
        payload = toolrenderer_structured_metadata(args.socket, refresh=not args.cached)
        print_response(json.dumps(payload, sort_keys=True), not args.raw)
        return 0

    if args.command == "catalog-dump-latest":
        raw = send_command(args.socket, "catalog-dump-latest")
        print_response(raw, not args.raw)
        return 0

    if args.command == "catalog-encode-latest-debug":
        raw = send_command(args.socket, "catalog-encode-latest-debug")
        print_response(raw, not args.raw)
        return 0

    parser.error("unhandled command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
