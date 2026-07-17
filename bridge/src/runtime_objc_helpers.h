#ifndef SHORTCUTS_IDE_RUNTIME_OBJC_HELPERS_H
#define SHORTCUTS_IDE_RUNTIME_OBJC_HELPERS_H

#import <Foundation/Foundation.h>

#include <stdbool.h>
#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN

/* Swift imports this C/Objective-C ABI surface. Private Swift ABI shims remain
 * declared next to their typed storage in ShortcutsRuntimeDirectSim.swift. */

FOUNDATION_EXPORT void * _Nullable bridge_compiler_trace_begin(void)
    NS_SWIFT_NAME(bridgeCompilerTraceBegin());
FOUNDATION_EXPORT char * _Nullable bridge_compiler_trace_end(
    void * _Nullable capture, uint64_t *total_bytes, uint64_t *returned_bytes,
    bool *truncated) NS_SWIFT_NAME(bridgeCompilerTraceEnd(_:_:_:_:));

FOUNDATION_EXPORT id _Nullable bridge_objc_alloc_class(
    const char *class_name) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcAllocClass(_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_class_msg_send0(
    const char *class_name, const char *selector_name) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcClassMsgSend0(_:_:));
FOUNDATION_EXPORT BOOL bridge_objc_responds(
    id object, const char *selector_name)
    NS_SWIFT_NAME(bridgeObjcResponds(_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send0(
    id object, const char *selector_name) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcMsgSend0(_:_:));
FOUNDATION_EXPORT void bridge_objc_msg_send_void0(
    id object, const char *selector_name)
    NS_SWIFT_NAME(bridgeObjcMsgSendVoid0(_:_:));
FOUNDATION_EXPORT void bridge_objc_msg_send_void0_barrier_sync(
    id queue, id object, const char *selector_name)
    NS_SWIFT_NAME(bridgeObjcMsgSendVoid0BarrierSync(_:_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send1(
    id object, const char *selector_name, id _Nullable arg1)
    NS_RETURNS_NOT_RETAINED NS_SWIFT_NAME(bridgeObjcMsgSend1(_:_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send2(
    id object, const char *selector_name, id _Nullable arg1,
    id _Nullable arg2) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcMsgSend2(_:_:_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send3(
    id object, const char *selector_name, id _Nullable arg1,
    id _Nullable arg2, id _Nullable arg3) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcMsgSend3(_:_:_:_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send4(
    id object, const char *selector_name, id _Nullable arg1,
    id _Nullable arg2, id _Nullable arg3,
    id _Nullable arg4) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcMsgSend4(_:_:_:_:_:_:));
FOUNDATION_EXPORT id _Nullable bridge_objc_msg_send2_bool(
    id object, const char *selector_name, id _Nullable arg1,
    id _Nullable arg2, BOOL arg3) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeObjcMsgSend2Bool(_:_:_:_:_:));
FOUNDATION_EXPORT uint64_t bridge_objc_msg_send_uint64(
    id object, const char *selector_name)
    NS_SWIFT_NAME(bridgeObjcMsgSendUInt64(_:_:));
FOUNDATION_EXPORT void bridge_objc_msg_send_uint64_arg(
    id object, const char *selector_name, uint64_t arg1)
    NS_SWIFT_NAME(bridgeObjcMsgSendUInt64Arg(_:_:_:));

FOUNDATION_EXPORT id _Nullable bridge_shortpy_make_edit_export_workflow(
    id workflow, uint64_t *adapted_action_count) NS_RETURNS_NOT_RETAINED
    NS_SWIFT_NAME(bridgeShortpyMakeEditExportWorkflow(_:_:));
FOUNDATION_EXPORT const char * _Nullable
bridge_shortpy_edit_export_last_error(void)
    NS_SWIFT_NAME(bridgeShortpyEditExportLastError());
FOUNDATION_EXPORT bool
bridge_shortpy_replace_workflow_action_serialized_parameters(
    id workflow, uint64_t index, NSDictionary *serialized_parameters)
    NS_SWIFT_NAME(
        bridgeShortpyReplaceWorkflowActionSerializedParameters(_:_:_:));
FOUNDATION_EXPORT bool bridge_shortpy_repair_else_if_witnesses(
    id workflow, const void *plan, uint32_t *condition_repairs,
    uint32_t *else_insertions, uint32_t *witness_markers_removed)
    NS_SWIFT_NAME(bridgeShortpyRepairElseIfWitnesses(_:_:_:_:_:));
FOUNDATION_EXPORT const char * _Nullable
bridge_shortpy_else_if_repair_last_error(void)
    NS_SWIFT_NAME(bridgeShortpyElseIfRepairLastError());

NS_ASSUME_NONNULL_END

#endif
