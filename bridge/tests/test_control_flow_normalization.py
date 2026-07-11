#!/usr/bin/env python3
import ast
import importlib.util
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
    nested = b"""def shortcut() -> None:
    repeat_results = []
    for repeat_index in range(2):
        repeat_results1 = []
        for repeat_index_2 in range(2):
            repeat_results1.append(repeat_index_2)
        repeat_results.append(repeat_results1)
    com_apple_shortcuts_combine_text(text=repeat_results)
"""
    normalized = bridgectl.normalize_nested_repeat_results(nested)
    assert normalized["rewritten"] is True
    rewritten = normalized["source"].decode("utf-8")
    assert len(rewritten.splitlines()) == len(nested.decode("utf-8").splitlines())
    assert "__shortpy_control_flow_value_1 = repeat_results1; " in rewritten
    assert "repeat_results.append(__shortpy_control_flow_value_1)" in rewritten
    assert len(normalized["report"]["transformations"]) == 1
    ast.parse(rewritten)

    collision = nested.replace(
        b"    repeat_results = []\n",
        b"    __shortpy_control_flow_value_1 = []\n    repeat_results = []\n",
    )
    normalized_collision = bridgectl.normalize_nested_repeat_results(collision)
    assert "__shortpy_control_flow_value_2 = repeat_results1; " in normalized_collision[
        "source"
    ].decode("utf-8")

    real_mutation = b"""def shortcut() -> None:
    real_values = []
    items = [1]
    for item in items:
        real_values.append(item)
    com_apple_shortcuts_combine_text(text=real_values)
"""
    unchanged = bridgectl.normalize_nested_repeat_results(real_mutation)
    assert unchanged["rewritten"] is False
    assert unchanged["source"] == real_mutation

    menu_and_conditional = b"""def shortcut() -> None:
    branch_results = []
    if True:
        branch_results.append("yes")
    else:
        branch_results.append("no")
    menu_results = []
    match shortcuts_builtin_choose(prompt=None):
        case "One":
            menu_results.append("one")
    com_apple_shortcuts_combine_text(text=branch_results)
    com_apple_shortcuts_combine_text(text=menu_results)
"""
    unchanged = bridgectl.normalize_nested_repeat_results(menu_and_conditional)
    assert unchanged["rewritten"] is False

    complete_branches = bridgectl.normalize_control_flow_source(
        menu_and_conditional
    )
    branch_source = complete_branches["source"].decode("utf-8")
    assert "branch_results = []" not in branch_source
    assert "menu_results = []" not in branch_source
    assert "branch_results = \"yes\"" in branch_source
    assert "menu_results = \"one\"" in branch_source

    conditional_chain = b"""def shortcut() -> None:
    results = []
    if value == 1:
        results.append("one")
    elif value == 2:
        results.append("two")
    else:
        results.append("other")
    consume(value=results)
"""
    normalized_chain = bridgectl.normalize_control_flow_source(conditional_chain)
    chain_source = normalized_chain["source"].decode("utf-8")
    assert "elif " not in chain_source
    assert "else:\n        if value == 2:" in chain_source
    assert "results = \"one\"" in chain_source
    assert "results = \"two\"" in chain_source
    assert "results = \"other\"" in chain_source
    ast.parse(chain_source)

    explicit_mutation = b"""def shortcut() -> None:
    values = []
    repeat_results = []
    for item in items:
        values.append(item)
        repeat_results.append(item)
    consume(value=values)
    consume(value=repeat_results)
"""
    normalized_mutation = bridgectl.normalize_control_flow_source(
        explicit_mutation
    )
    mutation_source = normalized_mutation["source"].decode("utf-8")
    assert "com_apple_shortcuts_set_variable(input=[]" in mutation_source
    assert "values.append(item)" in mutation_source
    assert (
        '__shortpy_variable_value_1 = com_apple_shortcuts_get_variable(variable="values"); '
        in mutation_source
    )
    assert "consume(value=__shortpy_variable_value_1)" in mutation_source
    ast.parse(mutation_source)

    imported = """def shortcut() -> None:
    list = []
    real_values = list
    for item in items:
        real_values.append(item)
    text = "real_values"
    variable = text
    consume(value=variable)
"""
    origins = [
        {
            "actionIdentifier": "is.workflow.actions.list",
            "actionParameters": {},
        },
        {
            "actionIdentifier": "is.workflow.actions.setvariable",
            "actionParameters": {"WFVariableName": "real_values"},
        },
        {
            "actionIdentifier": "is.workflow.actions.appendvariable",
            "actionParameters": {"WFVariableName": "real_values"},
        },
        {
            "actionIdentifier": "is.workflow.actions.gettext",
            "actionParameters": {"WFTextActionText": "real_values"},
        },
        {
            "actionIdentifier": "is.workflow.actions.getvariable",
            "actionParameters": {},
        },
    ]
    canonical, canonical_report = (
        bridgectl.canonicalize_imported_named_variables(imported, origins)
    )
    assert "real_values = []" in canonical
    assert 'text = "real_values"' not in canonical
    assert "variable = text" not in canonical
    assert "consume(value=real_values)" in canonical
    assert canonical_report["present"] is True

    aliases = b"""def shortcut() -> None:
    if value:
        inner_result = "yes"
    else:
        inner_result = "no"
    outer_result = inner_result
    consume(value=outer_result)
"""
    collapsed = bridgectl.normalize_variable_aliases(aliases)
    collapsed_source = collapsed["source"].decode("utf-8")
    assert "inner_result" not in collapsed_source
    assert 'outer_result = "yes"' in collapsed_source
    assert 'outer_result = "no"' in collapsed_source
    ast.parse(collapsed_source)

    print("control-flow-normalization-ok")


if __name__ == "__main__":
    main()
