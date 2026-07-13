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

    original_toolkit_items = bridgectl.toolkit_items
    try:
        bridgectl.toolkit_items = lambda kind, name: ([{
            "id": "com.apple.shortcuts.OpenAppIntent",
            "pythonName": "com_apple_shortcuts_open_app_intent",
            "parameters": [{"pythonName": "app", "key": "app"}],
        }] if kind == "actions" and name == "com_apple_shortcuts_open_app_intent" else [])
        action_binding = bridgectl.catalog_host_binding_for_context(
            "com_apple_shortcuts_open_app_intent", "app"
        )
        assert action_binding == {
            "source": "active-tool-database",
            "hostAndKey": {
                "handle": {"action": {"identifier": "com.apple.shortcuts.OpenAppIntent"}},
                "key": "app",
            },
        }

        bridgectl.toolkit_items = lambda kind, name: ([{
            "id": "com.apple.shortcuts.WFAppInFocusTrigger.opened",
            "pythonName": "when_app_opened",
            "parameters": [{"pythonName": "app", "key": "WFSelectedApps"}],
        }] if kind == "triggers" and name == "when_app_opened" else [])
        trigger_binding = bridgectl.catalog_host_binding_for_context(
            "when_app_opened", "app"
        )
        assert trigger_binding == {
            "source": "active-tool-database",
            "hostAndKey": {
                "handle": {
                    "trigger": {
                        "identifier": "WFAppInFocusTrigger",
                        "variant": "opened",
                    }
                },
                "key": "WFSelectedApps",
            },
        }

        bridgectl.toolkit_items = lambda _kind, _name: []
        try:
            bridgectl.catalog_host_binding_for_context("missing_action", "entity")
        except bridgectl.InlineCatalogError as exc:
            assert exc.diagnostics[0]["code"] == "unsupportedInlineCatalogContext"
            assert "active Tool database" in exc.diagnostics[0]["message"]
        else:
            raise AssertionError("missing catalog host/key did not fail closed")
    finally:
        bridgectl.toolkit_items = original_toolkit_items

    print("import-sources-ok")


if __name__ == "__main__":
    main()
