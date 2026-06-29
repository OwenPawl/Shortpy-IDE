#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DEVICE = "booted"
HOST_TOOLKIT_ACTIVE = Path.home() / "Library/Shortcuts/ToolKit/Tools-active"


def run_json(command: list[str]) -> dict:
    proc = subprocess.run(command, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"{command[0]} failed")
    return json.loads(proc.stdout)


def booted_device_udid() -> str:
    data = run_json(["xcrun", "simctl", "list", "devices", "booted", "-j"])
    devices = data.get("devices", {})
    for runtime_devices in devices.values():
        for device in runtime_devices:
            if device.get("state") == "Booted" and device.get("udid"):
                return device["udid"]
    raise RuntimeError("no booted simulator device found")


def resolve_device(device: str) -> str:
    if device == "booted":
        return booted_device_udid()
    return device


def device_data_path(device: str) -> Path:
    udid = resolve_device(device)
    return Path.home() / "Library/Developer/CoreSimulator/Devices" / udid / "data"


def toolkit_dir(device: str) -> Path:
    return device_data_path(device) / "Library/Shortcuts/ToolKit"


def active_path(device: str) -> Path:
    return toolkit_dir(device) / "Tools-active"


def target_description(path: Path) -> dict:
    payload = {
        "path": str(path),
        "exists": path.exists(),
        "is_symlink": path.is_symlink(),
    }
    if path.is_symlink():
        payload["link_target"] = os.readlink(path)
        try:
            payload["resolved"] = str(path.resolve(strict=False))
        except OSError:
            pass
    if path.exists():
        try:
            stat = path.stat()
            payload["size"] = stat.st_size
            payload["mtime"] = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
        except OSError:
            pass
    return payload


def backup_active(active: Path) -> Path | None:
    if not active.exists() and not active.is_symlink():
        return None
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = active.with_name(f"Tools-active.backup-{suffix}")
    counter = 1
    while backup.exists() or backup.is_symlink():
        backup = active.with_name(f"Tools-active.backup-{suffix}-{counter}")
        counter += 1
    if active.is_symlink():
        os.symlink(os.readlink(active), backup)
    elif active.is_file():
        shutil.copy2(active, backup)
    else:
        raise RuntimeError(f"refusing to back up unsupported Tools-active type: {active}")
    return backup


def point_active(device: str, sqlite_path: Path, resolve_target: bool) -> dict:
    active = active_path(device)
    directory = active.parent
    directory.mkdir(parents=True, exist_ok=True)
    target = sqlite_path.expanduser()
    if resolve_target:
        target = target.resolve(strict=True)
    elif not target.exists():
        raise FileNotFoundError(target)
    backup = backup_active(active)
    if active.exists() or active.is_symlink():
        active.unlink()
    os.symlink(str(target), active)
    return {
        "ok": True,
        "action": "point",
        "device": resolve_device(device),
        "toolkit_dir": str(directory),
        "active": target_description(active),
        "target": target_description(target),
        "backup": target_description(backup) if backup else None,
        "restart_required": True,
    }


def restore_active(device: str, backup: Path | None) -> dict:
    active = active_path(device)
    if backup is None:
        backups = sorted(active.parent.glob("Tools-active.backup-*"), key=lambda p: p.name)
        if not backups:
            raise RuntimeError(f"no Tools-active.backup-* files found in {active.parent}")
        backup = backups[-1]
    if not backup.exists() and not backup.is_symlink():
        raise FileNotFoundError(backup)
    current_backup = backup_active(active)
    if active.exists() or active.is_symlink():
        active.unlink()
    if backup.is_symlink():
        os.symlink(os.readlink(backup), active)
    else:
        shutil.copy2(backup, active)
    return {
        "ok": True,
        "action": "restore",
        "device": resolve_device(device),
        "active": target_description(active),
        "restored_from": target_description(backup),
        "previous_active_backup": target_description(current_backup) if current_backup else None,
        "restart_required": True,
    }


def show(device: str) -> dict:
    active = active_path(device)
    return {
        "ok": True,
        "device": resolve_device(device),
        "toolkit_dir": str(active.parent),
        "active": target_description(active),
        "host_active": target_description(HOST_TOOLKIT_ACTIVE),
        "backups": [target_description(path) for path in sorted(active.parent.glob("Tools-active.backup-*"))[-10:]],
    }


def connect_readonly(sqlite_path: Path) -> sqlite3.Connection:
    resolved = sqlite_path.expanduser().resolve(strict=True)
    uri = f"file:{resolved}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def rows(conn: sqlite3.Connection, query: str, args: tuple = ()) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(query, args)]


def toolkit_metadata(sqlite_path: Path) -> dict:
    conn = connect_readonly(sqlite_path)
    try:
        action_rows = rows(
            conn,
            """
            SELECT
              t.rowId,
              t.id,
              t.pythonName,
              MIN(l.name) AS displayName,
              MIN(l.descriptionSummary) AS summary
            FROM Tools t
            LEFT JOIN ToolLocalizations l
              ON l.toolId = t.rowId AND l.locale = 'en'
            WHERE t.pythonName IS NOT NULL AND t.pythonName != ''
            GROUP BY t.rowId, t.id, t.pythonName
            ORDER BY t.pythonName
            """,
        )
        action_params = rows(
            conn,
            """
            SELECT
              t.pythonName,
              p.key,
              p.sortOrder,
              MIN(l.name) AS displayName,
              MIN(l.description) AS summary
            FROM Parameters p
            JOIN Tools t ON t.rowId = p.toolId
            LEFT JOIN ParameterLocalizations l
              ON l.toolId = p.toolId AND l.key = p.key AND l.locale = 'en'
            WHERE t.pythonName IS NOT NULL AND t.pythonName != ''
            GROUP BY t.pythonName, p.key, p.sortOrder
            ORDER BY t.pythonName, p.sortOrder, p.key
            """,
        )
        trigger_rows = rows(
            conn,
            """
            SELECT
              tr.rowId,
              tr.id,
              tr.pythonName,
              MIN(l.name) AS displayName,
              MIN(l.descriptionSummary) AS summary
            FROM Triggers tr
            LEFT JOIN TriggerLocalizations l
              ON l.triggerId = tr.rowId AND l.locale = 'en'
            WHERE tr.pythonName IS NOT NULL AND tr.pythonName != ''
            GROUP BY tr.rowId, tr.id, tr.pythonName
            ORDER BY tr.pythonName
            """,
        )
        trigger_params = rows(
            conn,
            """
            SELECT
              tr.pythonName,
              p.key,
              p.sortOrder,
              MIN(l.name) AS displayName,
              MIN(l.description) AS summary
            FROM TriggerParameters p
            JOIN Triggers tr ON tr.rowId = p.triggerId
            LEFT JOIN TriggerParameterLocalizations l
              ON l.triggerId = p.triggerId AND l.key = p.key AND l.locale = 'en'
            WHERE tr.pythonName IS NOT NULL AND tr.pythonName != ''
            GROUP BY tr.pythonName, p.key, p.sortOrder
            ORDER BY tr.pythonName, p.sortOrder, p.key
            """,
        )
        type_rows = rows(
            conn,
            """
            SELECT rowId, pythonName
            FROM Types
            WHERE pythonName IS NOT NULL AND pythonName != ''
            ORDER BY pythonName
            """,
        )
    finally:
        conn.close()

    def python_identifier(value: str | None, fallback: str) -> str:
        import re

        source = value or fallback
        source = re.sub(r"[^0-9A-Za-z]+", "_", source).strip("_").lower()
        if not source:
            source = fallback.lower()
        if source and source[0].isdigit():
            source = f"_{source}"
        return source

    def attach_parameters(items: list[dict], params: list[dict]) -> list[dict]:
        by_name: dict[str, list[dict]] = {}
        for param in params:
            display_name = param.get("displayName")
            key = param["key"]
            by_name.setdefault(param["pythonName"], []).append({
                "key": key,
                "pythonName": python_identifier(display_name, key),
                "displayName": display_name,
                "summary": param.get("summary"),
                "sortOrder": param.get("sortOrder"),
            })
        output = []
        for item in items:
            clean = {
                "id": item["id"],
                "pythonName": item["pythonName"],
                "displayName": item.get("displayName"),
                "summary": item.get("summary"),
                "parameters": by_name.get(item["pythonName"], []),
            }
            output.append(clean)
        return output

    actions = attach_parameters(action_rows, action_params)
    triggers = attach_parameters(trigger_rows, trigger_params)
    types = [
        {
            "id": item["rowId"],
            "pythonName": item["pythonName"],
        }
        for item in type_rows
    ]
    return {
        "schema": "shortcuts-toolkit-metadata.v1",
        "source": str(sqlite_path.expanduser().resolve(strict=True)),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "actions": len(actions),
            "triggers": len(triggers),
            "types": len(types),
        },
        "actions": actions,
        "triggers": triggers,
        "types": types,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage simulator Shortcuts ToolKit sqlite pointers and metadata.")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="Simulator UDID, or booted [default].")
    parser.add_argument("--quiet", action="store_true", help="Print a compact response when a command also writes an output file.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("show")

    point = sub.add_parser("point", help="Point simulator Library/Shortcuts/ToolKit/Tools-active at a sqlite file.")
    point.add_argument("sqlite", type=Path)
    point.add_argument("--no-resolve", action="store_true", help="Keep the provided target path instead of resolving symlinks.")

    point_host = sub.add_parser("point-host", help="Point simulator Tools-active at the host mac Tools-active target.")
    point_host.add_argument("--no-resolve", action="store_true", help="Keep the host Tools-active symlink path instead of resolving it.")

    restore = sub.add_parser("restore", help="Restore simulator Tools-active from the latest or specified backup.")
    restore.add_argument("--backup", type=Path)

    metadata = sub.add_parser("metadata", help="Extract Python names and parameter keys from a ToolKit sqlite.")
    metadata.add_argument("--sqlite", type=Path, help="SQLite path. Defaults to simulator Tools-active.")
    metadata.add_argument("--out", type=Path, help="Write JSON metadata to this path.")

    args = parser.parse_args()
    try:
        if args.command == "show":
            payload = show(args.device)
        elif args.command == "point":
            payload = point_active(args.device, args.sqlite, not args.no_resolve)
        elif args.command == "point-host":
            payload = point_active(args.device, HOST_TOOLKIT_ACTIVE, not args.no_resolve)
        elif args.command == "restore":
            payload = restore_active(args.device, args.backup)
        elif args.command == "metadata":
            sqlite_path = args.sqlite or active_path(args.device)
            payload = toolkit_metadata(sqlite_path)
            if args.out:
                args.out.parent.mkdir(parents=True, exist_ok=True)
                args.out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
                if args.quiet:
                    payload = {
                        "ok": True,
                        "action": "metadata",
                        "out": str(args.out),
                        "source": payload["source"],
                        "counts": payload["counts"],
                    }
        else:
            parser.error("unhandled command")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "error_type": type(exc).__name__}), file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
