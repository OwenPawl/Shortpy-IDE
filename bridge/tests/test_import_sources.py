#!/usr/bin/env python3
import importlib.util
import json
import plistlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BRIDGECTL = ROOT / "bridge" / "tools" / "bridgectl.py"


def load_bridgectl():
    spec = importlib.util.spec_from_file_location("bridgectl", BRIDGECTL)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def main() -> None:
    bridgectl = load_bridgectl()
    shortcut_id = "00000000-0000-0000-0000-000000000000"
    record_url = f"https://www.icloud.com/shortcuts/api/records/{shortcut_id}"
    download_url = "https://download.example.invalid/Shortcut.wflow"
    workflow = plistlib.dumps({"WFWorkflowActions": []}, fmt=plistlib.FMT_BINARY)
    calls = []

    def fake_fetch_url_bytes(url, **_kwargs):
        calls.append(url)
        if url == record_url:
            return json.dumps({
                "fields": {
                    "shortcut": {
                        "value": {
                            "downloadURL": download_url,
                        },
                    },
                },
            }).encode("utf-8"), url
        if url == download_url:
            return workflow, url
        raise AssertionError(f"unexpected URL fetch: {url}")

    bridgectl.fetch_url_bytes = fake_fetch_url_bytes
    plist_data, signed_import, icloud_import = bridgectl.workflow_import_source_bytes(
        f"https://www.icloud.com/shortcuts/{shortcut_id}".encode("utf-8")
    )
    assert plist_data == workflow
    assert signed_import is None
    assert icloud_import["ok"] is True
    assert icloud_import["shortcut_id"] == shortcut_id
    assert icloud_import["download_url"] == download_url
    assert calls == [record_url, download_url]

    def fake_error_fetch_url_bytes(url, **_kwargs):
        assert url == record_url
        return json.dumps({"error": True, "reason": "missing shortcut"}).encode("utf-8"), url

    bridgectl.fetch_url_bytes = fake_error_fetch_url_bytes
    try:
        bridgectl.workflow_import_source_bytes(
            f"https://www.icloud.com/shortcuts/api/records/{shortcut_id}".encode("utf-8")
        )
    except RuntimeError as exc:
        assert "missing shortcut" in str(exc)
    else:
        raise AssertionError("iCloud API error response did not raise")

    value_uuid = "11111111-1111-1111-1111-111111111111"
    group_uuid = "22222222-2222-2222-2222-222222222222"
    accumulator = "repeat_results"
    repeat_actions = [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": group_uuid,
                "WFControlFlowMode": 0,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.combine",
            "WFWorkflowActionParameters": {"UUID": value_uuid},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.appendvariable",
            "WFWorkflowActionParameters": {
                "WFInput": {
                    "Value": {
                        "OutputUUID": value_uuid,
                        "Type": "ActionOutput",
                    },
                    "WFSerializationType": "WFTextTokenAttachment",
                },
                "WFVariableName": accumulator,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": group_uuid,
                "UUID": "33333333-3333-3333-3333-333333333333",
                "WFControlFlowMode": 2,
            },
        },
    ]
    repeat_workflow = plistlib.dumps(
        {"WFWorkflowActions": repeat_actions},
        fmt=plistlib.FMT_BINARY,
    )
    normalized, report = bridgectl.normalize_repeat_accumulators_for_python_export(repeat_workflow)
    normalized_actions = plistlib.loads(normalized)["WFWorkflowActions"]
    assert report["present"] is True
    assert report["removed_count"] == 1
    assert report["removed"][0]["variable_name"] == accumulator
    assert len(normalized_actions) == 3
    assert all(
        action["WFWorkflowActionIdentifier"] != "is.workflow.actions.appendvariable"
        for action in normalized_actions
    )

    referenced_workflow = plistlib.loads(repeat_workflow)
    referenced_workflow["WFWorkflowActions"].append({
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvariable",
        "WFWorkflowActionParameters": {"WFVariableName": accumulator},
    })
    referenced_data = plistlib.dumps(referenced_workflow, fmt=plistlib.FMT_BINARY)
    unchanged, unchanged_report = bridgectl.normalize_repeat_accumulators_for_python_export(referenced_data)
    assert unchanged == referenced_data
    assert unchanged_report["present"] is False

    print("import-sources-ok")


if __name__ == "__main__":
    main()
