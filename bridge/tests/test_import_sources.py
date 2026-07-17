#!/usr/bin/env python3
import importlib.util
import json
import plistlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BRIDGECTL = ROOT / "bridge" / "tools" / "bridgectl.py"


def test_native_boundary_contracts() -> None:
    makefile = (ROOT / "bridge" / "Makefile").read_text()
    header = (ROOT / "bridge" / "src" / "runtime_objc_helpers.h").read_text()
    implementation = (
        ROOT / "bridge" / "src" / "runtime_objc_helpers.m"
    ).read_text()
    swift = (
        ROOT / "bridge" / "src" / "ShortcutsRuntimeDirectSim.swift"
    ).read_text()
    adapter = (
        ROOT / "bridge" / "src" / "shortpy" / "shortpy_ir_adapter.c"
    ).read_text()

    assert '#import "runtime_objc_helpers.h"' in implementation
    assert "-import-objc-header \"$(OBJC_BRIDGING_HEADER)\"" in makefile
    assert "runtime_objc_helpers.m $(OBJC_BRIDGING_HEADER)" in makefile

    object_return_helpers = [
        "bridge_objc_alloc_class",
        "bridge_objc_class_msg_send0",
        "bridge_objc_msg_send0",
        "bridge_objc_msg_send1",
        "bridge_objc_msg_send2",
        "bridge_objc_msg_send3",
        "bridge_objc_msg_send4",
        "bridge_objc_msg_send2_bool",
        "bridge_shortpy_make_edit_export_workflow",
    ]
    imported_helpers = [
        *object_return_helpers,
        "bridge_objc_responds",
        "bridge_objc_msg_send_void0",
        "bridge_objc_msg_send_void0_barrier_sync",
        "bridge_objc_msg_send_uint64",
        "bridge_objc_msg_send_uint64_arg",
        "bridge_shortpy_edit_export_last_error",
        "bridge_shortpy_replace_workflow_action_serialized_parameters",
        "bridge_shortpy_repair_else_if_witnesses",
        "bridge_shortpy_else_if_repair_last_error",
        "bridge_compiler_trace_begin",
        "bridge_compiler_trace_end",
    ]
    for name in object_return_helpers:
        declaration = re.search(
            rf"\b{name}\s*\([^;]*?\);",
            header,
            flags=re.DOTALL,
        )
        assert declaration, f"missing Objective-C ownership declaration: {name}"
        assert "NS_RETURNS_NOT_RETAINED" in declaration.group(0), name
    for name in imported_helpers:
        assert f'@_silgen_name("{name}")' not in swift, name
    declared_helpers = set(re.findall(r"\b(bridge_[a-z0-9_]+)\s*\(", header))
    assert declared_helpers == set(imported_helpers)
    assert '@_silgen_name("bridge_make_flags")' in swift

    capability_names = [
        "kAdapterCapabilityBase",
        "kAdapterCapabilityStatementReferenceConstruction",
        "kAdapterCapabilityStatementExpressionConstruction",
    ]
    for name in capability_names:
        assert name in adapter
    assert "context->loadedCapabilities = kAdapterCapabilityBase;" in adapter
    assert adapter.count("LoadStatementReferenceConstructorCapabilities(") == 2
    assert adapter.count("LoadStatementExpressionConstructorCapabilities(") == 3
    assert adapter.count("RequireCapabilities(") >= 5
    assert "unknown ShortcutsLanguage IR capability requested" in adapter


def load_bridgectl():
    spec = importlib.util.spec_from_file_location("bridgectl", BRIDGECTL)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_toolrenderer_parser(bridgectl) -> None:
    source = '''def runnable(surface: RunSurface) -> Callable:
    """runnable
    Registers a shortcut on a run surface.
    """

# Actions
def com_apple_shortcuts_open_app(
    app: Resolved[com_apple_shortcuts_wfapp_descriptor_parameter_state],
) -> App:
    """Open App
    Launches a chosen application.
    Args:
        app: Query string searches across: name.
    Returns:
        App: App
    """

def messages_find_conversation(
    query: List[query_com_apple_mobile_sms_conversation_entity],
    query_operator: QUERY_OPERATOR = QUERY_OPERATOR.ALL,
    sort_by: Optional[str] = None,
    query_sort_order: QUERY_SORT_ORDER = QUERY_SORT_ORDER.ASCENDING,
    limit: Optional[int] = None,
    scope: Optional[str] = None,
) -> Conversation:
    """Find Conversation
    Search Messages conversations.
    Args:
        : The filter conditions.
        sort_by: The property used to sort results.
    Returns:
        Conversation
    """

# Triggers
def when_test(value: str) -> None:
    """When Test"""

# Types
App = Any
com_apple_shortcuts_wfapp_descriptor_parameter_state = Any
Conversation = Any
query_com_apple_mobile_sms_conversation_entity = Any
class RunSurface(Enum):
    SHARE_SHEET = "SHARE_SHEET"
    APPLE_WATCH = "APPLE_WATCH"
class QUERY_OPERATOR(Enum):
    ANY = "ANY"
    ALL = "ALL"
class QUERY_SORT_ORDER(Enum):
    ASCENDING = "ASCENDING"
    DESCENDING = "DESCENDING"
'''
    metadata = bridgectl.parse_toolrenderer_structured_from_source(source)
    assert metadata["counts"] == {
        "actions": 2,
        "triggers": 1,
        "helpers": 1,
        "types": 7,
        "items": 4,
    }
    by_name = {
        item["pythonName"]: item
        for item in [
            *metadata["helpers"],
            *metadata["actions"],
            *metadata["triggers"],
            *metadata["types"],
        ]
    }
    open_app = by_name["com_apple_shortcuts_open_app"]
    assert open_app["returnType"] == "App"
    assert open_app["definitionBlock"].startswith("def com_apple_shortcuts_open_app(")
    assert "Args:" in open_app["definitionBlock"]
    assert open_app["parameters"][0]["doc"] == "Query string searches across: name."
    assert by_name["runnable"]["kind"] == "decorator"
    assert by_name["when_test"]["kind"] == "trigger"
    assert by_name["RunSurface"]["cases"][0]["pythonName"] == "RunSurface.SHARE_SHEET"
    query = by_name["messages_find_conversation"]
    rendered_names = [parameter["pythonName"] for parameter in query["parameters"]]
    assert rendered_names == [
        "query",
        "query_operator",
        "sort_by",
        "query_sort_order",
        "limit",
        "scope",
    ], rendered_names
    assert query["parameters"][0]["type"] == "List[query_com_apple_mobile_sms_conversation_entity]"
    assert "filterActionSurface" not in query
    bridgectl.validate_toolrenderer_type_references(metadata)

    original_toolkit_items_by_id = bridgectl.toolkit_items_by_id
    try:
        def fake_toolkit_items_by_id(kind: str) -> dict:
            if kind == "actions":
                return {
                    "native.open-app": {
                        "id": "native.open-app",
                        "pythonName": "com_apple_shortcuts_open_app",
                        "parameters": [{"pythonName": "app", "key": "WFApp"}],
                    },
                    "native.toolkit-only": {
                        "id": "native.toolkit-only",
                        "pythonName": "toolkit_only_action",
                        "parameters": [],
                    },
                }
            return {}

        bridgectl.toolkit_items_by_id = fake_toolkit_items_by_id
        visible = bridgectl.visible_toolrenderer_metadata(metadata)
    finally:
        bridgectl.toolkit_items_by_id = original_toolkit_items_by_id
    assert [item["pythonName"] for item in visible["actions"]] == [
        "com_apple_shortcuts_open_app",
        "messages_find_conversation",
    ]
    visible_open_app = visible["actions"][0]
    assert visible_open_app["nativeIdentifier"] == "native.open-app"
    assert visible_open_app["parameters"][0]["acceptedNames"] == ["app"]
    assert [parameter["pythonName"] for parameter in visible["actions"][1]["parameters"]] == rendered_names

    incomplete = bridgectl.parse_toolrenderer_structured_from_source(
        "def broken(value: MissingNativeType) -> None:\n    pass\n"
    )
    try:
        bridgectl.validate_toolrenderer_type_references(incomplete)
    except bridgectl.ToolRendererMetadataError as exc:
        assert "MissingNativeType referenced by broken" in str(exc)
    else:
        raise AssertionError("missing native ToolRenderer type did not fail closed")


def main() -> None:
    test_native_boundary_contracts()
    bridgectl = load_bridgectl()
    test_toolrenderer_parser(bridgectl)
    malformed_source = b"def shortcut( -> None:\n    pass\n"
    malformed_prepared = bridgectl.rewrite_inline_catalog_metadata(malformed_source)
    assert malformed_prepared == {
        "source": malformed_source,
        "source_text": malformed_source.decode("utf-8"),
        "entries": [],
        "rewritten": False,
    }

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
