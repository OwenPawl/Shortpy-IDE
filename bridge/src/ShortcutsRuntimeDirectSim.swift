import Darwin
import Combine
import Dispatch
import Foundation
import ObjectiveC

private struct CompiledShortcut {
    var trigger: UInt64 = 0
    var workflow: UInt64 = 0
    var errorPolicyDecisions: UInt64 = 0
}

private struct FrontendResultStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
}

private struct IRProgramStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
}

private struct IRPassStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
}

@_silgen_name("bridge_shortpy_array_remove_last_generic")
@inline(never)
public func bridgeShortpyArrayRemoveLastGeneric<Element>(
    _ array: inout [Element]
) {
    array.removeLast()
}

private struct ErrorPolicyDecision {
    let inputDescription: String
    let outputDescription: String?
    let debugLog: [String]
}

private struct FlagsStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
    var w4: UInt64 = 0
    var w5: UInt64 = 0
    var w6: UInt64 = 0
    var w7: UInt64 = 0
    var w8: UInt64 = 0
    var w9: UInt64 = 0
    var w10: UInt64 = 0
    var w11: UInt64 = 0
    var w12: UInt64 = 0
    var w13: UInt64 = 0
    var w14: UInt64 = 0
    var w15: UInt64 = 0
}

private struct EditModeContextStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
}

private struct ErrorConfigurationStorage {
    var w0: UInt64 = 0
}

private struct ToolVisibilityFlagStorage {
    var rawValue: UInt64 = 0
}

private struct ToolVisibilityFilterStorage {
    var w0: UInt64 = 0
}

private final class ResultBox: @unchecked Sendable {
    var payload = ""
}

private final class ThrowingResultBox<T>: @unchecked Sendable {
    var result: Result<T, Error>?
}

private struct WorkflowFileDataPayload {
    let data: Data
    let fileSummary: [String: Any]
    let rootSummary: [String: Any]
    let actionsSummary: [String: Any]
    let triggersSummary: [String: Any]
}

private struct PythonExportResult {
    let python: String
    let proxy: AnyObject
    let context: EditModeContextStorage
    let pipeline: RuntimePipeline
    let adaptedActionCount: UInt64
}

private let recordFileNativeRetentionLock = NSLock()
private var recordFileNativeRetention: [AnyObject] = []

private func retainRecordFileNativeObjects(_ objects: [AnyObject?]) {
    recordFileNativeRetentionLock.lock()
    for object in objects {
        if let object {
            recordFileNativeRetention.append(object)
        }
    }
    appendRecordFileProbeStage("retained native object count=\(recordFileNativeRetention.count)")
    recordFileNativeRetentionLock.unlock()
}

private final class ImportedPythonContext: @unchecked Sendable {
    let source: String
    let originalData: Data
    let rootSummary: [String: Any]
    let proxyCatalog: AnyObject?
    let proxyCatalogSelector: String?

    init(
        source: String,
        originalData: Data,
        rootSummary: [String: Any],
        proxyCatalog: AnyObject?,
        proxyCatalogSelector: String?
    ) {
        self.source = source
        self.originalData = originalData
        self.rootSummary = rootSummary
        self.proxyCatalog = proxyCatalog
        self.proxyCatalogSelector = proxyCatalogSelector
    }
}

private let importedPythonContextLock = NSLock()
private var importedPythonContextHistory: [ImportedPythonContext] = []
private var latestImportedPythonContext: ImportedPythonContext?

private struct RuntimeBridgeError: Error, CustomStringConvertible {
    let description: String
}

private enum RuntimePipeline: UInt64 {
    case native = 0
    case shortpy = 1

    var name: String {
        switch self {
        case .native: return "native"
        case .shortpy: return "shortpy"
        }
    }

    static func decode(_ rawValue: UInt64) throws -> RuntimePipeline {
        guard let pipeline = RuntimePipeline(rawValue: rawValue) else {
            throw RuntimeBridgeError(
                description: "unsupported runtime pipeline \(rawValue); expected native or shortpy"
            )
        }
#if !SHORTPY_PIPELINE
        if pipeline == .shortpy {
            throw RuntimeBridgeError(
                description: "shortpy runtime pipeline is unavailable in this native-only bridge build"
            )
        }
#endif
        return pipeline
    }
}

private struct CompileRun {
    let catalog: AnyObject
    let catalogSource: String
    let strictness: UInt8
    let logLevel: UInt8
    let errorConfiguration: ErrorConfigurationStorage
    let toolVisibility: ToolVisibilityFilterStorage
    let flagsStorage: FlagsStorage
    let compiled: CompiledShortcut
}

private struct CompilerFlagsContext {
    var strictness = UInt8(0)
    var logLevel = UInt8(0)
    var errorConfiguration = ErrorConfigurationStorage()
    var toolVisibility = ToolVisibilityFilterStorage()
    var flags = FlagsStorage()
}

private struct ShortpyPassReport {
    let name: String
    let calls: Int
    let changes: Int
    let input: String
    let output: String

    var json: [String: Any] {
        [
            "name": name,
            "calls": calls,
            "changes": changes,
            "input": input,
            "output": output,
        ]
    }
}

private struct ShortpyRecurrencePlan {
    let controlKind: UInt32
    let targetBranches: [Int]
    let seedBranches: [Int]

    var json: [String: Any] {
        [
            "controlKind": controlKind == 1 ? "conditional" : "match",
            "targetBranches": targetBranches,
            "seedBranches": seedBranches,
        ]
    }
}

private struct ShortpyCompileRun {
    let catalog: AnyObject
    let catalogSource: String
    let flags: CompilerFlagsContext
    let compiled: CompiledShortcut
    let frontendIR: String
    let finalIR: String
    let passes: [ShortpyPassReport]
    let recurrencePlans: [ShortpyRecurrencePlan]
    let frontendPolicyDecisions: [ErrorPolicyDecision]
    let backendContextSize: UInt32
    let backendConformance: UnsafeRawPointer
}

private struct PipelineCompileRun {
    let pipeline: RuntimePipeline
    let catalog: AnyObject
    let catalogSource: String
    let compiled: CompiledShortcut
    let recurrencePlans: [ShortpyRecurrencePlan]
    let policyDecisions: [[String: Any]]
    let details: [String: Any]
}

private struct AgentToolboxStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
    var w4: UInt64 = 0
    var w5: UInt64 = 0
    var w6: UInt64 = 0
    var w7: UInt64 = 0
}

private struct AgentToolboxResultStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
    var w4: UInt64 = 0
    var w5: UInt64 = 0
}

private struct ToolEmbeddingRecordToolTypeStorage: Hashable {
    var rawValue: Int64 = 0
}

private struct CompatibilityShimsStorage {
    var rawValue: UInt64 = 0
}

private struct ProtocolExistentialStorage {
    var buffer0: UInt64 = 0
    var buffer1: UInt64 = 0
    var buffer2: UInt64 = 0
    var type: UInt64 = 0
    var witness: UInt64 = 0
}

private struct FindEntitiesToolStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
    var w2: UInt64 = 0
    var w3: UInt64 = 0
    var w4: UInt64 = 0
    var w5: UInt64 = 0
}

private struct FindEntitiesArgumentsStorage {
    var methodName: String = ""
    var methodParameterName: String = ""
    var methodParameterType: String = ""
    var query: String = ""
}

private struct FindEntitiesOutputStorage {
    var w0: UInt64 = 0
    var w1: UInt64 = 0
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

private struct ResolveEntityRequestInput: Decodable {
    let query: String
    let methodName: String
    let methodParameterName: String
    let methodParameterType: String
    let workflowID: String
    let debugNativeFindEntities: Bool

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)

        func stringValue(
            _ key: String,
            fallbackKeys: [String] = [],
            required: Bool = true,
            default defaultValue: String = ""
        ) throws -> String {
            for candidate in [key] + fallbackKeys {
                guard let codingKey = DynamicCodingKey(stringValue: candidate) else {
                    continue
                }
                if let value = try? container.decode(String.self, forKey: codingKey) {
                    return value
                }
                if let value = try? container.decode(Int.self, forKey: codingKey) {
                    return String(value)
                }
                if let value = try? container.decode(Double.self, forKey: codingKey) {
                    return String(value)
                }
            }
            if required {
                throw DecodingError.keyNotFound(
                    DynamicCodingKey(stringValue: key)!,
                    DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Missing required string field \(key)")
                )
            }
            return defaultValue
        }

        func boolValue(_ key: String, default defaultValue: Bool = false) -> Bool {
            guard let codingKey = DynamicCodingKey(stringValue: key) else {
                return defaultValue
            }
            if let value = try? container.decode(Bool.self, forKey: codingKey) {
                return value
            }
            if let value = try? container.decode(String.self, forKey: codingKey) {
                return ["1", "true", "yes", "native"].contains(value.lowercased())
            }
            if let value = try? container.decode(Int.self, forKey: codingKey) {
                return value != 0
            }
            return defaultValue
        }

        self.query = try stringValue("query")
        self.methodName = try stringValue(
            "method_name",
            fallbackKeys: ["methodName"],
            required: false
        )
        self.methodParameterName = try stringValue(
            "method_parameter_name",
            fallbackKeys: ["methodParameterName"],
            required: false
        )
        self.methodParameterType = try stringValue(
            "method_parameter_type",
            fallbackKeys: ["methodParameterType", "type_name", "typeName"]
        )
        self.workflowID = try stringValue(
            "workflow_id",
            fallbackKeys: ["workflowID"],
            required: false
        )
        self.debugNativeFindEntities = boolValue("debug_native_find_entities")
    }
}

@_silgen_name("$s14ShortcutsAgent017DescribeAShortcutB0V13configuration10workflowID18groundTruthEntries14initialCatalogAcA0B13ConfigurationV_SSSgSDySSSo016WFParameterStateL5EntryCGSgSo0noL0CtKcfcfA2_")
private func defaultInitialCatalog() -> AnyObject

@_silgen_name("$s7ToolKit06SharedA16DatabaseProviderC6sharedACvgZ")
private func sharedToolDatabaseProvider() -> AnyObject

@_silgen_name("bridge_fresh_tool_database")
private func freshToolDatabase() throws -> AnyObject

@_silgen_name("bridge_shared_tool_database_provider_database")
private func bridgeSharedToolDatabaseProviderDatabase(_ provider: AnyObject) throws -> AnyObject

@_silgen_name("bridge_make_toolrenderer_compatibility_shims_default_none")
private func bridgeMakeToolRendererCompatibilityShimsDefaultNone(
    _ result: UnsafeMutablePointer<CompatibilityShimsStorage>
)

private struct ToolRendererPythonInterfaceResult {
    let interface: String
    let symbol: String
    let defaultArgumentSymbol: String?
    let filterProvider: ProtocolExistentialStorage
}

private let toolRendererPythonInterfaceRequiredFilterSymbol = "$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pAA09ParameteriG0_pAA18CompatibilityShimsVtYaKF"
private let toolRendererPythonInterfaceOptionalFilterSymbol = "$s12ToolRenderer15pythonInterface8database14filterProvider017parameterMetadataG05shimsSS0A3Kit0A8DatabaseC_AA21FilterActionSurrogateV0G0_pSgAA09ParameteriG0_pAA18CompatibilityShimsVtYaKF"

@_silgen_name("bridge_set_toolrenderer_python_interface_target")
private func bridgeSetToolRendererPythonInterfaceTarget(_ target: UnsafeRawPointer)

@_silgen_name("bridge_toolrenderer_python_interface_selected")
private func bridgeToolRendererPythonInterfaceSelected(
    _ database: AnyObject,
    _ filterProvider: ProtocolExistentialStorage,
    _ parameterMetadataProvider: ProtocolExistentialStorage,
    _ shims: UnsafePointer<CompatibilityShimsStorage>
) async throws -> String

@_silgen_name("bridge_set_toolrenderer_filter_provider_default_target")
private func bridgeSetToolRendererFilterProviderDefaultTarget(_ target: UnsafeRawPointer)

@_silgen_name("bridge_toolrenderer_filter_provider_default_selected")
private func bridgeToolRendererFilterProviderDefaultSelected() -> ProtocolExistentialStorage

@_silgen_name("bridge_null_filter_provider_witness_table_ptr")
private func bridgeNullFilterProviderWitnessTablePointer() -> UnsafeRawPointer

@_silgen_name("$s11WorkflowKit27WFParameterMetadataProviderVMa")
private func wfParameterMetadataProviderMetadata(_ request: Int) -> UnsafeRawPointer

@_silgen_name("bridge_swift_get_witness_table")
private func bridgeSwiftGetWitnessTable(
    _ conformance: UnsafeRawPointer,
    _ type: UnsafeRawPointer,
    _ instantiationArgs: UnsafeRawPointer?
) -> UnsafeRawPointer

@_silgen_name("bridge_dlsym_default")
private func bridgeDlsymDefault(_ symbolName: UnsafePointer<CChar>) -> UnsafeMutableRawPointer?

@_silgen_name("bridge_resolve_shortcuts_language_ir_backend")
private func bridgeResolveShortcutsLanguageIRBackend(
    _ contextSize: UnsafeMutablePointer<UInt32>,
    _ conformance: UnsafeMutablePointer<UnsafeRawPointer?>
) -> UnsafeMutableRawPointer?

@_silgen_name("bridge_set_shortpy_backend_target")
private func bridgeSetShortpyBackendTarget(
    _ target: UnsafeRawPointer,
    _ contextSize: UInt32
)

@_silgen_name("bridge_shortpy_backend_selected")
private func bridgeShortpyBackendSelected(
    _ program: UnsafePointer<IRProgramStorage>,
    _ backend: UnsafeMutableRawPointer
) async throws -> CompiledShortcut

@_silgen_name("bridge_create_shortcuts_language_ir_backend")
private func bridgeCreateShortcutsLanguageIRBackend(
    _ flags: UnsafePointer<FlagsStorage>,
    _ catalog: AnyObject,
    _ database: AnyObject,
    _ toolVisibility: UnsafePointer<ToolVisibilityFilterStorage>
) -> UnsafeMutableRawPointer?

@_silgen_name("bridge_destroy_shortcuts_language_ir_backend")
private func bridgeDestroyShortcutsLanguageIRBackend(
    _ backend: UnsafeMutableRawPointer
)

@_silgen_name("bridge_shortpy_ir_backend_last_error")
private func bridgeShortpyIRBackendLastError() -> UnsafePointer<CChar>?

@_silgen_name("bridge_python_to_ir_init")
private func bridgePythonToIRInit(
    _ flags: UnsafePointer<FlagsStorage>,
    _ database: AnyObject?
) -> AnyObject

@_silgen_name("bridge_python_to_ir_visit")
private func bridgePythonToIRVisit(
    _ result: UnsafeMutablePointer<FrontendResultStorage>,
    _ source: String,
    _ frontend: AnyObject
) -> UnsafeRawPointer?

@_silgen_name("bridge_python_to_ir_visit_into_throwing")
private func bridgePythonToIRVisitIntoThrowing(
    _ result: UnsafeMutablePointer<FrontendResultStorage>,
    _ source: String,
    _ frontend: AnyObject
) throws

@_silgen_name("bridge_frontend_result_get_program")
private func bridgeFrontendResultGetProgram(
    _ result: UnsafeMutablePointer<IRProgramStorage>,
    _ frontendResult: UnsafePointer<FrontendResultStorage>
)

@_silgen_name("bridge_frontend_result_get_error_policy_decisions")
private func bridgeFrontendResultGetErrorPolicyDecisions(
    _ frontendResult: UnsafePointer<FrontendResultStorage>
) -> [ErrorPolicyDecision]

@_silgen_name("bridge_destroy_shortcuts_language_frontend_result")
private func bridgeDestroyFrontendResult(
    _ frontendResult: UnsafeMutablePointer<FrontendResultStorage>
)

@_silgen_name("bridge_ir_program_print")
private func bridgeIRProgramPrint(_ program: UnsafePointer<IRProgramStorage>) -> String

@_silgen_name("bridge_ir_program_equal")
private func bridgeIRProgramEqual(
    _ lhs: UnsafePointer<IRProgramStorage>,
    _ rhs: UnsafePointer<IRProgramStorage>
) -> Bool

@_silgen_name("bridge_copy_shortcuts_language_ir_program")
private func bridgeCopyIRProgram(
    _ destination: UnsafeMutablePointer<IRProgramStorage>,
    _ source: UnsafePointer<IRProgramStorage>
) -> Bool

@_silgen_name("bridge_destroy_shortcuts_language_ir_program")
private func bridgeDestroyIRProgram(_ program: UnsafeMutablePointer<IRProgramStorage>)

@_silgen_name("bridge_shortpy_capture_control_flow_bindings")
private func bridgeShortpyCaptureControlFlowBindings(
    _ program: UnsafeMutablePointer<IRProgramStorage>
) -> UnsafeMutableRawPointer?

@_silgen_name("bridge_shortpy_destroy_control_flow_bindings")
private func bridgeShortpyDestroyControlFlowBindings(
    _ bindings: UnsafeMutableRawPointer
)

@_silgen_name("bridge_shortpy_control_flow_binding_count")
private func bridgeShortpyControlFlowBindingCount(
    _ bindings: UnsafeRawPointer
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_binding_count")
private func bridgeShortpyRecurrenceBindingCount(
    _ bindings: UnsafeRawPointer
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_control_kind")
private func bridgeShortpyRecurrenceControlKind(
    _ bindings: UnsafeRawPointer,
    _ recurrenceIndex: UInt32
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_target_branch_count")
private func bridgeShortpyRecurrenceTargetBranchCount(
    _ bindings: UnsafeRawPointer,
    _ recurrenceIndex: UInt32
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_target_branch_at")
private func bridgeShortpyRecurrenceTargetBranchAt(
    _ bindings: UnsafeRawPointer,
    _ recurrenceIndex: UInt32,
    _ branchIndex: UInt32
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_seed_branch_count")
private func bridgeShortpyRecurrenceSeedBranchCount(
    _ bindings: UnsafeRawPointer,
    _ recurrenceIndex: UInt32
) -> UInt32

@_silgen_name("bridge_shortpy_recurrence_seed_branch_at")
private func bridgeShortpyRecurrenceSeedBranchAt(
    _ bindings: UnsafeRawPointer,
    _ recurrenceIndex: UInt32,
    _ branchIndex: UInt32
) -> UInt32

@_silgen_name("bridge_shortpy_prepare_loop_carried_recurrences")
private func bridgeShortpyPrepareLoopCarriedRecurrences(
    _ program: UnsafeMutablePointer<IRProgramStorage>,
    _ bindings: UnsafeRawPointer,
    _ changeCount: UnsafeMutablePointer<UInt32>
) -> Int32

@_silgen_name("bridge_shortpy_rewrite_nested_control_flow_results")
private func bridgeShortpyRewriteNestedControlFlowResults(
    _ program: UnsafeMutablePointer<IRProgramStorage>,
    _ bindings: UnsafeRawPointer,
    _ changeCount: UnsafeMutablePointer<UInt32>
) -> Int32

@_silgen_name("bridge_shortpy_ir_adapter_last_error")
private func bridgeShortpyIRAdapterLastError() -> UnsafePointer<CChar>?

@_silgen_name("bridge_shortpy_ir_adapter_last_trace")
private func bridgeShortpyIRAdapterLastTrace() -> UnsafePointer<CChar>?

@_silgen_name("bridge_control_flow_pass_init")
private func bridgeControlFlowPassInit(
    _ result: UnsafeMutablePointer<IRPassStorage>,
    _ flags: UnsafePointer<FlagsStorage>
)

@_silgen_name("bridge_control_flow_pass_apply_once")
private func bridgeControlFlowPassApplyOnce(
    _ program: UnsafeMutablePointer<IRProgramStorage>,
    _ pass: UnsafePointer<IRPassStorage>
) -> UnsafeRawPointer?

@_silgen_name("bridge_control_flow_pass_apply_once_throwing")
private func bridgeControlFlowPassApplyOnceThrowing(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("bridge_control_flow_pass_apply")
private func bridgeControlFlowPassApply(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("bridge_variable_inlining_pass_init")
private func bridgeVariableInliningPassInit(
    _ result: UnsafeMutablePointer<IRPassStorage>,
    _ flags: UnsafePointer<FlagsStorage>
)

@_silgen_name("bridge_variable_inlining_pass_apply_once")
private func bridgeVariableInliningPassApplyOnce(
    _ program: UnsafeMutablePointer<IRProgramStorage>,
    _ pass: UnsafePointer<IRPassStorage>
) -> UnsafeRawPointer?

@_silgen_name("bridge_variable_inlining_pass_apply_once_throwing")
private func bridgeVariableInliningPassApplyOnceThrowing(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("bridge_variable_inlining_pass_apply")
private func bridgeVariableInliningPassApply(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("bridge_drop_comments_pass_init")
private func bridgeDropCommentsPassInit(
    _ result: UnsafeMutablePointer<IRPassStorage>,
    _ flags: UnsafePointer<FlagsStorage>
)

@_silgen_name("bridge_drop_comments_pass_apply")
private func bridgeDropCommentsPassApply(
    _ program: UnsafeMutablePointer<IRProgramStorage>,
    _ pass: UnsafePointer<IRPassStorage>
) -> UnsafeRawPointer?

@_silgen_name("bridge_drop_comments_pass_apply_throwing")
private func bridgeDropCommentsPassApplyThrowing(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("bridge_drop_comments_pass_apply_native")
private func bridgeDropCommentsPassApplyNative(
    _ program: inout IRProgramStorage,
    _ pass: UnsafePointer<IRPassStorage>
) throws

@_silgen_name("$s14ShortcutsAgent0B7ToolboxV29alwaysIncludedToolIdentifiersACShySSG_tKcfC")
private func agentToolboxInit(alwaysIncludedToolIdentifiers: Set<String>) throws -> AgentToolboxStorage

@_silgen_name("$s14ShortcutsAgent0B7ToolboxV29alwaysIncludedToolIdentifiersACShySSG_tKcfcfA_")
private func agentToolboxDefaultAlwaysIncludedToolIdentifiers() -> Set<String>

@_silgen_name("$s14ShortcutsAgent0B7ToolboxV5query_6limitsAC6ResultVSS_SDyAA19ToolEmbeddingRecordV0G4TypeVSiGtYaKF")
private func agentToolboxQuery(
    _ query: String,
    _ limits: [ToolEmbeddingRecordToolTypeStorage: Int],
    _ toolbox: AgentToolboxStorage
) async throws -> AgentToolboxResultStorage

@_silgen_name("$s14ShortcutsAgent0B7ToolboxV6ResultV20stringRepresentationSSvg")
private func agentToolboxResultStringRepresentation(_ result: AgentToolboxResultStorage) -> String

@_silgen_name("bridge_agent_toolbox_result_string_representation")
private func bridgeAgentToolboxResultStringRepresentation(
    _ result: UnsafePointer<AgentToolboxResultStorage>
) -> String

@_silgen_name("bridge_tool_embedding_database_query")
private func bridgeToolEmbeddingDatabaseQuery(
    _ query: String,
    _ limits: [ToolEmbeddingRecordToolTypeStorage: Int],
    _ database: AnyObject
) throws -> [ToolEmbeddingRecordToolTypeStorage: [(score: Double, identifier: String)]]

@_silgen_name("$s14ShortcutsAgent16FindEntitiesToolV12toolDatabase7catalog10workflowID18groundTruthEntriesAC0E3Kit0eG0C_So23WFParameterStateCatalogCSSSgSDySSSo0opQ5EntryCGSgtcfC")
private func findEntitiesToolInit(
    _ toolDatabase: AnyObject,
    _ catalog: AnyObject,
    _ workflowID: String?,
    _ groundTruthEntries: [String: AnyObject]?
) -> FindEntitiesToolStorage

@_silgen_name("$s14ShortcutsAgent16FindEntitiesToolV9ArgumentsV11method_name0g11_parameter_H00g1_I5_type5queryAESS_S3StcfC")
private func findEntitiesArgumentsInit(
    _ methodName: String,
    _ methodParameterName: String,
    _ methodParameterType: String,
    _ query: String
) -> FindEntitiesArgumentsStorage

@_silgen_name("$s14ShortcutsAgent16FindEntitiesToolV4call9arguments16agentEventStreamAC6OutputVAC9ArgumentsV_7Combine18PassthroughSubjectCyAA017DescribeAShortcutbI0Os5NeverOGtYaAC5ErrorOYKF")
private func findEntitiesToolCall(
    _ arguments: FindEntitiesArgumentsStorage,
    _ agentEventStream: AnyObject,
    _ tool: FindEntitiesToolStorage
) async throws -> FindEntitiesOutputStorage

@_silgen_name("bridge_find_entities_output_content")
private func findEntitiesOutputContent(_ output: inout FindEntitiesOutputStorage) -> String

@_silgen_name("bridge_make_describe_agent_event_stream")
private func bridgeMakeDescribeAgentEventStream() -> AnyObject

@_silgen_name("bridge_describe_edit_mode_context_nil")
private func bridgeDescribeEditModeContextNil(
    _ result: UnsafeMutablePointer<EditModeContextStorage>,
    _ workflow: AnyObject
) -> UnsafeRawPointer?

@_silgen_name("$s17ShortcutsLanguage16pythonToShortcut6source5flags7catalogAA08CompiledE0VSS_AA5FlagsVSo23WFParameterStateCatalogCtYaKF")
private func pythonToShortcut(
    _ result: UnsafeMutablePointer<CompiledShortcut>,
    _ source: String,
    _ flagsContext: UnsafeMutablePointer<FlagsStorage>,
    _ catalog: AnyObject
) async throws

@_silgen_name("bridge_compiled_shortcut_get_trigger")
private func bridgeCompiledShortcutGetTrigger(_ compiled: UnsafePointer<CompiledShortcut>) -> AnyObject?

@_silgen_name("bridge_compiled_shortcut_get_workflow")
private func bridgeCompiledShortcutGetWorkflow(_ compiled: UnsafePointer<CompiledShortcut>) -> AnyObject

@_silgen_name("$sSo21WFPythonWorkflowProxyC0B3KitE6encode7catalog0E38DeserializationValuesWithJustification10Foundation4DataVSo23WFParameterStateCatalogC_s12StaticStringVSgtKFZ")
private func pythonWorkflowProxyEncodeCatalog(
    _ catalog: AnyObject,
    _ encodeDeserializationValuesWithJustification: StaticString?
) throws -> Data

@_silgen_name("$sSo21WFPythonWorkflowProxyC0B3KitE13decodeCatalog4fromSo016WFParameterStateF0C10Foundation4DataV_tKFZ")
private func pythonWorkflowProxyDecodeCatalog(_ data: Data) throws -> AnyObject

@_silgen_name("bridge_make_error_configuration_empty")
private func bridgeMakeErrorConfigurationEmpty(
    _ result: UnsafeMutablePointer<ErrorConfigurationStorage>
)

@_silgen_name("bridge_make_tool_visibility_filter_any")
private func bridgeMakeToolVisibilityFilterAny(
    _ result: UnsafeMutablePointer<ToolVisibilityFilterStorage>
)

@_silgen_name("bridge_make_flags")
private func bridgeMakeFlags(
    _ result: UnsafeMutablePointer<FlagsStorage>,
    _ strictness: UnsafePointer<UInt8>,
    _ logLevel: UnsafePointer<UInt8>,
    _ dropComments: Bool,
    _ errorConfiguration: UnsafePointer<ErrorConfigurationStorage>,
    _ validateCatalogKeysOnly: Bool,
    _ toolVisibility: UnsafePointer<ToolVisibilityFilterStorage>
)

@_silgen_name("bridge_objc_alloc_class")
private func bridgeObjcAllocClass(_ className: UnsafePointer<CChar>) -> AnyObject?

@_silgen_name("bridge_objc_class_msg_send0")
private func bridgeObjcClassMsgSend0(
    _ className: UnsafePointer<CChar>,
    _ selectorName: UnsafePointer<CChar>
) -> AnyObject?

@_silgen_name("bridge_objc_responds")
private func bridgeObjcResponds(_ object: AnyObject, _ selectorName: UnsafePointer<CChar>) -> Bool

@_silgen_name("bridge_objc_msg_send0")
private func bridgeObjcMsgSend0(_ object: AnyObject, _ selectorName: UnsafePointer<CChar>) -> AnyObject?

@_silgen_name("bridge_objc_msg_send_void0")
private func bridgeObjcMsgSendVoid0(_ object: AnyObject, _ selectorName: UnsafePointer<CChar>)

@_silgen_name("bridge_objc_msg_send_void0_barrier_sync")
private func bridgeObjcMsgSendVoid0BarrierSync(
    _ queue: AnyObject,
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>
)

@_silgen_name("bridge_objc_msg_send1")
private func bridgeObjcMsgSend1(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: AnyObject?
) -> AnyObject?

@_silgen_name("bridge_objc_msg_send2")
private func bridgeObjcMsgSend2(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?
) -> AnyObject?

@_silgen_name("bridge_objc_msg_send3")
private func bridgeObjcMsgSend3(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: AnyObject?
) -> AnyObject?

@_silgen_name("bridge_objc_msg_send4")
private func bridgeObjcMsgSend4(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: AnyObject?,
    _ arg4: AnyObject?
) -> AnyObject?

@_silgen_name("bridge_objc_msg_send2_bool")
private func bridgeObjcMsgSend2Bool(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: Bool
) -> AnyObject?

@_silgen_name("bridge_objc_msg_send_uint64")
private func bridgeObjcMsgSendUInt64(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>
) -> UInt64

@_silgen_name("bridge_objc_msg_send_uint64_arg")
private func bridgeObjcMsgSendUInt64Arg(
    _ object: AnyObject,
    _ selectorName: UnsafePointer<CChar>,
    _ arg1: UInt64
)

@_silgen_name("bridge_shortpy_make_edit_export_workflow")
private func bridgeShortpyMakeEditExportWorkflow(
    _ workflow: AnyObject,
    _ adaptedActionCount: UnsafeMutablePointer<UInt64>
) -> AnyObject?

@_silgen_name("bridge_shortpy_replace_workflow_action_serialized_parameters")
private func bridgeShortpyReplaceWorkflowActionSerializedParameters(
    _ workflow: AnyObject,
    _ index: UInt64,
    _ serializedParameters: NSDictionary
) -> Bool

private func shortHexPrefix<T>(of value: T, maxBytes: Int = 32) -> String {
    withUnsafeBytes(of: value) { raw in
        raw.prefix(maxBytes).map { String(format: "%02x", $0) }.joined()
    }
}

private func jsonString(_ payload: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        return "{\"ok\":false,\"error\":\"failed to encode JSON payload\"}"
    }
    return text
}

private func jsonStringLiteral(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
        switch scalar.value {
        case 0x08:
            result += "\\b"
        case 0x09:
            result += "\\t"
        case 0x0a:
            result += "\\n"
        case 0x0c:
            result += "\\f"
        case 0x0d:
            result += "\\r"
        case 0x22:
            result += "\\\""
        case 0x5c:
            result += "\\\\"
        case 0x00..<0x20:
            result += String(format: "\\u%04x", scalar.value)
        default:
            result.unicodeScalars.append(scalar)
        }
    }
    result += "\""
    return result
}

private func jsonDictionary(from text: String) throws -> NSDictionary {
    guard let data = text.data(using: .utf8) else {
        throw bridgeFailure("request JSON was not valid UTF-8")
    }
    let parsed = try JSONSerialization.jsonObject(with: data, options: [])
    guard let dictionary = parsed as? NSDictionary else {
        throw bridgeFailure("request JSON root must be an object")
    }
    return dictionary
}

private func jsonObject(from text: String) throws -> Any {
    guard let data = text.data(using: .utf8) else {
        throw bridgeFailure("request JSON was not valid UTF-8")
    }
    return try JSONSerialization.jsonObject(with: data, options: [])
}

private func resolveEntityRequest(from text: String) throws -> ResolveEntityRequestInput {
    guard let data = text.data(using: .utf8) else {
        throw bridgeFailure("resolve_entity request JSON was not valid UTF-8")
    }
    return try JSONDecoder().decode(ResolveEntityRequestInput.self, from: data)
}

private func stringField(
    _ dictionary: NSDictionary,
    _ key: String,
    fallbackKeys: [String] = [],
    required: Bool = true,
    default defaultValue: String = ""
) throws -> String {
    for candidate in [key] + fallbackKeys {
        if let value = dictionary[candidate] as? NSString {
            return value as String
        }
        if let value = dictionary[candidate] as? String {
            return value
        }
        if let value = dictionary[candidate] as? NSNumber {
            return value.stringValue
        }
    }
    if required {
        throw bridgeFailure("request JSON missing required string field \(key)")
    }
    return defaultValue
}

private func jsonValue(_ value: String?) -> Any {
    value ?? NSNull()
}

private func pointerString(_ value: UInt64) -> String {
    String(format: "0x%llx", value)
}

private func objectFromPointer(_ value: UInt64) -> AnyObject? {
    guard value != 0 else {
        return nil
    }
    return unsafeBitCast(value, to: AnyObject.self)
}

private struct CompiledShortcutObjectView {
    let rawTrigger: AnyObject?
    let rawWorkflow: AnyObject?
    let getterTrigger: AnyObject?
    let getterWorkflow: AnyObject?

    var preferredTrigger: AnyObject? {
        getterTrigger ?? rawTrigger
    }

    var preferredWorkflow: AnyObject? {
        getterWorkflow ?? rawWorkflow
    }
}

private func compiledShortcutObjectView(_ compiled: CompiledShortcut) -> CompiledShortcutObjectView {
    var compiledCopy = compiled
    return withUnsafePointer(to: &compiledCopy) { compiledPointer in
        CompiledShortcutObjectView(
            rawTrigger: objectFromPointer(compiled.trigger),
            rawWorkflow: objectFromPointer(compiled.workflow),
            getterTrigger: bridgeCompiledShortcutGetTrigger(compiledPointer),
            getterWorkflow: bridgeCompiledShortcutGetWorkflow(compiledPointer)
        )
    }
}

private func objectPointerString(_ object: AnyObject?) -> String {
    guard let object else {
        return "0x0"
    }
    return String(format: "%p", UInt(bitPattern: Unmanaged.passUnretained(object).toOpaque()))
}

private func objectClassName(_ object: AnyObject?) -> String {
    guard let object else {
        return ""
    }
    return String(cString: object_getClassName(object))
}

private func performObjectSelector(_ object: AnyObject, _ selectorName: String) -> AnyObject? {
    guard let nsObject = object as? NSObject else {
        return nil
    }
    let selector = NSSelectorFromString(selectorName)
    guard nsObject.responds(to: selector) else {
        return nil
    }
    return nsObject.perform(selector)?.takeUnretainedValue()
}

private func objcAlloc(_ className: String) -> AnyObject? {
    className.withCString { bridgeObjcAllocClass($0) }
}

private func objcClassSend0(_ className: String, _ selectorName: String) -> AnyObject? {
    className.withCString { classCString in
        selectorName.withCString { selectorCString in
            bridgeObjcClassMsgSend0(classCString, selectorCString)
        }
    }
}

private func objcResponds(_ object: AnyObject, _ selectorName: String) -> Bool {
    selectorName.withCString { bridgeObjcResponds(object, $0) }
}

private func objcSend0(_ object: AnyObject, _ selectorName: String) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend0(object, $0) }
}

private func objcSendVoid0(_ object: AnyObject, _ selectorName: String) {
    selectorName.withCString { bridgeObjcMsgSendVoid0(object, $0) }
}

private func objcSendVoid0BarrierSync(on queue: AnyObject, object: AnyObject, selectorName: String) {
    selectorName.withCString { bridgeObjcMsgSendVoid0BarrierSync(queue, object, $0) }
}

@discardableResult
private func objcSend1(_ object: AnyObject, _ selectorName: String, _ arg1: AnyObject?) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend1(object, $0, arg1) }
}

private func objcSend2(
    _ object: AnyObject,
    _ selectorName: String,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?
) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend2(object, $0, arg1, arg2) }
}

private func objcSend3(
    _ object: AnyObject,
    _ selectorName: String,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: AnyObject?
) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend3(object, $0, arg1, arg2, arg3) }
}

private func objcSend4(
    _ object: AnyObject,
    _ selectorName: String,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: AnyObject?,
    _ arg4: AnyObject?
) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend4(object, $0, arg1, arg2, arg3, arg4) }
}

private func objcSend2Bool(
    _ object: AnyObject,
    _ selectorName: String,
    _ arg1: AnyObject?,
    _ arg2: AnyObject?,
    _ arg3: Bool
) -> AnyObject? {
    selectorName.withCString { bridgeObjcMsgSend2Bool(object, $0, arg1, arg2, arg3) }
}

private func objcSendUInt64(_ object: AnyObject, _ selectorName: String) -> UInt64? {
    guard objcResponds(object, selectorName) else {
        return nil
    }
    return selectorName.withCString { bridgeObjcMsgSendUInt64(object, $0) }
}

private func objcSendUInt64Arg(_ object: AnyObject, _ selectorName: String, _ arg1: UInt64) {
    guard objcResponds(object, selectorName) else {
        return
    }
    selectorName.withCString { bridgeObjcMsgSendUInt64Arg(object, $0, arg1) }
}

private func stringFromObject(_ object: AnyObject?) -> String? {
    guard let object else {
        return nil
    }
    if let text = object as? String {
        return text
    }
    if let text = object as? NSString {
        return text as String
    }
    if let number = object as? NSNumber {
        return number.stringValue
    }
    if let nsObject = object as? NSObject {
        return nsObject.description
    }
    return String(describing: object)
}

private func bridgeFailure(_ message: String) -> RuntimeBridgeError {
    RuntimeBridgeError(description: message)
}

private func proxyCatalog(from proxy: AnyObject) -> (catalog: AnyObject?, selector: String?) {
    for selector in [
        "catalog",
        "parameterStateCatalog",
        "initialCatalog",
    ] {
        if let catalog = performObjectSelector(proxy, selector) {
            return (catalog, selector)
        }
    }
    return (nil, nil)
}

private func rememberImportedPythonContext(
    source: String,
    originalData: Data,
    rootSummary: [String: Any],
    proxy: AnyObject
) -> ImportedPythonContext {
    let catalogResult = proxyCatalog(from: proxy)
    let context = ImportedPythonContext(
        source: source,
        originalData: originalData,
        rootSummary: rootSummary,
        proxyCatalog: catalogResult.catalog,
        proxyCatalogSelector: catalogResult.selector
    )
    importedPythonContextLock.lock()
    importedPythonContextHistory.append(context)
    if importedPythonContextHistory.count > 32 {
        importedPythonContextHistory.removeFirst(importedPythonContextHistory.count - 32)
    }
    latestImportedPythonContext = context
    importedPythonContextLock.unlock()
    return context
}

private func refTags(in source: String) -> Set<String> {
    func isHex(_ scalar: Unicode.Scalar) -> Bool {
        (scalar.value >= 48 && scalar.value <= 57) ||
            (scalar.value >= 65 && scalar.value <= 70) ||
            (scalar.value >= 97 && scalar.value <= 102)
    }

    var tags = Set<String>()
    var searchStart = source.startIndex
    while let markerRange = source.range(of: "ref(0x", range: searchStart..<source.endIndex) {
        var end = markerRange.upperBound
        while end < source.endIndex,
              let scalar = source[end].unicodeScalars.first,
              isHex(scalar) {
            end = source.index(after: end)
        }
        if end > markerRange.upperBound {
            tags.insert(String(source[markerRange.upperBound..<end]).uppercased())
        }
        searchStart = end
    }
    return tags
}

private func importedPythonContext(matchingRefsIn source: String) -> ImportedPythonContext? {
    let requestedTags = refTags(in: source)
    guard !requestedTags.isEmpty else {
        return nil
    }
    importedPythonContextLock.lock()
    let history = importedPythonContextHistory
    importedPythonContextLock.unlock()
    for context in history.reversed() {
        if requestedTags.isSubset(of: refTags(in: context.source)) {
            return context
        }
    }
    return nil
}

private func latestImportCatalogContext() -> ImportedPythonContext? {
    importedPythonContextLock.lock()
    let context = latestImportedPythonContext
    importedPythonContextLock.unlock()
    return context
}

private func importContextSummary(_ context: ImportedPythonContext?) -> [String: Any] {
    guard let context else {
        return [
            "present": false,
        ]
    }
    return [
        "present": true,
        "source_length": context.source.utf8.count,
        "original_data_length": context.originalData.count,
        "catalog": objectSummary(context.proxyCatalog),
        "catalog_selector": jsonValue(context.proxyCatalogSelector),
    ]
}

private func catalogDataPayload(_ data: Data) -> [String: Any] {
    var payload: [String: Any] = [
        "length": data.count,
        "base64": data.base64EncodedString(),
    ]
    if let text = String(data: data, encoding: .utf8) {
        payload["utf8"] = text
        if let json = try? JSONSerialization.jsonObject(with: data) {
            payload["json"] = jsonReadyValue(enrichedEncodedCatalogJson(json))
        }
    }
    return payload
}

private func decodedArchivedParameterStateObject(from base64: String) -> (value: Any?, error: String?) {
    guard let data = Data(base64Encoded: base64) else {
        return (nil, "parameterState was not valid base64")
    }
    do {
        guard let object = try NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(data) else {
            return (nil, "parameterState archive decoded nil")
        }
        return (jsonReadyValue(propertyListReadyValue(object)), nil)
    } catch {
        return (nil, String(describing: error))
    }
}

private func enrichedEncodedCatalogJson(_ value: Any) -> Any {
    if let dictionary = value as? NSDictionary {
        let output = NSMutableDictionary(capacity: dictionary.count)
        for (rawKey, rawValue) in dictionary {
            let key = String(describing: rawKey)
            if key.hasPrefix("0x"), let entry = rawValue as? NSDictionary {
                output[rawKey] = enrichedEncodedCatalogEntry(entry)
            } else {
                output[rawKey] = enrichedEncodedCatalogJson(rawValue)
            }
        }
        return output
    }
    if let array = value as? NSArray {
        let output = NSMutableArray(capacity: array.count)
        for item in array {
            output.add(enrichedEncodedCatalogJson(item))
        }
        return output
    }
    return value
}

private func enrichedEncodedCatalogEntry(_ entry: NSDictionary) -> NSDictionary {
    let output = NSMutableDictionary(dictionary: entry)
    if let parameterState = entry["parameterState"] as? String {
        let decoded = decodedArchivedParameterStateObject(from: parameterState)
        if let value = decoded.value {
            output["parameterStateObject"] = value
        }
        if let error = decoded.error {
            output["parameterStateDecodeError"] = error
        }
    }
    return output
}

private func catalogDumpPayload(context: ImportedPythonContext?) -> [String: Any] {
    guard let context else {
        return [
            "ok": false,
            "mode": "catalog-dump-latest",
            "diagnostic": "No plist-data-to-python import context has been captured yet.",
        ]
    }
    guard let catalog = context.proxyCatalog else {
        return [
            "ok": false,
            "mode": "catalog-dump-latest",
            "latest_import_context": importContextSummary(context),
            "diagnostic": "Latest import context did not expose a WFParameterStateCatalog.",
        ]
    }

    let payload: [String: Any] = [
        "ok": true,
        "mode": "catalog-dump-latest",
        "latest_import_context": importContextSummary(context),
        "catalog": objectSummary(catalog),
        "entries_status": "disabled: selector probing WFParameterStateCatalog.entries crashed simulator Shortcuts before returning; use guarded LLDB before re-enabling",
        "render_for_model_status": "disabled: direct WorkflowKit renderForModel() crashed simulator Shortcuts before returning; use guarded LLDB before re-enabling",
        "encoded_catalog_status": "disabled: direct encode(catalog:) crashed simulator Shortcuts before returning; use guarded LLDB before re-enabling",
    ]

    return payload
}

private func catalogEncodeLatestDebugPayload(context: ImportedPythonContext?) -> [String: Any] {
    guard let context, let catalog = context.proxyCatalog else {
        return [
            "ok": false,
            "mode": "catalog-encode-latest-debug",
            "latest_import_context": importContextSummary(context),
            "diagnostic": "No latest imported WFParameterStateCatalog is available.",
        ]
    }
    do {
        let data = try pythonWorkflowProxyEncodeCatalog(
            catalog,
            "Shortcuts IDE bridge debug catalog encode"
        )
        return [
            "ok": true,
            "mode": "catalog-encode-latest-debug",
            "latest_import_context": importContextSummary(context),
            "catalog": objectSummary(catalog),
            "encoded_catalog": catalogDataPayload(data),
        ]
    } catch {
        return [
            "ok": false,
            "mode": "catalog-encode-latest-debug",
            "latest_import_context": importContextSummary(context),
            "catalog": objectSummary(catalog),
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ]
    }
}

private func jsonModelDescription(_ value: Any) throws -> String {
    let ready = jsonReadyValue(value)
    guard JSONSerialization.isValidJSONObject(ready),
          let data = try? JSONSerialization.data(withJSONObject: ready, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        throw bridgeFailure("inline catalog metadata is not JSON serializable")
    }
    return text
}

private func stringFromDictionary(_ dictionary: NSDictionary, keys: [String]) -> String? {
    for key in keys {
        if let value = dictionary[key] as? NSString {
            return value as String
        }
        if let value = dictionary[key] as? String {
            return value
        }
    }
    return nil
}

private func nativeCatalogParameterValue(
    metadata: Any,
    actionName: String,
    actionParameter: String
) throws -> Any {
    if let dictionary = metadata as? NSDictionary,
       let bundleIdentifier = stringFromDictionary(
           dictionary,
           keys: ["Bundle Identifier", "BundleIdentifier", "bundle_identifier", "bundleIdentifier"]
       ), !bundleIdentifier.isEmpty {
        let name = stringFromDictionary(
            dictionary,
            keys: ["Name", "Display Name", "DisplayName", "name", "display_name", "displayName"]
        ) ?? bundleIdentifier
        let teamIdentifier = stringFromDictionary(
            dictionary,
            keys: ["Team Identifier", "TeamIdentifier", "team_identifier", "teamIdentifier"]
        ) ?? "0000000000"
        return [
            "BundleIdentifier": bundleIdentifier,
            "Name": name,
            "TeamIdentifier": teamIdentifier,
        ] as NSDictionary
    }
    return propertyListReadyValue(metadata)
}

private func archivedParameterStateBase64(from propertyListObject: Any) throws -> String {
    guard let allocated = objcAlloc("WFAnyPropertyListObject") else {
        throw bridgeFailure("WFAnyPropertyListObject class is not loaded")
    }
    guard let stateObject = objcSend1(
        allocated,
        "initWithPropertyListObject:",
        foundationValue(propertyListObject) as AnyObject
    ) else {
        throw bridgeFailure("WFAnyPropertyListObject initWithPropertyListObject: returned nil")
    }
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: stateObject,
        requiringSecureCoding: false
    )
    return data.base64EncodedString()
}

private func inlineCatalogEntries(from root: Any) throws -> [NSDictionary] {
    if let array = root as? NSArray {
        return array.compactMap { $0 as? NSDictionary }
    }
    guard let dictionary = root as? NSDictionary else {
        throw bridgeFailure("inline catalog request must be an object or array")
    }
    if let entries = dictionary["entries"] as? NSArray {
        return entries.compactMap { $0 as? NSDictionary }
    }
    return [dictionary]
}

private func expandInlineCatalogPayload(from text: String) throws -> [String: Any] {
    let root = try jsonObject(from: text)
    let entries = try inlineCatalogEntries(from: root)
    let catalog = NSMutableDictionary(capacity: entries.count)
    let agentCatalog = NSMutableDictionary(capacity: entries.count)
    var summaries: [[String: Any]] = []

    for entry in entries {
        let tag = try stringField(entry, "tag")
        let actionName = try stringField(entry, "actionName", fallbackKeys: ["action_name"])
        let actionParameter = try stringField(entry, "actionParameter", fallbackKeys: ["action_parameter", "parameter"])
        guard let metadata = entry["metadata"] else {
            throw bridgeFailure("inline catalog entry \(tag) is missing metadata")
        }
        guard let handle = entry["handle"] else {
            throw bridgeFailure("inline catalog entry \(tag) is missing native handle")
        }
        let modelDescription = try jsonModelDescription(metadata)
        let parameterValue = try nativeCatalogParameterValue(
            metadata: foundationValue(metadata),
            actionName: actionName,
            actionParameter: actionParameter
        )
        let parameterState = try archivedParameterStateBase64(from: parameterValue)
        catalog[tag] = [
            "actionName": actionName,
            "actionParameter": actionParameter,
            "handle": foundationValue(handle),
            "modelDescription": modelDescription,
            "parameterState": parameterState,
        ] as NSDictionary
        agentCatalog[tag] = modelDescription
        summaries.append([
            "tag": tag,
            "actionName": actionName,
            "actionParameter": actionParameter,
            "modelDescription": modelDescription,
            "parameterStateLength": parameterState.count,
        ])
    }

    return [
        "ok": true,
        "mode": "expand-inline-catalog-metadata",
        "entry_count": entries.count,
        "catalog": catalog,
        "agent_catalog_metadata": agentCatalog,
        "entries": summaries,
    ]
}

private func performOnMain<T>(_ body: @escaping () throws -> T) throws -> T {
    if Thread.isMainThread {
        return try body()
    }
    let semaphore = DispatchSemaphore(value: 0)
    let box = ThrowingResultBox<T>()
    DispatchQueue.main.async {
        do {
            box.result = .success(try body())
        } catch {
            box.result = .failure(error)
        }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        throw bridgeFailure("main-queue WorkflowKit operation timed out")
    }
    guard let result = box.result else {
        throw bridgeFailure("main-queue WorkflowKit operation did not return a result")
    }
    return try result.get()
}

private func jsonReadyValue(_ value: Any?) -> Any {
    guard let value else {
        return NSNull()
    }
    if value is NSNull {
        return NSNull()
    }
    if let dictionary = value as? NSDictionary {
        var output: [String: Any] = [:]
        for (key, rawValue) in dictionary {
            output[String(describing: key)] = jsonReadyValue(rawValue)
        }
        return output
    }
    if let array = value as? NSArray {
        return array.map { jsonReadyValue($0) }
    }
    if let text = value as? NSString {
        return text as String
    }
    if let data = value as? NSData {
        return ["__base64Data": data.base64EncodedString()]
    }
    if let date = value as? NSDate {
        return ["__date": ISO8601DateFormatter().string(from: date as Date)]
    }
    if let url = value as? NSURL {
        return url.absoluteString ?? url.description
    }
    if let number = value as? NSNumber {
        return number
    }
    if let string = value as? String {
        return string
    }
    return String(describing: value)
}

private func foundationValue(_ value: Any) -> Any {
    if let dictionary = value as? NSDictionary {
        if dictionary.count == 1,
           let encoded = dictionary["__base64Data"] as? String,
           let data = Data(base64Encoded: encoded) {
            return data as NSData
        }
        let output = NSMutableDictionary(capacity: dictionary.count)
        for (key, rawValue) in dictionary {
            output[key] = foundationValue(rawValue)
        }
        return output
    }
    if let array = value as? NSArray {
        let output = NSMutableArray(capacity: array.count)
        for item in array {
            output.add(foundationValue(item))
        }
        return output
    }
    return value
}

private func propertyListReadyValue(_ value: Any?, depth: Int = 0) -> Any {
    guard depth < 32 else {
        return String(describing: value) as NSString
    }
    guard let value else {
        return "" as NSString
    }
    if value is NSNull {
        return "" as NSString
    }
    if let dictionary = value as? NSDictionary {
        let output = NSMutableDictionary(capacity: dictionary.count)
        for (key, rawValue) in dictionary {
            output[String(describing: key)] = propertyListReadyValue(rawValue, depth: depth + 1)
        }
        return output
    }
    if let array = value as? NSArray {
        let output = NSMutableArray(capacity: array.count)
        for item in array {
            output.add(propertyListReadyValue(item, depth: depth + 1))
        }
        return output
    }
    if let set = value as? NSSet {
        let output = NSMutableArray(capacity: set.count)
        for item in set {
            output.add(propertyListReadyValue(item, depth: depth + 1))
        }
        return output
    }
    if let text = value as? NSString {
        return text
    }
    if let data = value as? NSData {
        return data
    }
    if let date = value as? NSDate {
        return date
    }
    if let number = value as? NSNumber {
        return number
    }
    if let string = value as? String {
        return string as NSString
    }
    if let data = value as? Data {
        return data as NSData
    }
    if let date = value as? Date {
        return date as NSDate
    }
    if let url = value as? NSURL {
        return (url.absoluteString ?? url.description) as NSString
    }
    if let object = value as? NSObject {
        for selectorName in [
            "propertyListObject",
            "serializedRepresentation",
            "dictionaryRepresentation",
            "plistRepresentation",
            "propertyListRepresentation",
        ] where object.responds(to: NSSelectorFromString(selectorName)) {
            if let represented = object.perform(NSSelectorFromString(selectorName))?.takeUnretainedValue() {
                return propertyListReadyValue(represented, depth: depth + 1)
            }
        }
        return object.description as NSString
    }
    return String(describing: value) as NSString
}

private func plistRootFromJsonText(_ text: String) throws -> NSDictionary {
    guard let data = text.data(using: .utf8) else {
        throw bridgeFailure("plist JSON was not valid UTF-8")
    }
    let parsed = try JSONSerialization.jsonObject(with: data, options: [])
    let rootCandidate: Any
    if let wrapper = parsed as? NSDictionary, let plist = wrapper["plist"] {
        rootCandidate = plist
    } else {
        rootCandidate = parsed
    }
    guard let dictionary = foundationValue(rootCandidate) as? NSDictionary else {
        throw bridgeFailure("plist JSON root must be an NSDictionary or a response object containing a plist dictionary")
    }
    return dictionary
}

private func plistData(from rootDictionary: NSDictionary) throws -> Data {
    guard let plistRoot = propertyListReadyValue(rootDictionary) as? NSDictionary else {
        throw bridgeFailure("failed to normalize root dictionary into property-list values")
    }
    return try PropertyListSerialization.data(
        fromPropertyList: plistRoot,
        format: .binary,
        options: 0
    )
}

private func plistRootFromData(_ data: Data) throws -> NSDictionary {
    var format = PropertyListSerialization.PropertyListFormat.binary
    let parsed = try PropertyListSerialization.propertyList(
        from: data,
        options: [],
        format: &format
    )
    guard let dictionary = parsed as? NSDictionary else {
        throw bridgeFailure("plist root must be an NSDictionary")
    }
    return dictionary
}

private func workflowTriggerMetadata(from root: NSDictionary) -> NSArray? {
    guard let triggers = root["WFWorkflowTriggers"] as? NSArray, triggers.count > 0 else {
        return nil
    }
    return (propertyListReadyValue(triggers) as? NSArray) ?? triggers
}

private func rootByAttachingWorkflowTriggers(
    _ root: NSDictionary,
    triggers: NSArray?
) -> NSDictionary {
    guard let triggers else {
        return root
    }
    let mutableRoot = root.mutableCopy() as? NSMutableDictionary ?? NSMutableDictionary(dictionary: root)
    mutableRoot["WFWorkflowTriggers"] = triggers
    return mutableRoot
}

private func rootSummary(_ root: AnyObject?) -> [String: Any] {
    var payload: [String: Any] = [
        "class": objectClassName(root),
        "pointer": objectPointerString(root),
    ]
    guard let dictionary = root as? NSDictionary else {
        payload["is_dictionary"] = false
        return payload
    }
    payload["is_dictionary"] = true
    payload["key_count"] = dictionary.count
    payload["keys"] = dictionary.allKeys.map { String(describing: $0) }.sorted()
    if let actions = dictionary["WFWorkflowActions"] as? NSArray {
        payload["WFWorkflowActions_count"] = actions.count
    }
    return payload
}

private func collectionCount(_ object: AnyObject?) -> Int? {
    if let array = object as? NSArray {
        return array.count
    }
    if let set = object as? NSSet {
        return set.count
    }
    return nil
}

private func objectSummary(_ object: AnyObject?) -> [String: Any] {
    var payload: [String: Any] = [
        "class": objectClassName(object),
        "pointer": objectPointerString(object),
        "present": object != nil,
    ]
    if let count = collectionCount(object) {
        payload["count"] = count
    }
    return payload
}

private func pointerOnlySummary(_ object: AnyObject?) -> [String: Any] {
    [
        "class": objectClassName(object),
        "pointer": objectPointerString(object),
        "present": object != nil,
    ]
}

private func workflowFileSummary(_ file: AnyObject?) -> [String: Any] {
    var payload = objectSummary(file)
    guard let file else {
        return payload
    }
    for selector in [
        "name",
        "actions",
    ] {
        if let value = performObjectSelector(file, selector) {
            if let text = stringFromObject(value), selector == "name" {
                payload[selector] = text
            } else {
                payload[selector] = objectSummary(value)
            }
        }
    }
    return payload
}

private func selectorProbe(_ object: AnyObject?, selectors: [String]) -> [String: Any] {
    var payload = objectSummary(object)
    guard let object else {
        return payload
    }
    for selector in selectors {
        guard let value = performObjectSelector(object, selector) else {
            continue
        }
        if let text = stringFromObject(value), value is NSString || value is String || value is NSNumber {
            payload[selector] = text
        } else if let text = stringFromObject(value), selector.lowercased().contains("definition") {
            payload[selector] = text
        } else {
            payload[selector] = objectSummary(value)
        }
    }
    return payload
}

private func triggerPreviews(_ triggers: AnyObject?) -> [[String: Any]] {
    guard let array = triggers as? NSArray else {
        return []
    }
    let selectors = [
        "pythonDefinition",
        "trigger",
        "configuredTriggerRecord",
        "triggerRecord",
        "descriptor",
        "definition",
        "identifier",
        "triggerIdentifier",
        "serializedRepresentation",
        "dictionaryRepresentation",
    ]
    return (0..<array.count).map { index in
        let trigger = array.object(at: index) as AnyObject
        var payload = selectorProbe(trigger, selectors: selectors)
        payload["index"] = index
        if let dictionary = trigger as? NSDictionary {
            payload["construction_candidates"] = triggerConstructionPreviews(from: dictionary, selectors: selectors)
        }
        for nestedSelector in ["trigger", "configuredTriggerRecord", "triggerRecord", "descriptor"] {
            if let nested = performObjectSelector(trigger, nestedSelector) {
                payload["\(nestedSelector)_probe"] = selectorProbe(nested, selectors: selectors)
            }
        }
        return payload
    }
}

private func triggerConstructionPreviews(from dictionary: NSDictionary, selectors: [String]) -> [[String: Any]] {
    var output: [[String: Any]] = []
    for className in ["WFConfiguredTrigger", "WFConfiguredTriggerRecord", "WFTrigger"] {
        guard let allocated = objcAlloc(className) else {
            continue
        }
        for initializer in ["initWithDictionaryRepresentation:", "initWithSerializedRepresentation:"] {
            guard objcResponds(allocated, initializer),
                  let candidate = objcSend1(allocated, initializer, dictionary) else {
                continue
            }
            var preview = selectorProbe(candidate, selectors: selectors)
            preview["constructed_class"] = className
            preview["initializer"] = initializer
            output.append(preview)
        }
    }
    return output
}

private func methodNames(for className: String, meta: Bool = false) -> [String] {
    guard let baseClass = NSClassFromString(className) else {
        return []
    }
    let targetClass: AnyClass
    if meta, let metaClass = object_getClass(baseClass) {
        targetClass = metaClass
    } else {
        targetClass = baseClass
    }
    var count: UInt32 = 0
    guard let methods = class_copyMethodList(targetClass, &count) else {
        return []
    }
    defer { free(methods) }
    var names: [String] = []
    for index in 0..<Int(count) {
        names.append(String(cString: sel_getName(method_getName(methods[index]))))
    }
    return names.sorted()
}

private func triggerRuntimeClassProbe() -> [String: Any] {
    var payload: [String: Any] = [:]
    for className in [
        "WFConfiguredTrigger",
        "WFConfiguredTriggerRecord",
        "WFTrigger",
        "WFAppInFocusTrigger",
        "WFUserFocusActivityTrigger",
        "WFPythonWorkflowProxy",
    ] {
        payload[className] = [
            "instance_methods": methodNames(for: className),
            "class_methods": methodNames(for: className, meta: true),
        ]
    }
    return payload
}

private func copyObjectSelector(
    from source: AnyObject,
    sourceSelector: String,
    to destination: AnyObject,
    setter: String
) {
    guard objcResponds(destination, setter),
          let value = performObjectSelector(source, sourceSelector) else {
        return
    }
    _ = objcSend1(destination, setter, value)
}

private func copyUInt64Selector(
    from source: AnyObject,
    sourceSelector: String,
    to destination: AnyObject,
    setter: String
) {
    guard let value = objcSendUInt64(source, sourceSelector) else {
        return
    }
    objcSendUInt64Arg(destination, setter, value)
}

private func makeCompilerFlags(dropComments: Bool = true) -> CompilerFlagsContext {
    var context = CompilerFlagsContext()
    bridgeMakeErrorConfigurationEmpty(&context.errorConfiguration)
    bridgeMakeToolVisibilityFilterAny(&context.toolVisibility)
    bridgeMakeFlags(
        &context.flags,
        &context.strictness,
        &context.logLevel,
        dropComments,
        &context.errorConfiguration,
        false,
        &context.toolVisibility
    )
    return context
}

private func compileSource(
    _ source: String,
    catalogOverride: AnyObject? = nil,
    catalogSource: String = "defaultInitialCatalog"
) async throws -> CompileRun {
    let catalog: AnyObject
    let resolvedCatalogSource: String
    if let catalogOverride {
        catalog = catalogOverride
        resolvedCatalogSource = catalogSource
    } else {
        catalog = defaultInitialCatalog()
        resolvedCatalogSource = "defaultInitialCatalog"
    }
    var flags = makeCompilerFlags()
    var compiled = CompiledShortcut()

    try await pythonToShortcut(&compiled, source, &flags.flags, catalog)
    return CompileRun(
        catalog: catalog,
        catalogSource: resolvedCatalogSource,
        strictness: flags.strictness,
        logLevel: flags.logLevel,
        errorConfiguration: flags.errorConfiguration,
        toolVisibility: flags.toolVisibility,
        flagsStorage: flags.flags,
        compiled: compiled
    )
}

private func applyShortpyFixpointPass(
    name: String,
    program: inout IRProgramStorage,
    limit: Int = 64,
    applyOnce: (inout IRProgramStorage) throws -> Void
) throws -> ShortpyPassReport {
    var calls = 0
    var changes = 0
    while calls < limit {
        var before = IRProgramStorage()
        guard bridgeCopyIRProgram(&before, &program) else {
            throw RuntimeBridgeError(
                description: "could not copy IRProgram before \(name)"
            )
        }
        do {
            calls += 1
            try applyOnce(&program)
            let stable = bridgeIRProgramEqual(&before, &program)
            bridgeDestroyIRProgram(&before)
            if stable {
                return ShortpyPassReport(
                    name: name,
                    calls: calls,
                    changes: changes,
                    input: "native IRProgram value",
                    output: "native equality fixed point"
                )
            }
            changes += 1
        } catch {
            bridgeDestroyIRProgram(&before)
            throw error
        }
    }
    throw RuntimeBridgeError(
        description: "\(name) did not reach a fixed point after \(limit) calls"
    )
}

private func applyShortpyOwnedPass(
    name: String,
    program: inout IRProgramStorage,
    apply: (UnsafeMutablePointer<IRProgramStorage>, UnsafeMutablePointer<UInt32>) -> Int32
) throws -> ShortpyPassReport {
    var changes = UInt32(0)
    guard apply(&program, &changes) == 0 else {
        let diagnostic = bridgeShortpyIRAdapterLastError().map(String.init(cString:))
            ?? "unknown native IR adapter error"
        throw RuntimeBridgeError(description: "\(name) failed: \(diagnostic)")
    }
    let trace = bridgeShortpyIRAdapterLastTrace().map(String.init(cString:)) ?? ""
    return ShortpyPassReport(
        name: name,
        calls: 1,
        changes: Int(changes),
        input: "native IRProgram value",
        output: trace.isEmpty ? "native IRProgram value" : trace
    )
}

private func shortpyRecurrencePlans(
    _ bindings: UnsafeRawPointer
) throws -> [ShortpyRecurrencePlan] {
    let count = bridgeShortpyRecurrenceBindingCount(bindings)
    return try (0..<count).map { recurrenceIndex in
        func branches(
            count: UInt32,
            at: (UInt32) -> UInt32
        ) throws -> [Int] {
            try (0..<count).map { branchIndex in
                let value = at(branchIndex)
                guard value != UInt32.max else {
                    throw RuntimeBridgeError(
                        description: "Shortpy recurrence branch plan is incomplete"
                    )
                }
                return Int(value)
            }
        }

        let controlKind = bridgeShortpyRecurrenceControlKind(
            bindings, recurrenceIndex
        )
        guard controlKind == 1 || controlKind == 2 else {
            throw RuntimeBridgeError(
                description: "Shortpy recurrence control kind is unsupported"
            )
        }
        let targetBranches = try branches(
            count: bridgeShortpyRecurrenceTargetBranchCount(
                bindings, recurrenceIndex
            ),
            at: {
                bridgeShortpyRecurrenceTargetBranchAt(
                    bindings, recurrenceIndex, $0
                )
            }
        )
        let seedBranches = try branches(
            count: bridgeShortpyRecurrenceSeedBranchCount(
                bindings, recurrenceIndex
            ),
            at: {
                bridgeShortpyRecurrenceSeedBranchAt(
                    bindings, recurrenceIndex, $0
                )
            }
        )
        guard !targetBranches.isEmpty && !seedBranches.isEmpty else {
            throw RuntimeBridgeError(
                description: "Shortpy recurrence branch plan has no seed or recursive branch"
            )
        }
        return ShortpyRecurrencePlan(
            controlKind: controlKind,
            targetBranches: targetBranches,
            seedBranches: seedBranches
        )
    }
}

private func ShortpyToShortcut(
    _ source: String,
    catalogOverride: AnyObject? = nil,
    catalogSource: String = "defaultInitialCatalog"
) async throws -> ShortpyCompileRun {
    let catalog = catalogOverride ?? defaultInitialCatalog()
    let resolvedCatalogSource = catalogOverride == nil
        ? "defaultInitialCatalog"
        : catalogSource
    // Match Apple's generic Compiler lifecycle: each compile owns one database
    // shared by PythonToIR, IRToShortcut, and both matchers.
    let database = try freshToolDatabase()
    var flags = makeCompilerFlags()

    var backendContextSize = UInt32(0)
    var backendConformance: UnsafeRawPointer?
    guard let backendTarget = bridgeResolveShortcutsLanguageIRBackend(
        &backendContextSize,
        &backendConformance
    ), let backendConformance else {
        throw RuntimeBridgeError(
            description: "ShortcutsLanguage IRToShortcut Backend capability is unavailable"
        )
    }
    bridgeSetShortpyBackendTarget(backendTarget, backendContextSize)

    guard let backend = bridgeCreateShortcutsLanguageIRBackend(
        &flags.flags,
        catalog,
        database,
        &flags.toolVisibility
    ) else {
        let diagnostic = bridgeShortpyIRBackendLastError().map(String.init(cString:))
            ?? "unknown native adapter error"
        throw RuntimeBridgeError(
            description: "IRToShortcut initialization failed: \(diagnostic)"
        )
    }
    defer {
        bridgeDestroyShortcutsLanguageIRBackend(backend)
    }

    let frontend = bridgePythonToIRInit(&flags.flags, database)
    var frontendResult = FrontendResultStorage()
    try bridgePythonToIRVisitIntoThrowing(&frontendResult, source, frontend)
    let frontendPolicyDecisions = bridgeFrontendResultGetErrorPolicyDecisions(
        &frontendResult
    )
    var program = IRProgramStorage()
    bridgeFrontendResultGetProgram(&program, &frontendResult)
    bridgeDestroyFrontendResult(&frontendResult)
    frontendResult = FrontendResultStorage()
    defer {
        bridgeDestroyIRProgram(&program)
    }
    let frontendIR = "opaque IRProgram (IRPrintable capture is not on the compiler path)"

    guard let controlFlowBindings = bridgeShortpyCaptureControlFlowBindings(&program) else {
        let diagnostic = bridgeShortpyIRAdapterLastError().map(String.init(cString:))
            ?? "unknown control-flow binding capture error"
        throw RuntimeBridgeError(
            description: "Shortpy control-flow binding capture failed: \(diagnostic)"
        )
    }
    defer {
        bridgeShortpyDestroyControlFlowBindings(controlFlowBindings)
    }
    let recurrencePlans = try shortpyRecurrencePlans(controlFlowBindings)
    let bindingCaptureTrace = bridgeShortpyIRAdapterLastTrace().map(String.init(cString:)) ?? ""
    let bindingCaptureReport = ShortpyPassReport(
        name: "ShortpyControlFlowBindingCapture",
        calls: 1,
        changes: Int(bridgeShortpyControlFlowBindingCount(controlFlowBindings)),
        input: "untouched frontend IRProgram value",
        output: bindingCaptureTrace.isEmpty
            ? "lexically scoped native statement bindings"
            : bindingCaptureTrace
    )

    var controlFlowPass = IRPassStorage()
    bridgeControlFlowPassInit(&controlFlowPass, &flags.flags)

    let recurrenceReport = try applyShortpyOwnedPass(
        name: "ShortpyLoopCarriedRecurrencePreparationPass",
        program: &program,
        apply: { program, changes in
            return bridgeShortpyPrepareLoopCarriedRecurrences(
                program,
                controlFlowBindings,
                changes
            )
        }
    )

    let controlFlowReport = try applyShortpyFixpointPass(
        name: "ControlFlowOutputInferencePass",
        program: &program
    ) { program in
        try bridgeControlFlowPassApplyOnceThrowing(&program, &controlFlowPass)
    }

    var variableInliningPass = IRPassStorage()
    bridgeVariableInliningPassInit(&variableInliningPass, &flags.flags)
    let variableInliningReport = try applyShortpyFixpointPass(
        name: "VariableInliningPass",
        program: &program
    ) { program in
        try bridgeVariableInliningPassApplyOnceThrowing(
            &program,
            &variableInliningPass
        )
    }

    var dropCommentsPass = IRPassStorage()
    bridgeDropCommentsPassInit(&dropCommentsPass, &flags.flags)
    try bridgeDropCommentsPassApplyThrowing(&program, &dropCommentsPass)
    let dropCommentsReport = ShortpyPassReport(
        name: "DropCommentsPass",
        calls: 1,
        changes: -1,
        input: "native IRProgram value",
        output: "native IRProgram value"
    )

    let nestedControlFlowReport = try applyShortpyOwnedPass(
        name: "ShortpyNestedControlFlowResultPass",
        program: &program,
        apply: { program, changes in
            bridgeShortpyRewriteNestedControlFlowResults(
                program,
                controlFlowBindings,
                changes
            )
        }
    )

    let compiled = try await bridgeShortpyBackendSelected(&program, backend)
    return ShortpyCompileRun(
        catalog: catalog,
        catalogSource: resolvedCatalogSource,
        flags: flags,
        compiled: compiled,
        frontendIR: frontendIR,
        finalIR: "opaque IRProgram (IRPrintable capture is not on the compiler path)",
        passes: [
            bindingCaptureReport,
            recurrenceReport,
            controlFlowReport,
            variableInliningReport,
            dropCommentsReport,
            nestedControlFlowReport,
        ],
        recurrencePlans: recurrencePlans,
        frontendPolicyDecisions: frontendPolicyDecisions,
        backendContextSize: backendContextSize,
        backendConformance: backendConformance
    )
}

private func compileWithRuntimePipeline(
    _ source: String,
    pipeline: RuntimePipeline,
    catalogOverride: AnyObject?,
    catalogSource: String
) async throws -> PipelineCompileRun {
    switch pipeline {
    case .native:
        let run = try await compileSource(
            source,
            catalogOverride: catalogOverride,
            catalogSource: catalogSource
        )
        return PipelineCompileRun(
            pipeline: pipeline,
            catalog: run.catalog,
            catalogSource: run.catalogSource,
            compiled: run.compiled,
            recurrencePlans: [],
            policyDecisions: errorPolicyDecisions(from: run.compiled),
            details: [
                "entrypoint": "ShortcutsLanguage.pythonToShortcut",
                "owned_passes": [],
            ]
        )
    case .shortpy:
        let run = try await ShortpyToShortcut(
            source,
            catalogOverride: catalogOverride,
            catalogSource: catalogSource
        )
        return PipelineCompileRun(
            pipeline: pipeline,
            catalog: run.catalog,
            catalogSource: run.catalogSource,
            compiled: run.compiled,
            recurrencePlans: run.recurrencePlans,
            policyDecisions: errorPolicyDecisions(
                from: run.frontendPolicyDecisions,
                phase: "frontend"
            ) + errorPolicyDecisions(from: run.compiled),
            details: [
                "entrypoint": "ShortpyToShortcut",
                "passes": run.passes.map(\.json),
                "recurrencePlans": run.recurrencePlans.map(\.json),
                "backend_context_size": Int(run.backendContextSize),
                "backend_conformance": pointerString(run.backendConformance),
            ]
        )
    }
}

private func pointerString(_ pointer: UnsafeRawPointer?) -> String {
    guard let pointer else {
        return "0x0"
    }
    return String(format: "0x%016llx", UInt64(UInt(bitPattern: pointer)))
}

private func appendRecordFileProbeStage(_ stage: String) {
    let path = "/tmp/shortcuts-record-file-probe-stage.log"
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(stage)\n"
    guard let data = line.data(using: .utf8) else {
        return
    }
    if !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil, attributes: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: path)) else {
        return
    }
    handle.seekToEndOfFile()
    handle.write(data)
    try? handle.close()
}

private func workflowRecordFileDataPayloadFromWorkflow(
    _ workflow: AnyObject,
    trigger: AnyObject?,
    callSaveToRecord: Bool,
    recurrencePlans: [ShortpyRecurrencePlan] = []
) throws -> WorkflowFileDataPayload {
    appendRecordFileProbeStage("enter workflow=\(objectPointerString(workflow)) callSaveToRecord=\(callSaveToRecord)")
    guard objcResponds(workflow, "saveToRecord") else {
        throw bridgeFailure("WFWorkflow is missing saveToRecord")
    }
    guard objcResponds(workflow, "databaseAccessQueue") else {
        throw bridgeFailure("WFWorkflow is missing databaseAccessQueue")
    }
    guard objcResponds(workflow, "record") else {
        throw bridgeFailure("WFWorkflow is missing record")
    }

    let nativeRecurrenceReport = try applyShortpyRecurrenceToWorkflow(
        workflow,
        plans: recurrencePlans
    )

    appendRecordFileProbeStage("before recordBefore")
    let recordBefore = performObjectSelector(workflow, "record")
    appendRecordFileProbeStage("after recordBefore record=\(objectPointerString(recordBefore))")
    if callSaveToRecord {
        appendRecordFileProbeStage("before databaseAccessQueue")
        guard let databaseAccessQueue = performObjectSelector(workflow, "databaseAccessQueue") else {
            throw bridgeFailure("WFWorkflow databaseAccessQueue returned nil")
        }
        appendRecordFileProbeStage("after databaseAccessQueue queue=\(objectPointerString(databaseAccessQueue))")
        appendRecordFileProbeStage("before saveToRecord barrier")
        objcSendVoid0BarrierSync(on: databaseAccessQueue, object: workflow, selectorName: "saveToRecord")
        appendRecordFileProbeStage("after saveToRecord barrier")
    } else {
        appendRecordFileProbeStage("skip saveToRecord")
    }

    appendRecordFileProbeStage("before recordAfter")
    guard let record = performObjectSelector(workflow, "record") else {
        throw bridgeFailure("WFWorkflow record returned nil after saveToRecord")
    }
    appendRecordFileProbeStage("after recordAfter record=\(objectPointerString(record))")
    guard objcResponds(record, "fileRepresentation") else {
        throw bridgeFailure("\(objectClassName(record)) is missing fileRepresentation")
    }
    appendRecordFileProbeStage("before fileRepresentation")
    guard let file = performObjectSelector(record, "fileRepresentation") else {
        throw bridgeFailure("WFWorkflowRecord fileRepresentation returned nil")
    }
    appendRecordFileProbeStage("after fileRepresentation file=\(objectPointerString(file))")
    guard objcResponds(file, "fileDataWithError:") else {
        throw bridgeFailure("\(objectClassName(file)) is missing fileDataWithError:")
    }
    appendRecordFileProbeStage("before fileDataWithError")
    guard let dataObject = objcSend1(file, "fileDataWithError:", nil) else {
        throw bridgeFailure("WFWorkflowRecord fileRepresentation fileDataWithError: returned nil")
    }
    appendRecordFileProbeStage("after fileDataWithError data=\(objectPointerString(dataObject))")
    guard let nsData = dataObject as? NSData else {
        throw bridgeFailure("fileDataWithError: returned \(objectClassName(dataObject)), expected NSData")
    }

    let data = Data(bytes: nsData.bytes, count: nsData.length)
    appendRecordFileProbeStage("before plist parse length=\(data.count)")
    var format = PropertyListSerialization.PropertyListFormat.binary
    let rootObject = try PropertyListSerialization.propertyList(
        from: data,
        options: [],
        format: &format
    )
    appendRecordFileProbeStage("after plist parse")
    guard let root = rootObject as? NSDictionary else {
        throw bridgeFailure("WFWorkflowRecord fileRepresentation data decoded to \(type(of: rootObject)), expected NSDictionary")
    }
    let finalRoot = root
    let finalData = data
    let actions = finalRoot["WFWorkflowActions"] as? NSArray
    let triggers = finalRoot["WFWorkflowTriggers"] as? NSArray
    retainRecordFileNativeObjects([workflow, recordBefore, record, file, dataObject])
    return WorkflowFileDataPayload(
        data: finalData,
        fileSummary: [
            "present": true,
            "class": objectClassName(file),
            "export_path": callSaveToRecord
                ? "WFWorkflow.databaseAccessQueue dispatch_barrier_sync -> WFWorkflow.saveToRecord -> WFWorkflow.record -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:"
                : "WFWorkflow.record -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:",
            "record_before_saveToRecord": pointerOnlySummary(recordBefore),
            "record_after_saveToRecord": pointerOnlySummary(record),
            "file": pointerOnlySummary(file),
            "format": format == .binary ? "binary" : (format == .xml ? "xml" : "openstep"),
            "trigger_input": pointerOnlySummary(trigger),
            "shortpy_recurrence_lowering": nativeRecurrenceReport,
            "shortpy_recurrence_boundary": recurrencePlans.isEmpty
                ? "not-required"
                : "native WFAction reconstruction before WFWorkflow.saveToRecord",
        ],
        rootSummary: rootSummary(finalRoot),
        actionsSummary: objectSummary(actions),
        triggersSummary: objectSummary(triggers)
    )
}

private struct ShortpyAttachmentPath: Hashable {
    let components: [String]
}

private struct ShortpyControlGroup {
    let openIndex: Int
    let closeIndex: Int
    let branches: [Range<Int>]
}

private func shortpyActionParameters(_ action: NSDictionary) -> NSDictionary {
    action["WFWorkflowActionParameters"] as? NSDictionary ?? NSDictionary()
}

private func shortpyControlMode(_ action: NSDictionary) -> Int? {
    let value = shortpyActionParameters(action)["WFControlFlowMode"]
    if let number = value as? NSNumber {
        return number.intValue
    }
    return value as? Int
}

private func shortpyGroupingIdentifier(_ action: NSDictionary) -> String? {
    let parameters = shortpyActionParameters(action)
    return stringFromObject(parameters["GroupingIdentifier"] as AnyObject?)
        ?? stringFromObject(
            action["WFWorkflowActionGroupingIdentifier"] as AnyObject?
        )
}

private func shortpyActionUUID(_ action: NSDictionary) -> String? {
    let parameters = shortpyActionParameters(action)
    return stringFromObject(parameters["UUID"] as AnyObject?)
        ?? stringFromObject(action["WFWorkflowActionUUID"] as AnyObject?)
}

private func shortpyControlGroups(_ actions: NSArray) -> [ShortpyControlGroup] {
    var groups: [ShortpyControlGroup] = []
    for openIndex in 0..<actions.count {
        guard let open = actions[openIndex] as? NSDictionary,
              shortpyControlMode(open) == 0,
              let groupingIdentifier = shortpyGroupingIdentifier(open) else {
            continue
        }
        var intermediary: [Int] = []
        var closeIndex: Int?
        for index in (openIndex + 1)..<actions.count {
            guard let action = actions[index] as? NSDictionary,
                  shortpyGroupingIdentifier(action) == groupingIdentifier,
                  let mode = shortpyControlMode(action) else {
                continue
            }
            if mode == 1 {
                intermediary.append(index)
            } else if mode == 2 {
                closeIndex = index
                break
            }
        }
        guard let closeIndex else {
            continue
        }
        var branches: [Range<Int>] = []
        var start = openIndex + 1
        for boundary in intermediary {
            branches.append(start..<boundary)
            start = boundary + 1
        }
        branches.append(start..<closeIndex)
        groups.append(
            ShortpyControlGroup(
                openIndex: openIndex,
                closeIndex: closeIndex,
                branches: branches
            )
        )
    }
    return groups
}

private func shortpyFinalActionIndex(
    in branch: Range<Int>, actions: NSArray
) -> Int? {
    for index in branch.reversed() {
        guard let action = actions[index] as? NSDictionary else {
            continue
        }
        if shortpyControlMode(action) == nil {
            return index
        }
    }
    return nil
}

private func shortpyPlanBranches(
    plan: ShortpyRecurrencePlan,
    group: ShortpyControlGroup
) -> [Range<Int>] {
    var branches = group.branches
    if plan.controlKind == 2, branches.first?.isEmpty == true {
        branches.removeFirst()
    }
    return branches
}

private func shortpyActionOutputAttachments(
    _ value: Any,
    path: [String] = []
) -> [ShortpyAttachmentPath: NSDictionary] {
    if let dictionary = value as? NSDictionary {
        if stringFromObject(dictionary["Type"] as AnyObject?) == "ActionOutput",
           stringFromObject(dictionary["OutputUUID"] as AnyObject?) != nil {
            return [ShortpyAttachmentPath(components: path): dictionary]
        }
        var result: [ShortpyAttachmentPath: NSDictionary] = [:]
        let keys = dictionary.allKeys
            .map(String.init(describing:))
            .sorted()
        for key in keys {
            guard let child = dictionary[key] else {
                continue
            }
            result.merge(
                shortpyActionOutputAttachments(child, path: path + [key]),
                uniquingKeysWith: { current, _ in current }
            )
        }
        return result
    }
    if let array = value as? NSArray {
        var result: [ShortpyAttachmentPath: NSDictionary] = [:]
        for index in 0..<array.count {
            result.merge(
                shortpyActionOutputAttachments(
                    array[index], path: path + ["#\(index)"]
                ),
                uniquingKeysWith: { current, _ in current }
            )
        }
        return result
    }
    return [:]
}

private func shortpySetValue(
    _ value: Any,
    at path: ShortpyAttachmentPath,
    in root: NSMutableDictionary
) -> Bool {
    guard let final = path.components.last else {
        return false
    }
    var cursor: Any = root
    for component in path.components.dropLast() {
        if component.hasPrefix("#"),
           let index = Int(component.dropFirst()),
           let array = cursor as? NSMutableArray,
           index < array.count {
            cursor = array[index]
        } else if let dictionary = cursor as? NSMutableDictionary,
                  let child = dictionary[component] {
            cursor = child
        } else {
            return false
        }
    }
    if final.hasPrefix("#"),
       let index = Int(final.dropFirst()),
       let array = cursor as? NSMutableArray,
       index < array.count {
        array[index] = value
        return true
    }
    if let dictionary = cursor as? NSMutableDictionary {
        dictionary[final] = value
        return true
    }
    return false
}

private func shortpyRecurrencePaths(
    plan: ShortpyRecurrencePlan,
    group: ShortpyControlGroup,
    actions: NSArray
) -> [Int: ShortpyAttachmentPath]? {
    let branches = shortpyPlanBranches(plan: plan, group: group)
    let branchIndexes = plan.targetBranches + plan.seedBranches
    guard let maximumBranch = branchIndexes.max(),
          maximumBranch < branches.count else {
        return nil
    }
    var finalActions: [Int: NSDictionary] = [:]
    var identifiers = Set<String>()
    for branchIndex in Set(branchIndexes) {
        guard let actionIndex = shortpyFinalActionIndex(
            in: branches[branchIndex], actions: actions
        ), let action = actions[actionIndex] as? NSDictionary,
              let identifier = stringFromObject(
                action["WFWorkflowActionIdentifier"] as AnyObject?
              ) else {
            return nil
        }
        finalActions[branchIndex] = action
        identifiers.insert(identifier)
    }
    guard identifiers.count == 1 else {
        return nil
    }

    var result: [Int: ShortpyAttachmentPath] = [:]
    for targetBranch in plan.targetBranches {
        guard let targetAction = finalActions[targetBranch] else {
            return nil
        }
        let targetAttachments = shortpyActionOutputAttachments(
            shortpyActionParameters(targetAction)
        )
        var candidates = Set<ShortpyAttachmentPath>()
        for seedBranch in plan.seedBranches {
            guard let seedAction = finalActions[seedBranch] else {
                continue
            }
            let seedAttachments = shortpyActionOutputAttachments(
                shortpyActionParameters(seedAction)
            )
            for (path, targetAttachment) in targetAttachments {
                guard let seedAttachment = seedAttachments[path],
                      let targetUUID = stringFromObject(
                        targetAttachment["OutputUUID"] as AnyObject?
                      ),
                      targetUUID == stringFromObject(
                        seedAttachment["OutputUUID"] as AnyObject?
                      ) else {
                    continue
                }
                candidates.insert(path)
            }
        }
        guard candidates.count == 1, let path = candidates.first else {
            return nil
        }
        result[targetBranch] = path
    }
    return result
}

private func shortpySerializedActionSnapshots(
    _ workflowActions: NSArray
) throws -> NSMutableArray {
    let snapshots = NSMutableArray(capacity: workflowActions.count)
    for index in 0..<workflowActions.count {
        let action = workflowActions[index] as AnyObject
        guard let identifier = stringFromObject(
            performObjectSelector(action, "identifier")
        ), !identifier.isEmpty else {
            throw bridgeFailure(
                "WFAction at index \(index) did not provide an identifier"
            )
        }
        guard let serialized = performObjectSelector(action, "serializedParameters"),
              let parameters = propertyListReadyValue(serialized) as? NSDictionary else {
            throw bridgeFailure(
                "WFAction \(identifier) at index \(index) did not provide serializedParameters"
            )
        }
        snapshots.add(NSMutableDictionary(dictionary: [
            "WFWorkflowActionIdentifier": identifier,
            "WFWorkflowActionParameters": parameters,
        ]))
    }
    return snapshots
}

private func applyShortpyRecurrenceLowering(
    actionSnapshots: NSArray,
    workflowActions: NSArray,
    plans: [ShortpyRecurrencePlan]
) throws -> (actions: NSArray, report: [[String: Any]]) {
    guard !plans.isEmpty else {
        return (actionSnapshots, [])
    }
    guard let actions = propertyListReadyValue(actionSnapshots) as? NSMutableArray,
          actions.count == workflowActions.count else {
        throw bridgeFailure("Shortpy recurrence lowering requires aligned workflow actions")
    }
    let groups = shortpyControlGroups(actions)
    var usedGroups = Set<Int>()
    var report: [[String: Any]] = []

    for (planIndex, plan) in plans.enumerated() {
        var selected: (
            index: Int,
            group: ShortpyControlGroup,
            branches: [Range<Int>],
            paths: [Int: ShortpyAttachmentPath]
        )?
        for (groupIndex, group) in groups.enumerated() where !usedGroups.contains(groupIndex) {
            if let paths = shortpyRecurrencePaths(
                plan: plan, group: group, actions: actions
            ) {
                selected = (
                    groupIndex,
                    group,
                    shortpyPlanBranches(plan: plan, group: group),
                    paths
                )
                break
            }
        }
        guard let selected,
              let closeAction = actions[selected.group.closeIndex] as? NSDictionary,
              let closeUUID = shortpyActionUUID(closeAction) else {
            throw bridgeFailure(
                "unsupportedLoopCarriedRecurrence: native workflow structure did not uniquely match recurrence plan \(planIndex)"
            )
        }
        let closeWorkflowAction = workflowActions[selected.group.closeIndex] as AnyObject
        var outputName = stringFromObject(
            performObjectSelector(closeWorkflowAction, "outputName")
        )
        if outputName == nil {
            outputName = shortpyActionOutputAttachments(actions)
                .values
                .first(where: {
                    stringFromObject($0["OutputUUID"] as AnyObject?) == closeUUID
                })
                .flatMap {
                    stringFromObject($0["OutputName"] as AnyObject?)
                }
        }
        guard let outputName, !outputName.isEmpty else {
            throw bridgeFailure(
                "unsupportedLoopCarriedRecurrence: native control-flow output name is unavailable"
            )
        }

        var rewrittenBranches: [[String: Any]] = []
        for targetBranch in plan.targetBranches {
            guard let path = selected.paths[targetBranch],
                  let actionIndex = shortpyFinalActionIndex(
                    in: selected.branches[targetBranch], actions: actions
                  ), let action = actions[actionIndex] as? NSMutableDictionary,
                  let parameters = action["WFWorkflowActionParameters"] as? NSMutableDictionary,
                  let original = shortpyActionOutputAttachments(parameters)[path] else {
                throw bridgeFailure(
                    "unsupportedLoopCarriedRecurrence: recursive action attachment disappeared"
                )
            }
            let replacement = NSMutableDictionary(dictionary: original)
            let previousUUID = stringFromObject(
                replacement["OutputUUID"] as AnyObject?
            ) ?? ""
            replacement["OutputUUID"] = closeUUID as NSString
            replacement["OutputName"] = outputName as NSString
            guard shortpySetValue(replacement, at: path, in: parameters) else {
                throw bridgeFailure(
                    "unsupportedLoopCarriedRecurrence: could not replace recursive action attachment"
                )
            }
            rewrittenBranches.append([
                "branch": targetBranch,
                "actionIndex": actionIndex,
                "parameterPath": path.components,
                "fromOutputUUID": previousUUID,
                "toOutputUUID": closeUUID,
                "outputName": outputName,
            ])
        }
        usedGroups.insert(selected.index)
        report.append([
            "plan": plan.json,
            "openActionIndex": selected.group.openIndex,
            "closeActionIndex": selected.group.closeIndex,
            "rewrites": rewrittenBranches,
        ])
    }
    return (actions, report)
}

private func applyShortpyRecurrenceToWorkflow(
    _ workflow: AnyObject,
    plans: [ShortpyRecurrencePlan]
) throws -> [[String: Any]] {
    guard !plans.isEmpty else {
        return []
    }
    guard let workflowActions = performObjectSelector(workflow, "actions") as? NSArray else {
        throw bridgeFailure("WFWorkflow did not return actions for native recurrence lowering")
    }
    let actionSnapshots = try shortpySerializedActionSnapshots(workflowActions)
    let lowering = try applyShortpyRecurrenceLowering(
        actionSnapshots: actionSnapshots,
        workflowActions: workflowActions,
        plans: plans
    )
    guard actionSnapshots.count == lowering.actions.count else {
        throw bridgeFailure(
            "unsupportedLoopCarriedRecurrence: native workflow action snapshot changed shape"
        )
    }

    var mutatedActionIndices: [Int] = []
    for index in 0..<lowering.actions.count {
        guard let originalAction = actionSnapshots[index] as? NSDictionary,
              let rewrittenAction = lowering.actions[index] as? NSDictionary,
              let originalParameters = originalAction["WFWorkflowActionParameters"] as? NSDictionary,
              let rewrittenParameters = rewrittenAction["WFWorkflowActionParameters"] as? NSDictionary else {
            throw bridgeFailure(
                "unsupportedLoopCarriedRecurrence: malformed action parameters at index \(index)"
            )
        }
        if originalParameters.isEqual(rewrittenParameters) {
            continue
        }
        guard bridgeShortpyReplaceWorkflowActionSerializedParameters(
            workflow,
            UInt64(index),
            rewrittenParameters
        ) else {
            throw bridgeFailure(
                "unsupportedLoopCarriedRecurrence: failed to reconstruct native WFAction at index \(index)"
            )
        }
        mutatedActionIndices.append(index)
    }
    guard !mutatedActionIndices.isEmpty else {
        throw bridgeFailure(
            "unsupportedLoopCarriedRecurrence: lowering plan produced no native action mutations"
        )
    }
    return lowering.report.map { entry in
        var nativeEntry = entry
        nativeEntry["nativeMutation"] = [
            "boundary": "WFAction initWithIdentifier:definition:serializedParameters:",
            "actionIndices": mutatedActionIndices,
            "before": "WFWorkflow.saveToRecord",
        ]
        return nativeEntry
    }
}

private func workflowFileFromData(_ data: Data) throws -> AnyObject {
    guard let allocated = objcAlloc("WFWorkflowFile") else {
        throw bridgeFailure("WFWorkflowFile class is not loaded")
    }
    guard let file = objcSend3(
        allocated,
        "initWithFileData:name:error:",
        data as NSData,
        "Runtime IDE Import" as NSString,
        nil
    ) else {
        throw bridgeFailure("WFWorkflowFile initWithFileData:name:error: returned nil")
    }
    return file
}

private func workflowFromWorkflowFileRecordRoute(
    _ file: AnyObject
) throws -> (workflow: AnyObject, record: AnyObject) {
    guard objcResponds(file, "recordRepresentationWithError:") else {
        throw bridgeFailure("WFWorkflowFile is missing recordRepresentationWithError:")
    }
    guard let record = objcSend1(file, "recordRepresentationWithError:", nil) else {
        throw bridgeFailure("WFWorkflowFile recordRepresentationWithError: returned nil")
    }
    guard let allocated = objcAlloc("WFWorkflow") else {
        throw bridgeFailure("WFWorkflow class is not loaded")
    }
    guard let workflow = objcSend4(
        allocated,
        "initWithRecord:reference:storageProvider:error:",
        record,
        nil,
        nil,
        nil
    ) else {
        throw bridgeFailure("WFWorkflow initWithRecord:reference:storageProvider:error: returned nil")
    }
    return (workflow, record)
}

private func pythonCodeFromWorkflow(
    _ workflow: AnyObject,
    pipeline: RuntimePipeline
) throws -> PythonExportResult {
    let exportWorkflow: AnyObject
    var adaptedActionCount = UInt64(0)
    switch pipeline {
    case .native:
        exportWorkflow = workflow
    case .shortpy:
        guard let adapted = bridgeShortpyMakeEditExportWorkflow(
            workflow,
            &adaptedActionCount
        ) else {
            throw bridgeFailure(
                "ShortpyEditModeContext could not clone and adapt the native WFWorkflow"
            )
        }
        exportWorkflow = adapted
    }
    var context = EditModeContextStorage()
    if let errorPointer = bridgeDescribeEditModeContextNil(&context, exportWorkflow) {
        throw bridgeFailure(
            "\(pipeline == .native ? "editModeContext(for:)" : "ShortpyEditModeContext") threw Swift error pointer \(String(format: "%p", UInt(bitPattern: errorPointer)))"
        )
    }
    guard let proxy = objectFromPointer(context.w2) else {
        throw bridgeFailure("editModeContext(for:) did not populate exportedWorkflow at word 2")
    }
    guard let python = stringFromObject(performObjectSelector(proxy, "pythonCode")), !python.isEmpty else {
        throw bridgeFailure("exportedWorkflow object class \(objectClassName(proxy)) did not return pythonCode")
    }
    return PythonExportResult(
        python: python,
        proxy: proxy,
        context: context,
        pipeline: pipeline,
        adaptedActionCount: adaptedActionCount
    )
}

private func plistToPythonPayload(
    from root: NSDictionary,
    inputLength: Int,
    mode: String,
    pipeline: RuntimePipeline
) throws -> [String: Any] {
    let data = try plistData(from: root)
    var payload = try workflowFileDataToPythonPayload(
        from: data,
        mode: mode,
        pipeline: pipeline
    )
    payload["input_length"] = inputLength
    payload["plist_input"] = [
        "encoding": "json-dictionary-normalized-to-bplist",
        "normalized_bplist_length": data.count,
    ]
    return payload
}

private func workflowFileDataToPythonPayload(
    from data: Data,
    mode: String,
    pipeline: RuntimePipeline
) throws -> [String: Any] {
    let root = try plistRootFromData(data)
    let file = try workflowFileFromData(data)
    let recordRoute = try workflowFromWorkflowFileRecordRoute(file)
    let pythonResult = try pythonCodeFromWorkflow(
        recordRoute.workflow,
        pipeline: pipeline
    )
    let triggers = workflowTriggerMetadata(from: root)
    let importContext = rememberImportedPythonContext(
        source: pythonResult.python,
        originalData: data,
        rootSummary: rootSummary(root),
        proxy: pythonResult.proxy
    )
    return [
        "ok": true,
        "mode": mode,
        "runtime_pipeline": pipeline.name,
        "edit_mode_export": [
            "kind": pipeline == .native
                ? "DescribeAShortcutAgent.editModeContext(for:)"
                : "ShortpyEditModeContext over an adapted WFWorkflow copy",
            "adapted_action_count": Int(pythonResult.adaptedActionCount),
            "global_hooks": false,
            "executable_patches": false,
        ],
        "input_length": data.count,
        "workflow_file": workflowFileSummary(file),
        "record_route": [
            "kind": "WFWorkflowFile initWithFileData:name:error: + recordRepresentationWithError: + WFWorkflow initWithRecord:reference:storageProvider:error:",
            "record": selectorProbe(recordRoute.record, selectors: [
                "name",
                "actions",
                "actionCount",
                "unifiedAutomationTriggers",
                "workflowTypes",
                "inputClasses",
                "outputClasses",
                "minimumClientVersion",
            ]),
            "workflow": selectorProbe(recordRoute.workflow, selectors: [
                "name",
                "actions",
                "triggers",
                "unifiedAutomationTriggers",
                "workflowTypes",
                "inputClasses",
                "outputClasses",
                "serializeTriggersWhenSaving",
                "serializeActionsWhenSaving",
            ]),
            "workflow_summary": workflowSummary(from: CompiledShortcut(
                trigger: 0,
                workflow: UInt64(UInt(bitPattern: Unmanaged.passUnretained(recordRoute.workflow).toOpaque())),
                errorPolicyDecisions: 0
            )),
            "file_unifiedAutomationTriggers": objectSummary(performObjectSelector(file, "unifiedAutomationTriggers")),
            "workflow_unifiedAutomationTriggers": objectSummary(performObjectSelector(recordRoute.workflow, "unifiedAutomationTriggers")),
            "workflow_triggers": objectSummary(performObjectSelector(recordRoute.workflow, "triggers")),
        ],
        "edit_mode_context_words": [
            pointerString(pythonResult.context.w0),
            pointerString(pythonResult.context.w1),
            pointerString(pythonResult.context.w2),
            pointerString(pythonResult.context.w3),
        ],
        "exported_workflow_proxy": [
            "class": objectClassName(pythonResult.proxy),
            "pointer": objectPointerString(pythonResult.proxy),
        ],
        "import_context": importContextSummary(importContext),
        "trigger_metadata": [
            "kind": "native editModeContext trigger decorators from WFWorkflow.unifiedAutomationTriggers",
            "present": triggers != nil,
            "count": triggers?.count ?? 0,
            "raw_python_contains_when_decorator": pythonResult.python.contains("@when_"),
            "exported_python_contains_when_decorator": pythonResult.python.contains("@when_"),
            "exported_python_contains_metadata_comment": false,
        ],
        "raw_python_code": pythonResult.python,
        "raw_python_length": pythonResult.python.utf8.count,
        "python_code": pythonResult.python,
        "python_length": pythonResult.python.utf8.count,
    ]
}

private func agentToolboxQueryPayload(
    query: String,
    kind: String,
    limit: Int
) async throws -> [String: Any] {
    let clampedLimit = max(1, min(limit, 50))
    let type: ToolEmbeddingRecordToolTypeStorage
    switch kind {
    case "tool", "tools", "action", "actions":
        type = ToolEmbeddingRecordToolTypeStorage(rawValue: 1)
    case "trigger", "triggers":
        type = ToolEmbeddingRecordToolTypeStorage(rawValue: 2)
    default:
        throw bridgeFailure("unsupported AgentToolbox query kind \(kind); expected tool or trigger")
    }
    let toolbox = try agentToolboxInit(
        alwaysIncludedToolIdentifiers: agentToolboxDefaultAlwaysIncludedToolIdentifiers()
    )
    var result = try await agentToolboxQuery(query, [type: clampedLimit], toolbox)
    let rendered = withUnsafePointer(to: &result) { resultPointer in
        bridgeAgentToolboxResultStringRepresentation(resultPointer)
    }
    return [
        "ok": true,
        "mode": "agent-toolbox-query",
        "source": "ShortcutsAgent.AgentToolbox.query + AgentToolbox.Result.stringRepresentation",
        "query": query,
        "kind": kind,
        "limit": clampedLimit,
        "toolbox_words": [
            pointerString(toolbox.w0),
            pointerString(toolbox.w1),
            pointerString(toolbox.w2),
            pointerString(toolbox.w3),
            pointerString(toolbox.w4),
            pointerString(toolbox.w5),
            pointerString(toolbox.w6),
            pointerString(toolbox.w7),
        ],
        "result_words": [
            pointerString(result.w0),
            pointerString(result.w1),
            pointerString(result.w2),
            pointerString(result.w3),
            pointerString(result.w4),
            pointerString(result.w5),
        ],
        "tool_type_raw": type.rawValue,
        "string_representation": rendered,
        "string_length": rendered.utf8.count,
    ]
}

@MainActor
private func agentToolboxQueryPayloadMainActor(
    query: String,
    kind: String,
    limit: Int
) async throws -> [String: Any] {
    var payload = try await agentToolboxQueryPayload(query: query, kind: kind, limit: limit)
    payload["scheduler"] = "MainActor"
    return payload
}

private func agentToolboxInitDumpPayload() throws -> [String: Any] {
    let identifiers = agentToolboxDefaultAlwaysIncludedToolIdentifiers()
    let toolbox = try agentToolboxInit(alwaysIncludedToolIdentifiers: identifiers)
    return [
        "ok": true,
        "mode": "agent-toolbox-init-dump",
        "source": "ShortcutsAgent.AgentToolbox.init(alwaysIncludedToolIdentifiers:)",
        "always_included_count": identifiers.count,
        "toolbox_words": [
            pointerString(toolbox.w0),
            pointerString(toolbox.w1),
            pointerString(toolbox.w2),
            pointerString(toolbox.w3),
            pointerString(toolbox.w4),
            pointerString(toolbox.w5),
            pointerString(toolbox.w6),
            pointerString(toolbox.w7),
        ],
        "notes": [
            "Raw words only; fields are intentionally not dereferenced here so invalid/private storage cannot crash the bridge.",
            "Static init disassembly writes primary fields at offsets 0x0, 0x8, and the metadata-provided third field offset.",
        ],
    ]
}

private let fallbackAppEntities: [(name: String, bundleIdentifier: String)] = [
    ("Shortcuts", "com.apple.shortcuts"),
    ("Safari", "com.apple.mobilesafari"),
    ("Settings", "com.apple.Preferences"),
    ("Messages", "com.apple.MobileSMS"),
    ("Mail", "com.apple.mobilemail"),
    ("Photos", "com.apple.mobileslideshow"),
    ("Music", "com.apple.Music"),
    ("Calendar", "com.apple.mobilecal"),
    ("Reminders", "com.apple.reminders"),
    ("Notes", "com.apple.mobilenotes"),
    ("Clock", "com.apple.mobiletimer"),
    ("Maps", "com.apple.Maps"),
    ("Phone", "com.apple.mobilephone"),
    ("Camera", "com.apple.camera"),
    ("App Store", "com.apple.AppStore"),
]

private func isAppDescriptorResolve(_ request: ResolveEntityRequestInput) -> Bool {
    let type = request.methodParameterType.lowercased()
    return type.contains("wfapp_descriptor")
        || type.contains("wfapp")
        || request.methodName.lowercased().contains("app")
        || request.methodParameterName.lowercased() == "app"
}

private func fallbackAppEntityCandidates(for query: String) -> [(name: String, bundleIdentifier: String)] {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalized.isEmpty else {
        return fallbackAppEntities
    }
    let direct = fallbackAppEntities.filter { app in
        app.name.lowercased().contains(normalized)
            || app.bundleIdentifier.lowercased().contains(normalized)
            || normalized.contains(app.name.lowercased())
    }
    if !direct.isEmpty {
        return direct
    }
    if normalized.contains(".") {
        let name = query.split(separator: ".").last.map(String.init) ?? query
        return [(name: name, bundleIdentifier: query)]
    }
    return []
}

private func resolveEntityFallbackPayloadJson(from request: ResolveEntityRequestInput) -> String {
    let candidates = isAppDescriptorResolve(request)
        ? fallbackAppEntityCandidates(for: request.query)
        : []
    let candidateJson = candidates.enumerated().map { index, app -> String in
        let ref = String(format: "ref(0x%04x)", index)
        let metadata = jsonString([
            "Bundle Identifier": app.bundleIdentifier,
            "Name": app.name,
        ])
        let fields = [
            "\"index\":\(index)",
            "\"ref\":\(jsonStringLiteral(ref))",
            "\"tag\":\(jsonStringLiteral(String(format: "0x%04x", index)))",
            "\"python_argument\":\(jsonStringLiteral(ref))",
            "\"display_name\":\(jsonStringLiteral(app.name))",
            "\"bundle_identifier\":\(jsonStringLiteral(app.bundleIdentifier))",
            "\"metadata\":\(jsonStringLiteral(metadata))",
        ]
        return "{\(fields.joined(separator: ","))}"
    }.joined(separator: ",")
    let resultJson = candidates.enumerated().map { index, app -> String in
        let tag = String(format: "0x%04X", index)
        let metadata = jsonString([
            "Bundle Identifier": app.bundleIdentifier,
            "Name": app.name,
        ])
        return "{\(jsonStringLiteral(tag)):\(jsonStringLiteral(metadata))}"
    }.joined(separator: ",")
    let content: String
    if candidates.isEmpty {
        content = "No fallback entity candidates found. Native FindEntitiesTool.call remains debug-only until its resilient Swift ABI is fully wrapped."
    } else {
        content = candidates.enumerated().map { index, app in
            "\(index): \(app.name) (\(app.bundleIdentifier)) -> ref(0x\(String(format: "%04x", index)))"
        }.joined(separator: "\n")
    }
    let fields = [
        "\"ok\":true",
        "\"mode\":\"resolve_entity\"",
        "\"agent_tool\":\"resolve_entity\"",
        "\"source\":\"bridge fallback over ToolRenderer-compatible entity metadata; native FindEntitiesTool.call is debug-only\"",
        "\"native_find_entities_enabled\":false",
        "\"native_find_entities_status\":\"disabled by default after repeated EXC_BAD_ACCESS in FindEntitiesTool.Arguments copy; pass debug_native_find_entities=true only for guarded RE\"",
        "\"query\":\(jsonStringLiteral(request.query))",
        "\"method_name\":\(jsonStringLiteral(request.methodName))",
        "\"method_parameter_name\":\(jsonStringLiteral(request.methodParameterName))",
        "\"method_parameter_type\":\(jsonStringLiteral(request.methodParameterType))",
        "\"workflow_id\":\(request.workflowID.isEmpty ? "null" : jsonStringLiteral(request.workflowID))",
        "\"content\":\(jsonStringLiteral(content))",
        "\"content_length\":\(content.utf8.count)",
        "\"results\":[\(resultJson)]",
        "\"candidates\":[\(candidateJson)]",
        "\"catalog_metadata\":{\"status\":\"fallback app descriptor metadata; refs require WFParameterStateCatalog injection before compile\",\"entities\":[\(candidateJson)]}",
    ]
    return "{\(fields.joined(separator: ","))}"
}

@MainActor
private func resolveEntityPayloadJson(from request: ResolveEntityRequestInput) async throws -> String {
    if !request.debugNativeFindEntities {
        return resolveEntityFallbackPayloadJson(from: request)
    }

    let query = request.query
    let methodName = request.methodName
    let methodParameterName = request.methodParameterName
    let methodParameterType = request.methodParameterType
    let workflowID = request.workflowID

    let databaseProvider = sharedToolDatabaseProvider()
    let database = try bridgeSharedToolDatabaseProviderDatabase(databaseProvider)
    let importContext = latestImportCatalogContext()
    let catalog = importContext?.proxyCatalog ?? defaultInitialCatalog()
    let tool = findEntitiesToolInit(
        database,
        catalog,
        workflowID.isEmpty ? nil : workflowID,
        nil
    )
    let arguments = findEntitiesArgumentsInit(
        methodName,
        methodParameterName,
        methodParameterType,
        query
    )
    let eventStream = bridgeMakeDescribeAgentEventStream()
    let output = try await findEntitiesToolCall(arguments, eventStream, tool)

    let catalogSource = importContext == nil
        ? "defaultInitialCatalog"
        : "latest plist-data-to-python import via \(importContext?.proxyCatalogSelector ?? "unknown selector")"
    let fields = [
        "\"ok\":true",
        "\"mode\":\"resolve_entity\"",
        "\"agent_tool\":\"resolve_entity\"",
        "\"source\":\"ShortcutsAgent.FindEntitiesTool.call(arguments:agentEventStream:)\"",
        "\"query\":\(jsonStringLiteral(query))",
        "\"method_name\":\(jsonStringLiteral(methodName))",
        "\"method_parameter_name\":\(jsonStringLiteral(methodParameterName))",
        "\"method_parameter_type\":\(jsonStringLiteral(methodParameterType))",
        "\"workflow_id\":\(workflowID.isEmpty ? "null" : jsonStringLiteral(workflowID))",
        "\"catalog\":\(jsonStringLiteral(objectClassName(catalog)))",
        "\"catalog_pointer\":\(jsonStringLiteral(objectPointerString(catalog)))",
        "\"catalog_source\":\(jsonStringLiteral(catalogSource))",
        "\"database_class\":\(jsonStringLiteral(objectClassName(database)))",
        "\"database_pointer\":\(jsonStringLiteral(objectPointerString(database)))",
        "\"tool_storage_prefix\":\(jsonStringLiteral(shortHexPrefix(of: tool)))",
        "\"arguments_storage_prefix\":\(jsonStringLiteral(shortHexPrefix(of: arguments)))",
        "\"output_storage_prefix\":\(jsonStringLiteral(shortHexPrefix(of: output)))",
        "\"content\":null",
        "\"content_length\":null",
        "\"native_call_completed\":true",
        "\"catalog_metadata\":{\"status\":\"native FindEntitiesTool call completed; content getter is disabled until the output string ownership shim is fixed\",\"catalog_pointer\":\(jsonStringLiteral(objectPointerString(catalog)))}",
    ]
    return "{\(fields.joined(separator: ","))}"
}

private func toolRendererPythonInterfacePayload() async throws -> [String: Any] {
    let databaseProvider = sharedToolDatabaseProvider()
    let database = try bridgeSharedToolDatabaseProviderDatabase(databaseProvider)
    let parameterMetadataProvider = try wfParameterMetadataProviderExistential()
    var shims = CompatibilityShimsStorage()
    bridgeMakeToolRendererCompatibilityShimsDefaultNone(&shims)
    let rendered = try await callToolRendererPythonInterface(
        database: database,
        parameterMetadataProvider: parameterMetadataProvider,
        shims: &shims
    )
    let interface = rendered.interface

    return [
        "ok": true,
        "mode": "toolrenderer-python-interface",
        "source": "ToolRenderer.pythonInterface(database:filterProvider:parameterMetadataProvider:shims)",
        "compatibility_shims": "ToolRenderer.CompatibilityShims.defaultNone",
        "toolrenderer_python_interface_symbol": rendered.symbol,
        "toolrenderer_filter_provider_default_symbol": rendered.defaultArgumentSymbol as Any,
        "database_source": "ToolKit.SharedToolDatabaseProvider.shared.database() via x20 thunk shim",
        "database_provider_class": objectClassName(databaseProvider),
        "database_provider_pointer": objectPointerString(databaseProvider),
        "database_class": objectClassName(database),
        "database_pointer": objectPointerString(database),
        "filter_provider_words": [
            pointerString(rendered.filterProvider.buffer0),
            pointerString(rendered.filterProvider.buffer1),
            pointerString(rendered.filterProvider.buffer2),
            pointerString(rendered.filterProvider.type),
            pointerString(rendered.filterProvider.witness),
        ],
        "parameter_metadata_provider_words": [
            pointerString(parameterMetadataProvider.buffer0),
            pointerString(parameterMetadataProvider.buffer1),
            pointerString(parameterMetadataProvider.buffer2),
            pointerString(parameterMetadataProvider.type),
            pointerString(parameterMetadataProvider.witness),
        ],
        "compatibility_shims_raw": shims.rawValue,
        "python_interface": interface,
        "python_length": interface.utf8.count,
        "contains_trigger": interface.contains("trigger"),
        "contains_shortcut": interface.contains("shortcut"),
    ]
}


private func toolRendererStructuredMetadataPayload() async throws -> [String: Any] {
    var payload = try await toolRendererPythonInterfacePayload()
    payload["mode"] = "toolrenderer-structured-metadata"
    payload["source"] = "ToolRenderer.pythonInterface(database:filterProvider:parameterMetadataProvider:shims); structured parsing is performed host-side"
    payload["generatedAt"] = ISO8601DateFormatter().string(from: Date())
    payload["items"] = []
    payload["types"] = []
    payload["diagnostics"] = [[
        "code": "hostStructuredParser",
        "message": "Native ToolRenderer returned the authoritative Python interface. Host parsing structures the Python definitions for IDE hovers, completions, signatures, and diagnostics.",
    ]]
    payload["provider_symbols"] = [
        "binding_toolID": symbolAddress("$s12ToolRenderer25ParameterMetadataProviderPAAE7binding6toolIDAA0cD0VSS_tF") == nil ? "missing" : "present",
        "binding_triggerID": symbolAddress("$s12ToolRenderer25ParameterMetadataProviderPAAE7binding9triggerIDAA0cD0VSS_tF") == nil ? "missing" : "present",
        "wf_provider_conformance": symbolAddress("$s11WorkflowKit27WFParameterMetadataProviderV12ToolRenderer09ParameterdE0AAMc") == nil ? "missing" : "present",
    ]
    return payload
}

private func symbolAddress(_ name: String) -> UnsafeRawPointer? {
    name.withCString { symbolName in
        guard let pointer = bridgeDlsymDefault(symbolName) else {
            return nil
        }
        return UnsafeRawPointer(pointer)
    }
}

private func callToolRendererPythonInterface(
    database: AnyObject,
    parameterMetadataProvider: ProtocolExistentialStorage,
    shims: UnsafePointer<CompatibilityShimsStorage>
) async throws -> ToolRendererPythonInterfaceResult {
    if let pointer = symbolAddress(toolRendererPythonInterfaceRequiredFilterSymbol) {
        appendRecordFileProbeStage("toolrenderer select required function=\(pointerString(pointer))")
        bridgeSetToolRendererPythonInterfaceTarget(pointer)
        let filterProvider = nullFilterProviderExistential()
        appendRecordFileProbeStage("toolrenderer required null provider type=\(pointerString(filterProvider.type)) witness=\(pointerString(filterProvider.witness))")
        appendRecordFileProbeStage("toolrenderer required native call before")
        let interface = try await bridgeToolRendererPythonInterfaceSelected(
            database,
            filterProvider,
            parameterMetadataProvider,
            shims
        )
        appendRecordFileProbeStage("toolrenderer required native call after length=\(interface.utf8.count)")
        return ToolRendererPythonInterfaceResult(
            interface: interface,
            symbol: toolRendererPythonInterfaceRequiredFilterSymbol,
            defaultArgumentSymbol: "bridge-null-filter-provider",
            filterProvider: filterProvider
        )
    }
    if let pointer = symbolAddress(toolRendererPythonInterfaceOptionalFilterSymbol) {
        appendRecordFileProbeStage("toolrenderer select optional function=\(pointerString(pointer))")
        bridgeSetToolRendererPythonInterfaceTarget(pointer)
        let filterProvider = ProtocolExistentialStorage()
        appendRecordFileProbeStage("toolrenderer optional nil provider")
        appendRecordFileProbeStage("toolrenderer optional native call before")
        let interface = try await bridgeToolRendererPythonInterfaceSelected(
            database,
            filterProvider,
            parameterMetadataProvider,
            shims
        )
        appendRecordFileProbeStage("toolrenderer optional native call after length=\(interface.utf8.count)")
        return ToolRendererPythonInterfaceResult(
            interface: interface,
            symbol: toolRendererPythonInterfaceOptionalFilterSymbol,
            defaultArgumentSymbol: nil,
            filterProvider: filterProvider
        )
    }
    throw bridgeFailure("missing ToolRenderer.pythonInterface symbol for both required and optional filterProvider variants")
}

private func nullFilterProviderExistential() -> ProtocolExistentialStorage {
    let metadata = unsafeBitCast(Int.self, to: UnsafeRawPointer.self)
    let witness = bridgeNullFilterProviderWitnessTablePointer()
    return ProtocolExistentialStorage(
        buffer0: 0,
        buffer1: 0,
        buffer2: 0,
        type: UInt64(UInt(bitPattern: metadata)),
        witness: UInt64(UInt(bitPattern: witness))
    )
}

private func wfParameterMetadataProviderExistential() throws -> ProtocolExistentialStorage {
    let metadata = wfParameterMetadataProviderMetadata(0)
    guard let conformance = symbolAddress("$s11WorkflowKit27WFParameterMetadataProviderV12ToolRenderer09ParameterdE0AAMc") else {
        throw bridgeFailure("missing WFParameterMetadataProvider ParameterMetadataProvider conformance")
    }
    let witness = bridgeSwiftGetWitnessTable(conformance, metadata, nil)
    return ProtocolExistentialStorage(
        buffer0: 0,
        buffer1: 0,
        buffer2: 0,
        type: UInt64(UInt(bitPattern: metadata)),
        witness: UInt64(UInt(bitPattern: witness))
    )
}

private func actionPreview(_ action: AnyObject, index: Int) -> [String: Any] {
    var payload: [String: Any] = [
        "index": index,
        "pointer": objectPointerString(action),
        "class": objectClassName(action),
    ]
    for selector in ["identifier", "localizedKeyParameterDisplayName", "outputName", "customOutputName"] {
        if let value = stringFromObject(performObjectSelector(action, selector)), !value.isEmpty {
            payload[selector] = value
        }
    }
    return payload
}

private func workflowSummary(from compiled: CompiledShortcut) -> [String: Any] {
    let objects = compiledShortcutObjectView(compiled)
    var payload: [String: Any] = [
        "compiled_layout": "trigger, workflow, errorPolicyDecisions per ShortcutsLanguage.CompiledShortcut property descriptors",
        "trigger_pointer": pointerString(compiled.trigger),
        "workflow_pointer": pointerString(compiled.workflow),
        "error_policy_decisions_pointer": pointerString(compiled.errorPolicyDecisions),
        "raw_trigger": objectSummary(objects.rawTrigger),
        "raw_workflow": objectSummary(objects.rawWorkflow),
        "getter_trigger": objectSummary(objects.getterTrigger),
        "getter_workflow": objectSummary(objects.getterWorkflow),
        "getter_matches_raw": [
            "trigger": objectPointerString(objects.rawTrigger) == objectPointerString(objects.getterTrigger),
            "workflow": objectPointerString(objects.rawWorkflow) == objectPointerString(objects.getterWorkflow),
        ],
        "preferred_trigger_source": objects.getterTrigger == nil ? "raw slot" : "ShortcutsLanguage.CompiledShortcut.trigger.getter",
        "preferred_workflow_source": objects.getterWorkflow == nil ? "raw slot" : "ShortcutsLanguage.CompiledShortcut.workflow.getter",
    ]

    guard let workflow = objects.preferredWorkflow else {
        payload["workflow_present"] = false
        return payload
    }

    payload["workflow_present"] = true
    payload["workflow_class"] = objectClassName(workflow)
    payload["workflow_object_pointer"] = objectPointerString(workflow)
    payload["root_metadata"] = selectorProbe(workflow, selectors: [
        "workflowTypes",
        "inputClasses",
        "inputContentItemClasses",
        "outputClasses",
        "noInputBehavior",
        "serializeTriggersWhenSaving",
        "serializeActionsWhenSaving",
        "triggers",
        "unifiedAutomationTriggers",
    ])

    if let trigger = objects.preferredTrigger {
        payload["trigger_present"] = true
        payload["trigger_class"] = objectClassName(trigger)
        payload["trigger_object_pointer"] = objectPointerString(trigger)
    } else {
        payload["trigger_present"] = false
    }

    if let actionsObject = performObjectSelector(workflow, "actions") {
        payload["actions_selector_available"] = true
        payload["actions_object_class"] = objectClassName(actionsObject)
        if let actions = actionsObject as? NSArray {
            let previewLimit = min(actions.count, 20)
            payload["action_count"] = actions.count
            payload["action_preview_limit"] = previewLimit
            payload["action_preview"] = (0..<previewLimit).map { index in
                actionPreview(actions.object(at: index) as AnyObject, index: index)
            }
        }
    } else {
        payload["actions_selector_available"] = false
    }

    return payload
}

private func errorPolicyDecisions(from compiled: CompiledShortcut) -> [[String: Any]] {
    guard compiled.errorPolicyDecisions != 0 else {
        return []
    }

    let decisions = unsafeBitCast(compiled.errorPolicyDecisions, to: [ErrorPolicyDecision].self)
    return errorPolicyDecisions(from: decisions)
}

private func errorPolicyDecisions(
    from decisions: [ErrorPolicyDecision],
    phase: String? = nil
) -> [[String: Any]] {
    return decisions.enumerated().map { index, decision in
        var payload: [String: Any] = [
            "index": index,
            "input_description": decision.inputDescription,
            "output_description": jsonValue(decision.outputDescription),
            "debug_log": decision.debugLog,
        ]
        if let phase {
            payload["phase"] = phase
        }
        return payload
    }
}

@_cdecl("bridge_swift_agent_toolbox_init_dump")
public func bridge_swift_agent_toolbox_init_dump() -> UnsafeMutablePointer<CChar>? {
    do {
        return strdup(jsonString(try agentToolboxInitDumpPayload()))
    } catch {
        return strdup(jsonString([
            "ok": false,
            "mode": "agent-toolbox-init-dump",
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ]))
    }
}

@_cdecl("bridge_swift_agent_toolbox_query")
public func bridge_swift_agent_toolbox_query(
    _ cQuery: UnsafePointer<CChar>?,
    _ cKind: UnsafePointer<CChar>?,
    _ rawLimit: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cQuery else {
        return strdup(jsonString(["ok": false, "error": "missing query"]))
    }
    let query = String(cString: cQuery)
    let kind = cKind.map { String(cString: $0) } ?? "trigger"
    let limit = Int(min(rawLimit == 0 ? 3 : rawLimit, 50))
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        do {
            box.payload = jsonString(try await agentToolboxQueryPayload(
                query: query,
                kind: kind,
                limit: limit
            ))
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "agent-toolbox-query",
                "query": query,
                "kind": kind,
                "limit": limit,
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "agent-toolbox-query",
            "query": query,
            "kind": kind,
            "limit": limit,
            "error": "AgentToolbox query timed out",
        ])
    }

    return strdup(box.payload)
}

@_cdecl("bridge_swift_agent_toolbox_query_mainactor")
public func bridge_swift_agent_toolbox_query_mainactor(
    _ cQuery: UnsafePointer<CChar>?,
    _ cKind: UnsafePointer<CChar>?,
    _ rawLimit: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cQuery else {
        return strdup(jsonString(["ok": false, "error": "missing query"]))
    }
    let query = String(cString: cQuery)
    let kind = cKind.map { String(cString: $0) } ?? "trigger"
    let limit = Int(min(rawLimit == 0 ? 3 : rawLimit, 50))
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task { @MainActor in
        do {
            box.payload = jsonString(try await agentToolboxQueryPayloadMainActor(
                query: query,
                kind: kind,
                limit: limit
            ))
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "agent-toolbox-query-mainactor",
                "query": query,
                "kind": kind,
                "limit": limit,
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "agent-toolbox-query-mainactor",
            "query": query,
            "kind": kind,
            "limit": limit,
            "error": "AgentToolbox main-actor query timed out",
        ])
    }

    return strdup(box.payload)
}

@_cdecl("bridge_swift_resolve_entity")
public func bridge_swift_resolve_entity(_ cJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let cJson else {
        return strdup(jsonString(["ok": false, "error": "missing resolve entity JSON"]))
    }

    let requestText = String(cString: cJson)
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        do {
            let request = try resolveEntityRequest(from: requestText)
            box.payload = try await resolveEntityPayloadJson(from: request)
        } catch {
            box.payload = "{"
                + "\"ok\":false,"
                + "\"mode\":\"resolve_entity\","
                + "\"agent_tool\":\"resolve_entity\","
                + "\"request_length\":\(requestText.utf8.count),"
                + "\"diagnostic\":\(jsonStringLiteral(String(describing: error))),"
                + "\"error_type\":\(jsonStringLiteral(String(describing: type(of: error))))"
                + "}"
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = "{"
            + "\"ok\":false,"
            + "\"mode\":\"resolve_entity\","
            + "\"agent_tool\":\"resolve_entity\","
            + "\"request_length\":\(requestText.utf8.count),"
            + "\"error\":\"FindEntitiesTool call timed out\""
            + "}"
    }

    return strdup(box.payload)
}

@_cdecl("bridge_swift_catalog_dump_latest")
public func bridge_swift_catalog_dump_latest() -> UnsafeMutablePointer<CChar>? {
    let context = latestImportCatalogContext()
    return strdup(jsonString(catalogDumpPayload(context: context)))
}

@_cdecl("bridge_swift_catalog_encode_latest_debug")
public func bridge_swift_catalog_encode_latest_debug() -> UnsafeMutablePointer<CChar>? {
    let context = latestImportCatalogContext()
    return strdup(jsonString(catalogEncodeLatestDebugPayload(context: context)))
}

@_cdecl("bridge_swift_expand_inline_catalog_metadata")
public func bridge_swift_expand_inline_catalog_metadata(_ cJson: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let cJson else {
        return strdup(jsonString(["ok": false, "error": "missing inline catalog JSON"]))
    }
    let text = String(cString: cJson)
    do {
        return strdup(jsonString(try expandInlineCatalogPayload(from: text)))
    } catch {
        return strdup(jsonString([
            "ok": false,
            "mode": "expand-inline-catalog-metadata",
            "input_length": text.utf8.count,
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ]))
    }
}

@_cdecl("bridge_swift_toolrenderer_python_interface")
public func bridge_swift_toolrenderer_python_interface() -> UnsafeMutablePointer<CChar>? {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        do {
            box.payload = jsonString(try await toolRendererPythonInterfacePayload())
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "toolrenderer-python-interface",
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 180) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "toolrenderer-python-interface",
            "error": "ToolRenderer pythonInterface call timed out",
        ])
    }

    return strdup(box.payload)
}

@_cdecl("bridge_swift_toolrenderer_structured_metadata")
public func bridge_swift_toolrenderer_structured_metadata() -> UnsafeMutablePointer<CChar>? {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        do {
            box.payload = jsonString(try await toolRendererStructuredMetadataPayload())
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "toolrenderer-structured-metadata",
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 180) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "toolrenderer-structured-metadata",
            "error": "ToolRenderer structured metadata call timed out",
        ])
    }

    return strdup(box.payload)
}

private func pythonToBplistPayload(
    source: String,
    rawFlags: UInt64,
    pipeline: RuntimePipeline,
    explicitCatalog: AnyObject? = nil,
    explicitCatalogSource: String? = nil
) async -> String {
    let flags = UInt16(truncatingIfNeeded: rawFlags)
    let importContext = importedPythonContext(matchingRefsIn: source)
    let catalogOverride = explicitCatalog ?? importContext?.proxyCatalog
    let catalogSource = explicitCatalogSource ?? (catalogOverride == nil
        ? "defaultInitialCatalog"
        : "latest plist-data-to-python import via \(importContext?.proxyCatalogSelector ?? "unknown selector")")
    do {
        let run = try await compileWithRuntimePipeline(
            source,
            pipeline: pipeline,
            catalogOverride: catalogOverride,
            catalogSource: catalogSource
        )
        let compiledObjects = compiledShortcutObjectView(run.compiled)
        guard let workflow = compiledObjects.preferredWorkflow else {
            throw bridgeFailure("compiled shortcut did not produce a WFWorkflow")
        }
        let fileDataResult = try workflowRecordFileDataPayloadFromWorkflow(
            workflow,
            trigger: compiledObjects.preferredTrigger,
            callSaveToRecord: true,
            recurrencePlans: run.recurrencePlans
        )
        return jsonString([
            "ok": true,
            "mode": "python-to-workflow-file-data",
            "runtime_pipeline": pipeline.name,
            "flags": Int(flags),
            "source_length": source.utf8.count,
            "catalog": String(describing: type(of: run.catalog)),
            "catalog_source": run.catalogSource,
            "latest_import_context": importContextSummary(importContext),
            "pipeline": run.details.merging([
                "recurrenceLowering": fileDataResult.fileSummary[
                    "shortpy_recurrence_lowering"
                ] ?? [],
            ]) { _, new in new },
            "workflow": [
                "workflow": pointerOnlySummary(workflow),
                "trigger": pointerOnlySummary(compiledObjects.preferredTrigger),
            ],
            "plist_builder": [
                "kind": "native WFWorkflowRecord.fileRepresentation whole-file serializer",
                "serializer_path": "WFWorkflow.databaseAccessQueue dispatch_barrier_sync -> WFWorkflow.saveToRecord -> WFWorkflow.record -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:",
                "workflow_file": fileDataResult.fileSummary,
                "root": fileDataResult.rootSummary,
                "actions": fileDataResult.actionsSummary,
                "unifiedAutomationTriggers": fileDataResult.triggersSummary,
            ],
            "plist_payload": [
                "format": "com.apple.binary-property-list",
                "encoding": "base64",
                "length": fileDataResult.data.count,
                "data": fileDataResult.data.base64EncodedString(),
            ],
            "error_policy_decision_count": run.policyDecisions.count,
            "error_policy_decisions": run.policyDecisions,
        ])
    } catch {
        return jsonString([
            "ok": false,
            "mode": "python-to-workflow-file-data",
            "runtime_pipeline": pipeline.name,
            "flags": Int(flags),
            "source_length": source.utf8.count,
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ])
    }
}

@_cdecl("bridge_swift_pipeline_python_to_bplist")
public func bridge_swift_pipeline_python_to_bplist(
    _ cSource: UnsafePointer<CChar>?,
    _ rawFlags: UInt64,
    _ rawPipeline: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cSource else {
        return strdup(jsonString(["ok": false, "error": "missing source"]))
    }
    let source = String(cString: cSource)
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()
    Task.detached {
        do {
            let pipeline = try RuntimePipeline.decode(rawPipeline)
            box.payload = await pythonToBplistPayload(
                source: source,
                rawFlags: rawFlags,
                pipeline: pipeline
            )
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "python-to-workflow-file-data",
                "runtime_pipeline_raw": Int(rawPipeline),
                "diagnostic": String(describing: error),
            ])
        }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "python-to-workflow-file-data",
            "runtime_pipeline_raw": Int(rawPipeline),
            "error": "python-to-workflow-file-data call timed out",
        ])
    }
    return strdup(box.payload)
}

@_cdecl("bridge_swift_pipeline_python_to_bplist_with_catalog_metadata")
public func bridge_swift_pipeline_python_to_bplist_with_catalog_metadata(
    _ cSource: UnsafePointer<CChar>?,
    _ cCatalogMetadata: UnsafePointer<CChar>?,
    _ rawFlags: UInt64,
    _ rawPipeline: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cSource, let cCatalogMetadata else {
        return strdup(jsonString([
            "ok": false,
            "error": "missing source or catalog metadata",
        ]))
    }
    let source = String(cString: cSource)
    let catalogMetadataText = String(cString: cCatalogMetadata)
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()
    Task.detached {
        do {
            let pipeline = try RuntimePipeline.decode(rawPipeline)
            guard let catalogData = catalogMetadataText.data(using: .utf8) else {
                throw bridgeFailure("catalog metadata was not valid UTF-8")
            }
            let catalog = try pythonWorkflowProxyDecodeCatalog(catalogData)
            box.payload = await pythonToBplistPayload(
                source: source,
                rawFlags: rawFlags,
                pipeline: pipeline,
                explicitCatalog: catalog,
                explicitCatalogSource: "WFPythonWorkflowProxy.decodeCatalog(from:) input"
            )
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "python-to-workflow-file-data-with-catalog-metadata",
                "runtime_pipeline_raw": Int(rawPipeline),
                "catalog_metadata_length": catalogMetadataText.utf8.count,
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "python-to-workflow-file-data-with-catalog-metadata",
            "runtime_pipeline_raw": Int(rawPipeline),
            "error": "python-to-workflow-file-data catalog call timed out",
        ])
    }
    return strdup(box.payload)
}

private func recordFileProbePayload(
    source: String,
    flags: UInt16,
    probeMode: UInt64,
    catalogOverride: AnyObject?,
    catalogSource: String,
    importContext: ImportedPythonContext?
) async -> String {
    do {
        let run = try await ShortpyToShortcut(
            source,
            catalogOverride: catalogOverride,
            catalogSource: catalogSource
        )
        let compiledObjects = compiledShortcutObjectView(run.compiled)
        guard let workflow = compiledObjects.preferredWorkflow else {
            throw bridgeFailure("compiled shortcut did not produce a WFWorkflow")
        }
        let callSaveToRecord = (probeMode & 1) == 0
        let fileDataResult = try workflowRecordFileDataPayloadFromWorkflow(
            workflow,
            trigger: compiledObjects.preferredTrigger,
            callSaveToRecord: callSaveToRecord,
            recurrencePlans: run.recurrencePlans
        )
        appendRecordFileProbeStage("before plist base64")
        let plistBase64 = fileDataResult.data.base64EncodedString()
        appendRecordFileProbeStage("after plist base64 length=\(plistBase64.utf8.count)")
        appendRecordFileProbeStage("before probe json")
        let response = jsonString([
            "ok": true,
            "mode": "workflow-record-file-representation-probe",
            "flags": Int(flags),
            "probe_mode": Int(probeMode),
            "call_save_to_record": callSaveToRecord,
            "source_length": source.utf8.count,
            "catalog": String(describing: type(of: run.catalog)),
            "catalog_source": run.catalogSource,
            "latest_import_context": importContextSummary(importContext),
            "shortpy_pipeline": [
                "entrypoint": "ShortpyToShortcut",
                "passes": run.passes.map(\.json),
                "recurrencePlans": run.recurrencePlans.map(\.json),
                "recurrenceLowering": fileDataResult.fileSummary[
                    "shortpy_recurrence_lowering"
                ] ?? [],
            ],
            "workflow": [
                "workflow": pointerOnlySummary(workflow),
                "trigger": pointerOnlySummary(compiledObjects.preferredTrigger),
            ],
            "plist_builder": [
                "kind": "native WFWorkflowRecord.fileRepresentation whole-file serializer probe",
                "path": callSaveToRecord
                    ? "ShortpyToShortcut -> PythonToIR -> Shortpy IR passes -> native IR passes -> IRToShortcut -> WFWorkflow.databaseAccessQueue dispatch_barrier_sync -> WFWorkflow.saveToRecord -> WFWorkflow.record -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:"
                    : "ShortpyToShortcut -> PythonToIR -> Shortpy IR passes -> native IR passes -> IRToShortcut -> WFWorkflow.record -> WFWorkflowRecord.fileRepresentation -> WFWorkflowFile.fileDataWithError:",
                "static_evidence": "LLDB proved saveToRecord asserts the workflow databaseAccessQueue; the bridge now performs the same queue hop directly before calling saveToRecord. WFWorkflowRecord.fileRepresentation initializes WFWorkflowFile storage then calls WFRecord.writeToStorage:error:.",
                "workflow_file": fileDataResult.fileSummary,
                "root": fileDataResult.rootSummary,
                "actions": fileDataResult.actionsSummary,
                "unifiedAutomationTriggers": fileDataResult.triggersSummary,
            ],
            "plist_payload": [
                "format": "com.apple.binary-property-list",
                "encoding": "base64",
                "length": fileDataResult.data.count,
                "data": plistBase64,
            ],
            "error_policy_decision_count": "omitted-in-record-file-probe",
        ])
        appendRecordFileProbeStage("after probe json length=\(response.utf8.count)")
        return response
    } catch {
        return jsonString([
            "ok": false,
            "mode": "workflow-record-file-representation-probe",
            "flags": Int(flags),
            "probe_mode": Int(probeMode),
            "call_save_to_record": (probeMode & 1) == 0,
            "source_length": source.utf8.count,
            "catalog_source": catalogSource,
            "latest_import_context": importContextSummary(importContext),
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ])
    }
}

@_cdecl("bridge_swift_python_record_file_probe")
public func bridge_swift_python_record_file_probe(
    _ cSource: UnsafePointer<CChar>?,
    _ rawFlags: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cSource else {
        return strdup(jsonString(["ok": false, "error": "missing source"]))
    }

    let source = String(cString: cSource)
    let flags = UInt16(truncatingIfNeeded: rawFlags)
    let probeMode = rawFlags >> 16
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        let importContext = importedPythonContext(matchingRefsIn: source)
        let catalogOverride = importContext?.proxyCatalog
        let catalogSource = catalogOverride == nil
            ? "defaultInitialCatalog"
            : "latest plist-data-to-python import via \(importContext?.proxyCatalogSelector ?? "unknown selector")"
        appendRecordFileProbeStage("before async recordFileProbePayload assign")
        box.payload = await recordFileProbePayload(
            source: source,
            flags: flags,
            probeMode: probeMode,
            catalogOverride: catalogOverride,
            catalogSource: catalogSource,
            importContext: importContext
        )
        appendRecordFileProbeStage("after async recordFileProbePayload assign length=\(box.payload.utf8.count)")
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "workflow-record-file-representation-probe",
            "flags": Int(flags),
            "probe_mode": Int(probeMode),
            "source_length": source.utf8.count,
            "error": "workflow-record-file-representation probe timed out",
        ])
    }

    appendRecordFileProbeStage("before strdup payload length=\(box.payload.utf8.count)")
    let payload = box.payload
    let copied = strdup(payload)
    appendRecordFileProbeStage("after strdup payload copied=\(copied != nil)")
    return copied
}

@_cdecl("bridge_swift_python_record_file_probe_with_catalog_metadata")
public func bridge_swift_python_record_file_probe_with_catalog_metadata(
    _ cSource: UnsafePointer<CChar>?,
    _ cCatalogMetadata: UnsafePointer<CChar>?,
    _ rawFlags: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cSource else {
        return strdup(jsonString(["ok": false, "error": "missing source"]))
    }
    guard let cCatalogMetadata else {
        return strdup(jsonString(["ok": false, "error": "missing catalog metadata"]))
    }

    let source = String(cString: cSource)
    let catalogMetadataText = String(cString: cCatalogMetadata)
    let flags = UInt16(truncatingIfNeeded: rawFlags)
    let probeMode = rawFlags >> 16
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox()

    Task.detached {
        do {
            guard let catalogData = catalogMetadataText.data(using: .utf8) else {
                throw bridgeFailure("catalog metadata was not valid UTF-8")
            }
            let catalog = try pythonWorkflowProxyDecodeCatalog(catalogData)
            appendRecordFileProbeStage("before async recordFileProbePayload catalog assign")
            box.payload = await recordFileProbePayload(
                source: source,
                flags: flags,
                probeMode: probeMode,
                catalogOverride: catalog,
                catalogSource: "WFPythonWorkflowProxy.decodeCatalog(from:) input",
                importContext: nil
            )
            appendRecordFileProbeStage("after async recordFileProbePayload catalog assign length=\(box.payload.utf8.count)")
        } catch {
            box.payload = jsonString([
                "ok": false,
                "mode": "workflow-record-file-representation-probe",
                "flags": Int(flags),
                "probe_mode": Int(probeMode),
                "source_length": source.utf8.count,
                "catalog_metadata_length": catalogMetadataText.utf8.count,
                "diagnostic": String(describing: error),
                "error_type": String(describing: type(of: error)),
            ])
        }
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        box.payload = jsonString([
            "ok": false,
            "mode": "workflow-record-file-representation-probe",
            "flags": Int(flags),
            "source_length": source.utf8.count,
            "catalog_metadata_length": catalogMetadataText.utf8.count,
            "error": "workflow-record-file-representation catalog probe timed out",
        ])
    }

    appendRecordFileProbeStage("before strdup catalog payload length=\(box.payload.utf8.count)")
    let payload = box.payload
    let copied = strdup(payload)
    appendRecordFileProbeStage("after strdup catalog payload copied=\(copied != nil)")
    return copied
}

@_cdecl("bridge_swift_pipeline_plist_to_python")
public func bridge_swift_pipeline_plist_to_python(
    _ cJson: UnsafePointer<CChar>?,
    _ rawPipeline: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cJson else {
        return strdup(jsonString(["ok": false, "error": "missing plist JSON"]))
    }
    let text = String(cString: cJson)
    do {
        let pipeline = try RuntimePipeline.decode(rawPipeline)
        let root = try plistRootFromJsonText(text)
        return strdup(jsonString(try plistToPythonPayload(
            from: root,
            inputLength: text.utf8.count,
            mode: "workflow-plist-to-python",
            pipeline: pipeline
        )))
    } catch {
        return strdup(jsonString([
            "ok": false,
            "mode": "workflow-plist-to-python",
            "input_length": text.utf8.count,
            "runtime_pipeline_raw": Int(rawPipeline),
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ]))
    }
}

@_cdecl("bridge_swift_pipeline_bplist_to_python")
public func bridge_swift_pipeline_bplist_to_python(
    _ cBytes: UnsafePointer<UInt8>?,
    _ length: Int,
    _ rawPipeline: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let cBytes, length >= 0 else {
        return strdup(jsonString(["ok": false, "error": "missing plist bytes"]))
    }
    do {
        let pipeline = try RuntimePipeline.decode(rawPipeline)
        let data = Data(bytes: cBytes, count: length)
        return strdup(jsonString(try workflowFileDataToPythonPayload(
            from: data,
            mode: "workflow-file-data-to-python",
            pipeline: pipeline
        )))
    } catch {
        return strdup(jsonString([
            "ok": false,
            "mode": "workflow-file-data-to-python",
            "input_length": length,
            "runtime_pipeline_raw": Int(rawPipeline),
            "diagnostic": String(describing: error),
            "error_type": String(describing: type(of: error)),
        ]))
    }
}
