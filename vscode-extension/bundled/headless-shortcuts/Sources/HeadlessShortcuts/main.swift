import Darwin
import Foundation
import ObjectiveC

private enum Command: String {
  case unknown
  case create
  case edit
  case export
  case delete
}

private struct Options {
  var command: Command = .unknown
  var workflowPath: String?
  var outputPath: String?
  var name: String?
  var workflowID: String?
}

private struct WorkflowRuntime {
  let fileClass: AnyClass
  let workflowClass: AnyClass
  let databaseClass: AnyClass
  let creationOptionsClass: AnyClass
  let databaseStorageClass: AnyClass
}

private let errorDomain = "HeadlessShortcuts"

private enum ToolErrorCode: Int {
  case operationFailed = 1
  case notFound = 2
}

private typealias ErrorPointer = AutoreleasingUnsafeMutablePointer<NSError?>
private typealias Object0 = @convention(c) (AnyObject, Selector) -> AnyObject?
private typealias Object1 = @convention(c) (AnyObject, Selector, AnyObject) -> AnyObject?
private typealias ObjectError = @convention(c) (AnyObject, Selector, ErrorPointer) -> AnyObject?
private typealias Object1Error =
  @convention(c) (AnyObject, Selector, AnyObject, ErrorPointer) -> AnyObject?
private typealias InitDatabase =
  @convention(c) (AnyObject, Selector, UInt, AnyObject, ErrorPointer) -> AnyObject?
private typealias InitFile =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> AnyObject?
private typealias WorkflowForReference =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> AnyObject?
private typealias SaveRecordWithReference =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> Bool
private typealias DeleteWorkflowIdentifier =
  @convention(c) (AnyObject, Selector, AnyObject, ErrorPointer) -> Bool
private typealias SetObject = @convention(c) (AnyObject, Selector, AnyObject) -> Void
private typealias SetInt = @convention(c) (AnyObject, Selector, Int) -> Void

private func toolError(_ message: String, code: ToolErrorCode = .operationFailed) -> NSError {
  NSError(
    domain: errorDomain,
    code: code.rawValue,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}

private func standardizedPath(_ path: String) -> String {
  ((path as NSString).expandingTildeInPath as NSString).standardizingPath
}

private func databasePath() -> String {
  if let override = ProcessInfo.processInfo.environment["HEADLESS_SHORTCUTS_DATABASE"],
    !override.isEmpty
  {
    return standardizedPath(override)
  }
  return NSHomeDirectory() + "/Library/Shortcuts/Shortcuts.sqlite"
}

private func parse(_ arguments: [String], into options: inout Options) throws {
  guard arguments.count >= 2 else {
    throw toolError("missing command")
  }
  guard let command = Command(rawValue: arguments[1]), command != .unknown else {
    throw toolError("unknown command \(arguments[1])")
  }
  options.command = command

  var index = 2
  while index < arguments.count {
    let argument = arguments[index]
    index += 1
    guard index < arguments.count else {
      throw toolError("\(argument) requires a value")
    }
    let value = arguments[index]
    index += 1

    switch argument {
    case "--plist":
      options.workflowPath = value
    case "--name":
      options.name = value
    case "--id":
      options.workflowID = value
    case "--output":
      options.outputPath = value
    default:
      throw toolError("unknown argument \(argument)")
    }
  }

  switch options.command {
  case .create:
    guard options.workflowPath?.isEmpty == false,
      options.name?.isEmpty == false,
      options.outputPath == nil,
      options.workflowID == nil
    else {
      throw toolError("create requires --plist PATH and --name NAME")
    }
  case .edit:
    guard options.workflowID?.isEmpty == false,
      options.workflowPath?.isEmpty == false,
      options.outputPath == nil,
      options.name == nil
    else {
      throw toolError("edit requires --id UUID and --plist PATH")
    }
  case .export:
    guard options.workflowID?.isEmpty == false,
      options.outputPath?.isEmpty == false,
      options.workflowPath == nil,
      options.name == nil
    else {
      throw toolError("export requires --id UUID and --output PATH")
    }
  case .delete:
    guard options.workflowID?.isEmpty == false,
      options.workflowPath == nil,
      options.outputPath == nil,
      options.name == nil
    else {
      throw toolError("delete requires --id UUID")
    }
  case .unknown:
    throw toolError("missing command")
  }

  if let workflowID = options.workflowID {
    guard let uuid = UUID(uuidString: workflowID) else {
      throw toolError("--id must be a UUID")
    }
    options.workflowID = uuid.uuidString.uppercased()
  }
  if let workflowPath = options.workflowPath {
    options.workflowPath = standardizedPath(workflowPath)
  }
  if let outputPath = options.outputPath {
    options.outputPath = standardizedPath(outputPath)
  }
}

private func printJSON(_ response: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: response, options: .sortedKeys)
  else {
    return
  }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

private func printSuccess(command: Command, workflowID: String, name: String?) {
  var response: [String: Any] = [
    "ok": true,
    "operation": command.rawValue,
    "workflowID": workflowID,
  ]
  if let name, !name.isEmpty {
    response["name"] = name
  }
  printJSON(response)
}

private func printExportSuccess(
  workflowID: String,
  name: String,
  outputPath: String,
  byteCount: Int
) {
  printJSON([
    "bytes": byteCount,
    "name": name,
    "ok": true,
    "operation": Command.export.rawValue,
    "output": outputPath,
    "workflowID": workflowID,
  ])
}

private func printFailure(command: Command, workflowID: String?, error: NSError, code: String) {
  var response: [String: Any] = [
    "ok": false,
    "operation": command.rawValue,
    "error": [
      "code": code,
      "message": error.localizedDescription,
    ],
  ]
  if let workflowID, !workflowID.isEmpty {
    response["workflowID"] = workflowID
  }
  printJSON(response)
}

private func operationErrorCode(_ error: NSError) -> String {
  if error.domain == errorDomain, error.code == ToolErrorCode.notFound.rawValue {
    return "not_found"
  }
  return "operation_failed"
}

private func selector(_ name: String) -> Selector {
  NSSelectorFromString(name)
}

private func methodImplementation(_ receiver: AnyObject, _ selector: Selector) throws -> IMP {
  guard let cls = object_getClass(receiver),
    let method = class_getInstanceMethod(cls, selector)
  else {
    throw toolError("WorkflowKit did not expose \(NSStringFromSelector(selector))")
  }
  return method_getImplementation(method)
}

private func responds(_ object: AnyObject, to selector: Selector) -> Bool {
  (object as? NSObject)?.responds(to: selector) == true
}

private func callObject0(_ object: AnyObject, _ selector: Selector) -> AnyObject? {
  guard responds(object, to: selector),
    let implementation = try? methodImplementation(object, selector)
  else {
    return nil
  }
  let function = unsafeBitCast(implementation, to: Object0.self)
  return function(object, selector)
}

private func setObject(_ object: AnyObject, _ selector: Selector, _ value: AnyObject) throws {
  let function = unsafeBitCast(try methodImplementation(object, selector), to: SetObject.self)
  function(object, selector, value)
}

private func setInt(_ object: AnyObject, _ selector: Selector, _ value: Int) throws {
  let function = unsafeBitCast(try methodImplementation(object, selector), to: SetInt.self)
  function(object, selector, value)
}

private func allocate(_ cls: AnyClass) throws -> AnyObject {
  let receiver = cls as AnyObject
  let allocSelector = selector("alloc")
  let function = unsafeBitCast(try methodImplementation(receiver, allocSelector), to: Object0.self)
  guard let object = function(receiver, allocSelector) else {
    throw toolError("WorkflowKit allocation failed")
  }
  return object
}

private func loadRuntime() throws -> WorkflowRuntime {
  let path = "/System/Library/PrivateFrameworks/WorkflowKit.framework/WorkflowKit"
  guard dlopen(path, RTLD_NOW) != nil else {
    let reason = dlerror().map { String(cString: $0) } ?? "unknown error"
    throw toolError("could not load WorkflowKit: \(reason)")
  }
  guard let fileClass = NSClassFromString("WFWorkflowFile"),
    let workflowClass = NSClassFromString("WFWorkflow"),
    let databaseClass = NSClassFromString("WFDatabase"),
    let creationOptionsClass = NSClassFromString("WFWorkflowCreationOptions"),
    let databaseStorageClass = NSClassFromString("WFDatabaseWorkflowStorage")
  else {
    throw toolError("WorkflowKit did not expose the required classes")
  }
  return WorkflowRuntime(
    fileClass: fileClass,
    workflowClass: workflowClass,
    databaseClass: databaseClass,
    creationOptionsClass: creationOptionsClass,
    databaseStorageClass: databaseStorageClass
  )
}

private func openDatabase(_ runtime: WorkflowRuntime) throws -> AnyObject {
  let path = databasePath()
  guard FileManager.default.fileExists(atPath: path) else {
    throw toolError("Shortcuts database not found at \(path)")
  }

  var error: NSError?
  let databaseObject = try allocate(runtime.databaseClass)
  let databaseSelector = selector("initWithPersistenceMode:fileURL:error:")
  let initializeDatabase = unsafeBitCast(
    try methodImplementation(databaseObject, databaseSelector),
    to: InitDatabase.self
  )
  guard
    let database = initializeDatabase(
      databaseObject,
      databaseSelector,
      0,
      URL(fileURLWithPath: path) as NSURL,
      &error
    )
  else {
    throw error ?? toolError("WFDatabase initialization failed")
  }

  return database
}

private func workflowRecord(
  runtime: WorkflowRuntime,
  plistPath: String,
  name: String
) throws -> AnyObject {
  let data = try Data(contentsOf: URL(fileURLWithPath: plistPath))
  guard !data.starts(with: [0x41, 0x45, 0x41, 0x31]) else {
    throw toolError(
      "signed AEA1 .shortcut envelopes are not supported; pass an unsigned workflow plist")
  }

  var error: NSError?
  let fileObject = try allocate(runtime.fileClass)
  let fileSelector = selector("initWithFileData:name:error:")
  let initializeFile = unsafeBitCast(
    try methodImplementation(fileObject, fileSelector),
    to: InitFile.self
  )
  guard
    let file = initializeFile(fileObject, fileSelector, data as NSData, name as NSString, &error)
  else {
    throw error ?? toolError("WFWorkflowFile initialization failed")
  }

  let recordSelector = selector("recordRepresentationWithError:")
  let recordRepresentation = unsafeBitCast(
    try methodImplementation(file, recordSelector),
    to: ObjectError.self
  )
  guard let record = recordRepresentation(file, recordSelector, &error) else {
    throw error ?? toolError("workflow record creation failed")
  }
  let setNameSelector = selector("setName:")
  if responds(record, to: setNameSelector) {
    try setObject(record, setNameSelector, name as NSString)
  }
  let setActionCountSelector = selector("setActionCount:")
  if let actions = callObject0(record, selector("actions")) as? NSArray,
    responds(record, to: setActionCountSelector)
  {
    try setInt(record, setActionCountSelector, actions.count)
  }
  return record
}

private func identifier(for object: AnyObject) throws -> String {
  for property in ["identifier", "workflowID"] {
    if let identifier = callObject0(object, selector(property)) {
      let workflowID = identifier as? String ?? String(describing: identifier)
      if !workflowID.isEmpty {
        return workflowID
      }
    }
  }
  throw toolError("workflow object did not expose an identifier")
}

private func createShortcut(
  options: Options,
  runtime: WorkflowRuntime,
  database: AnyObject
) throws -> (workflowID: String, name: String) {
  let requestedName = options.name!
  let record = try workflowRecord(
    runtime: runtime,
    plistPath: options.workflowPath!,
    name: requestedName
  )
  let optionsObject = try allocate(runtime.creationOptionsClass)
  let optionsSelector = selector("initWithRecord:")
  let initializeOptions = unsafeBitCast(
    try methodImplementation(optionsObject, optionsSelector),
    to: Object1.self
  )
  guard let options = initializeOptions(optionsObject, optionsSelector, record) else {
    throw toolError("WFWorkflowCreationOptions initWithRecord: returned nil")
  }

  var error: NSError?
  let createSelector = selector("createWorkflowWithOptions:error:")
  let createWorkflow = unsafeBitCast(
    try methodImplementation(database, createSelector),
    to: Object1Error.self
  )
  guard let workflow = createWorkflow(database, createSelector, options, &error) else {
    throw error ?? toolError("workflow creation failed")
  }
  let createdName = callObject0(workflow, selector("name")) as? String ?? requestedName
  return (try identifier(for: workflow), createdName)
}

private func reference(for workflowID: String, database: AnyObject) throws -> AnyObject? {
  let referenceSelector = selector("referenceForWorkflowID:")
  let lookup = unsafeBitCast(
    try methodImplementation(database, referenceSelector),
    to: Object1.self
  )
  return lookup(database, referenceSelector, workflowID as NSString)
}

private func loadedWorkflow(
  workflowID: String,
  runtime: WorkflowRuntime,
  database: AnyObject
) throws -> (reference: AnyObject, workflow: AnyObject, name: String) {
  guard let reference = try reference(for: workflowID, database: database) else {
    throw toolError("shortcut \(workflowID) was not found", code: .notFound)
  }

  var error: NSError?
  let workflowClassObject = runtime.workflowClass as AnyObject
  let loadSelector = selector("workflowWithReference:database:error:")
  let loadWorkflow = unsafeBitCast(
    try methodImplementation(workflowClassObject, loadSelector),
    to: WorkflowForReference.self
  )
  guard
    let workflow = loadWorkflow(
      workflowClassObject,
      loadSelector,
      reference,
      database,
      &error
    )
  else {
    throw error ?? toolError("workflow load failed")
  }
  guard let name = callObject0(workflow, selector("name")) as? String, !name.isEmpty else {
    throw toolError("existing shortcut did not provide a name")
  }
  return (reference, workflow, name)
}

private func editShortcut(
  options: Options,
  runtime: WorkflowRuntime,
  database: AnyObject
) throws -> (workflowID: String, name: String) {
  let workflowID = options.workflowID!
  let existing = try loadedWorkflow(
    workflowID: workflowID,
    runtime: runtime,
    database: database
  )
  let reference = existing.reference
  let existingName = existing.name
  let replacementRecord = try workflowRecord(
    runtime: runtime,
    plistPath: options.workflowPath!,
    name: existingName
  )

  let saveSelector = selector("saveRecord:withReference:error:")
  let storageObject = try allocate(runtime.databaseStorageClass)
  let storageSelector = selector("initWithDatabase:")
  let initializeStorage = unsafeBitCast(
    try methodImplementation(storageObject, storageSelector),
    to: Object1.self
  )
  let storage = initializeStorage(storageObject, storageSelector, database)
  guard let storage else {
    throw toolError("WFDatabaseWorkflowStorage initWithDatabase: returned nil")
  }
  let saveRecord = unsafeBitCast(
    try methodImplementation(storage, saveSelector),
    to: SaveRecordWithReference.self
  )
  var error: NSError?
  if !saveRecord(storage, saveSelector, replacementRecord, reference, &error) {
    throw error ?? toolError("workflow record save failed")
  }
  return (workflowID, existingName)
}

private func exportShortcut(
  options: Options,
  runtime: WorkflowRuntime,
  database: AnyObject
) throws -> (workflowID: String, name: String, outputPath: String, byteCount: Int) {
  let workflowID = options.workflowID!
  let existing = try loadedWorkflow(
    workflowID: workflowID,
    runtime: runtime,
    database: database
  )
  guard let record = callObject0(existing.workflow, selector("record")) else {
    throw toolError("existing shortcut did not provide a workflow record")
  }
  guard let file = callObject0(record, selector("fileRepresentation")) else {
    throw toolError("workflow record did not provide a file representation")
  }

  var error: NSError?
  let dataSelector = selector("fileDataWithError:")
  let fileData = unsafeBitCast(
    try methodImplementation(file, dataSelector),
    to: ObjectError.self
  )
  guard let dataObject = fileData(file, dataSelector, &error),
    let data = dataObject as? Data
  else {
    throw error ?? toolError("workflow file serialization failed")
  }
  let outputPath = options.outputPath!
  try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
  return (workflowID, existing.name, outputPath, data.count)
}

private func deleteShortcut(options: Options, database: AnyObject) throws -> String {
  let workflowID = options.workflowID!
  let identifierSelector = selector("deleteWorkflowRecordWithIdentifier:error:")
  var error: NSError?
  let deleteIdentifier = unsafeBitCast(
    try methodImplementation(database, identifierSelector),
    to: DeleteWorkflowIdentifier.self
  )
  guard deleteIdentifier(database, identifierSelector, workflowID as NSString, &error) else {
    throw error ?? toolError("workflow deletion failed")
  }
  return workflowID
}

private func run(arguments: [String]) -> Int32 {
  var options = Options()
  do {
    try parse(arguments, into: &options)
  } catch {
    printFailure(
      command: options.command,
      workflowID: nil,
      error: error as NSError,
      code: "invalid_arguments"
    )
    return 64
  }

  do {
    let runtime = try loadRuntime()
    let database = try openDatabase(runtime)
    switch options.command {
    case .create:
      let result = try createShortcut(options: options, runtime: runtime, database: database)
      printSuccess(command: .create, workflowID: result.workflowID, name: result.name)
    case .edit:
      let result = try editShortcut(
        options: options,
        runtime: runtime,
        database: database
      )
      printSuccess(command: .edit, workflowID: result.workflowID, name: result.name)
    case .export:
      let result = try exportShortcut(
        options: options,
        runtime: runtime,
        database: database
      )
      printExportSuccess(
        workflowID: result.workflowID,
        name: result.name,
        outputPath: result.outputPath,
        byteCount: result.byteCount
      )
    case .delete:
      let workflowID = try deleteShortcut(options: options, database: database)
      printSuccess(command: .delete, workflowID: workflowID, name: nil)
    case .unknown:
      throw toolError("missing command")
    }
    return 0
  } catch {
    let error = error as NSError
    printFailure(
      command: options.command,
      workflowID: options.workflowID,
      error: error,
      code: operationErrorCode(error)
    )
    return 1
  }
}

exit(
  autoreleasepool {
    run(arguments: CommandLine.arguments)
  })
