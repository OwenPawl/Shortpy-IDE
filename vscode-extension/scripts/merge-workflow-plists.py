#!/usr/bin/env python3
"""Apply the structural delta from compiled Shortpy onto a host workflow plist."""

import argparse
import plistlib


MISSING = object()


def same(left, right):
    if left is MISSING or right is MISSING:
        return left is right
    return left == right


def item_identity(value):
    if not isinstance(value, dict):
        return None
    for key in ("WFWorkflowActionIdentifier", "WFTriggerIdentifier"):
        if key in value:
            return (key, value[key])
    return None


def mergeable_object_lists(base, local, host):
    if not (len(base) == len(local) == len(host)):
        return False
    for base_item, local_item, host_item in zip(base, local, host):
        identity = item_identity(base_item)
        if identity is None or item_identity(local_item) != identity or item_identity(host_item) != identity:
            return False
    return True


def apply_local_delta(base, local, host, preserve_keys=frozenset()):
    if same(local, base):
        return host
    if local is MISSING:
        return MISSING
    if base is MISSING or host is MISSING:
        return local
    if isinstance(base, dict) and isinstance(local, dict) and isinstance(host, dict):
        merged = {}
        for key in base.keys() | local.keys() | host.keys():
            if key in preserve_keys:
                if key in host:
                    merged[key] = host[key]
                continue
            value = apply_local_delta(
                base.get(key, MISSING),
                local.get(key, MISSING),
                host.get(key, MISSING),
                preserve_keys,
            )
            if value is not MISSING:
                merged[key] = value
        return merged
    if (
        isinstance(base, list)
        and isinstance(local, list)
        and isinstance(host, list)
        and mergeable_object_lists(base, local, host)
    ):
        return [
            apply_local_delta(base_item, local_item, host_item, preserve_keys)
            for base_item, local_item, host_item in zip(base, local, host)
        ]
    return local


def load(path):
    with open(path, "rb") as handle:
        return plistlib.load(handle)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--local", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--preserve-key", action="append", default=[])
    parser.add_argument("--preserve-root-key", action="append", default=[])
    args = parser.parse_args()

    base = load(args.base)
    local = load(args.local)
    host = load(args.host)
    merged = apply_local_delta(base, local, host, frozenset(args.preserve_key))
    if isinstance(merged, dict) and isinstance(host, dict):
        for key in args.preserve_root_key:
            if key in host:
                merged[key] = host[key]
            else:
                merged.pop(key, None)
    with open(args.output, "wb") as handle:
        plistlib.dump(merged, handle, fmt=plistlib.FMT_BINARY, sort_keys=True)


if __name__ == "__main__":
    main()
