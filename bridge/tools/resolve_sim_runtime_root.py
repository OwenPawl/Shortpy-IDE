#!/usr/bin/env python3

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys


REQUIRED_PRIVATE_FRAMEWORKS = [
    "ShortcutsLanguage.framework",
    "ShortcutsAgent.framework",
    "ToolRenderer.framework",
    "ToolKit.framework",
    "WorkflowKit.framework",
]


def version_tuple(value):
    return tuple(int(part) for part in re.findall(r"\d+", str(value or "")))


def xcode_build_tuple(value):
    text = str(value or "")
    parts = []
    for chunk in re.findall(r"\d+|[A-Za-z]+", text):
        if chunk.isdigit():
            parts.append((1, int(chunk)))
        else:
            parts.append((0, chunk.lower()))
    return tuple(parts)


def plist_value(path, key):
    try:
        raw = subprocess.check_output(
            ["/usr/libexec/PlistBuddy", "-c", f"Print :{key}", str(path)],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return ""
    return raw.strip()


def xcrun_env(developer_dir):
    env = os.environ.copy()
    if developer_dir:
        env["DEVELOPER_DIR"] = developer_dir
    return env


def xcrun_has_simctl(developer_dir):
    try:
        subprocess.check_output(
            ["xcrun", "--find", "simctl"],
            text=True,
            stderr=subprocess.DEVNULL,
            env=xcrun_env(developer_dir),
        )
        return True
    except Exception:
        return False


def candidate_developer_dirs():
    seen = set()

    def add(path):
        if not path:
            return
        expanded = os.path.abspath(os.path.expanduser(path))
        if expanded in seen:
            return
        seen.add(expanded)
        yield expanded

    for explicit in (os.environ.get("XCODE_DEVELOPER_DIR"), os.environ.get("DEVELOPER_DIR")):
        yield from add(explicit)

    try:
        selected = subprocess.check_output(
            ["/usr/bin/xcode-select", "-p"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        yield from add(selected)
    except Exception:
        pass

    apps = []
    for root in ("/Applications", str(pathlib.Path.home() / "Downloads")):
        for app in pathlib.Path(root).glob("Xcode*.app"):
            developer = app / "Contents" / "Developer"
            simctl = developer / "usr" / "bin" / "simctl"
            if not simctl.exists():
                continue
            info = app / "Contents" / "Info.plist"
            build = plist_value(info, "DTXcodeBuild") if info.exists() else ""
            version = plist_value(info, "CFBundleShortVersionString") if info.exists() else ""
            apps.append((xcode_build_tuple(build), version, str(developer)))
    for _, _, developer in sorted(apps, reverse=True):
        yield from add(developer)


def resolve_developer_dir():
    for developer in candidate_developer_dirs():
        if xcrun_has_simctl(developer):
            return developer
    if xcrun_has_simctl(None):
        return ""
    raise SystemExit(
        "Could not find an Xcode Developer directory with simctl. Install Xcode or set XCODE_DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer."
    )


def load_runtimes():
    developer_dir = resolve_developer_dir()
    try:
        raw = subprocess.check_output(
            ["xcrun", "simctl", "list", "runtimes", "-j"],
            text=True,
            stderr=subprocess.PIPE,
            env=xcrun_env(developer_dir),
        )
    except FileNotFoundError as error:
        raise SystemExit("Missing xcrun. Install Xcode or Xcode Command Line Tools.") from error
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() if error.stderr else str(error)
        raise SystemExit(f"Could not list simulator runtimes: {detail}") from error
    return developer_dir, json.loads(raw).get("runtimes", [])


def is_ios_runtime(runtime):
    identifier = runtime.get("identifier") or ""
    name = runtime.get("name") or ""
    return ".iOS-" in identifier or name.startswith("iOS ")


def missing_required_frameworks(runtime_root):
    private_frameworks = os.path.join(runtime_root, "System", "Library", "PrivateFrameworks")
    return [item for item in REQUIRED_PRIVATE_FRAMEWORKS if not os.path.exists(os.path.join(private_frameworks, item))]


def has_required_frameworks(runtime_root):
    return not missing_required_frameworks(runtime_root)


def runtime_record(runtime):
    root = runtime.get("runtimeRoot") or ""
    missing = missing_required_frameworks(root) if root else REQUIRED_PRIVATE_FRAMEWORKS[:]
    return {
        "identifier": runtime.get("identifier"),
        "name": runtime.get("name"),
        "version": runtime.get("version"),
        "buildversion": runtime.get("buildversion"),
        "runtimeRoot": root,
        "targetVersion": target_version(runtime),
        "isAvailable": runtime.get("isAvailable", True),
        "hasRequiredFrameworks": not missing,
        "missingRequiredFrameworks": missing,
    }


def choose_runtime(build=None):
    developer_dir, runtimes = load_runtimes()
    candidates = []
    for runtime in runtimes:
        if not runtime.get("isAvailable", True) or not is_ios_runtime(runtime):
            continue
        runtime_root = runtime.get("runtimeRoot") or ""
        if not runtime_root or not os.path.isdir(runtime_root):
            continue
        runtime_build = runtime.get("buildversion") or ""
        if build and runtime_build.lower() != build.lower():
            continue
        framework_score = 1 if has_required_frameworks(runtime_root) else 0
        version = version_tuple(runtime.get("version") or runtime.get("name"))
        if version[:2] == (27, 0):
            version_preference = 2
        elif version and version[0] == 27:
            version_preference = 1
        else:
            version_preference = 0
        build_score = xcode_build_tuple(runtime_build)
        candidates.append((framework_score, version_preference, version, build_score, runtime))
    if not candidates:
        available = sorted(
            {
                str(runtime.get("buildversion") or "")
                for runtime in runtimes
                if runtime.get("isAvailable", True) and is_ios_runtime(runtime)
            }
        )
        if build:
            raise SystemExit(
                f"No available iOS simulator runtime build {build} was found. Available iOS builds: {', '.join(available) or '(none)'}."
            )
        raise SystemExit("No available iOS simulator runtime was found. Install an iOS Simulator runtime, preferably iOS 27.0.")
    candidates.sort(key=lambda item: (item[0], item[1], item[2], item[3]), reverse=True)
    best = candidates[0][4]
    if not has_required_frameworks(best.get("runtimeRoot") or ""):
        missing = ", ".join(missing_required_frameworks(best.get("runtimeRoot") or ""))
        raise SystemExit(
            f"Found iOS runtime {best.get('name') or best.get('identifier')}, but it is missing required private frameworks: {missing}"
        )
    return developer_dir, best


def target_version(runtime):
    version = runtime.get("version") or ""
    match = re.match(r"^(\d+)(?:\.(\d+))?", version)
    if not match:
        return "27.0"
    return f"{match.group(1)}.{match.group(2) or '0'}"


def main():
    parser = argparse.ArgumentParser(description="Resolve the best iOS Simulator runtime for the Shortpy bridge build.")
    parser.add_argument("--build", default=os.environ.get("SIM_RUNTIME_BUILD"), help="Require an exact simulator runtime build, e.g. 24A5370g. Defaults to SIM_RUNTIME_BUILD.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--developer-dir", action="store_true", help="Print the selected Xcode Developer directory.")
    group.add_argument("--runtime-root", action="store_true", help="Print the selected runtime RuntimeRoot path.")
    group.add_argument("--version", action="store_true", help="Print the selected runtime version for a Swift target triple.")
    group.add_argument("--buildversion", action="store_true", help="Print the selected runtime build version.")
    group.add_argument("--json", action="store_true", help="Print selected runtime metadata as JSON.")
    group.add_argument("--all-json", action="store_true", help="Print all available iOS runtime candidates as JSON.")
    args = parser.parse_args()
    if args.developer_dir:
        print(resolve_developer_dir())
        return
    if args.all_json:
        developer_dir, runtimes = load_runtimes()
        print(json.dumps({
            "developerDir": developer_dir,
            "runtimes": [runtime_record(runtime) for runtime in runtimes if is_ios_runtime(runtime)],
        }, indent=2))
        return
    developer_dir, runtime = choose_runtime(args.build)
    if args.version:
        print(target_version(runtime))
    elif args.buildversion:
        print(runtime.get("buildversion") or "")
    elif args.json:
        record = runtime_record(runtime)
        record["developerDir"] = developer_dir
        print(json.dumps(record, indent=2))
    else:
        print(runtime.get("runtimeRoot") or "")


if __name__ == "__main__":
    main()
