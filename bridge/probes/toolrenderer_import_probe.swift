import Foundation
import ToolKit
import ToolRenderer
import WorkflowKit

func probeToolRendererPythonInterface() async throws -> String {
    let database = try SharedToolDatabaseProvider.shared.database()
    let provider = WFParameterMetadataProvider()
    return try await pythonInterface(
        database: database,
        filterProvider: nil,
        parameterMetadataProvider: provider,
        shims: .default
    )
}
