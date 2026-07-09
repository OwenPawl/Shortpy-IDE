#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DEVICE = "booted"
HOST_TOOLKIT_ACTIVE = Path.home() / "Library/Shortcuts/ToolKit/Tools-active"
ADJUSTABLE_PYTHON_NAME_TABLES = ("Tools", "Triggers")
TOOL_VISIBILITY_VISIBLE_FOR_SHORTCUTS = 0x1
TOOL_VISIBILITY_APPROVED = 0x4
REQUIRED_TOOLRENDERER_VISIBILITY_FLAGS = (
    TOOL_VISIBILITY_VISIBLE_FOR_SHORTCUTS | TOOL_VISIBILITY_APPROVED
)


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


def canonical_python_name(identifier: str, fallback: str) -> str:
    source = str(identifier or fallback or "").strip()
    name = re.sub(r"[^0-9A-Za-z_]+", "_", source).strip("_")
    if not name:
        name = re.sub(r"[^0-9A-Za-z_]+", "_", str(fallback or "item")).strip("_") or "item"
    if name[0].isdigit():
        name = f"_{name}"
    return name


def identifier_text(value: object) -> str:
    if isinstance(value, bytes):
        try:
            decoded = value.decode("utf-8")
            if decoded:
                return decoded
        except UnicodeDecodeError:
            pass
        return value.hex()
    if value is None:
        return ""
    return str(value)


def unique_python_name(base: str, used: set[str], row_id: object) -> str:
    candidate = base
    if not candidate:
        candidate = canonical_python_name("", str(row_id))
    if candidate not in used:
        used.add(candidate)
        return candidate
    suffix_base = canonical_python_name(str(row_id), "row")
    candidate = f"{base}_{suffix_base}"
    if candidate not in used:
        used.add(candidate)
        return candidate
    counter = 2
    while f"{candidate}_{counter}" in used:
        counter += 1
    final = f"{candidate}_{counter}"
    used.add(final)
    return final


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    except sqlite3.DatabaseError:
        return set()


def adjustable_table(conn: sqlite3.Connection, table: str) -> bool:
    return {"rowId", "id", "pythonName"}.issubset(table_columns(conn, table))


def duplicate_python_name_rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    query = f"""
        SELECT rowId, id, pythonName
        FROM {table}
        WHERE pythonName IN (
            SELECT pythonName
            FROM {table}
            WHERE pythonName IS NOT NULL AND pythonName != ''
            GROUP BY pythonName
            HAVING COUNT(*) > 1
        )
        ORDER BY pythonName, id, rowId
    """
    return [dict(row) for row in conn.execute(query)]


def attach_sqlite(conn: sqlite3.Connection, alias: str, sqlite_path: Path) -> None:
    conn.execute(f"ATTACH DATABASE ? AS {alias}", (str(sqlite_path.expanduser().resolve(strict=True)),))


def overlay_python_names(conn: sqlite3.Connection, source_sqlite: Path) -> dict:
    report = {
        "source": str(source_sqlite.expanduser().resolve(strict=True)),
        "tables": {},
        "change_count": 0,
    }
    attach_sqlite(conn, "source_toolkit", source_sqlite)
    for table in ADJUSTABLE_PYTHON_NAME_TABLES:
        if not adjustable_table(conn, table):
            continue
        source_columns = {
            row[1]
            for row in conn.execute(f"PRAGMA source_toolkit.table_info({table})")
        }
        if not {"id", "pythonName"}.issubset(source_columns):
            continue
        conn.row_factory = sqlite3.Row
        candidates = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT main.rowId AS rowId, main.id AS id, main.pythonName AS oldPythonName, source.pythonName AS newPythonName
                FROM {table} main
                JOIN source_toolkit.{table} source ON source.id = main.id
                WHERE source.pythonName IS NOT NULL AND source.pythonName != ''
                  AND (main.pythonName IS NULL OR main.pythonName != source.pythonName)
                ORDER BY main.rowId
                """
            )
        ]
        changes = []
        for row in candidates:
            conn.execute(
                f"UPDATE {table} SET pythonName = ? WHERE rowId = ?",
                (row["newPythonName"], row["rowId"]),
            )
            changes.append({
                "rowId": row["rowId"],
                "id": identifier_text(row["id"]),
                "oldPythonName": row["oldPythonName"],
                "newPythonName": row["newPythonName"],
            })
        report["tables"][table] = {
            "changed_count": len(changes),
            "changes": changes,
        }
        report["change_count"] += len(changes)
    return report


def adjust_duplicate_python_names(conn: sqlite3.Connection) -> dict:
    report = {
        "tables": {},
        "change_count": 0,
        "source_of_truth_change_count": 0,
    }
    for table in ADJUSTABLE_PYTHON_NAME_TABLES:
        if not adjustable_table(conn, table):
            continue
        conn.row_factory = sqlite3.Row
        used = {
            row[0]
            for row in conn.execute(f"SELECT pythonName FROM {table} WHERE pythonName IS NOT NULL AND pythonName != ''")
        }
        duplicate_rows = duplicate_python_name_rows(conn, table)
        duplicate_ids = {row["rowId"] for row in duplicate_rows}
        for row in duplicate_rows:
            used.discard(row["pythonName"])
        changes = []
        for row in duplicate_rows:
            old_name = row["pythonName"]
            identifier = identifier_text(row["id"])
            new_name = unique_python_name(canonical_python_name(identifier, old_name), used, row["rowId"])
            if new_name != old_name:
                conn.execute(
                    f"UPDATE {table} SET pythonName = ? WHERE rowId = ?",
                    (new_name, row["rowId"]),
                )
                changes.append({
                    "rowId": row["rowId"],
                    "id": identifier,
                    "oldPythonName": old_name,
                    "newPythonName": new_name,
                })
            row["finalPythonName"] = new_name
        source_of_truth = apply_duplicate_python_name_source_of_truth(conn, table, duplicate_rows)
        report["tables"][table] = {
            "duplicate_row_count": len(duplicate_rows),
            "changed_count": len(changes),
            "duplicate_row_ids": sorted(duplicate_ids),
            "changes": changes,
            "source_of_truth": source_of_truth,
        }
        report["change_count"] += len(changes)
        report["source_of_truth_change_count"] += source_of_truth.get("changed_count", 0)
    return report


def update_duplicate_localization_names(
    conn: sqlite3.Connection,
    table: str,
    localization_table: str,
    foreign_key: str,
    duplicate_rows: list[dict],
) -> dict:
    if not sqlite_table_exists(conn, localization_table):
        return {
            "table": localization_table,
            "changed_count": 0,
            "changes": [],
            "skipped": True,
            "reason": f"{localization_table} table not found",
        }
    changes = []
    conn.row_factory = sqlite3.Row
    localization_columns = table_columns(conn, localization_table)
    has_localization_usage = "localizationUsage" in localization_columns
    selected_columns = f"{foreign_key}, locale, name"
    order_columns = "locale"
    if has_localization_usage:
        selected_columns = f"{foreign_key}, locale, localizationUsage, name"
        order_columns = "locale, localizationUsage"
    for row in duplicate_rows:
        final_name = row.get("finalPythonName") or row.get("pythonName")
        if not final_name:
            continue
        localization_rows = [
            dict(localized)
            for localized in conn.execute(
                f"""
                SELECT {selected_columns}
                FROM {localization_table}
                WHERE {foreign_key} = ? AND name != ?
                ORDER BY {order_columns}
                """,
                (row["rowId"], final_name),
            )
        ]
        for localized in localization_rows:
            if has_localization_usage:
                conn.execute(
                    f"""
                    UPDATE {localization_table}
                    SET name = ?
                    WHERE {foreign_key} = ? AND locale = ? AND localizationUsage = ?
                    """,
                    (final_name, row["rowId"], localized["locale"], localized["localizationUsage"]),
                )
            else:
                conn.execute(
                    f"""
                    UPDATE {localization_table}
                    SET name = ?
                    WHERE {foreign_key} = ? AND locale = ?
                    """,
                    (final_name, row["rowId"], localized["locale"]),
                )
            changes.append({
                "rowId": row["rowId"],
                "id": identifier_text(row["id"]),
                "table": table,
                "localizationTable": localization_table,
                "locale": localized["locale"],
                "localizationUsage": localized.get("localizationUsage"),
                "oldName": localized["name"],
                "newName": final_name,
            })
    return {
        "table": localization_table,
        "changed_count": len(changes),
        "changes": changes,
    }


def neutralize_duplicate_tool_source_containers(
    conn: sqlite3.Connection,
    duplicate_rows: list[dict],
) -> dict:
    if not duplicate_rows:
        return {
            "table": "ContainerMetadata",
            "changed_count": 0,
            "changes": [],
            "localization_changed_count": 0,
            "localization_changes": [],
        }
    if "sourceContainerId" not in table_columns(conn, "Tools") or not sqlite_table_exists(conn, "ContainerMetadata"):
        return {
            "table": "ContainerMetadata",
            "changed_count": 0,
            "changes": [],
            "localization_changed_count": 0,
            "localization_changes": [],
            "skipped": True,
            "reason": "Tools.sourceContainerId or ContainerMetadata table not found",
        }
    row_ids = [row["rowId"] for row in duplicate_rows]
    placeholders = ",".join("?" for _ in row_ids)
    conn.row_factory = sqlite3.Row
    containers = [
        dict(row)
        for row in conn.execute(
            f"""
            SELECT DISTINCT
              cm.rowId,
              cm.id,
              cm.bundleVersion,
              cm.deviceId
            FROM Tools t
            JOIN ContainerMetadata cm ON cm.rowId = t.sourceContainerId
            WHERE t.rowId IN ({placeholders})
            ORDER BY cm.rowId
            """,
            row_ids,
        )
    ]
    changes = []
    for container in containers:
        new_bundle_version = f"shortpy-container-{container['rowId']}"
        if (
            container.get("id") == ""
            and container.get("bundleVersion") == new_bundle_version
            and container.get("deviceId") == ""
        ):
            continue
        conn.execute(
            """
            UPDATE ContainerMetadata
            SET id = '', bundleVersion = ?, deviceId = ''
            WHERE rowId = ?
            """,
            (new_bundle_version, container["rowId"]),
        )
        changes.append({
            "rowId": container["rowId"],
            "oldId": container["id"],
            "oldBundleVersion": container["bundleVersion"],
            "oldDeviceId": container["deviceId"],
            "newId": "",
            "newBundleVersion": new_bundle_version,
            "newDeviceId": "",
        })

    localization_changes = []
    if sqlite_table_exists(conn, "ContainerMetadataLocalizations"):
        container_ids = [container["rowId"] for container in containers]
        if container_ids:
            container_placeholders = ",".join("?" for _ in container_ids)
            localized_rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT containerId, locale, name
                    FROM ContainerMetadataLocalizations
                    WHERE containerId IN ({container_placeholders}) AND name != ''
                    ORDER BY containerId, locale
                    """,
                    container_ids,
                )
            ]
            for localized in localized_rows:
                conn.execute(
                    """
                    UPDATE ContainerMetadataLocalizations
                    SET name = ''
                    WHERE containerId = ? AND locale = ?
                    """,
                    (localized["containerId"], localized["locale"]),
                )
                localization_changes.append({
                    "containerId": localized["containerId"],
                    "locale": localized["locale"],
                    "oldName": localized["name"],
                    "newName": "",
                })
    return {
        "table": "ContainerMetadata",
        "changed_count": len(changes),
        "changes": changes,
        "localization_changed_count": len(localization_changes),
        "localization_changes": localization_changes,
    }


def apply_duplicate_python_name_source_of_truth(
    conn: sqlite3.Connection,
    table: str,
    duplicate_rows: list[dict],
) -> dict:
    if not duplicate_rows:
        return {
            "changed_count": 0,
            "display_name_adjustment": {"changed_count": 0, "changes": []},
            "source_container_adjustment": {"changed_count": 0, "changes": []},
        }
    if table == "Tools":
        display_name_adjustment = update_duplicate_localization_names(
            conn,
            table,
            "ToolLocalizations",
            "toolId",
            duplicate_rows,
        )
        source_container_adjustment = neutralize_duplicate_tool_source_containers(conn, duplicate_rows)
    elif table == "Triggers":
        display_name_adjustment = update_duplicate_localization_names(
            conn,
            table,
            "TriggerLocalizations",
            "triggerId",
            duplicate_rows,
        )
        source_container_adjustment = {
            "changed_count": 0,
            "changes": [],
            "skipped": True,
            "reason": "Triggers do not have sourceContainerId",
        }
    else:
        display_name_adjustment = {"changed_count": 0, "changes": [], "skipped": True}
        source_container_adjustment = {"changed_count": 0, "changes": [], "skipped": True}
    changed_count = (
        display_name_adjustment.get("changed_count", 0)
        + source_container_adjustment.get("changed_count", 0)
        + source_container_adjustment.get("localization_changed_count", 0)
    )
    return {
        "changed_count": changed_count,
        "display_name_adjustment": display_name_adjustment,
        "source_container_adjustment": source_container_adjustment,
    }


def toolrenderer_visibility_rows(conn: sqlite3.Connection) -> list[dict]:
    if "visibilityFlags" not in table_columns(conn, "Tools"):
        return []
    conn.row_factory = sqlite3.Row
    return [
        dict(row)
        for row in conn.execute(
            """
            SELECT rowId, id, pythonName, visibilityFlags
            FROM Tools
            WHERE (visibilityFlags & ?) != ?
            ORDER BY rowId
            """,
            (REQUIRED_TOOLRENDERER_VISIBILITY_FLAGS, REQUIRED_TOOLRENDERER_VISIBILITY_FLAGS),
        )
    ]


def adjust_toolrenderer_visibility(conn: sqlite3.Connection) -> dict:
    report = {
        "table": "Tools",
        "requiredBits": {
            "visibleForShortcuts": TOOL_VISIBILITY_VISIBLE_FOR_SHORTCUTS,
            "approved": TOOL_VISIBILITY_APPROVED,
        },
        "requiredMask": REQUIRED_TOOLRENDERER_VISIBILITY_FLAGS,
        "predicate": "(visibilityFlags & 0x5) != 0x5",
        "changed_count": 0,
        "changes": [],
    }
    rows_to_change = toolrenderer_visibility_rows(conn)
    for row in rows_to_change:
        old_flags = int(row["visibilityFlags"])
        new_flags = old_flags | REQUIRED_TOOLRENDERER_VISIBILITY_FLAGS
        conn.execute(
            "UPDATE Tools SET visibilityFlags = ? WHERE rowId = ?",
            (new_flags, row["rowId"]),
        )
        report["changes"].append({
            "rowId": row["rowId"],
            "id": identifier_text(row["id"]),
            "pythonName": row["pythonName"],
            "oldVisibilityFlags": old_flags,
            "newVisibilityFlags": new_flags,
        })
    report["changed_count"] = len(report["changes"])
    return report


def default_adjusted_path(source: Path, out_dir: Path) -> Path:
    resolved = source.expanduser().resolve(strict=True)
    stat = resolved.stat()
    digest = hashlib.sha256(f"{resolved}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")).hexdigest()[:16]
    stem = resolved.name
    if stem.endswith(".sqlite"):
        stem = stem[:-7]
    clean = re.sub(r"[^0-9A-Za-z_.-]+", "_", stem).strip("._") or "Tools-active"
    return out_dir / f"{clean}.shortpy-adjusted-{digest}.sqlite"


def copy_sqlite_database(source: Path, destination: Path) -> None:
    resolved = source.expanduser().resolve(strict=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm", ".lock"):
        target = Path(f"{destination}{suffix}")
        if target.exists() or target.is_symlink():
            target.unlink()
    shutil.copy2(resolved, destination)
    for suffix in ("-wal", "-shm", ".lock"):
        sidecar = Path(f"{resolved}{suffix}")
        if sidecar.exists() and sidecar.stat().st_size > 0:
            shutil.copy2(sidecar, Path(f"{destination}{suffix}"))


def clear_extended_attributes(path: Path) -> list[str]:
    listing = subprocess.run(
        ["/usr/bin/xattr", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    names = [line.strip() for line in listing.stdout.splitlines() if line.strip()]
    if names:
        subprocess.run(["/usr/bin/xattr", "-c", str(path)], check=False, capture_output=True)
    return names


def clear_sqlite_sidecars(sqlite_path: Path) -> list[str]:
    removed = []
    for suffix in ("-wal", "-shm", ".lock"):
        sidecar = Path(f"{sqlite_path}{suffix}")
        if sidecar.exists() or sidecar.is_symlink():
            sidecar.unlink()
            removed.append(str(sidecar))
    return removed


def prime_sqlite_database(sqlite_path: Path) -> dict:
    sql = "PRAGMA journal_mode; PRAGMA wal_checkpoint; PRAGMA integrity_check; PRAGMA user_version;"
    proc = subprocess.run(
        ["/usr/bin/sqlite3", str(sqlite_path), sql],
        check=False,
        capture_output=True,
        text=True,
    )
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    payload = {
        "ok": proc.returncode == 0 and "ok" in lines,
        "returncode": proc.returncode,
        "stdout": lines,
        "stderr": proc.stderr.strip(),
    }
    if len(lines) >= 1:
        payload["journal_mode"] = lines[0]
    if len(lines) >= 2:
        payload["wal_checkpoint"] = lines[1]
    if len(lines) >= 3:
        payload["integrity"] = lines[2]
    if len(lines) >= 4:
        try:
            payload["user_version"] = int(lines[3])
        except ValueError:
            payload["user_version"] = lines[3]
    return payload


def sqlite_table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "select 1 from sqlite_master where type='table' and name=? limit 1",
        (table_name,),
    ).fetchone()
    return row is not None


def preserve_metadata_from_runtime_target(target: Path, runtime_source: Path) -> dict:
    keys = [
        "IndexerSource",
        "LaunchServicesDatabaseVersionKey",
        "LaunchServicesSnapshotDatabaseVersionKey",
        "OSVersion",
        "VersionKey",
    ]
    source_conn = sqlite3.connect(str(runtime_source))
    try:
        if not sqlite_table_exists(source_conn, "Metadata"):
            return {
                "ok": True,
                "source": target_description(runtime_source),
                "keys": {},
                "skipped": True,
                "reason": "runtime source has no Metadata table",
            }
        rows = dict(
            source_conn.execute(
                f"select key,value from Metadata where key in ({','.join('?' for _ in keys)})",
                keys,
            ).fetchall()
        )
    finally:
        source_conn.close()
    if not rows:
        return {
            "ok": True,
            "source": target_description(runtime_source),
            "keys": {},
            "skipped": True,
            "reason": "runtime source has none of the preserved Metadata keys",
        }
    target_conn = sqlite3.connect(str(target))
    try:
        if not sqlite_table_exists(target_conn, "Metadata"):
            return {
                "ok": True,
                "source": target_description(runtime_source),
                "keys": {},
                "skipped": True,
                "reason": "replacement target has no Metadata table",
            }
        for key, value in rows.items():
            target_conn.execute(
                "insert or replace into Metadata(key,value) values(?,?)",
                (key, value),
            )
        target_conn.commit()
    finally:
        target_conn.close()
    return {
        "ok": True,
        "source": target_description(runtime_source),
        "keys": rows,
    }


def backup_sqlite_database(source: Path, label: str = "shortpy-backup") -> Path:
    resolved = source.expanduser().resolve(strict=True)
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = resolved.with_name(f"{resolved.name}.{label}-{suffix}")
    counter = 1
    while backup.exists() or backup.is_symlink():
        backup = resolved.with_name(f"{resolved.name}.{label}-{suffix}-{counter}")
        counter += 1
    copy_sqlite_database(resolved, backup)
    return backup


def has_duplicate_python_names(conn: sqlite3.Connection) -> bool:
    for table in ADJUSTABLE_PYTHON_NAME_TABLES:
        if adjustable_table(conn, table) and duplicate_python_name_rows(conn, table):
            return True
    return False


def needs_toolrenderer_visibility_adjustment(conn: sqlite3.Connection) -> bool:
    return bool(toolrenderer_visibility_rows(conn))


def adjust_sqlite_in_place(sqlite_path: Path, backup: bool = True, overlay_source: Path | None = None) -> dict:
    source = sqlite_path.expanduser().resolve(strict=True)
    overlay_path = overlay_source.expanduser().resolve(strict=True) if overlay_source else None
    created_backup: Path | None = None
    conn = sqlite3.connect(str(source))
    try:
        needs_adjustment = (
            has_duplicate_python_names(conn)
            or needs_toolrenderer_visibility_adjustment(conn)
        )
    finally:
        conn.close()
    if (needs_adjustment or overlay_path is not None) and backup:
        created_backup = backup_sqlite_database(source)
    conn = sqlite3.connect(str(source))
    try:
        overlay = overlay_python_names(conn, overlay_path) if overlay_path else None
        adjustment = adjust_duplicate_python_names(conn)
        visibility_adjustment = adjust_toolrenderer_visibility(conn)
        conn.commit()
    finally:
        conn.close()
    return {
        "ok": True,
        "action": "adjust",
        "source": target_description(source),
        "overlay_source": target_description(overlay_path) if overlay_path else None,
        "backup": target_description(created_backup) if created_backup else None,
        "python_name_overlay": overlay,
        "duplicate_adjustment": adjustment,
        "toolrenderer_visibility_adjustment": visibility_adjustment,
        "restart_required": bool(
            (overlay or {}).get("change_count", 0) > 0
            or adjustment.get("change_count", 0) > 0
            or adjustment.get("source_of_truth_change_count", 0) > 0
            or visibility_adjustment.get("changed_count", 0) > 0
        ),
    }


def prepare_adjusted_sqlite(sqlite_path: Path, out: Path | None, out_dir: Path | None, base: Path | None = None) -> dict:
    source = sqlite_path.expanduser().resolve(strict=True)
    copy_source = base.expanduser().resolve(strict=True) if base else source
    destination = out.expanduser() if out else default_adjusted_path(source, (out_dir or source.parent).expanduser())
    destination = destination.resolve(strict=False)
    copy_sqlite_database(copy_source, destination)
    conn = sqlite3.connect(str(destination))
    try:
        overlay = overlay_python_names(conn, source) if base else None
        adjustment = adjust_duplicate_python_names(conn)
        visibility_adjustment = adjust_toolrenderer_visibility(conn)
        conn.commit()
    finally:
        conn.close()
    return {
        "ok": True,
        "action": "prepare",
        "source": target_description(source),
        "base": target_description(copy_source) if base else None,
        "prepared": target_description(destination),
        "python_name_overlay": overlay,
        "duplicate_adjustment": adjustment,
        "toolrenderer_visibility_adjustment": visibility_adjustment,
    }


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


def active_target(device: str) -> Path:
    active = active_path(device)
    if not active.exists() and not active.is_symlink():
        raise RuntimeError(
            f"simulator Tools-active does not exist yet: {active}. "
            "Launch Shortcuts once so the native ToolKit target is indexed, then retry."
        )
    target = active.resolve(strict=True)
    if not target.is_file():
        raise RuntimeError(f"resolved Tools-active target is not a sqlite file: {target}")
    return target


def replace_active_target(device: str, prepared_sqlite: Path) -> dict:
    active = active_path(device)
    target = active_target(device)
    prepared = prepared_sqlite.expanduser().resolve(strict=True)
    if prepared == target:
        raise RuntimeError(f"refusing to replace active target with itself: {target}")
    removed_before = clear_sqlite_sidecars(target)
    backup = backup_sqlite_database(target, "shortpy-target-backup")
    shutil.copy2(prepared, target)
    preserved_metadata = preserve_metadata_from_runtime_target(target, backup)
    removed_xattrs = clear_extended_attributes(target)
    sqlite_prime = prime_sqlite_database(target)
    return {
        "ok": True,
        "action": "replace-active-target",
        "device": resolve_device(device),
        "active": target_description(active),
        "target": target_description(target),
        "prepared": target_description(prepared),
        "backup": target_description(backup),
        "removed_sidecars_before": removed_before,
        "removed_sidecars_after": [],
        "removed_xattrs": removed_xattrs,
        "preserved_runtime_metadata": preserved_metadata,
        "sqlite_prime": sqlite_prime,
        "restart_required": True,
    }


def adjusted_sqlite_path(path: Path) -> bool:
    text = str(path)
    return ".shortpy-adjusted-" in path.name or "/toolkit-adjusted/" in text


def simulator_base_sqlite(device: str) -> Path | None:
    active = active_path(device)
    candidates: list[Path] = []
    if active.exists() or active.is_symlink():
        candidates.append(active)
    candidates.extend(sorted(active.parent.glob("Tools-active.backup-*"), key=lambda item: item.name, reverse=True))
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if adjusted_sqlite_path(resolved):
            continue
        if resolved == HOST_TOOLKIT_ACTIVE or str(resolved).startswith(str(HOST_TOOLKIT_ACTIVE.parent)):
            continue
        if resolved.is_file():
            return resolved
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if not adjusted_sqlite_path(resolved) and resolved.is_file():
            return resolved
    return None


def activate_adjusted(device: str, sqlite_path: Path, out_dir: Path | None, out: Path | None, base: Path | None = None) -> dict:
    prepared_out_dir = out_dir or (toolkit_dir(device) / "ShortpyPrepared")
    selected_base = base
    prepared = prepare_adjusted_sqlite(sqlite_path, out, prepared_out_dir, selected_base)
    replacement = replace_active_target(device, Path(prepared["prepared"]["path"]))
    return {
        "ok": True,
        "action": "activate",
        "mode": "prepared-copy-replace-active-target",
        "device": replacement["device"],
        "source": prepared["source"],
        "base": prepared["base"],
        "prepared": prepared["prepared"],
        "python_name_overlay": prepared["python_name_overlay"],
        "duplicate_adjustment": prepared["duplicate_adjustment"],
        "toolrenderer_visibility_adjustment": prepared["toolrenderer_visibility_adjustment"],
        "replacement": replacement,
        "restart_required": True,
    }


def prime_active(device: str) -> dict:
    target = active_target(device)
    return {
        "ok": True,
        "action": "prime",
        "device": resolve_device(device),
        "target": target_description(target),
        "sqlite_prime": prime_sqlite_database(target),
    }


def active_database_snapshot(device: str) -> dict:
    target = active_target(device)
    stat = target.stat()
    payload = {
        "target": target_description(target),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }
    conn = sqlite3.connect(f"file:{target}?mode=ro", uri=True, timeout=1.0)
    try:
        for table, key in (("Tools", "tools"), ("Triggers", "triggers")):
            if sqlite_table_exists(conn, table):
                payload[key] = conn.execute(f"select count(*) from {table}").fetchone()[0]
            else:
                payload[key] = None
        if sqlite_table_exists(conn, "Metadata"):
            payload["metadata"] = dict(
                conn.execute(
                    "select key,value from Metadata where key in "
                    "('OSVersion','LaunchServicesDatabaseVersionKey',"
                    "'LaunchServicesSnapshotDatabaseVersionKey','VersionKey','IndexerSource')"
                ).fetchall()
            )
        else:
            payload["metadata"] = {}
    finally:
        conn.close()
    return payload


def wait_active_idle(device: str, min_wait: float, stable_seconds: float, timeout: float, interval: float) -> dict:
    started = time.monotonic()
    deadline = started + timeout
    samples: list[dict] = []
    last_key = None
    stable_since = None
    while True:
        now = time.monotonic()
        try:
            snapshot = active_database_snapshot(device)
            key = (
                snapshot.get("target", {}).get("path"),
                snapshot.get("size"),
                snapshot.get("mtime_ns"),
                snapshot.get("tools"),
                snapshot.get("triggers"),
            )
            if key == last_key:
                if stable_since is None:
                    stable_since = now
            else:
                last_key = key
                stable_since = now
            snapshot["elapsed_s"] = round(now - started, 3)
            snapshot["stable_for_s"] = round(now - (stable_since or now), 3)
            samples.append(snapshot)
            if (
                now - started >= min_wait
                and stable_since is not None
                and now - stable_since >= stable_seconds
                and snapshot.get("tools") is not None
            ):
                return {
                    "ok": True,
                    "action": "wait-idle",
                    "device": resolve_device(device),
                    "min_wait_s": min_wait,
                    "stable_seconds": stable_seconds,
                    "timeout_s": timeout,
                    "interval_s": interval,
                    "elapsed_s": round(now - started, 3),
                    "snapshot": snapshot,
                    "sample_count": len(samples),
                    "samples_tail": samples[-10:],
                }
        except Exception as exc:
            samples.append({"elapsed_s": round(now - started, 3), "error": repr(exc)})
        if now >= deadline:
            return {
                "ok": False,
                "action": "wait-idle",
                "device": resolve_device(device),
                "error": "active ToolKit sqlite did not become idle before timeout",
                "min_wait_s": min_wait,
                "stable_seconds": stable_seconds,
                "timeout_s": timeout,
                "interval_s": interval,
                "elapsed_s": round(now - started, 3),
                "sample_count": len(samples),
                "samples_tail": samples[-10:],
            }
        time.sleep(interval)


def restore_active(device: str, backup: Path | None) -> dict:
    active = active_path(device)
    target = active_target(device)
    if backup is None:
        target_backups = sorted(target.parent.glob(f"{target.name}.shortpy-target-backup-*"), key=lambda p: p.name)
        if target_backups:
            backup = target_backups[-1]
        else:
            backups = sorted(active.parent.glob("Tools-active.backup-*"), key=lambda p: p.name)
            if not backups:
                raise RuntimeError(f"no Tools-active or target backup files found in {active.parent}")
            backup = backups[-1]
    if not backup.exists() and not backup.is_symlink():
        raise FileNotFoundError(backup)
    if backup.is_symlink():
        current_backup = backup_active(active)
        if active.exists() or active.is_symlink():
            active.unlink()
        os.symlink(os.readlink(backup), active)
        restored_target = active.resolve(strict=False)
    else:
        current_backup = backup_sqlite_database(target, "shortpy-target-restore-backup")
        removed_before = clear_sqlite_sidecars(target)
        shutil.copy2(backup, target)
        removed_after = clear_sqlite_sidecars(target)
        restored_target = target
    return {
        "ok": True,
        "action": "restore",
        "device": resolve_device(device),
        "active": target_description(active),
        "target": target_description(restored_target),
        "restored_from": target_description(backup),
        "previous_active_backup": target_description(current_backup) if current_backup else None,
        "removed_sidecars_before": removed_before if not backup.is_symlink() else [],
        "removed_sidecars_after": removed_after if not backup.is_symlink() else [],
        "restart_required": True,
    }


def show(device: str) -> dict:
    active = active_path(device)
    target = active.resolve(strict=False) if active.exists() or active.is_symlink() else None
    target_backups = []
    if target:
        target_backups = [
            target_description(path)
            for path in sorted(target.parent.glob(f"{target.name}.shortpy-target-backup-*"))[-10:]
        ]
    return {
        "ok": True,
        "device": resolve_device(device),
        "toolkit_dir": str(active.parent),
        "active": target_description(active),
        "target": target_description(target) if target else None,
        "host_active": target_description(HOST_TOOLKIT_ACTIVE),
        "backups": [target_description(path) for path in sorted(active.parent.glob("Tools-active.backup-*"))[-10:]],
        "target_backups": target_backups,
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
    sub.add_parser("snapshot", help="Inspect the active simulator ToolKit sqlite row counts and metadata.")

    point = sub.add_parser("point", help="Point simulator Library/Shortcuts/ToolKit/Tools-active at a sqlite file.")
    point.add_argument("sqlite", type=Path)
    point.add_argument("--no-resolve", action="store_true", help="Keep the provided target path instead of resolving symlinks.")

    point_host = sub.add_parser("point-host", help="Point simulator Tools-active at the host mac Tools-active target.")
    point_host.add_argument("--no-resolve", action="store_true", help="Keep the host Tools-active symlink path instead of resolving it.")

    prepare = sub.add_parser("prepare", help="Copy a ToolKit sqlite and rewrite duplicate Python names in the copy.")
    prepare.add_argument("--sqlite", type=Path, default=HOST_TOOLKIT_ACTIVE, help="SQLite path. Defaults to host ~/Library/Shortcuts/ToolKit/Tools-active.")
    prepare.add_argument("--base", type=Path, help="Base sqlite to copy before overlaying Python names from --sqlite.")
    prepare.add_argument("--out", type=Path, help="Adjusted sqlite output path.")
    prepare.add_argument("--out-dir", type=Path, help="Directory for a generated adjusted sqlite name.")

    adjust = sub.add_parser("adjust", help="Rewrite duplicate Python names in a ToolKit sqlite in place.")
    adjust.add_argument("--sqlite", type=Path, default=HOST_TOOLKIT_ACTIVE, help="SQLite path. Defaults to host ~/Library/Shortcuts/ToolKit/Tools-active.")
    adjust.add_argument("--no-backup", action="store_true", help="Do not create a sqlite backup before making changes.")

    activate = sub.add_parser("activate", help="Prepare an adjusted sqlite copy and replace the simulator Tools-active target with it.")
    activate.add_argument("--sqlite", type=Path, default=HOST_TOOLKIT_ACTIVE, help="SQLite path. Defaults to host ~/Library/Shortcuts/ToolKit/Tools-active.")
    activate.add_argument("--base", type=Path, help="Debug only: base sqlite to copy before overlaying Python names from --sqlite.")
    activate.add_argument("--out", type=Path, help="Debug only: adjusted sqlite output path.")
    activate.add_argument("--out-dir", type=Path, help="Debug only: directory for a generated adjusted sqlite name.")

    sub.add_parser("prime", help="Open and checkpoint the active simulator ToolKit sqlite.")

    wait_idle = sub.add_parser("wait-idle", help="Wait until the active simulator ToolKit sqlite stops changing.")
    wait_idle.add_argument("--min-wait", type=float, default=45.0, help="Minimum seconds to wait before accepting an idle snapshot.")
    wait_idle.add_argument("--stable-seconds", type=float, default=8.0, help="Seconds the active sqlite snapshot must remain unchanged.")
    wait_idle.add_argument("--timeout", type=float, default=180.0, help="Maximum seconds to wait.")
    wait_idle.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds.")

    restore = sub.add_parser("restore", help="Restore simulator Tools-active target from the latest or specified backup.")
    restore.add_argument("--backup", type=Path)

    metadata = sub.add_parser("metadata", help="Extract Python names and parameter keys from a ToolKit sqlite.")
    metadata.add_argument("--sqlite", type=Path, help="SQLite path. Defaults to simulator Tools-active.")
    metadata.add_argument("--out", type=Path, help="Write JSON metadata to this path.")

    args = parser.parse_args()
    try:
        if args.command == "show":
            payload = show(args.device)
        elif args.command == "snapshot":
            payload = {
                "ok": True,
                "action": "snapshot",
                "device": resolve_device(args.device),
                "snapshot": active_database_snapshot(args.device),
            }
        elif args.command == "point":
            payload = point_active(args.device, args.sqlite, not args.no_resolve)
        elif args.command == "point-host":
            payload = point_active(args.device, HOST_TOOLKIT_ACTIVE, not args.no_resolve)
        elif args.command == "prepare":
            payload = prepare_adjusted_sqlite(args.sqlite, args.out, args.out_dir, args.base)
        elif args.command == "adjust":
            payload = adjust_sqlite_in_place(args.sqlite, not args.no_backup)
        elif args.command == "activate":
            payload = activate_adjusted(args.device, args.sqlite, args.out_dir, args.out, args.base)
        elif args.command == "prime":
            payload = prime_active(args.device)
        elif args.command == "wait-idle":
            payload = wait_active_idle(args.device, args.min_wait, args.stable_seconds, args.timeout, args.interval)
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
    return 0 if payload.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
