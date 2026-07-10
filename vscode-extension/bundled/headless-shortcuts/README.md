# Headless Shortcuts

A macOS CLI for creating, editing, and deleting shortcuts directly in
`~/Library/Shortcuts/Shortcuts.sqlite`.

## Build

```sh
make
```

The binary is written to `build/headless-shortcuts`.

## Commands

```sh
# Create
build/headless-shortcuts create --plist workflow.plist --name "My Shortcut"

# Replace the complete workflow record while preserving its ID and name
build/headless-shortcuts edit --id UUID --plist workflow.plist

# Export the complete workflow record as an unsigned plist
build/headless-shortcuts export --id UUID --output workflow.plist

# Delete
build/headless-shortcuts delete --id UUID
```

Every command writes one compact JSON object to stdout:

```json
{"name":"My Shortcut","ok":true,"operation":"create","workflowID":"UUID"}
```

Exit codes are `0` for success, `1` for an operation failure, and `64` for
invalid arguments.

This tool uses Apple's private WorkflowKit APIs. It accepts unsigned workflow
plists, not signed `AEA1` `.shortcut` files.

Create and edit both parse the plist through
`WFWorkflowFile.recordRepresentationWithError:`. Editing saves that complete
`WFWorkflowRecord` against the existing workflow reference, so actions,
triggers, input/output classes, fallback behavior, icon data, and other record
metadata are handled by WorkflowKit rather than reconstructed as SQL. The only
derived value filled by the CLI is `actionCount`, which is not carried by the
workflow plist itself.
