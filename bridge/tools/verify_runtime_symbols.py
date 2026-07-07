#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys


MODULES = {
    "ShortcutsLanguage": {
        "framework": "ShortcutsLanguage",
        "prefixes": ["_$s17ShortcutsLanguage"],
    },
    "ShortcutsAgent": {
        "framework": "ShortcutsAgent",
        "prefixes": ["_$s14ShortcutsAgent"],
    },
    "ToolRenderer": {
        "framework": "ToolRenderer",
        "prefixes": ["_$s12ToolRenderer"],
    },
    "ToolKit": {
        "framework": "ToolKit",
        "prefixes": ["_$s7ToolKit"],
    },
    "WorkflowKit": {
        "framework": "WorkflowKit",
        "prefixes": ["_$s11WorkflowKit", "_$sSo21WFPythonWorkflowProxyC0B3KitE"],
    },
}

TOOLRENDERER_REQUIRED_FILTER = [
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pAA09ParameteriG0_pAA18CompatibilityShimsVtYaKF",
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pAA09ParameteriG0_pAA18CompatibilityShimsVtYaKFTu",
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pAA09ParameteriG0_pAA18CompatibilityShimsVtYaKFfA2_",
]

TOOLRENDERER_OPTIONAL_FILTER = [
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pSgAA09ParameteriG0_pAA18CompatibilityShimsVtYaKF",
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pSgAA09ParameteriG0_pAA18CompatibilityShimsVtYaKFTu",
    "_$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pSgAA09ParameteriG0_pAA18CompatibilityShimsVtYaKFfA2_",
]

ALTERNATIVE_SYMBOL_GROUPS = [
    {
        "name": "ToolRenderer.pythonInterface.filterProvider",
        "module": "ToolRenderer",
        "variants": {
            "required-filterProvider": TOOLRENDERER_REQUIRED_FILTER,
            "optional-filterProvider": TOOLRENDERER_OPTIONAL_FILTER,
        },
    }
]


def run_lines(command):
    try:
        raw = subprocess.check_output(command, text=True, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() if error.stderr else str(error)
        raise SystemExit(f"Command failed: {' '.join(command)}\n{detail}") from error
    return raw.splitlines()


def normalize_symbol(line):
    text = line.strip()
    if not text:
        return ""
    return text.split()[-1]


def dylib_undefined_symbols(path):
    return {normalize_symbol(line) for line in run_lines(["nm", "-u", path]) if normalize_symbol(line)}


def framework_symbols(runtime_root, framework_name):
    binary = os.path.join(
        runtime_root,
        "System",
        "Library",
        "PrivateFrameworks",
        f"{framework_name}.framework",
        framework_name,
    )
    if not os.path.exists(binary):
        raise SystemExit(f"Missing private framework binary: {binary}")
    return binary, {normalize_symbol(line) for line in run_lines(["nm", "-gU", binary]) if normalize_symbol(line)}


def owning_module(symbol):
    for module, spec in MODULES.items():
        if any(symbol.startswith(prefix) for prefix in spec["prefixes"]):
            return module
    return None


def main():
    parser = argparse.ArgumentParser(description="Verify Shortpy bridge private Swift symbols against a simulator RuntimeRoot.")
    parser.add_argument("--dylib", required=True, help="Bridge dylib to inspect.")
    parser.add_argument("--runtime-root", required=True, help="Simulator RuntimeRoot to verify against.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON only.")
    args = parser.parse_args()

    undefined = dylib_undefined_symbols(args.dylib)
    alternative_reports = []
    alternative_symbols = {
        symbol
        for group in ALTERNATIVE_SYMBOL_GROUPS
        for symbols in group["variants"].values()
        for symbol in symbols
    }
    by_module = {module: [] for module in MODULES}
    for symbol in sorted(undefined):
        if symbol in alternative_symbols:
            continue
        module = owning_module(symbol)
        if module:
            by_module[module].append(symbol)

    framework_cache = {}
    missing = {}
    checked = {}
    for module, symbols in by_module.items():
        if not symbols:
            checked[module] = 0
            continue
        framework = MODULES[module]["framework"]
        binary, exports = framework_symbols(args.runtime_root, framework)
        framework_cache[module] = binary
        absent = [symbol for symbol in symbols if symbol not in exports]
        checked[module] = len(symbols)
        if absent:
            missing[module] = absent

    for group in ALTERNATIVE_SYMBOL_GROUPS:
        module = group["module"]
        framework = MODULES[module]["framework"]
        binary, exports = framework_symbols(args.runtime_root, framework)
        framework_cache[module] = binary
        variants = {}
        ok = False
        selected = None
        for name, symbols in group["variants"].items():
            absent = [symbol for symbol in symbols if symbol not in exports]
            variants[name] = {
                "ok": not absent,
                "checked": len(symbols),
                "missing": absent,
            }
            if not absent and selected is None:
                ok = True
                selected = name
        alternative_reports.append({
            "name": group["name"],
            "ok": ok,
            "selected": selected,
            "variants": variants,
        })
        if not ok:
            missing[group["name"]] = {
                name: report["missing"] for name, report in variants.items()
            }

    report = {
        "ok": not missing,
        "dylib": os.path.abspath(args.dylib),
        "runtimeRoot": os.path.abspath(args.runtime_root),
        "frameworks": framework_cache,
        "checked": checked,
        "alternatives": alternative_reports,
        "missing": missing,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(json.dumps(report, indent=2))
        if missing:
            print("Missing private Swift symbols; the dylib is not portable to this runtime as built.", file=sys.stderr)
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
