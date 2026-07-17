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
L_shortpy_backend_target:
    .quad 0

.globl _bridge_shortpy_backend_selectedTu
_bridge_shortpy_backend_selectedTu:
    .long _bridge_shortpy_backend_selected - _bridge_shortpy_backend_selectedTu
    .long 0

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

.globl _bridge_set_shortpy_backend_target
_bridge_set_shortpy_backend_target:
    adrp x8, L_shortpy_backend_target@PAGE
    str x0, [x8, L_shortpy_backend_target@PAGEOFF]
    adrp x8, _bridge_shortpy_backend_selectedTu@PAGE
    add x8, x8, _bridge_shortpy_backend_selectedTu@PAGEOFF
    str w1, [x8, #4]
    ret

.globl _bridge_shortpy_backend_selected
_bridge_shortpy_backend_selected:
    mov x20, x1
    adrp x16, L_shortpy_backend_target@PAGE
    ldr x16, [x16, L_shortpy_backend_target@PAGEOFF]
    br x16

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

.globl _bridge_fresh_tool_database
_bridge_fresh_tool_database:
    stp x20, x30, [sp, #-16]!
    mov x0, #0
    bl _$s7ToolKit0A8DatabaseCMa
    mov x20, x0
    bl _$s7ToolKit0A8DatabaseCACyKcfC
    ldp x20, x30, [sp], #16
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

.globl _bridge_python_to_ir_init
_bridge_python_to_ir_init:
    stp x19, x20, [sp, #-32]!
    stp x21, x30, [sp, #16]
    mov x19, x0
    mov x21, x1
    mov x0, x21
    bl _swift_retain
    mov x21, x0
    mov x0, #0
    bl _$s17ShortcutsLanguage10PythonToIRCMa
    mov x20, x0
    mov x0, x19
    mov x1, x21
    bl _$s17ShortcutsLanguage10PythonToIRC5flags8databaseAcA5FlagsV_7ToolKit0I8DatabaseCSgtcfC
    ldp x21, x30, [sp, #16]
    ldp x19, x20, [sp], #32
    ret

.globl _bridge_python_to_ir_visit
_bridge_python_to_ir_visit:
    stp x19, x20, [sp, #-48]!
    stp x21, x30, [sp, #16]
    str x22, [sp, #32]
    mov x8, x0
    mov x0, x1
    mov x1, x2
    mov x20, x3
    mov x21, #0
    bl _$s17ShortcutsLanguage10PythonToIRC5visityAA14FrontendResultVSSKF
    mov x0, x21
    ldr x22, [sp, #32]
    ldp x21, x30, [sp, #16]
    ldp x19, x20, [sp], #48
    ret

.globl _bridge_python_to_ir_visit_into_throwing
_bridge_python_to_ir_visit_into_throwing:
    stp x20, x30, [sp, #-16]!
    mov x8, x0
    mov x0, x1
    mov x1, x2
    mov x20, x3
    bl _$s17ShortcutsLanguage10PythonToIRC5visityAA14FrontendResultVSSKF
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_frontend_result_get_program
_bridge_frontend_result_get_program:
    stp x19, x20, [sp, #-32]!
    str x30, [sp, #16]
    mov x8, x0
    mov x20, x1
    bl _$s17ShortcutsLanguage14FrontendResultV7programAA9IRProgramVvg
    ldr x30, [sp, #16]
    ldp x19, x20, [sp], #32
    ret

.globl _bridge_frontend_result_get_error_policy_decisions
_bridge_frontend_result_get_error_policy_decisions:
    stp x20, x30, [sp, #-16]!
    mov x20, x0
    bl _$s17ShortcutsLanguage14FrontendResultV20errorPolicyDecisionsSayAA05ErrorF8DecisionVGvg
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_shortpy_ir_statement_id
_bridge_shortpy_ir_statement_id:
    stp x20, x30, [sp, #-16]!
    mov x20, x0
    bl _$s17ShortcutsLanguage11IRStatementO2idSivg
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_shortpy_swift_string_equal
_bridge_shortpy_swift_string_equal:
    mov x8, x1
    ldp x2, x3, [x8]
    ldp x0, x1, [x0]
    b _$sSS2eeoiySbSS_SStFZ

.globl _bridge_shortpy_source_referenced_get_value
_bridge_shortpy_source_referenced_get_value:
    stp x20, x30, [sp, #-16]!
    mov x8, x0
    mov x20, x1
    mov x0, x2
    bl _$s17ShortcutsLanguage16SourceReferencedV5valuexvg
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_ir_program_print
_bridge_ir_program_print:
    stp x20, x30, [sp, #-16]!
    mov x20, x0
    adrp x1, _$s17ShortcutsLanguage9IRProgramVAA11IRPrintableAAWP@GOTPAGE
    ldr x1, [x1, _$s17ShortcutsLanguage9IRProgramVAA11IRPrintableAAWP@GOTPAGEOFF]
    bl _$s17ShortcutsLanguage11IRPrintablePAAE13printToStringSSyF
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_ir_program_equal
_bridge_ir_program_equal:
    b _$s17ShortcutsLanguage9IRProgramV2eeoiySbAC_ACtFZ

.globl _bridge_control_flow_pass_init
_bridge_control_flow_pass_init:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    mov x0, x1
    bl _$s17ShortcutsLanguage30ControlFlowOutputInferencePassV5flagsAcA5FlagsV_tcfC
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_control_flow_pass_apply_once
_bridge_control_flow_pass_apply_once:
    stp x19, x20, [sp, #-48]!
    stp x21, x30, [sp, #16]
    str x22, [sp, #32]
    mov x20, x1
    mov x21, #0
    bl _$s17ShortcutsLanguage30ControlFlowOutputInferencePassV9applyOnce2onyAA9IRProgramVz_tKF
    mov x0, x21
    ldr x22, [sp, #32]
    ldp x21, x30, [sp, #16]
    ldp x19, x20, [sp], #48
    ret

.globl _bridge_control_flow_pass_apply_once_throwing
_bridge_control_flow_pass_apply_once_throwing:
    stp x20, x30, [sp, #-16]!
    mov x20, x1
    bl _$s17ShortcutsLanguage30ControlFlowOutputInferencePassV9applyOnce2onyAA9IRProgramVz_tKF
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_control_flow_pass_apply
_bridge_control_flow_pass_apply:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    adrp x2, _$s17ShortcutsLanguage30ControlFlowOutputInferencePassVAA6IRPassAAWP@GOTPAGE
    ldr x2, [x2, _$s17ShortcutsLanguage30ControlFlowOutputInferencePassVAA6IRPassAAWP@GOTPAGEOFF]
    bl _$s17ShortcutsLanguage6IRPassP5apply2onyAA9IRProgramVz_tKFTj
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_variable_inlining_pass_init
_bridge_variable_inlining_pass_init:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    mov x0, x1
    bl _$s17ShortcutsLanguage20VariableInliningPassV5flagsAcA5FlagsV_tcfC
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_variable_inlining_pass_apply_once
_bridge_variable_inlining_pass_apply_once:
    stp x19, x20, [sp, #-48]!
    stp x21, x30, [sp, #16]
    str x22, [sp, #32]
    mov x20, x1
    mov x21, #0
    bl _$s17ShortcutsLanguage20VariableInliningPassV9applyOnce2onyAA9IRProgramVz_tKF
    mov x0, x21
    ldr x22, [sp, #32]
    ldp x21, x30, [sp, #16]
    ldp x19, x20, [sp], #48
    ret

.globl _bridge_variable_inlining_pass_apply_once_throwing
_bridge_variable_inlining_pass_apply_once_throwing:
    stp x20, x30, [sp, #-16]!
    mov x20, x1
    bl _$s17ShortcutsLanguage20VariableInliningPassV9applyOnce2onyAA9IRProgramVz_tKF
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_variable_inlining_pass_apply
_bridge_variable_inlining_pass_apply:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    adrp x2, _$s17ShortcutsLanguage20VariableInliningPassVAA6IRPassAAWP@GOTPAGE
    ldr x2, [x2, _$s17ShortcutsLanguage20VariableInliningPassVAA6IRPassAAWP@GOTPAGEOFF]
    bl _$s17ShortcutsLanguage6IRPassP5apply2onyAA9IRProgramVz_tKFTj
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_drop_comments_pass_init
_bridge_drop_comments_pass_init:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    mov x8, x0
    mov x0, x1
    bl _$s17ShortcutsLanguage16DropCommentsPassV5flagsAcA5FlagsV_tcfC
    ldp x29, x30, [sp], #16
    ret

.globl _bridge_drop_comments_pass_apply
_bridge_drop_comments_pass_apply:
    stp x19, x20, [sp, #-48]!
    stp x21, x30, [sp, #16]
    str x22, [sp, #32]
    mov x20, x1
    mov x21, #0
    bl _$s17ShortcutsLanguage16DropCommentsPassV5apply2onyAA9IRProgramVz_tKF
    mov x0, x21
    ldr x22, [sp, #32]
    ldp x21, x30, [sp, #16]
    ldp x19, x20, [sp], #48
    ret

.globl _bridge_drop_comments_pass_apply_throwing
_bridge_drop_comments_pass_apply_throwing:
    stp x20, x30, [sp, #-16]!
    mov x20, x1
    bl _$s17ShortcutsLanguage16DropCommentsPassV5apply2onyAA9IRProgramVz_tKF
    ldp x20, x30, [sp], #16
    ret

.globl _bridge_drop_comments_pass_apply_native
_bridge_drop_comments_pass_apply_native:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    adrp x2, _$s17ShortcutsLanguage16DropCommentsPassVAA6IRPassAAWP@GOTPAGE
    ldr x2, [x2, _$s17ShortcutsLanguage16DropCommentsPassVAA6IRPassAAWP@GOTPAGEOFF]
    bl _$s17ShortcutsLanguage6IRPassP5apply2onyAA9IRProgramVz_tKFTj
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
