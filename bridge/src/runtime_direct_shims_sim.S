.text
.p2align 2

.globl _bridge_make_error_configuration_empty
_bridge_make_error_configuration_empty:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    bl _$s17ShortcutsLanguage18ErrorConfigurationV5emptyACvgZ
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_make_tool_visibility_filter_any
_bridge_make_tool_visibility_filter_any:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    bl _$s7ToolKit0A16VisibilityFilterV3anyACvgZ
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_make_toolrenderer_compatibility_shims_default_none
_bridge_make_toolrenderer_compatibility_shims_default_none:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    bl _$s12ToolRenderer18CompatibilityShimsV11defaultNoneACvgZ
    ldp x29, x30, [sp], #16
    ret

.section __DATA,__data
.p2align 3
L_toolrenderer_python_interface_target:
    .quad 0
L_toolrenderer_filter_provider_default_target:
    .quad 0

.p2align 3
L_null_filter_provider_witness_table:
    .quad 0
    .quad _bridge_null_filter_provider_surrogate

.text
.p2align 2

.globl _bridge_set_toolrenderer_python_interface_target
_bridge_set_toolrenderer_python_interface_target:
    adrp x8, L_toolrenderer_python_interface_target@PAGE
    str x0, [x8, L_toolrenderer_python_interface_target@PAGEOFF]
    ret

.globl _bridge_toolrenderer_python_interface_selected
_bridge_toolrenderer_python_interface_selected:
    adrp x16, L_toolrenderer_python_interface_target@PAGE
    ldr x16, [x16, L_toolrenderer_python_interface_target@PAGEOFF]
    br x16

.section __TEXT,__const
.p2align 3
.globl _bridge_toolrenderer_python_interface_selectedTu
_bridge_toolrenderer_python_interface_selectedTu:
    .long _bridge_toolrenderer_python_interface_selected - _bridge_toolrenderer_python_interface_selectedTu
    .long 0x160

.text
.p2align 2

.globl _bridge_set_toolrenderer_filter_provider_default_target
_bridge_set_toolrenderer_filter_provider_default_target:
    adrp x8, L_toolrenderer_filter_provider_default_target@PAGE
    str x0, [x8, L_toolrenderer_filter_provider_default_target@PAGEOFF]
    ret

.globl _bridge_toolrenderer_filter_provider_default_selected
_bridge_toolrenderer_filter_provider_default_selected:
    adrp x16, L_toolrenderer_filter_provider_default_target@PAGE
    ldr x16, [x16, L_toolrenderer_filter_provider_default_target@PAGEOFF]
    br x16

.globl _bridge_null_filter_provider_witness_table_ptr
_bridge_null_filter_provider_witness_table_ptr:
    adrp x0, L_null_filter_provider_witness_table@PAGE
    add x0, x0, L_null_filter_provider_witness_table@PAGEOFF
    ret

.globl _bridge_null_filter_provider_surrogate
_bridge_null_filter_provider_surrogate:
    cbz x8, 2f
    mov x9, #0
    str x9, [x8]
    str x9, [x8, #8]
    str x9, [x8, #16]
    str x9, [x8, #24]
    str x9, [x8, #32]
    str x9, [x8, #40]
    str x9, [x8, #48]
    str x9, [x8, #56]
2:
    ret

.globl _bridge_shared_tool_database_provider_database
_bridge_shared_tool_database_provider_database:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x0
    bl _$s7ToolKit06SharedA16DatabaseProviderC8databaseAA0aD0CyKFTj
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_tool_embedding_database_query
_bridge_tool_embedding_database_query:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x3
    bl _$s14ShortcutsAgent21ToolEmbeddingDatabaseC5query_6limitsSDyAA0cD6RecordV0C4TypeVSaySd5score_SS10identifiertGGSS_SDyAISiGtKF
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_agent_toolbox_result_string_representation
_bridge_agent_toolbox_result_string_representation:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x0
    bl _$s14ShortcutsAgent0B7ToolboxV6ResultV20stringRepresentationSSvg
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_make_describe_agent_event_stream
_bridge_make_describe_agent_event_stream:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    adrp x0, L_describe_agent_event_subject_type@PAGE
    add x0, x0, L_describe_agent_event_subject_type@PAGEOFF
    mov x1, #83
    mov x2, #0
    mov x3, #0
    bl _swift_getTypeByMangledNameInContext2
    cbz x0, 1f
    mov x20, x0
    bl _$s7Combine18PassthroughSubjectCACyxq_GycfC
    b 2f
1:
    mov x0, #0
2:
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_find_entities_tool_call
_bridge_find_entities_tool_call:
    mov x4, x0
    mov x5, x1
    mov x6, x2
    mov x20, x3
    mov x0, x4
    mov x1, x5
    mov x2, x6
    b _$s14ShortcutsAgent16FindEntitiesToolV4call9arguments16agentEventStreamAC6OutputVAC9ArgumentsV_7Combine18PassthroughSubjectCyAA017DescribeAShortcutbI0Os5NeverOGtYaAC5ErrorOYKF

.globl _bridge_find_entities_tool_callTu
.set _bridge_find_entities_tool_callTu, _$s14ShortcutsAgent16FindEntitiesToolV4call9arguments16agentEventStreamAC6OutputVAC9ArgumentsV_7Combine18PassthroughSubjectCyAA017DescribeAShortcutbI0Os5NeverOGtYaAC5ErrorOYKFTu

.globl _bridge_find_entities_output_content
_bridge_find_entities_output_content:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x0
    bl _$s14ShortcutsAgent16FindEntitiesToolV6OutputV7contentSSvg
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_make_flags
_bridge_make_flags:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    mov x0, x1
    mov x1, x2
    mov w2, w3
    mov x3, x4
    mov w4, w5
    mov x5, x6
    bl _$s17ShortcutsLanguage5FlagsV10strictness8logLevel12dropComments18errorConfiguration23validateCatalogKeysOnly14toolVisibilityA2C10StrictnessO_AC03LogF0OSbAA05ErrorJ0VSb7ToolKit0tP6FilterVtcfC
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_compiled_shortcut_get_trigger
_bridge_compiled_shortcut_get_trigger:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x0
    bl _$s17ShortcutsLanguage16CompiledShortcutV7triggerSo25WFConfiguredTriggerRecordCSgvg
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_compiled_shortcut_get_workflow
_bridge_compiled_shortcut_get_workflow:
    stp x29, x30, [sp, #-32]!
    str x20, [sp, #16]
    mov x29, sp
    mov x20, x0
    bl _$s17ShortcutsLanguage16CompiledShortcutV8workflowSo10WFWorkflowCvg
    ldr x20, [sp, #16]
    ldp x29, x30, [sp], #32
    ret

.globl _bridge_describe_edit_mode_context_nil
_bridge_describe_edit_mode_context_nil:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    mov x0, x1
    mov x1, xzr
    mov x2, xzr
    mov x21, xzr
    bl _$s14ShortcutsAgent017DescribeAShortcutB0V15editModeContext3forAC04EditfG0VSo10WFWorkflowC_tKFZ
    mov x0, x21
    ldp x29, x30, [sp], #16
    ret

.section __TEXT,__cstring,cstring_literals
L_describe_agent_event_subject_type:
    .asciz "7Combine18PassthroughSubjectCy14ShortcutsAgent017DescribeAShortcutE5EventOs5NeverOG"
