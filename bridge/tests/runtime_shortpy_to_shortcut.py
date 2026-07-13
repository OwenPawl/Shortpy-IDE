#!/usr/bin/env python3
"""Live simulator regression coverage for the owned ShortpyToShortcut path."""

from __future__ import annotations

import argparse
import base64
import json
import plistlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bridge" / "tools"))
import bridgectl  # noqa: E402


CASES = {
    "loop-carried-recurrence": '''def shortcut() -> None:
    updated_text = com_apple_shortcuts_replace_text(
        find_text="seed",
        replace_with="first",
        text="seed",
    )
    for repeat_index in range(2):
        if repeat_index == 0:
            if_result = com_apple_shortcuts_replace_text(
                find_text=f"{repeat_index}",
                replace_with="first",
                text=f"{updated_text}",
            )
        else:
            if_result = com_apple_shortcuts_replace_text(
                find_text=f"{repeat_index}",
                replace_with="next",
                text=f"{if_result}",
            )
    com_apple_shortcuts_combine_text(text=if_result)
''',
    "elif-loop-carried-recurrence": '''def shortcut() -> None:
    updated_text = com_apple_shortcuts_replace_text(
        find_text="seed",
        replace_with="first",
        text="seed",
    )
    for repeat_index in range(3):
        if repeat_index == 0:
            if_result = com_apple_shortcuts_replace_text(
                find_text=f"{repeat_index}", replace_with="first", text=f"{updated_text}"
            )
        elif repeat_index == 1:
            if_result = com_apple_shortcuts_replace_text(
                find_text=f"{repeat_index}", replace_with="middle", text=f"{if_result}"
            )
        else:
            if_result = com_apple_shortcuts_replace_text(
                find_text=f"{repeat_index}", replace_with="last", text=f"{if_result}"
            )
    com_apple_shortcuts_combine_text(text=if_result)
''',
    "menu-loop-carried-recurrence": '''def shortcut() -> None:
    updated_text = com_apple_shortcuts_replace_text(
        find_text="seed",
        replace_with="first",
        text="seed",
    )
    for repeat_index in range(2):
        match shortcuts_builtin_choose(prompt=None):
            case "First":
                menu_result = com_apple_shortcuts_replace_text(
                    find_text="first", replace_with="first", text=f"{updated_text}"
                )
            case "Next":
                menu_result = com_apple_shortcuts_replace_text(
                    find_text="next", replace_with="next", text=f"{menu_result}"
                )
    com_apple_shortcuts_combine_text(text=menu_result)
''',
    "nested-repeat-results": '''def shortcut() -> None:
    repeat_results = []
    for repeat_index in range(2):
        repeat_results1 = []
        for repeat_index_2 in range(2):
            repeat_results1.append(repeat_index_2)
        repeat_results.append(repeat_results1)
    com_apple_shortcuts_combine_text(text=repeat_results)
''',
    "explicit-variable-actions": '''def shortcut() -> None:
    com_apple_shortcuts_set_variable(input=[], variable="real_values")
    items = ["value"]
    for repeat_item in items:
        real_values.append(repeat_item)
    variable = com_apple_shortcuts_get_variable(variable="real_values")
    com_apple_shortcuts_combine_text(text=variable)
''',
    "list-and-get-item": '''def shortcut() -> None:
    items = ["One", "Two"]
    com_apple_shortcuts_get_item_from_list(list=items)
''',
    "explicit-comment": '''def shortcut() -> None:
    com_apple_shortcuts_comment(comment="native comment")
''',
    "root-decorators": '''@runnable(surface=RunSurface.SHARE_SHEET)
@input_fallback(behavior=InputFallback.GET_CLIPBOARD)
def shortcut() -> None:
    pass
''',
    "inline-trigger-catalog": '''@when_app_opened(app=[{"Bundle Identifier": "com.apple.shortcuts", "Name": "Shortcuts"}])
def shortcut() -> None:
    pass
''',
}


def bridge(command: str, socket_path: str) -> dict:
    raw = bridgectl.send_command(socket_path, command)
    return bridgectl.parse_bridge_json_response(raw, command.split(" ", 1)[0])


def compile_source(source: str, socket_path: str) -> tuple[dict, bytes]:
    response = bridgectl.compile_python_to_bplist(
        socket_path, source.encode("utf-8"), 0
    )
    payload = response.get("plist_payload", {}).get("data")
    return response, base64.b64decode(payload) if payload else b""


def import_workflow(data: bytes, socket_path: str) -> dict:
    response = bridge(
        "pipeline-plist-data-to-python-b64 1 "
        + base64.b64encode(data).decode("ascii"),
        socket_path,
    )
    return bridgectl.inline_catalog_import_response(socket_path, response)


def action_shape(data: bytes) -> list[tuple[str | None, object]]:
    root = plistlib.loads(data)
    return [
        (
            action.get("WFWorkflowActionIdentifier"),
            action.get("WFWorkflowActionParameters", {}).get("WFControlFlowMode"),
        )
        for action in root.get("WFWorkflowActions", [])
    ]


def action_uuid(action: dict) -> str | None:
    parameters = action.get("WFWorkflowActionParameters", {})
    return parameters.get("UUID") or action.get("WFWorkflowActionUUID")


def semantic_edges(data: bytes) -> list[list[tuple[int, str]]]:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    index_by_uuid = {
        uuid: index
        for index, action in enumerate(actions)
        if (uuid := action_uuid(action))
    }

    def walk(value: object, output: list[tuple[int, str]]) -> None:
        if isinstance(value, dict):
            if value.get("Type") == "ActionOutput":
                target = index_by_uuid.get(value.get("OutputUUID"))
                if target is not None:
                    output.append((
                        target,
                        json.dumps(value.get("Aggrandizements", []), sort_keys=True),
                    ))
                return
            for child in value.values():
                walk(child, output)
        elif isinstance(value, list):
            for child in value:
                walk(child, output)

    result = []
    for action in actions:
        output: list[tuple[int, str]] = []
        walk(action.get("WFWorkflowActionParameters", {}), output)
        result.append(sorted(output))
    return result


def recurrence_edge_is_correct(data: bytes) -> bool:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    close_uuids = {
        action_uuid(action)
        for action in actions
        if action.get("WFWorkflowActionParameters", {}).get("WFControlFlowMode") == 2
    }
    referenced = []
    for action in actions:
        if action.get("WFWorkflowActionIdentifier") != "is.workflow.actions.text.replace":
            continue
        values: list[str] = []

        def walk(value: object) -> None:
            if isinstance(value, dict):
                if value.get("Type") == "ActionOutput" and value.get("OutputUUID"):
                    values.append(value["OutputUUID"])
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(action.get("WFWorkflowActionParameters", {}))
        referenced.extend(values)
    return any(uuid in close_uuids for uuid in referenced) and any(
        uuid not in close_uuids for uuid in referenced
    )


def run_case(name: str, source: str, socket_path: str, output: Path) -> dict:
    case_dir = output / name
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "source.py").write_text(source)

    first_response, first_data = compile_source(source, socket_path)
    (case_dir / "first-response.json").write_text(
        json.dumps(first_response, indent=2, sort_keys=True) + "\n"
    )
    if first_data:
        (case_dir / "first.wflow").write_bytes(first_data)

    first_import = import_workflow(first_data, socket_path) if first_data else {}
    (case_dir / "first-import.json").write_text(
        json.dumps(first_import, indent=2, sort_keys=True) + "\n"
    )
    imported_source = first_import.get("python_code", "")
    (case_dir / "imported.py").write_text(imported_source)

    second_response, second_data = (
        compile_source(imported_source, socket_path)
        if imported_source
        else ({}, b"")
    )
    (case_dir / "second-response.json").write_text(
        json.dumps(second_response, indent=2, sort_keys=True) + "\n"
    )
    if second_data:
        (case_dir / "second.wflow").write_bytes(second_data)
    second_import = import_workflow(second_data, socket_path) if second_data else {}

    first_shape = action_shape(first_data) if first_data else []
    second_shape = action_shape(second_data) if second_data else []
    first_edges = semantic_edges(first_data) if first_data else []
    second_edges = semantic_edges(second_data) if second_data else []
    recurrence_correct = (
        "loop-carried-recurrence" not in name
        or (
            recurrence_edge_is_correct(first_data)
            and recurrence_edge_is_correct(second_data)
        )
    )
    ok = all(
        [
            first_response.get("ok"),
            first_import.get("ok"),
            second_response.get("ok"),
            second_import.get("ok"),
            first_shape == second_shape,
            first_edges == second_edges,
            recurrence_correct,
        ]
    )
    return {
        "name": name,
        "ok": ok,
        "firstActionCount": len(first_shape),
        "secondActionCount": len(second_shape),
        "actionShapeStable": first_shape == second_shape,
        "actionOutputEdgesStable": first_edges == second_edges,
        "recurrenceEdgeCorrect": recurrence_correct,
        "firstDiagnostic": first_response.get("diagnostic"),
        "firstImportDiagnostic": first_import.get("diagnostic"),
        "secondDiagnostic": second_response.get("diagnostic"),
        "secondImportDiagnostic": second_import.get("diagnostic"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="auto")
    parser.add_argument(
        "--output", default="/tmp/shortpy-to-shortcut-runtime-tests"
    )
    args = parser.parse_args()

    status = bridge("status", args.socket)
    if not status.get("ok"):
        raise RuntimeError(f"simulator bridge is unavailable: {status}")

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    results = [
        run_case(name, source, args.socket, output)
        for name, source in CASES.items()
    ]
    summary = {
        "ok": all(result["ok"] for result in results),
        "runtimeTarget": status.get("target"),
        "bridgeVersion": status.get("version"),
        "caseCount": len(results),
        "results": results,
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n"
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
