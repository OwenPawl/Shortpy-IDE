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
    "aliased-loop-carried-recurrence": '''def shortcut() -> None:
    updated_text = com_apple_shortcuts_replace_text(
        find_text="seed",
        replace_with="first",
        text="seed",
    )
    if_result = updated_text
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
    "multi-elif-nonempty": '''def shortcut() -> None:
    if shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="if")
    elif shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="elif one")
    elif shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="elif two")
    else:
        com_apple_shortcuts_comment(comment="else")
''',
    "elif-without-else": '''def shortcut() -> None:
    if shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="if")
    elif shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="elif")
''',
    "nested-multi-elif": '''def shortcut() -> None:
    if shortcuts_builtin_current_date() is None:
        if shortcuts_builtin_current_date() is None:
            com_apple_shortcuts_comment(comment="inner if")
        elif shortcuts_builtin_current_date() is None:
            com_apple_shortcuts_comment(comment="inner elif one")
        elif shortcuts_builtin_current_date() is None:
            com_apple_shortcuts_comment(comment="inner elif two")
        else:
            com_apple_shortcuts_comment(comment="inner else")
    elif shortcuts_builtin_current_date() is None:
        com_apple_shortcuts_comment(comment="outer elif")
    else:
        com_apple_shortcuts_comment(comment="outer else")
''',
    "elif-action-output-reference": '''def shortcut() -> None:
    value = com_apple_shortcuts_text(text="seed")
    if value == "first":
        com_apple_shortcuts_comment(comment="if")
    elif value == "second":
        com_apple_shortcuts_comment(comment="elif")
    else:
        com_apple_shortcuts_comment(comment="else")
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
    "nested-repeat-index-consumers": '''def shortcut() -> None:
    for repeat_index in range(2):
        for repeat_index_2 in range(2):
            com_apple_shortcuts_replace_text(
                find_text="inner",
                replace_with=f"{repeat_index_2}",
                text=f"{repeat_index}",
            )
        com_apple_shortcuts_replace_text(
            find_text="outer",
            replace_with=f"{repeat_index}",
            text="done",
        )
''',
    "nested-repeat-each-item-consumers": '''def shortcut() -> None:
    items = com_apple_shortcuts_list(WFItems=["One", "Two"])
    for repeat_item in items:
        for repeat_item_2 in items:
            com_apple_shortcuts_replace_text(
                find_text="inner",
                replace_with=f"{repeat_item_2}",
                text=f"{repeat_item}",
            )
        com_apple_shortcuts_replace_text(
            find_text="outer",
            replace_with=f"{repeat_item}",
            text="done",
        )
''',
    "nested-empty-repeat-results": '''def shortcut() -> None:
    repeat_results = []
    for repeat_index in range(3):
        repeat_results1 = []
        for repeat_index_2 in range(1):
            pass
        repeat_results.append(com_apple_shortcuts_get_variable(variable=repeat_results1))
    com_apple_shortcuts_combine_text(text=repeat_results)
''',
    "wrapped-nested-repeat-results": '''def shortcut() -> None:
    repeat_results = []
    for repeat_index in range(1):
        repeat_results1 = []
        for repeat_index_2 in range(1):
            for repeat_index_3 in range(1):
                pass
            repeat_results2 = []
            for repeat_index_3 in range(1):
                pass
            repeat_results1.append(
                com_apple_shortcuts_get_variable(variable=repeat_results2)
            )
        repeat_results.append(
            com_apple_shortcuts_get_variable(variable=repeat_results1)
        )
    com_apple_shortcuts_combine_text(text=repeat_results)
''',
    "empty-if-menu-results": '''def shortcut() -> None:
    if shortcuts_builtin_current_date() is None:
        if_result = None
    com_apple_shortcuts_get_variable(variable=if_result)
    match shortcuts_builtin_choose(prompt=None):
        case "One":
            menu_result = None
        case "Two":
            menu_result = None
    com_apple_shortcuts_get_variable(variable=menu_result)
''',
    "mixed-explicit-list-empty-repeat-results": '''def shortcut() -> None:
    native_items = com_apple_shortcuts_list(WFItems=["One"])
    repeat_results = []
    for repeat_index in range(3):
        repeat_results1 = []
        for repeat_index_2 in range(1):
            pass
        repeat_results.append(com_apple_shortcuts_get_variable(variable=repeat_results1))
    com_apple_shortcuts_get_item_from_list(list=native_items)
    com_apple_shortcuts_combine_text(text=repeat_results)
''',
    "explicit-list-before-repeat": '''def shortcut() -> None:
    native_items = com_apple_shortcuts_list(WFItems=[])
    for repeat_index in range(1):
        pass
    com_apple_shortcuts_get_item_from_list(list=native_items)
''',
    "multiple-empty-repeat-results": '''def shortcut() -> None:
    first_results = []
    for repeat_index in range(1):
        pass
    com_apple_shortcuts_get_variable(variable=first_results)
    second_results = []
    for repeat_index_2 in range(1):
        pass
    com_apple_shortcuts_get_variable(variable=second_results)
''',
    "explicit-variable-actions": '''def shortcut() -> None:
    real_values = com_apple_shortcuts_list(WFItems=[])
    real_values = com_apple_shortcuts_set_variable(
        input=real_values, variable="real_values"
    )
    items = com_apple_shortcuts_list(WFItems=["value"])
    for repeat_item in items:
        real_values = com_apple_shortcuts_add_to_variable(
            input=repeat_item, variable="real_values"
        )
    variable = com_apple_shortcuts_get_variable(variable=real_values)
    com_apple_shortcuts_combine_text(text=variable)
''',
    "native-variable-reference": '''def shortcut() -> None:
    seed = com_apple_shortcuts_text(text="seed")
    hello = com_apple_shortcuts_set_variable(input=seed, variable="Hello")
    com_apple_shortcuts_combine_text(text=hello)
''',
    "historical-variable-references": '''def shortcut() -> None:
    seed = com_apple_shortcuts_text(text="seed")
    first = com_apple_shortcuts_set_variable(input=seed, variable="Hello")
    com_apple_shortcuts_combine_text(text=first)
    next_value = com_apple_shortcuts_text(text="next")
    current = com_apple_shortcuts_add_to_variable(input=next_value, variable="Hello")
    com_apple_shortcuts_combine_text(text=first)
    com_apple_shortcuts_combine_text(text=current)
''',
    "list-and-get-item": '''def shortcut() -> None:
    items = com_apple_shortcuts_list(WFItems=["One", "Two"])
    items = com_apple_shortcuts_add_item_to_list(item="Three", list=items)
    com_apple_shortcuts_get_item_from_list(list=items)
''',
    "explicit-get-dictionary-value": '''def shortcut() -> None:
    dictionary = com_apple_shortcuts_dictionary(items={"key": "value"})
    dictionary = com_apple_shortcuts_set_dictionary_value(dictionary=dictionary)
    value = com_apple_shortcuts_get_dictionary_value(dictionary=dictionary)
    com_apple_shortcuts_get_dictionary_from_input(input=value)
''',
    "explicit-comment": '''def shortcut() -> None:
    com_apple_shortcuts_comment(comment="native comment")
''',
    "explicit-text": '''def shortcut() -> None:
    text = com_apple_shortcuts_text(text="value")
    com_apple_shortcuts_combine_text(text=text)
''',
    "explicit-dictionary": '''def shortcut() -> None:
    dictionary = com_apple_shortcuts_dictionary(items={"key": "value"})
    com_apple_shortcuts_combine_text(text=dictionary)
''',
    "typed-dictionary": '''def shortcut() -> None:
    dictionary = com_apple_shortcuts_dictionary(
        items={"number": 42, "list": ["one", 2], "nested_list": [["one", 2], [3]], "flag": True}
    )
    com_apple_shortcuts_combine_text(text=dictionary)
''',
    "explicit-nothing": '''def shortcut() -> None:
    nothing = com_apple_shortcuts_nothing()
    com_apple_shortcuts_combine_text(text=nothing)
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

REPEAT_EACH_CANONICALIZATION_CASE = '''def shortcut() -> None:
    repeat_input = com_apple_shortcuts_list(WFItems=["One"])
    repeat_results = []
    for repeat_item in repeat_input:
        pass
    com_apple_shortcuts_get_variable(variable=repeat_results)
'''

REJECTION_CASES = {
    "implicit-list": (
        '''def shortcut() -> None:
    items = ["one"]
    com_apple_shortcuts_combine_text(text=items)
''',
        ["implicit action lowering is disabled", "com_apple_shortcuts_list(...)"],
    ),
    "implicit-add-to-variable": (
        '''def shortcut() -> None:
    items = []
    items.append("one")
    com_apple_shortcuts_combine_text(text=items)
''',
        [
            "implicit action lowering is disabled",
            "com_apple_shortcuts_list(...)",
            "com_apple_shortcuts_add_to_variable(...)",
        ],
    ),
    "implicit-set-variable": (
        '''def shortcut() -> None:
    value = "one"
    value = "two"
    com_apple_shortcuts_combine_text(text=value)
''',
        [
            "implicit action lowering is disabled",
            "com_apple_shortcuts_set_variable(...)",
        ],
    ),
    "implicit-text": (
        '''def shortcut() -> None:
    text = "value"
    com_apple_shortcuts_combine_text(text=text)
''',
        ["implicit action lowering is disabled", "com_apple_shortcuts_text(...)"],
    ),
    "implicit-dictionary": (
        '''def shortcut() -> None:
    dictionary = {"key": "value"}
    com_apple_shortcuts_combine_text(text=dictionary)
''',
        [
            "implicit action lowering is disabled",
            "com_apple_shortcuts_dictionary(...)",
        ],
    ),
    "implicit-nothing": (
        '''def shortcut() -> None:
    nothing = None
    com_apple_shortcuts_combine_text(text=nothing)
''',
        [
            "implicit action lowering is disabled",
            "com_apple_shortcuts_nothing(...)",
        ],
    ),
}

EXPECTED_IMPORT_FRAGMENTS = {
    "explicit-variable-actions": [
        "com_apple_shortcuts_list(",
        "real_values = com_apple_shortcuts_set_variable(",
        "real_values = com_apple_shortcuts_add_to_variable(",
        "variable = com_apple_shortcuts_get_variable(variable=real_values)",
    ],
    "native-variable-reference": [
        "hello = com_apple_shortcuts_set_variable(",
        "com_apple_shortcuts_combine_text(text=hello)",
    ],
    "historical-variable-references": [
        "hello = com_apple_shortcuts_set_variable(",
        "hello = com_apple_shortcuts_add_to_variable(",
        "com_apple_shortcuts_combine_text(text=hello)",
    ],
    "list-and-get-item": [
        "com_apple_shortcuts_list(",
        "com_apple_shortcuts_add_item_to_list(",
        "com_apple_shortcuts_get_item_from_list(",
    ],
    "nested-empty-repeat-results": [
        "repeat_results1 = []",
        "com_apple_shortcuts_get_variable(variable=repeat_results1)",
    ],
    "wrapped-nested-repeat-results": [
        "repeat_results2 = []",
        "com_apple_shortcuts_get_variable(variable=repeat_results2)",
    ],
    "mixed-explicit-list-empty-repeat-results": [
        "list = com_apple_shortcuts_list(",
        "repeat_results1 = []",
        "com_apple_shortcuts_get_variable(variable=repeat_results1)",
        "com_apple_shortcuts_get_item_from_list(list=list)",
    ],
    "explicit-list-before-repeat": [
        "list = com_apple_shortcuts_list(",
        "com_apple_shortcuts_get_item_from_list(list=list)",
    ],
    "explicit-get-dictionary-value": [
        "com_apple_shortcuts_set_dictionary_value(",
        "com_apple_shortcuts_get_dictionary_value(",
        "com_apple_shortcuts_get_dictionary_from_input(",
    ],
    "explicit-text": ["text = com_apple_shortcuts_text(text=\"value\")"],
    "explicit-dictionary": [
        "dictionary = com_apple_shortcuts_dictionary(items={\"key\": \"value\"})"
    ],
    "typed-dictionary": [
        '"number": 42',
        '"list": ["one", 2]',
        '"nested_list": [["one", 2], [3]]',
        '"flag": True',
    ],
    "explicit-nothing": ["nothing = com_apple_shortcuts_nothing()"],
}

ORDER_INSENSITIVE_SOURCE_CASES = {"typed-dictionary"}

EXPECTED_NAMED_VARIABLE_REFERENCES = {
    "explicit-variable-actions": [
        ("is.workflow.actions.getvariable", "real_values", 1),
    ],
    "native-variable-reference": [
        ("is.workflow.actions.text.combine", "Hello", 1),
    ],
    "historical-variable-references": [
        ("is.workflow.actions.text.combine", "Hello", 3),
    ],
}

VARIABLE_MUTATION_IDENTIFIERS = {
    "is.workflow.actions.setvariable",
    "is.workflow.actions.appendvariable",
}

EXPECTED_LIST_ACTION_COUNTS = {
    "nested-repeat-each-item-consumers": 1,
    "nested-empty-repeat-results": 0,
    "wrapped-nested-repeat-results": 0,
    "mixed-explicit-list-empty-repeat-results": 1,
    "explicit-list-before-repeat": 1,
    "multiple-empty-repeat-results": 0,
}

INNER_REPEAT_RESULT_REFERENCE_CASES = {
    "nested-empty-repeat-results",
    "mixed-explicit-list-empty-repeat-results",
}

EXPECTED_CONTROL_VARIABLE_REFERENCES = {
    "nested-repeat-index-consumers": {
        "Repeat Index": 2,
        "Repeat Index 2": 1,
    },
    "nested-repeat-each-item-consumers": {
        "Repeat Item": 2,
        "Repeat Item 2": 1,
    },
}

EXPECTED_CONTROL_FLOW_OUTPUT_REPAIRS = {
    "nested-repeat-results": (0, 1, 0, 0, 0),
    "nested-empty-repeat-results": (1, 0, 0, 0, 0),
    "wrapped-nested-repeat-results": (1, 0, 1, 0, 0),
    "empty-if-menu-results": (0, 0, 0, 2, 1),
    "mixed-explicit-list-empty-repeat-results": (1, 0, 0, 0, 0),
    "multiple-empty-repeat-results": (2, 0, 0, 0, 0),
}

EXPECTED_ELSE_IF_BRANCH_COUNTS = {
    "elif-loop-carried-recurrence": [1],
    "multi-elif-nonempty": [2],
    "elif-without-else": [1],
    "nested-multi-elif": [1, 2],
    "elif-action-output-reference": [1],
}

EXPECTED_ELSE_IF_ELSE_INSERTIONS = {
    "elif-without-else": (1, 0),
}

EXPECTED_FIRST_PRESERVED_RECURRENCE_ALIASES = {
    "aliased-loop-carried-recurrence": 1,
}

EXPECTED_PASS_NAMES = [
    "ShortpyControlFlowPlan",
    "ShortpyControlFlowInputPreparation",
    "ControlFlowOutputInferencePass",
    "ShortpyControlFlowOutputRepair",
    "VariableInliningPass",
    "DropCommentsPass",
    "ShortpyElseIfConditionWitnessPreparation",
]


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


def action_named_variable_reference_count(
    data: bytes, action_identifier: str, variable_name: str
) -> int:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])

    def count(value: object) -> int:
        if isinstance(value, dict):
            if (
                value.get("Type") == "Variable"
                and value.get("VariableName") == variable_name
            ):
                return 1
            return sum(count(child) for child in value.values())
        if isinstance(value, list):
            return sum(count(child) for child in value)
        return 0

    return sum(
        count(action.get("WFWorkflowActionParameters", {}))
        for action in actions
        if action.get("WFWorkflowActionIdentifier") == action_identifier
    )


def named_variable_reference_count(data: bytes, variable_name: str) -> int:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])

    def count(value: object) -> int:
        if isinstance(value, dict):
            if (
                value.get("Type") == "Variable"
                and value.get("VariableName") == variable_name
            ):
                return 1
            return sum(count(child) for child in value.values())
        if isinstance(value, list):
            return sum(count(child) for child in value)
        return 0

    return sum(
        count(action.get("WFWorkflowActionParameters", {}))
        for action in actions
    )


def variable_mutations_are_named_and_uuid_free(data: bytes) -> bool:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    for action in actions:
        if action.get("WFWorkflowActionIdentifier") not in VARIABLE_MUTATION_IDENTIFIERS:
            continue
        parameters = action.get("WFWorkflowActionParameters", {})
        variable_name = parameters.get("WFVariableName")
        if not isinstance(variable_name, str) or not variable_name:
            return False
        if "UUID" in parameters or "WFWorkflowActionUUID" in action:
            return False
    return True


def action_output_references_resolve(data: bytes) -> bool:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    known_uuids = {
        uuid for action in actions if (uuid := action_uuid(action))
    }

    def resolves(value: object) -> bool:
        if isinstance(value, dict):
            if value.get("Type") == "ActionOutput":
                return value.get("OutputUUID") in known_uuids
            return all(resolves(child) for child in value.values())
        if isinstance(value, list):
            return all(resolves(child) for child in value)
        return True

    return all(
        resolves(action.get("WFWorkflowActionParameters", {}))
        for action in actions
    )


def conditional_group_else_if_counts(data: bytes) -> list[int] | None:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    groups: dict[str, list[dict]] = {}
    for action in actions:
        if action.get("WFWorkflowActionIdentifier") != "is.workflow.actions.conditional":
            continue
        parameters = action.get("WFWorkflowActionParameters", {})
        grouping_identifier = parameters.get("GroupingIdentifier")
        if not isinstance(grouping_identifier, str) or not grouping_identifier:
            return None
        groups.setdefault(grouping_identifier, []).append(parameters)

    result: list[int] = []
    for parameters in groups.values():
        modes = [item.get("WFControlFlowMode") for item in parameters]
        if len(modes) < 4 or modes[0] != 0 or modes[-1] != 2:
            return None
        if any(mode != 1 for mode in modes[1:-1]):
            return None
        mode_one_parameters = parameters[1:-1]
        condition_payloads = []
        for item in mode_one_parameters:
            payload = {
                key: value
                for key, value in item.items()
                if key not in {"WFControlFlowMode", "GroupingIdentifier", "UUID"}
            }
            condition_payloads.append(payload)
        if not condition_payloads or condition_payloads[-1]:
            return None
        if any(not payload for payload in condition_payloads[:-1]):
            return None
        result.append(len(condition_payloads) - 1)
    return result


def list_action_count(data: bytes) -> int:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    return sum(
        action.get("WFWorkflowActionIdentifier") == "is.workflow.actions.list"
        for action in actions
    )


def pass_report(response: dict, pass_name: str) -> dict | None:
    for report in response.get("pipeline", {}).get("passes", []):
        if report.get("name") == pass_name:
            return report
    return None


def pass_change_count(response: dict, pass_name: str) -> int | None:
    report = pass_report(response, pass_name)
    return report.get("changes") if report else None


def pass_output_field(response: dict, pass_name: str, key: str) -> str | None:
    report = pass_report(response, pass_name)
    output = report.get("output", "") if report else ""
    for field in output.split():
        field_key, separator, value = field.partition("=")
        if field_key == key and separator:
            return value
    return None


def pass_output_int(response: dict, pass_name: str, key: str) -> int | None:
    value = pass_output_field(response, pass_name, key)
    return int(value) if value and value.isdecimal() else None


def pass_names(response: dict) -> list[str]:
    return [
        report.get("name")
        for report in response.get("pipeline", {}).get("passes", [])
    ]


def inner_repeat_result_reference_is_correct(data: bytes) -> bool:
    actions = plistlib.loads(data).get("WFWorkflowActions", [])
    repeat_closes = [
        (index, action_uuid(action))
        for index, action in enumerate(actions)
        if action.get("WFWorkflowActionIdentifier", "").startswith(
            "is.workflow.actions.repeat."
        )
        and action.get("WFWorkflowActionParameters", {}).get(
            "WFControlFlowMode"
        ) == 2
        and action_uuid(action)
    ]
    if len(repeat_closes) < 2:
        return False
    inner_close_index, inner_close_uuid = repeat_closes[0]
    outer_close_index, _ = repeat_closes[1]
    for action in actions[inner_close_index + 1 : outer_close_index]:
        if action.get("WFWorkflowActionIdentifier") != "is.workflow.actions.getvariable":
            continue
        variable = action.get("WFWorkflowActionParameters", {}).get(
            "WFVariable", {}
        )
        attachment = variable.get("Value", {}) if isinstance(variable, dict) else {}
        if (
            attachment.get("Type") == "ActionOutput"
            and attachment.get("OutputUUID") == inner_close_uuid
            and attachment.get("OutputName") == "Repeat Results"
        ):
            return True
    return False


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
    (case_dir / "second-import.json").write_text(
        json.dumps(second_import, indent=2, sort_keys=True) + "\n"
    )
    second_imported_source = second_import.get("python_code", "")
    (case_dir / "second-imported.py").write_text(second_imported_source)

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
    expected_first_preserved_aliases = (
        EXPECTED_FIRST_PRESERVED_RECURRENCE_ALIASES.get(name)
    )
    first_preserved_aliases = pass_output_int(
        first_response,
        "ShortpyControlFlowInputPreparation",
        "preserved_aliases",
    )
    recurrence_alias_preservation_correct = (
        expected_first_preserved_aliases is None
        or first_preserved_aliases == expected_first_preserved_aliases
    )
    expected_import_fragments = EXPECTED_IMPORT_FRAGMENTS.get(name, [])
    import_fragments_stable = all(
        fragment in imported_source and fragment in second_imported_source
        for fragment in expected_import_fragments
    )
    source_stable = imported_source == second_imported_source
    source_stability_correct = (
        source_stable or name in ORDER_INSENSITIVE_SOURCE_CASES
    )
    expected_named_variable_references = EXPECTED_NAMED_VARIABLE_REFERENCES.get(
        name, []
    )
    named_variable_references_stable = all(
        action_named_variable_reference_count(
            first_data, identifier, variable
        ) == expected_count
        and action_named_variable_reference_count(
            second_data, identifier, variable
        ) == expected_count
        for identifier, variable, expected_count in expected_named_variable_references
    )
    expected_control_variable_references = (
        EXPECTED_CONTROL_VARIABLE_REFERENCES.get(name, {})
    )
    first_control_variable_references = {
        variable: named_variable_reference_count(first_data, variable)
        for variable in expected_control_variable_references
    } if first_data else {}
    second_control_variable_references = {
        variable: named_variable_reference_count(second_data, variable)
        for variable in expected_control_variable_references
    } if second_data else {}
    control_variable_references_stable = (
        first_control_variable_references
        == expected_control_variable_references
        == second_control_variable_references
    )
    variable_mutations_stable = (
        bool(first_data)
        and bool(second_data)
        and variable_mutations_are_named_and_uuid_free(first_data)
        and variable_mutations_are_named_and_uuid_free(second_data)
    )
    action_output_references_resolved = (
        bool(first_data)
        and bool(second_data)
        and action_output_references_resolve(first_data)
        and action_output_references_resolve(second_data)
    )
    expected_else_if_branch_counts = EXPECTED_ELSE_IF_BRANCH_COUNTS.get(
        name, []
    )
    expected_else_if_witness_count = sum(expected_else_if_branch_counts)
    (
        expected_first_else_if_else_insertions,
        expected_second_else_if_else_insertions,
    ) = EXPECTED_ELSE_IF_ELSE_INSERTIONS.get(
        name, (0, 0)
    )
    first_else_if_branch_counts = (
        conditional_group_else_if_counts(first_data)
        if expected_else_if_branch_counts and first_data
        else []
    )
    second_else_if_branch_counts = (
        conditional_group_else_if_counts(second_data)
        if expected_else_if_branch_counts and second_data
        else []
    )
    first_else_if_lowering = first_response.get("pipeline", {}).get(
        "elseIfConditionLowering", {}
    )
    second_else_if_lowering = second_response.get("pipeline", {}).get(
        "elseIfConditionLowering", {}
    )
    else_if_lowering_correct = (
        first_else_if_branch_counts == expected_else_if_branch_counts
        and second_else_if_branch_counts == expected_else_if_branch_counts
        and pass_change_count(
            first_response, "ShortpyElseIfConditionWitnessPreparation"
        ) == expected_else_if_witness_count
        and pass_change_count(
            second_response, "ShortpyElseIfConditionWitnessPreparation"
        ) == expected_else_if_witness_count
        and first_else_if_lowering.get("witnessInsertions")
        == expected_else_if_witness_count
        and second_else_if_lowering.get("witnessInsertions")
        == expected_else_if_witness_count
        and first_else_if_lowering.get("conditionRepairs")
        == expected_else_if_witness_count
        and second_else_if_lowering.get("conditionRepairs")
        == expected_else_if_witness_count
        and first_else_if_lowering.get("elseInsertions")
        == expected_first_else_if_else_insertions
        and second_else_if_lowering.get("elseInsertions")
        == expected_second_else_if_else_insertions
        and first_else_if_lowering.get("witnessMarkersRemoved")
        == expected_else_if_witness_count * 2
        and second_else_if_lowering.get("witnessMarkersRemoved")
        == expected_else_if_witness_count * 2
    )
    expected_list_action_count = EXPECTED_LIST_ACTION_COUNTS.get(name)
    first_list_action_count = list_action_count(first_data) if first_data else -1
    second_list_action_count = list_action_count(second_data) if second_data else -1
    list_action_count_stable = (
        expected_list_action_count is None
        or (
            first_list_action_count == expected_list_action_count
            and second_list_action_count == expected_list_action_count
        )
    )
    inner_repeat_result_reference_correct = (
        name not in INNER_REPEAT_RESULT_REFERENCE_CASES
        or (
            bool(first_data)
            and bool(second_data)
            and inner_repeat_result_reference_is_correct(first_data)
            and inner_repeat_result_reference_is_correct(second_data)
        )
    )
    output_pass_name = "ShortpyControlFlowOutputRepair"
    (
        expected_initializer_repairs,
        expected_forwarding_removals,
        expected_forwarding_conversions,
        expected_structural_none_removals,
        expected_one_sided_none_repairs,
    ) = (
        EXPECTED_CONTROL_FLOW_OUTPUT_REPAIRS.get(name, (0, 0, 0, 0, 0))
    )
    expected_output_changes = (
        expected_initializer_repairs
        + expected_forwarding_removals
        + expected_forwarding_conversions
        + expected_structural_none_removals
        + expected_one_sided_none_repairs
    )
    first_output_changes = pass_change_count(
        first_response, output_pass_name
    )
    second_output_changes = pass_change_count(
        second_response, output_pass_name
    )
    first_initializer_repairs = pass_output_int(
        first_response, output_pass_name, "initializer_repairs"
    )
    second_initializer_repairs = pass_output_int(
        second_response, output_pass_name, "initializer_repairs"
    )
    first_forwarding_removals = pass_output_int(
        first_response, output_pass_name, "forwarding_removals"
    )
    second_forwarding_removals = pass_output_int(
        second_response, output_pass_name, "forwarding_removals"
    )
    first_forwarding_conversions = pass_output_int(
        first_response, output_pass_name, "forwarding_conversions"
    )
    second_forwarding_conversions = pass_output_int(
        second_response, output_pass_name, "forwarding_conversions"
    )
    first_structural_none_removals = pass_output_int(
        first_response, output_pass_name, "structural_none_removals"
    )
    second_structural_none_removals = pass_output_int(
        second_response, output_pass_name, "structural_none_removals"
    )
    first_one_sided_none_repairs = pass_output_int(
        first_response, output_pass_name, "one_sided_none_repairs"
    )
    second_one_sided_none_repairs = pass_output_int(
        second_response, output_pass_name, "one_sided_none_repairs"
    )
    expected_constructor = (
        "swift_allocBox+value_witnesses"
        if expected_initializer_repairs or expected_one_sided_none_repairs
        else "value_witnesses"
        if expected_forwarding_conversions
        else "not-required"
    )
    output_repair_correct = (
        first_output_changes == expected_output_changes
        and second_output_changes == expected_output_changes
        and first_initializer_repairs == expected_initializer_repairs
        and second_initializer_repairs == expected_initializer_repairs
        and first_forwarding_removals == expected_forwarding_removals
        and second_forwarding_removals == expected_forwarding_removals
        and first_forwarding_conversions == expected_forwarding_conversions
        and second_forwarding_conversions == expected_forwarding_conversions
        and first_structural_none_removals == expected_structural_none_removals
        and second_structural_none_removals == expected_structural_none_removals
        and first_one_sided_none_repairs == expected_one_sided_none_repairs
        and second_one_sided_none_repairs == expected_one_sided_none_repairs
        and pass_output_field(
            first_response, output_pass_name, "constructor"
        ) == expected_constructor
        and pass_output_field(
            second_response, output_pass_name, "constructor"
        ) == expected_constructor
    )
    pass_order_correct = (
        pass_names(first_response) == EXPECTED_PASS_NAMES
        and pass_names(second_response) == EXPECTED_PASS_NAMES
    )
    control_flow_plan_read_only = (
        pass_change_count(first_response, "ShortpyControlFlowPlan") == 0
        and pass_change_count(second_response, "ShortpyControlFlowPlan") == 0
    )
    first_repeat_result_lowering_count = len(
        first_response.get("pipeline", {}).get("repeatResultLowering", [])
    )
    second_repeat_result_lowering_count = len(
        second_response.get("pipeline", {}).get("repeatResultLowering", [])
    )
    postbackend_lowering_absent = (
        first_repeat_result_lowering_count == 0
        and second_repeat_result_lowering_count == 0
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
            recurrence_alias_preservation_correct,
            import_fragments_stable,
            source_stability_correct,
            named_variable_references_stable,
            control_variable_references_stable,
            variable_mutations_stable,
            action_output_references_resolved,
            else_if_lowering_correct,
            list_action_count_stable,
            inner_repeat_result_reference_correct,
            output_repair_correct,
            pass_order_correct,
            control_flow_plan_read_only,
            postbackend_lowering_absent,
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
        "expectedFirstPreservedRecurrenceAliases":
            expected_first_preserved_aliases,
        "firstPreservedRecurrenceAliases": first_preserved_aliases,
        "recurrenceAliasPreservationCorrect":
            recurrence_alias_preservation_correct,
        "importFragmentsStable": import_fragments_stable,
        "sourceStable": source_stable,
        "sourceStabilityCorrect": source_stability_correct,
        "namedVariableReferencesStable": named_variable_references_stable,
        "expectedNamedVariableReferences": expected_named_variable_references,
        "expectedControlVariableReferences":
            expected_control_variable_references,
        "firstControlVariableReferences": first_control_variable_references,
        "secondControlVariableReferences": second_control_variable_references,
        "controlVariableReferencesStable": control_variable_references_stable,
        "variableMutationsNamedAndUUIDFree": variable_mutations_stable,
        "actionOutputReferencesResolved": action_output_references_resolved,
        "expectedElseIfBranchCounts": expected_else_if_branch_counts,
        "firstElseIfBranchCounts": first_else_if_branch_counts,
        "secondElseIfBranchCounts": second_else_if_branch_counts,
        "expectedElseIfWitnessCount": expected_else_if_witness_count,
        "expectedFirstElseIfElseInsertions":
            expected_first_else_if_else_insertions,
        "expectedSecondElseIfElseInsertions":
            expected_second_else_if_else_insertions,
        "elseIfLoweringCorrect": else_if_lowering_correct,
        "expectedListActionCount": expected_list_action_count,
        "firstListActionCount": first_list_action_count,
        "secondListActionCount": second_list_action_count,
        "listActionCountStable": list_action_count_stable,
        "innerRepeatResultReferenceCorrect": inner_repeat_result_reference_correct,
        "expectedInitializerOnlyRepeatRepairs": expected_initializer_repairs,
        "firstInitializerOnlyRepeatRepairs": first_initializer_repairs,
        "secondInitializerOnlyRepeatRepairs": second_initializer_repairs,
        "expectedRepeatForwardingRemovals": expected_forwarding_removals,
        "firstRepeatForwardingRemovals": first_forwarding_removals,
        "secondRepeatForwardingRemovals": second_forwarding_removals,
        "expectedRepeatForwardingConversions": expected_forwarding_conversions,
        "firstRepeatForwardingConversions": first_forwarding_conversions,
        "secondRepeatForwardingConversions": second_forwarding_conversions,
        "expectedStructuralNoneRemovals": expected_structural_none_removals,
        "firstStructuralNoneRemovals": first_structural_none_removals,
        "secondStructuralNoneRemovals": second_structural_none_removals,
        "expectedOneSidedNoneRepairs": expected_one_sided_none_repairs,
        "firstOneSidedNoneRepairs": first_one_sided_none_repairs,
        "secondOneSidedNoneRepairs": second_one_sided_none_repairs,
        "expectedControlFlowOutputChanges": expected_output_changes,
        "firstControlFlowOutputChanges": first_output_changes,
        "secondControlFlowOutputChanges": second_output_changes,
        "controlFlowOutputRepairCorrect": output_repair_correct,
        "passOrderCorrect": pass_order_correct,
        "controlFlowPlanReadOnly": control_flow_plan_read_only,
        "firstRepeatResultLoweringCount": first_repeat_result_lowering_count,
        "secondRepeatResultLoweringCount": second_repeat_result_lowering_count,
        "postbackendLoweringAbsent": postbackend_lowering_absent,
        "expectedImportFragments": expected_import_fragments,
        "firstDiagnostic": first_response.get("diagnostic"),
        "firstImportDiagnostic": first_import.get("diagnostic"),
        "secondDiagnostic": second_response.get("diagnostic"),
        "secondImportDiagnostic": second_import.get("diagnostic"),
    }


def run_repeat_each_canonicalization_case(
    socket_path: str, output: Path
) -> dict:
    name = "repeat-each-empty-results"
    case_dir = output / name
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "source.py").write_text(REPEAT_EACH_CANONICALIZATION_CASE)

    responses: list[dict] = []
    workflows: list[bytes] = []
    imports: list[dict] = []
    imported_sources: list[str] = []
    source = REPEAT_EACH_CANONICALIZATION_CASE
    for generation in ("first", "second", "third"):
        response, data = compile_source(source, socket_path)
        responses.append(response)
        workflows.append(data)
        (case_dir / f"{generation}-response.json").write_text(
            json.dumps(response, indent=2, sort_keys=True) + "\n"
        )
        if data:
            (case_dir / f"{generation}.wflow").write_bytes(data)
        imported = import_workflow(data, socket_path) if data else {}
        imports.append(imported)
        imported_source = imported.get("python_code", "")
        imported_sources.append(imported_source)
        (case_dir / f"{generation}-import.json").write_text(
            json.dumps(imported, indent=2, sort_keys=True) + "\n"
        )
        (case_dir / f"{generation}-imported.py").write_text(imported_source)
        source = imported_source

    shapes = [action_shape(data) if data else [] for data in workflows]
    edges = [semantic_edges(data) if data else [] for data in workflows]
    output_pass_name = "ShortpyControlFlowOutputRepair"
    output_changes = [
        pass_change_count(response, output_pass_name)
        for response in responses
    ]
    initializer_repairs = [
        pass_output_int(response, output_pass_name, "initializer_repairs")
        for response in responses
    ]
    forwarding_removals = [
        pass_output_int(response, output_pass_name, "forwarding_removals")
        for response in responses
    ]
    forwarding_conversions = [
        pass_output_int(response, output_pass_name, "forwarding_conversions")
        for response in responses
    ]
    structural_none_removals = [
        pass_output_int(response, output_pass_name, "structural_none_removals")
        for response in responses
    ]
    constructors = [
        pass_output_field(response, output_pass_name, "constructor")
        for response in responses
    ]
    pass_orders_correct = all(
        pass_names(response) == EXPECTED_PASS_NAMES
        for response in responses
    )
    control_flow_plans_read_only = all(
        pass_change_count(response, "ShortpyControlFlowPlan") == 0
        for response in responses
    )
    list_counts = [
        list_action_count(data) if data else -1 for data in workflows
    ]
    lowering_counts = [
        len(response.get("pipeline", {}).get("repeatResultLowering", []))
        for response in responses
    ]
    first_canonicalization = all(
        fragment in imported_sources[0]
        for fragment in (
            "list = com_apple_shortcuts_list(",
            "repeat_results = []",
            "repeat_results.append(repeat_item)",
            "com_apple_shortcuts_get_variable(variable=repeat_results)",
        )
    )
    stable_canonicalization = (
        "repeat_results.append("
        "com_apple_shortcuts_get_variable(variable=repeat_item))"
        in imported_sources[1]
        and imported_sources[1] == imported_sources[2]
        and shapes[1] == shapes[2]
        and edges[1] == edges[2]
    )
    references_resolved = all(
        data and action_output_references_resolve(data)
        for data in workflows
    )
    ok = all(
        response.get("ok") for response in responses
    ) and all(
        imported.get("ok") for imported in imports
    ) and all(
        [
            output_changes == [1, 0, 0],
            initializer_repairs == [1, 0, 0],
            forwarding_removals == [0, 0, 0],
            forwarding_conversions == [0, 0, 0],
            structural_none_removals == [0, 0, 0],
            constructors == [
                "swift_allocBox+value_witnesses",
                "not-required",
                "not-required",
            ],
            pass_orders_correct,
            control_flow_plans_read_only,
            list_counts == [1, 1, 1],
            lowering_counts == [0, 0, 0],
            first_canonicalization,
            stable_canonicalization,
            references_resolved,
        ]
    )
    return {
        "name": name,
        "ok": ok,
        "nativeCanonicalizationExpected": True,
        "controlFlowOutputChanges": output_changes,
        "initializerOnlyRepeatRepairs": initializer_repairs,
        "repeatForwardingRemovals": forwarding_removals,
        "repeatForwardingConversions": forwarding_conversions,
        "structuralNoneRemovals": structural_none_removals,
        "constructors": constructors,
        "passOrderCorrect": pass_orders_correct,
        "controlFlowPlanReadOnly": control_flow_plans_read_only,
        "listActionCounts": list_counts,
        "repeatResultLoweringCounts": lowering_counts,
        "firstCanonicalizationCorrect": first_canonicalization,
        "stableCanonicalizationReached": stable_canonicalization,
        "actionOutputReferencesResolved": references_resolved,
        "firstActionCount": len(shapes[0]),
        "secondActionCount": len(shapes[1]),
        "thirdActionCount": len(shapes[2]),
        "firstToSecondShapeChanged": shapes[0] != shapes[1],
        "secondToThirdShapeStable": shapes[1] == shapes[2],
        "diagnostics": [
            response.get("diagnostic") for response in responses
        ],
        "importDiagnostics": [
            imported.get("diagnostic") for imported in imports
        ],
    }


def run_rejection_case(
    name: str,
    source: str,
    expected_diagnostics: list[str],
    socket_path: str,
    output: Path,
) -> dict:
    case_dir = output / name
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "source.py").write_text(source)
    response, data = compile_source(source, socket_path)
    (case_dir / "response.json").write_text(
        json.dumps(response, indent=2, sort_keys=True) + "\n"
    )
    diagnostic = response.get("diagnostic", "")
    diagnostic_matches = all(
        fragment in diagnostic for fragment in expected_diagnostics
    )
    ok = not response.get("ok") and not data and diagnostic_matches
    return {
        "name": name,
        "ok": ok,
        "expectedRejection": True,
        "payloadAbsent": not data,
        "diagnosticMatches": diagnostic_matches,
        "expectedDiagnosticFragments": expected_diagnostics,
        "diagnostic": diagnostic,
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
    ] + [
        run_repeat_each_canonicalization_case(args.socket, output)
    ] + [
        run_rejection_case(
            name, source, expected_diagnostics, args.socket, output
        )
        for name, (source, expected_diagnostics) in REJECTION_CASES.items()
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
