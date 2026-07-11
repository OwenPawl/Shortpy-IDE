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

    comment_source = """def shortcut() -> None:
    # Line one
    # Line two
    action()
""" + "    # \n"
    comment_origins = [
        {
            "actionIndex": 0,
            "actionIdentifier": "is.workflow.actions.comment",
            "actionParameters": {"WFCommentActionText": "Line one\nLine two"},
        },
        {
            "actionIndex": 1,
            "actionIdentifier": "is.workflow.actions.notification",
            "actionParameters": {},
        },
        {
            "actionIndex": 2,
            "actionIdentifier": "is.workflow.actions.comment",
            "actionParameters": {},
        },
    ]
    canonical_comments, comment_report = (
        bridgectl.canonicalize_imported_comment_actions(
            comment_source, comment_origins
        )
    )
    assert 'com_apple_shortcuts_comment(comment="Line one\\nLine two")' in canonical_comments
    assert 'com_apple_shortcuts_comment(comment="")' in canonical_comments
    assert "    # Line one" not in canonical_comments
    assert comment_report["replacement_count"] == 2
    assert comment_report["unresolved"] == []

    edge_comment_source = """def shortcut() -> None:
    # # literal hash
    # trailing newline
""" + "    # \n    action()\n"
    edge_comment_origins = [
        {
            "actionIndex": 0,
            "actionIdentifier": "is.workflow.actions.comment",
            "actionParameters": {"WFCommentActionText": "# literal hash"},
        },
        {
            "actionIndex": 1,
            "actionIdentifier": "is.workflow.actions.comment",
            "actionParameters": {"WFCommentActionText": "trailing newline\n"},
        },
        {
            "actionIndex": 2,
            "actionIdentifier": "is.workflow.actions.notification",
            "actionParameters": {},
        },
    ]
    canonical_edges, edge_report = bridgectl.canonicalize_imported_comment_actions(
        edge_comment_source, edge_comment_origins
    )
    assert 'com_apple_shortcuts_comment(comment="# literal hash")' in canonical_edges
    assert 'com_apple_shortcuts_comment(comment="trailing newline\\n")' in canonical_edges
    assert "    # " not in canonical_edges
    assert edge_report["replacement_count"] == 2
    assert edge_report["unresolved"] == []

    print("import-sources-ok")


if __name__ == "__main__":
    main()
