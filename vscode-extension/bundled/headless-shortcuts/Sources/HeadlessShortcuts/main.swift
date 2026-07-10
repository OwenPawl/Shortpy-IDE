import Darwin
import Foundation
import ObjectiveC

private enum Command: String {
  case unknown
  case create
  case edit
  case delete
}

private struct Options {
  var command: Command = .unknown
  var workflowPath: String?
  var name: String?
  var workflowID: String?
}

private struct WorkflowRuntime {
  let fileClass: AnyClass
  let workflowClass: AnyClass
  let databaseClass: AnyClass
  let proxyClass: AnyClass
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
private typealias InitDatabase =
  @convention(c) (AnyObject, Selector, UInt, AnyObject, ErrorPointer) -> AnyObject?
private typealias InitFile =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> AnyObject?
private typealias WorkflowForReference =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> AnyObject?
private typealias CreateWorkflow =
  @convention(c) (AnyObject, Selector, AnyObject, UInt, ErrorPointer) -> AnyObject?
private typealias SaveRecordWithReference =
  @convention(c) (AnyObject, Selector, AnyObject, AnyObject, ErrorPointer) -> Bool
private typealias DeleteReference =
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
    default:
      throw toolError("unknown argument \(argument)")
    }
  }

  switch options.command {
  case .create:
    guard options.workflowPath?.isEmpty == false,
      options.name?.isEmpty == false,
      options.workflowID == nil
    else {
      throw toolError("create requires --plist PATH and --name NAME")
    }
  case .edit:
    guard options.workflowID?.isEmpty == false,
      options.workflowPath?.isEmpty == false,
      options.name == nil
    else {
      throw toolError("edit requires --id UUID and --plist PATH")
    }
  case .delete:
    guard options.workflowID?.isEmpty == false,
      options.workflowPath == nil,
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
    let proxyClass = NSClassFromString("WFDatabaseProxy")
  else {
    throw toolError("WorkflowKit did not expose the required classes")
  }
  return WorkflowRuntime(
    fileClass: fileClass,
    workflowClass: workflowClass,
    databaseClass: databaseClass,
    proxyClass: proxyClass
  )
}

private func openDatabase(_ runtime: WorkflowRuntime) throws -> (
  database: AnyObject, proxy: AnyObject
) {
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

  let proxyObject = try allocate(runtime.proxyClass)
  let proxySelector = selector("initWithDatabase:")
  let initializeProxy = unsafeBitCast(
    try methodImplementation(proxyObject, proxySelector),
    to: Object1.self
  )
  guard let proxy = initializeProxy(proxyObject, proxySelector, database) else {
    throw toolError("WFDatabaseProxy initWithDatabase: returned nil")
  }
  return (database, proxy)
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

private func identifier(for reference: AnyObject) throws -> String {
  guard let identifier = callObject0(reference, selector("identifier")) else {
    throw toolError("workflow reference did not expose an identifier")
  }
  let workflowID = identifier as? String ?? String(describing: identifier)
  guard !workflowID.isEmpty else {
    throw toolError("workflow reference did not expose an identifier")
  }
  return workflowID
}

private func createShortcut(
  options: Options,
  runtime: WorkflowRuntime,
  proxy: AnyObject
) throws -> (workflowID: String, name: String) {
  let requestedName = options.name!
  let record = try workflowRecord(
    runtime: runtime,
    plistPath: options.workflowPath!,
    name: requestedName
  )

  var error: NSError?
  let createSelector = selector("createWorkflowWithWorkflowRecord:nameCollisionBehavior:error:")
  let createWorkflow = unsafeBitCast(
    try methodImplementation(proxy, createSelector),
    to: CreateWorkflow.self
  )
  guard let reference = createWorkflow(proxy, createSelector, record, 0, &error) else {
    throw error ?? toolError("workflow creation failed")
  }
  let createdName = callObject0(reference, selector("name")) as? String ?? requestedName
  return (try identifier(for: reference), createdName)
}

private func reference(for workflowID: String, proxy: AnyObject) throws -> AnyObject? {
  let referenceSelector = selector("referenceForWorkflowID:")
  let lookup = unsafeBitCast(
    try methodImplementation(proxy, referenceSelector),
    to: Object1.self
  )
  return lookup(proxy, referenceSelector, workflowID as NSString)
}

private func editShortcut(
  options: Options,
  runtime: WorkflowRuntime,
  database: AnyObject,
  proxy: AnyObject
) throws -> (workflowID: String, name: String) {
  let workflowID = options.workflowID!
  guard let reference = try reference(for: workflowID, proxy: proxy) else {
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
    let existingWorkflow = loadWorkflow(
      workflowClassObject,
      loadSelector,
      reference,
      database,
      &error
    )
  else {
    throw error ?? toolError("workflow load failed")
  }
  guard let existingName = callObject0(existingWorkflow, selector("name")) as? String,
    !existingName.isEmpty
  else {
    throw toolError("existing shortcut did not provide a name")
  }
  guard let storageProvider = callObject0(existingWorkflow, selector("storageProvider")) else {
    throw toolError("existing shortcut did not provide a storage provider")
  }

  let replacementRecord = try workflowRecord(
    runtime: runtime,
    plistPath: options.workflowPath!,
    name: existingName
  )

  let saveSelector = selector("saveRecord:withReference:error:")
  let saveRecord = unsafeBitCast(
    try methodImplementation(storageProvider, saveSelector),
    to: SaveRecordWithReference.self
  )
  if !saveRecord(storageProvider, saveSelector, replacementRecord, reference, &error) {
    throw error ?? toolError("workflow record save failed")
  }
  return (workflowID, existingName)
}

private func deleteShortcut(options: Options, database: AnyObject, proxy: AnyObject) throws
  -> String
{
  let workflowID = options.workflowID!
  guard let reference = try reference(for: workflowID, proxy: proxy) else {
    throw toolError("shortcut \(workflowID) was not found", code: .notFound)
  }

  var error: NSError?
  let deleteSelector = selector("deleteReference:error:")
  let deleteReference = unsafeBitCast(
    try methodImplementation(database, deleteSelector),
    to: DeleteReference.self
  )
  guard deleteReference(database, deleteSelector, reference, &error) else {
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
    let (database, proxy) = try openDatabase(runtime)
    switch options.command {
    case .create:
      let result = try createShortcut(options: options, runtime: runtime, proxy: proxy)
      printSuccess(command: .create, workflowID: result.workflowID, name: result.name)
    case .edit:
      let result = try editShortcut(
        options: options,
        runtime: runtime,
        database: database,
        proxy: proxy
      )
      printSuccess(command: .edit, workflowID: result.workflowID, name: result.name)
    case .delete:
      let workflowID = try deleteShortcut(options: options, database: database, proxy: proxy)
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
