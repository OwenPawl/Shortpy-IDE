#import "runtime_objc_helpers.h"

#import <dispatch/dispatch.h>
#import <dlfcn.h>
#import <mach-o/dyld.h>
#import <mach-o/loader.h>
#import <pthread.h>
#import <stdbool.h>
#import <stdint.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdarg.h>
#import <stdio.h>
#import <stdlib.h>
#import <unistd.h>

#define BRIDGE_COMPILER_TRACE_MAX_BYTES (4U * 1024U * 1024U)

typedef struct {
  int savedStdout;
  FILE *stream;
} BridgeCompilerTraceCapture;

static pthread_mutex_t gBridgeCompilerTraceLock = PTHREAD_MUTEX_INITIALIZER;

void *bridge_compiler_trace_begin(void) {
  pthread_mutex_lock(&gBridgeCompilerTraceLock);

  BridgeCompilerTraceCapture *capture =
      calloc(1, sizeof(BridgeCompilerTraceCapture));
  if (!capture) {
    pthread_mutex_unlock(&gBridgeCompilerTraceLock);
    return NULL;
  }
  capture->savedStdout = -1;
  capture->stream = tmpfile();
  if (!capture->stream) {
    free(capture);
    pthread_mutex_unlock(&gBridgeCompilerTraceLock);
    return NULL;
  }

  fflush(stdout);
  capture->savedStdout = dup(STDOUT_FILENO);
  if (capture->savedStdout < 0 ||
      dup2(fileno(capture->stream), STDOUT_FILENO) < 0) {
    if (capture->savedStdout >= 0) {
      close(capture->savedStdout);
    }
    fclose(capture->stream);
    free(capture);
    pthread_mutex_unlock(&gBridgeCompilerTraceLock);
    return NULL;
  }
  return capture;
}

char *bridge_compiler_trace_end(void *opaqueCapture, uint64_t *totalBytes,
                                uint64_t *returnedBytes, bool *truncated) {
  if (totalBytes) {
    *totalBytes = 0;
  }
  if (returnedBytes) {
    *returnedBytes = 0;
  }
  if (truncated) {
    *truncated = false;
  }
  if (!opaqueCapture) {
    return NULL;
  }

  BridgeCompilerTraceCapture *capture = opaqueCapture;
  fflush(stdout);
  if (capture->savedStdout >= 0) {
    (void)dup2(capture->savedStdout, STDOUT_FILENO);
    close(capture->savedStdout);
    capture->savedStdout = -1;
  }

  uint64_t total = 0;
  if (fseeko(capture->stream, 0, SEEK_END) == 0) {
    off_t end = ftello(capture->stream);
    if (end > 0) {
      total = (uint64_t)end;
    }
  }
  size_t count = (size_t)(total > BRIDGE_COMPILER_TRACE_MAX_BYTES
                              ? BRIDGE_COMPILER_TRACE_MAX_BYTES
                              : total);
  char *bytes = calloc(1, count + 1);
  if (bytes && count > 0 && fseeko(capture->stream, 0, SEEK_SET) == 0) {
    count = fread(bytes, 1, count, capture->stream);
    bytes[count] = 0;
  }

  fclose(capture->stream);
  free(capture);
  pthread_mutex_unlock(&gBridgeCompilerTraceLock);

  if (totalBytes) {
    *totalBytes = total;
  }
  if (returnedBytes) {
    *returnedBytes = (uint64_t)count;
  }
  if (truncated) {
    *truncated = total > (uint64_t)count;
  }
  return bytes;
}

static NSString *const kBridgeLogicalGeneratorAssetRoot =
    @"/System/Library/AssetsV2/"
     "com_apple_MobileAsset_UAF_Shortcuts_Generator/";

static NSString *BridgeHostGeneratorAssetRoot(void) {
  const char *override = getenv("SHORTPY_GENERATOR_ASSET_ROOT");
  if (!override || !override[0]) {
    return nil;
  }
  NSString *root = [NSString stringWithUTF8String:override];
  if (![root hasSuffix:@"/"]) {
    root = [root stringByAppendingString:@"/"];
  }
  return root;
}

static NSString *BridgeMappedGeneratorAssetPath(NSString *path) {
  if (![path isKindOfClass:[NSString class]] ||
      ![path hasPrefix:kBridgeLogicalGeneratorAssetRoot]) {
    return path;
  }
  NSString *hostRoot = BridgeHostGeneratorAssetRoot();
  if (!hostRoot.length) {
    return path;
  }
  NSString *suffix = [path substringFromIndex:kBridgeLogicalGeneratorAssetRoot.length];
  return [hostRoot stringByAppendingString:suffix];
}

static NSURL *BridgeMappedGeneratorAssetURL(NSURL *url) {
  if (![url isKindOfClass:[NSURL class]] || !url.isFileURL) {
    return url;
  }
  NSString *path = url.path;
  NSString *mapped = BridgeMappedGeneratorAssetPath(path);
  if (mapped == path || [mapped isEqualToString:path]) {
    return url;
  }
  BOOL isDirectory = url.hasDirectoryPath || [mapped hasSuffix:@".mlpackage"];
  return [NSURL fileURLWithPath:mapped isDirectory:isDirectory];
}

static void BridgeLogAssetPathHookInstall(void) {
  FILE *file = fopen("/tmp/shortcuts-ide-bridge-sim.log", "a");
  if (!file) {
    return;
  }
  NSString *hostRoot = BridgeHostGeneratorAssetRoot();
  fprintf(file,
          "[asset-path-bridge] installed logical=%s host=%s\n",
          kBridgeLogicalGeneratorAssetRoot.UTF8String,
          hostRoot.length ? hostRoot.UTF8String : "(disabled)");
  fclose(file);
}

static void BridgeExchangeInstanceMethod(Class cls, SEL original, SEL replacement) {
  Method originalMethod = class_getInstanceMethod(cls, original);
  Method replacementMethod = class_getInstanceMethod(cls, replacement);
  if (originalMethod && replacementMethod) {
    method_exchangeImplementations(originalMethod, replacementMethod);
  }
}

static void BridgeExchangeClassMethod(Class cls, SEL original, SEL replacement) {
  Method originalMethod = class_getClassMethod(cls, original);
  Method replacementMethod = class_getClassMethod(cls, replacement);
  if (originalMethod && replacementMethod) {
    method_exchangeImplementations(originalMethod, replacementMethod);
  }
}

@interface NSURL (ShortcutsIDESimAssetPathBridge)
@end

@implementation NSURL (ShortcutsIDESimAssetPathBridge)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    BridgeExchangeClassMethod(self, @selector(fileURLWithPath:),
                              @selector(bridge_fileURLWithPath:));
    BridgeExchangeClassMethod(self, @selector(fileURLWithPath:isDirectory:),
                              @selector(bridge_fileURLWithPath:isDirectory:));
    BridgeExchangeInstanceMethod(self, @selector(URLByAppendingPathComponent:),
                                 @selector(bridge_URLByAppendingPathComponent:));
    BridgeExchangeInstanceMethod(self,
                                 @selector(URLByAppendingPathComponent:isDirectory:),
                                 @selector(bridge_URLByAppendingPathComponent:isDirectory:));
    BridgeLogAssetPathHookInstall();
  });
}

+ (NSURL *)bridge_fileURLWithPath:(NSString *)path {
  return [self bridge_fileURLWithPath:BridgeMappedGeneratorAssetPath(path)];
}

+ (NSURL *)bridge_fileURLWithPath:(NSString *)path isDirectory:(BOOL)isDirectory {
  return [self bridge_fileURLWithPath:BridgeMappedGeneratorAssetPath(path)
                          isDirectory:isDirectory];
}

- (NSURL *)bridge_URLByAppendingPathComponent:(NSString *)pathComponent {
  return BridgeMappedGeneratorAssetURL([self bridge_URLByAppendingPathComponent:pathComponent]);
}

- (NSURL *)bridge_URLByAppendingPathComponent:(NSString *)pathComponent
                                  isDirectory:(BOOL)isDirectory {
  return BridgeMappedGeneratorAssetURL([self bridge_URLByAppendingPathComponent:pathComponent
                                                                    isDirectory:isDirectory]);
}

@end

@interface NSFileManager (ShortcutsIDESimAssetPathBridge)
@end

@implementation NSFileManager (ShortcutsIDESimAssetPathBridge)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    BridgeExchangeInstanceMethod(self, @selector(fileExistsAtPath:),
                                 @selector(bridge_fileExistsAtPath:));
    BridgeExchangeInstanceMethod(self, @selector(fileExistsAtPath:isDirectory:),
                                 @selector(bridge_fileExistsAtPath:isDirectory:));
    BridgeExchangeInstanceMethod(self, @selector(attributesOfItemAtPath:error:),
                                 @selector(bridge_attributesOfItemAtPath:error:));
    BridgeExchangeInstanceMethod(self, @selector(contentsAtPath:),
                                 @selector(bridge_contentsAtPath:));
    BridgeExchangeInstanceMethod(self, @selector(contentsOfDirectoryAtPath:error:),
                                 @selector(bridge_contentsOfDirectoryAtPath:error:));
  });
}

- (BOOL)bridge_fileExistsAtPath:(NSString *)path {
  return [self bridge_fileExistsAtPath:BridgeMappedGeneratorAssetPath(path)];
}

- (BOOL)bridge_fileExistsAtPath:(NSString *)path isDirectory:(BOOL *)isDirectory {
  return [self bridge_fileExistsAtPath:BridgeMappedGeneratorAssetPath(path)
                           isDirectory:isDirectory];
}

- (NSDictionary<NSFileAttributeKey, id> *)bridge_attributesOfItemAtPath:(NSString *)path
                                                                  error:(NSError **)error {
  return [self bridge_attributesOfItemAtPath:BridgeMappedGeneratorAssetPath(path) error:error];
}

- (NSData *)bridge_contentsAtPath:(NSString *)path {
  return [self bridge_contentsAtPath:BridgeMappedGeneratorAssetPath(path)];
}

- (NSArray<NSString *> *)bridge_contentsOfDirectoryAtPath:(NSString *)path
                                                    error:(NSError **)error {
  return [self bridge_contentsOfDirectoryAtPath:BridgeMappedGeneratorAssetPath(path)
                                          error:error];
}

@end

@interface NSData (ShortcutsIDESimAssetPathBridge)
@end

@implementation NSData (ShortcutsIDESimAssetPathBridge)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    BridgeExchangeClassMethod(self, @selector(dataWithContentsOfURL:options:error:),
                              @selector(bridge_dataWithContentsOfURL:options:error:));
    BridgeExchangeInstanceMethod(self, @selector(initWithContentsOfURL:options:error:),
                                 @selector(bridge_initWithContentsOfURL:options:error:));
  });
}

+ (NSData *)bridge_dataWithContentsOfURL:(NSURL *)url
                                 options:(NSDataReadingOptions)readOptionsMask
                                   error:(NSError **)errorPtr {
  return [self bridge_dataWithContentsOfURL:BridgeMappedGeneratorAssetURL(url)
                                    options:readOptionsMask
                                      error:errorPtr];
}

- (instancetype)bridge_initWithContentsOfURL:(NSURL *)url
                                     options:(NSDataReadingOptions)readOptionsMask
                                       error:(NSError **)errorPtr {
  return [self bridge_initWithContentsOfURL:BridgeMappedGeneratorAssetURL(url)
                                    options:readOptionsMask
                                      error:errorPtr];
}

@end

extern const void *swift_getWitnessTable(const void *conformance,
                                         const void *type,
                                         const void *instantiationArgs);

const void *bridge_swift_get_witness_table(const void *conformance,
                                           const void *type,
                                           const void *instantiationArgs) {
  return swift_getWitnessTable(conformance, type, instantiationArgs);
}

void *bridge_dlsym_default(const char *symbol_name) {
  if (!symbol_name) {
    return NULL;
  }
  return dlsym(RTLD_DEFAULT, symbol_name);
}

static char kBridgeShortpyFallbackParametersKey;
static _Thread_local char gBridgeShortpyEditExportError[1024];
static _Thread_local char gBridgeShortpyElseIfRepairError[1024];

static void BridgeShortpySetEditExportError(NSString *description) {
  const char *text = description.UTF8String;
  snprintf(gBridgeShortpyEditExportError,
           sizeof(gBridgeShortpyEditExportError), "%s",
           text ?: "unknown Shortpy reverse-export error");
}

const char *bridge_shortpy_edit_export_last_error(void) {
  return gBridgeShortpyEditExportError;
}

static void BridgeShortpySetElseIfRepairError(NSString *description) {
  const char *text = description.UTF8String;
  snprintf(gBridgeShortpyElseIfRepairError,
           sizeof(gBridgeShortpyElseIfRepairError), "%s",
           text ?: "unknown Shortpy Else If repair error");
}

const char *bridge_shortpy_else_if_repair_last_error(void) {
  return gBridgeShortpyElseIfRepairError;
}

static id BridgeShortpyAppendFallbackParameters(id action, id exported,
                                                  NSError **error);

static bool BridgeShortpyIsVariableMutationAction(id action) {
  Class appendClass = NSClassFromString(@"WFAppendVariableAction");
  Class setClass = NSClassFromString(@"WFSetVariableAction");
  return (appendClass && [action isKindOfClass:appendClass]) ||
         (setClass && [action isKindOfClass:setClass]);
}

static id BridgeShortpyRewriteVariableMutationReferences(
    id value, NSDictionary<NSString *, NSString *> *variableByUUID,
    bool *changed) {
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dictionary = value;
    NSString *type = dictionary[@"Type"];
    NSString *outputUUID = dictionary[@"OutputUUID"];
    NSString *variable = outputUUID ? variableByUUID[outputUUID] : nil;
    if ([type isEqualToString:@"ActionOutput"] && variable) {
      NSMutableDictionary *replacement = [dictionary mutableCopy];
      [replacement removeObjectForKey:@"OutputUUID"];
      [replacement removeObjectForKey:@"OutputName"];
      replacement[@"Type"] = @"Variable";
      replacement[@"VariableName"] = variable;
      *changed = true;
      return replacement;
    }

    NSMutableDictionary *replacement = nil;
    for (id key in dictionary) {
      id child = dictionary[key];
      id rewritten = BridgeShortpyRewriteVariableMutationReferences(
          child, variableByUUID, changed);
      if (rewritten != child) {
        if (!replacement) {
          replacement = [dictionary mutableCopy];
        }
        replacement[key] = rewritten;
      }
    }
    return replacement ?: value;
  }

  if ([value isKindOfClass:[NSArray class]]) {
    NSArray *array = value;
    NSMutableArray *replacement = nil;
    for (NSUInteger index = 0; index < array.count; index++) {
      id child = array[index];
      id rewritten = BridgeShortpyRewriteVariableMutationReferences(
          child, variableByUUID, changed);
      if (rewritten != child) {
        if (!replacement) {
          replacement = [array mutableCopy];
        }
        replacement[index] = rewritten;
      }
    }
    return replacement ?: value;
  }
  return value;
}

static id BridgeShortpyActionWithSerializedParameters(
    id action, NSDictionary *serializedParameters) {
  if (!action || ![serializedParameters isKindOfClass:[NSDictionary class]] ||
      ![action respondsToSelector:@selector(identifier)] ||
      ![action respondsToSelector:@selector(definition)]) {
    return nil;
  }
  id identifier =
      ((id(*)(id, SEL))objc_msgSend)(action, @selector(identifier));
  id definition =
      ((id(*)(id, SEL))objc_msgSend)(action, @selector(definition));
  id allocated = ((id(*)(id, SEL))objc_msgSend)(object_getClass(action),
                                                 @selector(alloc));
  return ((id(*)(id, SEL, id, id, id))objc_msgSend)(
      allocated, @selector(initWithIdentifier:definition:serializedParameters:),
      identifier, definition, serializedParameters);
}

static NSArray *BridgeShortpyNormalizeVariableActionDataflow(
    NSArray *sourceActions) {
  NSMutableDictionary<NSString *, NSString *> *variableByUUID =
      [NSMutableDictionary dictionary];
  for (id action in sourceActions) {
    if (!BridgeShortpyIsVariableMutationAction(action)) {
      continue;
    }
    NSDictionary *serialized =
        ((id(*)(id, SEL))objc_msgSend)(action, @selector(serializedParameters));
    NSString *variable = serialized[@"WFVariableName"];
    NSString *uuid = serialized[@"UUID"];
    if ([variable isKindOfClass:[NSString class]] && variable.length > 0 &&
        [uuid isKindOfClass:[NSString class]] && uuid.length > 0) {
      variableByUUID[uuid] = variable;
    }
  }
  if (variableByUUID.count == 0) {
    return sourceActions;
  }

  NSMutableArray<NSDictionary *> *normalizedParameters =
      [NSMutableArray arrayWithCapacity:sourceActions.count];
  for (id action in sourceActions) {
    NSDictionary *serialized =
        ((id(*)(id, SEL))objc_msgSend)(action, @selector(serializedParameters));
    bool changed = false;
    NSDictionary *normalized = BridgeShortpyRewriteVariableMutationReferences(
        serialized, variableByUUID, &changed);
    [normalizedParameters addObject:normalized];
  }

  NSMutableArray *actions = [sourceActions mutableCopy];
  for (NSUInteger index = 0; index < sourceActions.count; index++) {
    id action = sourceActions[index];
    NSDictionary *original =
        ((id(*)(id, SEL))objc_msgSend)(action, @selector(serializedParameters));
    NSDictionary *normalized = normalizedParameters[index];
    NSMutableDictionary *replacement = nil;
    if (![normalized isEqual:original]) {
      replacement = [normalized mutableCopy];
    }
    if (BridgeShortpyIsVariableMutationAction(action)) {
      if (original[@"UUID"] || normalized[@"UUID"]) {
        if (!replacement) {
          replacement = [normalized mutableCopy];
        }
        [replacement removeObjectForKey:@"UUID"];
      }
    }
    if (replacement) {
      id rewritten =
          BridgeShortpyActionWithSerializedParameters(action, replacement);
      if (!rewritten) {
        return nil;
      }
      actions[index] = rewritten;
    }
  }
  return actions;
}

static id BridgeShortpyVariableDeclaration(NSString *name, id value) {
  Class variableClass = NSClassFromString(@"WFProgramUserDefinedVariable");
  Class assignmentClass = NSClassFromString(@"WFProgramAssignmentNode");
  Class nodeClass = NSClassFromString(@"WFProgramNode");
  if (![name isKindOfClass:[NSString class]] || name.length == 0 || !value ||
      !variableClass || !assignmentClass || !nodeClass) {
    return nil;
  }
  id variableAllocated =
      ((id(*)(id, SEL))objc_msgSend)(variableClass, @selector(alloc));
  id variable = ((id(*)(id, SEL, id))objc_msgSend)(
      variableAllocated, @selector(initWithName:), name);
  id assignmentAllocated =
      ((id(*)(id, SEL))objc_msgSend)(assignmentClass, @selector(alloc));
  id assignment = ((id(*)(id, SEL, id, id))objc_msgSend)(
      assignmentAllocated, @selector(initWithVariable:value:), variable,
      value);
  return assignment ? ((id(*)(id, SEL, id))objc_msgSend)(
                          nodeClass, @selector(group:), assignment)
                    : nil;
}

static id BridgeShortpyGenericActionExport(id action, SEL selector,
                                            NSError **error) {
  Class baseClass = NSClassFromString(@"WFAction");
  Method baseMethod = class_getInstanceMethod(baseClass, selector);
  if (!baseMethod) {
    if (error) {
      *error = [NSError errorWithDomain:@"ShortpyEditModeContext"
                                   code:1
                               userInfo:@{
                                 NSLocalizedDescriptionKey :
                                     @"WFAction is missing exportWithError:"
                               }];
    }
    return nil;
  }
  id (*implementation)(id, SEL, NSError **) =
      (id(*)(id, SEL, NSError **))method_getImplementation(baseMethod);
  id exported = nil;
  @try {
    exported = implementation(action, selector, error);
    if (exported) {
      exported = BridgeShortpyAppendFallbackParameters(action, exported, error);
    }
  } @catch (NSException *exception) {
    if (error) {
      *error = [NSError errorWithDomain:@"ShortpyEditModeContext"
                                   code:2
                               userInfo:@{
                                 NSLocalizedDescriptionKey : exception.reason
                                     ?: @"generic action export raised an exception",
                                 @"exceptionName" : exception.name
                                     ?: @"NSException",
                               }];
    }
    return nil;
  }
  bool needsVariableParameter = BridgeShortpyIsVariableMutationAction(action);
  if (!exported || !needsVariableParameter) {
    return exported;
  }

  NSDictionary *serialized =
      ((id(*)(id, SEL))objc_msgSend)(action, @selector(serializedParameters));
  NSString *variable = [serialized objectForKey:@"WFVariableName"];
  id group = [exported respondsToSelector:@selector(group)]
                 ? ((id(*)(id, SEL))objc_msgSend)(exported, @selector(group))
                 : nil;
  if (![variable isKindOfClass:[NSString class]] ||
      ![group respondsToSelector:@selector(functionName)] ||
      ![group respondsToSelector:@selector(parameters)]) {
    return exported;
  }
  NSString *functionName =
      ((id(*)(id, SEL))objc_msgSend)(group, @selector(functionName));
  NSArray *parameters =
      ((id(*)(id, SEL))objc_msgSend)(group, @selector(parameters));
  Class quotedClass = NSClassFromString(@"WFProgramQuotedNode");
  Class passedClass = NSClassFromString(@"WFProgramPassedParameterNode");
  Class executionClass = NSClassFromString(@"WFProgramActionExecutionNode");
  Class nodeClass = NSClassFromString(@"WFProgramNode");
  if (!functionName || ![parameters isKindOfClass:[NSArray class]] ||
      !quotedClass || !passedClass || !executionClass || !nodeClass) {
    return exported;
  }
  id quoted = ((id(*)(id, SEL, id))objc_msgSend)(
      quotedClass, @selector(quotingString:), variable);
  id quotedValue = quoted ? ((id(*)(id, SEL, id))objc_msgSend)(
                                nodeClass, @selector(group:), quoted)
                          : nil;
  id passedAllocated = ((id(*)(id, SEL))objc_msgSend)(passedClass,
                                                       @selector(alloc));
  id variableParameter = ((id(*)(id, SEL, id, id))objc_msgSend)(
      passedAllocated, @selector(initWithName:value:), @"variable", quotedValue);
  if (!quotedValue || !variableParameter) {
    return exported;
  }
  NSMutableArray *completeParameters = [parameters mutableCopy];
  [completeParameters insertObject:variableParameter atIndex:0];
  id executionAllocated = ((id(*)(id, SEL))objc_msgSend)(executionClass,
                                                          @selector(alloc));
  id execution = ((id(*)(id, SEL, id, id, id))objc_msgSend)(
      executionAllocated, @selector(initWithAction:functionName:parameters:),
      action, functionName, completeParameters);
  id executionNode = execution ? ((id(*)(id, SEL, id))objc_msgSend)(
                                     nodeClass, @selector(group:), execution)
                               : nil;
  id declaration = BridgeShortpyVariableDeclaration(variable, executionNode);
  return declaration ?: executionNode ?: exported;
}

static id BridgeShortpyAdaptedActionParameters(id action, SEL selector) {
  Class adapterClass = object_getClass(action);
  Class originalClass = class_getSuperclass(adapterClass);
  Method originalMethod = class_getInstanceMethod(originalClass, selector);
  if (!originalMethod) {
    return nil;
  }
  id (*implementation)(id, SEL) =
      (id(*)(id, SEL))method_getImplementation(originalMethod);
  NSArray *parameters = implementation(action, selector);
  if (![parameters isKindOfClass:[NSArray class]]) {
    return parameters;
  }

  Class parameterClass = NSClassFromString(@"WFParameter");
  Class variableFieldClass = NSClassFromString(@"WFVariableFieldParameter");
  Class dictionaryClass = NSClassFromString(@"WFDictionaryParameter");
  SEL exportSelectors[] = {
      @selector(exportParameterState:hostHandle:delegate:error:),
      @selector(exportExpressionForSingleState:hostHandle:error:),
      @selector(exportExpressionForMultipleState:hostHandle:error:),
  };
  NSMutableArray *supported =
      [NSMutableArray arrayWithCapacity:parameters.count];
  NSMutableArray *fallback = [NSMutableArray array];
  for (id parameter in parameters) {
    // Variable target fields retain the established Set/Add reconstruction
    // below. They are not interchangeable with ordinary parameter states.
    if (variableFieldClass &&
        [parameter isKindOfClass:variableFieldClass]) {
      continue;
    }
    if (dictionaryClass && [parameter isKindOfClass:dictionaryClass]) {
      [fallback addObject:parameter];
      continue;
    }

    Class concreteClass = object_getClass(parameter);
    bool hasConcreteExporter = false;
    for (size_t index = 0;
         index < sizeof(exportSelectors) / sizeof(exportSelectors[0]); index++) {
      SEL exportSelector = exportSelectors[index];
      IMP concreteImplementation =
          class_getMethodImplementation(concreteClass, exportSelector);
      IMP abstractImplementation = parameterClass
          ? class_getMethodImplementation(parameterClass, exportSelector)
          : NULL;
      if (concreteImplementation &&
          (!abstractImplementation ||
           concreteImplementation != abstractImplementation)) {
        hasConcreteExporter = true;
        break;
      }
    }
    if (hasConcreteExporter) {
      [supported addObject:parameter];
    } else {
      [fallback addObject:parameter];
    }
  }
  objc_setAssociatedObject(action, &kBridgeShortpyFallbackParametersKey,
                           fallback, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return supported;
}

static NSError *BridgeShortpyFallbackError(NSString *description,
                                            id parameter, id state) {
  NSMutableDictionary *userInfo =
      [NSMutableDictionary dictionaryWithObject:description
                                         forKey:NSLocalizedDescriptionKey];
  if (parameter) {
    userInfo[@"parameterClass"] = NSStringFromClass(object_getClass(parameter));
    if ([parameter respondsToSelector:@selector(key)]) {
      id key = ((id(*)(id, SEL))objc_msgSend)(parameter, @selector(key));
      if (key) {
        userInfo[@"parameterKey"] = key;
      }
    }
  }
  if (state) {
    userInfo[@"stateClass"] = NSStringFromClass(object_getClass(state));
  }
  return [NSError errorWithDomain:@"ShortpyReverseExporter"
                             code:3
                         userInfo:userInfo];
}

static id BridgeShortpyFirstSerializedValue(id object, NSString *key) {
  if ([object isKindOfClass:[NSDictionary class]]) {
    id direct = object[key];
    if (direct) {
      return direct;
    }
    for (id child in [object allValues]) {
      id found = BridgeShortpyFirstSerializedValue(child, key);
      if (found) {
        return found;
      }
    }
  } else if ([object isKindOfClass:[NSArray class]]) {
    for (id child in object) {
      id found = BridgeShortpyFirstSerializedValue(child, key);
      if (found) {
        return found;
      }
    }
  }
  return nil;
}

static bool BridgeShortpyContainsTypedDictionaryNumber(id object) {
  if ([object isKindOfClass:[NSDictionary class]]) {
    id itemType = object[@"WFItemType"];
    if ([itemType respondsToSelector:@selector(integerValue)] &&
        [itemType integerValue] == 3) {
      return true;
    }
    for (id child in [object allValues]) {
      if (BridgeShortpyContainsTypedDictionaryNumber(child)) {
        return true;
      }
    }
  } else if ([object isKindOfClass:[NSArray class]]) {
    for (id child in object) {
      if (BridgeShortpyContainsTypedDictionaryNumber(child)) {
        return true;
      }
    }
  }
  return false;
}

static NSString *BridgeShortpyStaticQuotedProgramString(id node) {
  Class quotedClass = NSClassFromString(@"WFProgramQuotedNode");
  id group = [node respondsToSelector:@selector(group)]
                 ? ((id(*)(id, SEL))objc_msgSend)(node, @selector(group))
                 : nil;
  if (!quotedClass || ![group isKindOfClass:quotedClass] ||
      ![group respondsToSelector:@selector(contents)]) {
    return nil;
  }
  NSArray *contents =
      ((id(*)(id, SEL))objc_msgSend)(group, @selector(contents));
  if (![contents isKindOfClass:[NSArray class]] || contents.count != 1) {
    return nil;
  }
  id atom = contents[0];
  NSInteger nodeType = [atom respondsToSelector:@selector(nodeType)]
                           ? ((NSInteger(*)(id, SEL))objc_msgSend)(
                                 atom, @selector(nodeType))
                           : -1;
  id string = [atom respondsToSelector:@selector(string)]
                  ? ((id(*)(id, SEL))objc_msgSend)(atom, @selector(string))
                  : nil;
  return nodeType == 0 && [string isKindOfClass:[NSString class]] ? string
                                                                  : nil;
}

static bool BridgeShortpyRepairTypedDictionaryItem(id programNode,
                                                    NSDictionary *item,
                                                    NSError **error);

static void BridgeShortpyFindDictionaryItemArray(id object,
                                                  NSArray **candidate,
                                                  bool *ambiguous) {
  if (*ambiguous || !object) {
    return;
  }
  if ([object isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dictionary = object;
    id value = dictionary[@"Value"];
    if ([dictionary[@"WFSerializationType"]
            isEqual:@"WFArrayParameterState"] &&
        [value isKindOfClass:[NSArray class]]) {
      if (*candidate && *candidate != value) {
        *ambiguous = true;
      } else {
        *candidate = value;
      }
      return;
    }
    for (id child in [dictionary allValues]) {
      BridgeShortpyFindDictionaryItemArray(child, candidate, ambiguous);
    }
    return;
  }
  if ([object isKindOfClass:[NSArray class]]) {
    for (id child in object) {
      BridgeShortpyFindDictionaryItemArray(child, candidate, ambiguous);
    }
  }
}

static bool BridgeShortpyRepairTypedDictionaryArray(id programNode,
                                                     id serialized,
                                                     NSError **error) {
  Class arrayClass = NSClassFromString(@"WFProgramArrayNode");
  id group = [programNode respondsToSelector:@selector(group)]
                 ? ((id(*)(id, SEL))objc_msgSend)(programNode,
                                                  @selector(group))
                 : nil;
  NSArray *elements = arrayClass && [group isKindOfClass:arrayClass] &&
                              [group respondsToSelector:@selector(elements)]
                          ? ((id(*)(id, SEL))objc_msgSend)(group,
                                                           @selector(elements))
                          : nil;
  NSArray *serializedElements = nil;
  bool ambiguousSerializedArray = false;
  BridgeShortpyFindDictionaryItemArray(serialized, &serializedElements,
                                       &ambiguousSerializedArray);
  if (![elements isKindOfClass:[NSArray class]] ||
      ![serializedElements isKindOfClass:[NSArray class]] ||
      ambiguousSerializedArray ||
      elements.count != serializedElements.count) {
    if (BridgeShortpyContainsTypedDictionaryNumber(serialized) && error) {
      *error = BridgeShortpyFallbackError(
          @"typed Dictionary list could not be matched to its native program "
           "array",
          nil, nil);
    }
    return !BridgeShortpyContainsTypedDictionaryNumber(serialized);
  }
  for (NSUInteger index = 0; index < elements.count; index++) {
    id serializedElement = serializedElements[index];
    if ([serializedElement isKindOfClass:[NSDictionary class]] &&
        serializedElement[@"WFItemType"] &&
        !BridgeShortpyRepairTypedDictionaryItem(
            elements[index], serializedElement, error)) {
      return false;
    }
  }
  return true;
}

static bool BridgeShortpyRepairTypedDictionaryProgram(id programNode,
                                                       id serialized,
                                                       NSError **error) {
  if (!BridgeShortpyContainsTypedDictionaryNumber(serialized)) {
    return true;
  }
  Class dictionaryClass = NSClassFromString(@"WFProgramDictionaryNode");
  id group = [programNode respondsToSelector:@selector(group)]
                 ? ((id(*)(id, SEL))objc_msgSend)(programNode,
                                                  @selector(group))
                 : nil;
  NSArray *pairs = dictionaryClass && [group isKindOfClass:dictionaryClass] &&
                           [group respondsToSelector:@selector(keyValuePairs)]
                       ? ((id(*)(id, SEL))objc_msgSend)(group,
                                                        @selector(keyValuePairs))
                       : nil;
  NSArray *items = BridgeShortpyFirstSerializedValue(
      serialized, @"WFDictionaryFieldValueItems");
  if (![pairs isKindOfClass:[NSArray class]] ||
      ![items isKindOfClass:[NSArray class]] || pairs.count != items.count) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"typed Dictionary could not be matched to its native program node",
          nil, nil);
    }
    return false;
  }

  NSMutableDictionary<NSString *, NSDictionary *> *itemsByKey =
      [NSMutableDictionary dictionaryWithCapacity:items.count];
  for (id item in items) {
    id key = BridgeShortpyFirstSerializedValue(item[@"WFKey"], @"string");
    if (![key isKindOfClass:[NSString class]] || itemsByKey[key]) {
      if (error) {
        *error = BridgeShortpyFallbackError(
            @"typed Dictionary requires unique static keys for lossless "
             "program export",
            nil, nil);
      }
      return false;
    }
    itemsByKey[key] = item;
  }

  Class pairClass = NSClassFromString(@"WFProgramKeyValuePairNode");
  for (id pairNode in pairs) {
    id pair = pairClass && [pairNode isKindOfClass:pairClass]
                  ? pairNode
                  : [pairNode respondsToSelector:@selector(group)]
                        ? ((id(*)(id, SEL))objc_msgSend)(pairNode,
                                                         @selector(group))
                        : nil;
    id keyNode = [pair respondsToSelector:@selector(key)]
                     ? ((id(*)(id, SEL))objc_msgSend)(pair, @selector(key))
                     : nil;
    id valueNode = [pair respondsToSelector:@selector(value)]
                       ? ((id(*)(id, SEL))objc_msgSend)(pair, @selector(value))
                       : nil;
    NSString *key = BridgeShortpyStaticQuotedProgramString(keyNode);
    NSDictionary *item = key ? itemsByKey[key] : nil;
    if (!item || !valueNode ||
        !BridgeShortpyRepairTypedDictionaryItem(valueNode, item, error)) {
      if (error && !*error) {
        *error = BridgeShortpyFallbackError(
            @"typed Dictionary program key could not be matched", nil, nil);
      }
      return false;
    }
  }
  return true;
}

static bool BridgeShortpyRepairTypedDictionaryItem(id programNode,
                                                    NSDictionary *item,
                                                    NSError **error) {
  NSInteger itemType = [item[@"WFItemType"] integerValue];
  if (itemType == 1) {
    return BridgeShortpyRepairTypedDictionaryProgram(programNode,
                                                      item[@"WFValue"], error);
  }
  if (itemType == 2) {
    return BridgeShortpyRepairTypedDictionaryArray(programNode,
                                                    item[@"WFValue"], error);
  }
  if (itemType != 3) {
    return true;
  }

  NSString *literal = BridgeShortpyStaticQuotedProgramString(programNode);
  NSCharacterSet *invalid = [[NSCharacterSet
      characterSetWithCharactersInString:@"0123456789+-.eE"] invertedSet];
  NSDecimalNumber *number = literal
      ? [NSDecimalNumber decimalNumberWithString:literal
                                          locale:@{
                                            NSLocaleDecimalSeparator : @"."
                                          }]
      : nil;
  if (!literal || [literal rangeOfCharacterFromSet:invalid].location !=
                      NSNotFound ||
      ![literal rangeOfCharacterFromSet:[NSCharacterSet decimalDigitCharacterSet]]
           .length ||
      [number isEqualToNumber:[NSDecimalNumber notANumber]] ||
      ![programNode respondsToSelector:@selector(replaceContentWithVerbatim:)]) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"typed Dictionary number is not a static numeric program literal",
          nil, nil);
    }
    return false;
  }
  ((void (*)(id, SEL, id))objc_msgSend)(
      programNode, @selector(replaceContentWithVerbatim:), literal);
  return true;
}

static id BridgeShortpyAppendFallbackParameters(id action, id exported,
                                                  NSError **error) {
  NSArray *fallback = objc_getAssociatedObject(
      action, &kBridgeShortpyFallbackParametersKey);
  if (![fallback isKindOfClass:[NSArray class]] || fallback.count == 0) {
    return exported;
  }

  id group = [exported respondsToSelector:@selector(group)]
                 ? ((id(*)(id, SEL))objc_msgSend)(exported, @selector(group))
                 : nil;
  if (![group respondsToSelector:@selector(functionName)] ||
      ![group respondsToSelector:@selector(parameters)]) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"generic action export did not return an action execution group",
          nil, nil);
    }
    return nil;
  }

  NSString *functionName =
      ((id(*)(id, SEL))objc_msgSend)(group, @selector(functionName));
  NSArray *exportedParameters =
      ((id(*)(id, SEL))objc_msgSend)(group, @selector(parameters));
  Class hostClass = NSClassFromString(@"WFParameterHostHandle");
  Class passedClass = NSClassFromString(@"WFProgramPassedParameterNode");
  Class executionClass = NSClassFromString(@"WFProgramActionExecutionNode");
  Class nodeClass = NSClassFromString(@"WFProgramNode");
  if (!functionName || ![exportedParameters isKindOfClass:[NSArray class]] ||
      !hostClass || !passedClass || !executionClass || !nodeClass) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"native program classes required for parameter fallback are missing",
          nil, nil);
    }
    return nil;
  }

  id hostAllocated =
      ((id(*)(id, SEL))objc_msgSend)(hostClass, @selector(alloc));
  id hostHandle = ((id(*)(id, SEL, id))objc_msgSend)(
      hostAllocated, @selector(initWithAction:), action);
  if (!hostHandle) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"WFParameterHostHandle could not represent the action", nil, nil);
    }
    return nil;
  }

  NSMutableArray *completeParameters = [exportedParameters mutableCopy];
  for (id parameter in fallback) {
    id key = [parameter respondsToSelector:@selector(key)]
                 ? ((id(*)(id, SEL))objc_msgSend)(parameter, @selector(key))
                 : nil;
    id state = key &&
                       [action respondsToSelector:@selector(parameterStateForKey:)]
                   ? ((id(*)(id, SEL, id))objc_msgSend)(
                         action, @selector(parameterStateForKey:), key)
                   : nil;
    if (!state) {
      continue;
    }
    if (![state respondsToSelector:@selector(exportWithError:)]) {
      if (error) {
        *error = BridgeShortpyFallbackError(
            @"parameter state does not provide a native program exporter",
            parameter, state);
      }
      return nil;
    }

    NSError *fallbackError = nil;
    id value = ((id(*)(id, SEL, NSError **))objc_msgSend)(
        state, @selector(exportWithError:), &fallbackError);
    Class dictionaryClass = NSClassFromString(@"WFDictionaryParameter");
    NSDictionary *serialized =
        ((id(*)(id, SEL))objc_msgSend)(action, @selector(serializedParameters));
    if (value && !fallbackError && dictionaryClass &&
        [parameter isKindOfClass:dictionaryClass] &&
        !BridgeShortpyRepairTypedDictionaryProgram(value, serialized[key],
                                                    &fallbackError)) {
      value = nil;
    }
    id label = ((id(*)(id, SEL, id, NSError **))objc_msgSend)(
        parameter, @selector(exportedArgumentLabelWithHostHandle:error:),
        hostHandle, &fallbackError);
    if ([key isKindOfClass:[NSString class]] &&
        [label isKindOfClass:[NSString class]] && ![label isEqual:key] &&
        [label caseInsensitiveCompare:key] == NSOrderedSame) {
      label = key;
    }
    if (!value || !label || fallbackError) {
      if (error) {
        *error = fallbackError ?: BridgeShortpyFallbackError(
            @"parameter state could not be exported as a ToolKit argument",
            parameter, state);
      }
      return nil;
    }

    id passedAllocated = ((id(*)(id, SEL))objc_msgSend)(
        passedClass, @selector(alloc));
    id passed = ((id(*)(id, SEL, id, id))objc_msgSend)(
        passedAllocated, @selector(initWithName:value:), label, value);
    if (!passed) {
      if (error) {
        *error = BridgeShortpyFallbackError(
            @"WFProgramPassedParameterNode initialization failed", parameter,
            state);
      }
      return nil;
    }
    [completeParameters addObject:passed];
  }

  id executionAllocated = ((id(*)(id, SEL))objc_msgSend)(
      executionClass, @selector(alloc));
  id execution = ((id(*)(id, SEL, id, id, id))objc_msgSend)(
      executionAllocated, @selector(initWithAction:functionName:parameters:),
      action, functionName, completeParameters);
  return execution ? ((id(*)(id, SEL, id))objc_msgSend)(
                         nodeClass, @selector(group:), execution)
                   : nil;
}

static Class BridgeShortpyExportSubclass(Class originalClass) {
  if (!originalClass) {
    return Nil;
  }
  NSString *name = [@"ShortpyEditExport_"
      stringByAppendingString:NSStringFromClass(originalClass)];
  Class existing = NSClassFromString(name);
  if (existing) {
    return existing;
  }
  @synchronized([NSProcessInfo processInfo]) {
    existing = NSClassFromString(name);
    if (existing) {
      return existing;
    }
    Class subclass = objc_allocateClassPair(originalClass, name.UTF8String, 0);
    Method baseMethod = class_getInstanceMethod(NSClassFromString(@"WFAction"),
                                                @selector(exportWithError:));
    if (!subclass || !baseMethod ||
        !class_addMethod(subclass, @selector(exportWithError:),
                         (IMP)BridgeShortpyGenericActionExport,
                         method_getTypeEncoding(baseMethod))) {
      if (subclass) {
        objc_disposeClassPair(subclass);
      }
      return Nil;
    }
    Method parametersMethod = class_getInstanceMethod(originalClass,
                                                       @selector(parameters));
    if (parametersMethod) {
      class_addMethod(subclass, @selector(parameters),
                      (IMP)BridgeShortpyAdaptedActionParameters,
                      method_getTypeEncoding(parametersMethod));
    }
    objc_registerClassPair(subclass);
    return subclass;
  }
}

static NSInteger BridgeShortpyActionExecutionCount(id rootNode, id action,
                                                    NSError **error) {
  Class executionClass = NSClassFromString(@"WFProgramActionExecutionNode");
  if (!rootNode || !action || !executionClass) {
    if (error) {
      *error = BridgeShortpyFallbackError(
          @"native program node classification is unavailable", nil, nil);
    }
    return -1;
  }

  NSMutableArray *queue = [NSMutableArray arrayWithObject:rootNode];
  NSMutableSet<NSValue *> *visited = [NSMutableSet set];
  NSInteger matches = 0;
  for (NSUInteger index = 0; index < queue.count; index++) {
    if (index >= 100000) {
      if (error) {
        *error = BridgeShortpyFallbackError(
            @"native program node tree exceeded the classification limit",
            nil, nil);
      }
      return -1;
    }
    id node = queue[index];
    NSValue *identity = [NSValue valueWithPointer:(__bridge const void *)node];
    if ([visited containsObject:identity]) {
      continue;
    }
    [visited addObject:identity];

    id group = [node respondsToSelector:@selector(group)]
                   ? ((id(*)(id, SEL))objc_msgSend)(node, @selector(group))
                   : nil;
    if ([group isKindOfClass:executionClass] &&
        [group respondsToSelector:@selector(action)]) {
      id groupAction =
          ((id(*)(id, SEL))objc_msgSend)(group, @selector(action));
      if (groupAction == action) {
        matches++;
      }
    }
    if (![group respondsToSelector:@selector(children)]) {
      continue;
    }
    id children =
        ((id(*)(id, SEL))objc_msgSend)(group, @selector(children));
    if (!children) {
      continue;
    }
    if (![children isKindOfClass:[NSArray class]]) {
      if (error) {
        *error = BridgeShortpyFallbackError(
            @"native program node children are not an array", nil, nil);
      }
      return -1;
    }
    [queue addObjectsFromArray:children];
  }
  return matches;
}

id bridge_shortpy_make_edit_export_workflow(id workflow,
                                             uint64_t *adaptedActionCount) {
  gBridgeShortpyEditExportError[0] = '\0';
  if (adaptedActionCount) {
    *adaptedActionCount = 0;
  }
  if (!workflow) {
    BridgeShortpySetEditExportError(@"native WFWorkflow is unavailable");
    return nil;
  }
  id copy = [workflow copy];
  NSArray *sourceActions = [copy respondsToSelector:@selector(actions)]
                               ? ((id(*)(id, SEL))objc_msgSend)(copy,
                                                                @selector(actions))
                               : nil;
  if (![sourceActions isKindOfClass:[NSArray class]]) {
    BridgeShortpySetEditExportError(
        @"WFWorkflow copy did not provide an action array");
    return nil;
  }
  if (![copy respondsToSelector:@selector(setActions:)]) {
    BridgeShortpySetEditExportError(
        @"WFWorkflow copy does not support replacing its action array");
    return nil;
  }

  NSMutableArray *isolatedActions =
      [NSMutableArray arrayWithCapacity:sourceActions.count];
  for (NSUInteger index = 0; index < sourceActions.count; index++) {
    id sourceAction = sourceActions[index];
    NSDictionary *serialized = [sourceAction
        respondsToSelector:@selector(serializedParameters)]
        ? ((id(*)(id, SEL))objc_msgSend)(sourceAction,
                                         @selector(serializedParameters))
        : nil;
    id isolatedAction = BridgeShortpyActionWithSerializedParameters(
        sourceAction, serialized);
    if (!isolatedAction || isolatedAction == sourceAction) {
      BridgeShortpySetEditExportError([NSString stringWithFormat:
          @"action %lu (%@) could not be isolated for reverse export",
          (unsigned long)index,
          NSStringFromClass(object_getClass(sourceAction))]);
      return nil;
    }
    [isolatedActions addObject:isolatedAction];
  }
  ((void (*)(id, SEL, id))objc_msgSend)(copy, @selector(setActions:),
                                        isolatedActions);
  sourceActions = isolatedActions;

  sourceActions = BridgeShortpyNormalizeVariableActionDataflow(sourceActions);
  if (!sourceActions) {
    BridgeShortpySetEditExportError(
        @"native variable action dataflow could not be normalized");
    return nil;
  }
  ((void (*)(id, SEL, id))objc_msgSend)(copy, @selector(setActions:),
                                        sourceActions);

  Class baseClass = NSClassFromString(@"WFAction");
  Class controlFlowClass = NSClassFromString(@"WFControlFlowAction");
  Method baseMethod = class_getInstanceMethod(baseClass, @selector(exportWithError:));
  IMP baseImplementation = baseMethod ? method_getImplementation(baseMethod) : NULL;
  if (!baseClass || !baseImplementation) {
    BridgeShortpySetEditExportError(
        @"WFAction generic exportWithError: implementation is unavailable");
    return nil;
  }

  NSMutableArray *actions = [sourceActions mutableCopy];
  uint64_t adapted = 0;
  for (NSUInteger index = 0; index < actions.count; index++) {
    id action = actions[index];
    if (controlFlowClass && [action isKindOfClass:controlFlowClass]) {
      continue;
    }
    IMP actionImplementation = class_getMethodImplementation(
        object_getClass(action), @selector(exportWithError:));
    if (!actionImplementation) {
      BridgeShortpySetEditExportError([NSString stringWithFormat:
          @"action %lu (%@) has no exportWithError: implementation",
          (unsigned long)index, NSStringFromClass(object_getClass(action))]);
      return nil;
    }
    if (actionImplementation == baseImplementation) {
      continue;
    }

    NSError *specializedError = nil;
    id specializedNode = nil;
    NSException *specializedException = nil;
    @try {
      specializedNode = ((id(*)(id, SEL, NSError **))objc_msgSend)(
          action, @selector(exportWithError:), &specializedError);
    } @catch (NSException *exception) {
      specializedException = exception;
    }
    NSInteger executionCount = 0;
    if (specializedNode && !specializedError && !specializedException) {
      NSError *classificationError = nil;
      executionCount = BridgeShortpyActionExecutionCount(
          specializedNode, action, &classificationError);
      if (executionCount < 0) {
        BridgeShortpySetEditExportError([NSString stringWithFormat:
            @"action %lu (%@) could not be classified: %@",
            (unsigned long)index, NSStringFromClass(object_getClass(action)),
            classificationError.localizedDescription ?: @"unknown node shape"]);
        return nil;
      }
      if (executionCount == 1) {
        continue;
      }
      if (executionCount != 0) {
        BridgeShortpySetEditExportError([NSString stringWithFormat:
            @"action %lu (%@) specialized export contains %ld matching "
             "action execution nodes",
            (unsigned long)index, NSStringFromClass(object_getClass(action)),
            (long)executionCount]);
        return nil;
      }
    }

    Class adapterClass = BridgeShortpyExportSubclass(object_getClass(action));
    if (!adapterClass) {
      BridgeShortpySetEditExportError([NSString stringWithFormat:
          @"action %lu (%@) explicit export adapter could not be created",
          (unsigned long)index, NSStringFromClass(object_getClass(action))]);
      return nil;
    }
    object_setClass(action, adapterClass);
    NSError *genericError = nil;
    id genericNode = nil;
    @try {
      genericNode = ((id(*)(id, SEL, NSError **))objc_msgSend)(
          action, @selector(exportWithError:), &genericError);
    } @catch (NSException *exception) {
      BridgeShortpySetEditExportError([NSString stringWithFormat:
          @"action %lu (%@) explicit export raised %@: %@",
          (unsigned long)index, NSStringFromClass(object_getClass(action)),
          exception.name ?: @"NSException", exception.reason ?: @"unknown"]);
      return nil;
    }
    NSError *genericClassificationError = nil;
    NSInteger genericExecutionCount =
        genericNode && !genericError
            ? BridgeShortpyActionExecutionCount(
                  genericNode, action, &genericClassificationError)
            : -1;
    if (genericExecutionCount != 1) {
      NSString *specializedDiagnostic = specializedException
          ? [NSString stringWithFormat:@"%@: %@",
                                       specializedException.name ?: @"NSException",
                                       specializedException.reason ?: @"unknown"]
          : specializedError.localizedDescription
              ?: (specializedNode ? @"no matching action execution node"
                                  : @"no program node");
      NSString *genericDiagnostic = genericError.localizedDescription
          ?: genericClassificationError.localizedDescription
          ?: [NSString stringWithFormat:
                  @"%ld matching action execution nodes",
                  (long)genericExecutionCount];
      BridgeShortpySetEditExportError([NSString stringWithFormat:
          @"action %lu (%@) cannot be exported explicitly; specialized: %@; "
           "generic: %@",
          (unsigned long)index, NSStringFromClass(object_getClass(action)),
          specializedDiagnostic, genericDiagnostic]);
      return nil;
    }
    adapted++;
  }
  ((void (*)(id, SEL, id))objc_msgSend)(copy, @selector(setActions:), actions);
  if (adaptedActionCount) {
    *adaptedActionCount = adapted;
  }
  return copy;
}

bool bridge_shortpy_replace_workflow_action_serialized_parameters(
    id workflow, uint64_t index, NSDictionary *serializedParameters) {
  if (!workflow || ![serializedParameters isKindOfClass:[NSDictionary class]] ||
      ![workflow respondsToSelector:@selector(actions)] ||
      ![workflow respondsToSelector:@selector(setActions:)]) {
    return false;
  }
  NSArray *sourceActions =
      ((id(*)(id, SEL))objc_msgSend)(workflow, @selector(actions));
  if (![sourceActions isKindOfClass:[NSArray class]] ||
      index >= sourceActions.count) {
    return false;
  }
  id source = sourceActions[(NSUInteger)index];
  if (![source respondsToSelector:@selector(identifier)] ||
      ![source respondsToSelector:@selector(definition)]) {
    return false;
  }
  id identifier =
      ((id(*)(id, SEL))objc_msgSend)(source, @selector(identifier));
  id definition =
      ((id(*)(id, SEL))objc_msgSend)(source, @selector(definition));
  id allocated = ((id(*)(id, SEL))objc_msgSend)(object_getClass(source),
                                                 @selector(alloc));
  id replacement =
      ((id(*)(id, SEL, id, id, id))objc_msgSend)(
          allocated,
          @selector(initWithIdentifier:definition:serializedParameters:),
          identifier, definition, serializedParameters);
  if (!replacement) {
    return false;
  }
  NSMutableArray *actions = [sourceActions mutableCopy];
  actions[(NSUInteger)index] = replacement;
  ((void (*)(id, SEL, id))objc_msgSend)(workflow, @selector(setActions:),
                                        actions);
  return true;
}

extern uint32_t bridge_shortpy_else_if_witness_entry_count(
    const void *plan);
extern uint32_t bridge_shortpy_else_if_target_ordinal(
    const void *plan, uint32_t entryIndex);
extern uint32_t bridge_shortpy_else_if_witness_count(
    const void *plan, uint32_t entryIndex);
extern uint32_t bridge_shortpy_else_if_witness_ordinal(
    const void *plan, uint32_t entryIndex, uint32_t witnessIndex);

static NSString *BridgeShortpyActionIdentifier(id action) {
  if (!action || ![action respondsToSelector:@selector(identifier)]) {
    return nil;
  }
  id identifier =
      ((id(*)(id, SEL))objc_msgSend)(action, @selector(identifier));
  return [identifier isKindOfClass:[NSString class]] ? identifier : nil;
}

static NSDictionary *BridgeShortpyActionSerializedParameters(id action) {
  if (!action ||
      ![action respondsToSelector:@selector(serializedParameters)]) {
    return nil;
  }
  id parameters = ((id(*)(id, SEL))objc_msgSend)(
      action, @selector(serializedParameters));
  return [parameters isKindOfClass:[NSDictionary class]] ? parameters : nil;
}

static NSDictionary *BridgeShortpyConditionPayload(
    NSDictionary *parameters) {
  if (![parameters isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  NSMutableDictionary *payload = [parameters mutableCopy];
  [payload removeObjectForKey:@"WFControlFlowMode"];
  [payload removeObjectForKey:@"GroupingIdentifier"];
  [payload removeObjectForKey:@"UUID"];
  return payload;
}

static bool BridgeShortpyConditionalGroupShape(
    NSDictionary *group, NSUInteger witnessCount,
    bool witness, NSString **diagnostic) {
  NSArray<NSNumber *> *modes = group[@"modes"];
  if (![modes isKindOfClass:[NSArray class]]) {
    if (diagnostic) {
      *diagnostic = @"conditional group has no mode sequence";
    }
    return false;
  }
  if (witness) {
    if (modes.count != 2 || modes[0].integerValue != 0 ||
        modes[1].integerValue != 2) {
      if (diagnostic) {
        *diagnostic = [NSString stringWithFormat:
            @"witness group modes are %@, expected [0, 2]", modes];
      }
      return false;
    }
    return true;
  }
  if (modes.count < witnessCount + 2 || modes[0].integerValue != 0 ||
      modes.lastObject.integerValue != 2) {
    if (diagnostic) {
      *diagnostic = [NSString stringWithFormat:
          @"target group modes are %@", modes];
    }
    return false;
  }
  NSUInteger modeOneCount = modes.count - 2;
  if (modeOneCount != witnessCount &&
      modeOneCount != witnessCount + 1) {
    if (diagnostic) {
      *diagnostic = [NSString stringWithFormat:
          @"target has %lu mode-1 markers for %lu Else If branches",
          (unsigned long)modeOneCount, (unsigned long)witnessCount];
    }
    return false;
  }
  for (NSUInteger index = 1; index + 1 < modes.count; index++) {
    if (modes[index].integerValue != 1) {
      if (diagnostic) {
        *diagnostic = [NSString stringWithFormat:
            @"target group modes are %@", modes];
      }
      return false;
    }
  }
  return true;
}

bool bridge_shortpy_repair_else_if_witnesses(
    id workflow, const void *opaquePlan,
    uint32_t *conditionRepairs, uint32_t *elseInsertions,
    uint32_t *witnessMarkersRemoved) {
  if (conditionRepairs) {
    *conditionRepairs = 0;
  }
  if (elseInsertions) {
    *elseInsertions = 0;
  }
  if (witnessMarkersRemoved) {
    *witnessMarkersRemoved = 0;
  }
  gBridgeShortpyElseIfRepairError[0] = 0;
  uint32_t entryCount =
      bridge_shortpy_else_if_witness_entry_count(opaquePlan);
  if (!opaquePlan || entryCount == UINT32_MAX) {
    BridgeShortpySetElseIfRepairError(
        @"Else If witness plan is unavailable or malformed");
    return false;
  }
  if (entryCount == 0) {
    return true;
  }
  if (!workflow || ![workflow respondsToSelector:@selector(actions)] ||
      ![workflow respondsToSelector:@selector(setActions:)]) {
    BridgeShortpySetElseIfRepairError(
        @"native WFWorkflow does not expose mutable actions");
    return false;
  }
  NSArray *sourceActions =
      ((id(*)(id, SEL))objc_msgSend)(workflow, @selector(actions));
  if (![sourceActions isKindOfClass:[NSArray class]]) {
    BridgeShortpySetElseIfRepairError(
        @"native WFWorkflow actions are unavailable");
    return false;
  }

  NSMutableArray<NSMutableDictionary *> *groups = [NSMutableArray array];
  NSMutableDictionary<NSString *, NSMutableDictionary *> *groupByIdentifier =
      [NSMutableDictionary dictionary];
  for (NSUInteger actionIndex = 0;
       actionIndex < sourceActions.count; actionIndex++) {
    id action = sourceActions[actionIndex];
    if (![BridgeShortpyActionIdentifier(action)
            isEqualToString:@"is.workflow.actions.conditional"]) {
      continue;
    }
    NSDictionary *parameters =
        BridgeShortpyActionSerializedParameters(action);
    NSNumber *mode = parameters[@"WFControlFlowMode"];
    NSString *groupingIdentifier = parameters[@"GroupingIdentifier"];
    if (![mode isKindOfClass:[NSNumber class]] ||
        mode.integerValue < 0 || mode.integerValue > 2 ||
        ![groupingIdentifier isKindOfClass:[NSString class]] ||
        groupingIdentifier.length == 0) {
      BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
          @"conditional action %lu has invalid control parameters",
          (unsigned long)actionIndex]);
      return false;
    }
    NSMutableDictionary *group = groupByIdentifier[groupingIdentifier];
    if (mode.integerValue == 0) {
      if (group) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"conditional group %@ has multiple mode-0 markers",
            groupingIdentifier]);
        return false;
      }
      group = [@{
        @"identifier": groupingIdentifier,
        @"indices": [NSMutableArray array],
        @"modes": [NSMutableArray array],
      } mutableCopy];
      groupByIdentifier[groupingIdentifier] = group;
      [groups addObject:group];
    } else if (!group) {
      BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
          @"conditional group %@ begins with mode %@",
          groupingIdentifier, mode]);
      return false;
    }
    NSMutableArray *indices = group[@"indices"];
    NSMutableArray *modes = group[@"modes"];
    if ([modes.lastObject integerValue] == 2) {
      BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
          @"conditional group %@ has actions after mode 2",
          groupingIdentifier]);
      return false;
    }
    [indices addObject:@(actionIndex)];
    [modes addObject:mode];
  }

  NSMutableDictionary<NSNumber *, id> *replacements =
      [NSMutableDictionary dictionary];
  NSMutableDictionary<NSNumber *, NSMutableArray *> *insertions =
      [NSMutableDictionary dictionary];
  NSMutableIndexSet *removals = [NSMutableIndexSet indexSet];
  NSMutableIndexSet *claimedGroupOrdinals = [NSMutableIndexSet indexSet];
  uint64_t repairedCount = 0;
  uint64_t insertedElseCount = 0;

  // Validate and stage every edit before committing one replacement array.
  for (uint32_t entryIndex = 0;
       entryIndex < entryCount; entryIndex++) {
    uint32_t targetOrdinal = bridge_shortpy_else_if_target_ordinal(
        opaquePlan, entryIndex);
    uint32_t witnessCount = bridge_shortpy_else_if_witness_count(
        opaquePlan, entryIndex);
    if (targetOrdinal == UINT32_MAX || witnessCount == UINT32_MAX ||
        witnessCount == 0 || targetOrdinal >= groups.count ||
        targetOrdinal < witnessCount) {
      BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
          @"Else If plan entry %u has invalid group ordinals", entryIndex]);
      return false;
    }
    if ([claimedGroupOrdinals containsIndex:targetOrdinal]) {
      BridgeShortpySetElseIfRepairError(
          @"Else If plan reuses a target conditional group");
      return false;
    }
    [claimedGroupOrdinals addIndex:targetOrdinal];
    NSMutableDictionary *targetGroup = groups[targetOrdinal];
    NSString *shapeDiagnostic = nil;
    if (!BridgeShortpyConditionalGroupShape(
            targetGroup, witnessCount, false, &shapeDiagnostic)) {
      BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
          @"target group %u is incompatible: %@", targetOrdinal,
          shapeDiagnostic ?: @"unknown shape"]);
      return false;
    }
    NSArray<NSNumber *> *targetIndices = targetGroup[@"indices"];
    NSString *targetGroupingIdentifier = targetGroup[@"identifier"];

    for (uint32_t witnessIndex = 0;
         witnessIndex < witnessCount; witnessIndex++) {
      uint32_t witnessOrdinal = bridge_shortpy_else_if_witness_ordinal(
          opaquePlan, entryIndex, witnessIndex);
      uint32_t expectedOrdinal =
          targetOrdinal - witnessCount + witnessIndex;
      if (witnessOrdinal != expectedOrdinal ||
          witnessOrdinal >= groups.count ||
          [claimedGroupOrdinals containsIndex:witnessOrdinal]) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"witness %u for target %u is not contiguous or unique",
            witnessIndex, targetOrdinal]);
        return false;
      }
      [claimedGroupOrdinals addIndex:witnessOrdinal];
      NSMutableDictionary *witnessGroup = groups[witnessOrdinal];
      if (!BridgeShortpyConditionalGroupShape(
              witnessGroup, 0, true, &shapeDiagnostic)) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"witness group %u is incompatible: %@", witnessOrdinal,
            shapeDiagnostic ?: @"unknown shape"]);
        return false;
      }
      NSArray<NSNumber *> *witnessIndices = witnessGroup[@"indices"];
      NSUInteger witnessModeZeroIndex = witnessIndices[0].unsignedIntegerValue;
      NSDictionary *witnessParameters = BridgeShortpyActionSerializedParameters(
          sourceActions[witnessModeZeroIndex]);
      NSDictionary *conditionPayload =
          BridgeShortpyConditionPayload(witnessParameters);
      if (conditionPayload.count == 0) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"witness group %u has no serialized condition payload",
            witnessOrdinal]);
        return false;
      }

      NSUInteger targetModeOneIndex =
          targetIndices[1 + witnessIndex].unsignedIntegerValue;
      id targetModeOneAction = sourceActions[targetModeOneIndex];
      NSDictionary *targetParameters =
          BridgeShortpyActionSerializedParameters(targetModeOneAction);
      if (BridgeShortpyConditionPayload(targetParameters).count != 0) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"target mode-1 marker %lu already has condition payload; "
             "native backend behavior changed",
            (unsigned long)targetModeOneIndex]);
        return false;
      }
      NSMutableDictionary *replacementParameters =
          [@{
            @"WFControlFlowMode": @1,
            @"GroupingIdentifier": targetGroupingIdentifier,
          } mutableCopy];
      [replacementParameters addEntriesFromDictionary:conditionPayload];
      id replacement = BridgeShortpyActionWithSerializedParameters(
          targetModeOneAction, replacementParameters);
      if (!replacement) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"could not construct replacement for mode-1 marker %lu",
            (unsigned long)targetModeOneIndex]);
        return false;
      }
      replacements[@(targetModeOneIndex)] = replacement;
      [removals addIndex:witnessIndices[0].unsignedIntegerValue];
      [removals addIndex:witnessIndices[1].unsignedIntegerValue];
      repairedCount++;
    }

    NSUInteger modeOneCount = targetIndices.count - 2;
    if (modeOneCount == witnessCount) {
      NSUInteger targetModeTwoIndex =
          targetIndices.lastObject.unsignedIntegerValue;
      id templateAction =
          sourceActions[targetIndices[witnessCount].unsignedIntegerValue];
      NSDictionary *elseParameters = @{
        @"WFControlFlowMode": @1,
        @"GroupingIdentifier": targetGroupingIdentifier,
      };
      id elseAction = BridgeShortpyActionWithSerializedParameters(
          templateAction, elseParameters);
      if (!elseAction) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"could not construct final Else marker for target group %u",
            targetOrdinal]);
        return false;
      }
      NSNumber *insertionIndex = @(targetModeTwoIndex);
      NSMutableArray *actionsBefore = insertions[insertionIndex];
      if (!actionsBefore) {
        actionsBefore = [NSMutableArray array];
        insertions[insertionIndex] = actionsBefore;
      }
      [actionsBefore addObject:elseAction];
      insertedElseCount++;
    } else {
      NSUInteger finalElseIndex =
          targetIndices[1 + witnessCount].unsignedIntegerValue;
      NSDictionary *finalElseParameters =
          BridgeShortpyActionSerializedParameters(
              sourceActions[finalElseIndex]);
      if (BridgeShortpyConditionPayload(finalElseParameters).count != 0) {
        BridgeShortpySetElseIfRepairError([NSString stringWithFormat:
            @"final Else marker %lu unexpectedly has condition payload",
            (unsigned long)finalElseIndex]);
        return false;
      }
    }
  }

  if (repairedCount > UINT32_MAX || insertedElseCount > UINT32_MAX ||
      removals.count > UINT32_MAX) {
    BridgeShortpySetElseIfRepairError(
        @"Else If workflow repair count exceeded UInt32");
    return false;
  }
  NSMutableArray *repairedActions = [NSMutableArray arrayWithCapacity:
      sourceActions.count - removals.count + insertedElseCount];
  for (NSUInteger actionIndex = 0;
       actionIndex < sourceActions.count; actionIndex++) {
    NSArray *actionsBefore = insertions[@(actionIndex)];
    if (actionsBefore) {
      [repairedActions addObjectsFromArray:actionsBefore];
    }
    if ([removals containsIndex:actionIndex]) {
      continue;
    }
    id replacement = replacements[@(actionIndex)];
    [repairedActions addObject:replacement ?: sourceActions[actionIndex]];
  }
  NSUInteger expectedCount =
      sourceActions.count - removals.count + (NSUInteger)insertedElseCount;
  if (repairedActions.count != expectedCount) {
    BridgeShortpySetElseIfRepairError(
        @"Else If workflow transaction produced the wrong action count");
    return false;
  }
  ((void (*)(id, SEL, id))objc_msgSend)(
      workflow, @selector(setActions:), repairedActions);
  if (conditionRepairs) {
    *conditionRepairs = (uint32_t)repairedCount;
  }
  if (elseInsertions) {
    *elseInsertions = (uint32_t)insertedElseCount;
  }
  if (witnessMarkersRemoved) {
    *witnessMarkersRemoved = (uint32_t)removals.count;
  }
  return true;
}

typedef struct {
  int32_t protocol;
  int32_t type;
  int32_t witnessTablePattern;
  uint32_t flags;
} BridgeProtocolConformanceDescriptor;

typedef struct {
  int32_t implementation;
  uint32_t contextSize;
} BridgeAsyncFunctionDescriptor;

static const void *BridgeResolveRelative(const int32_t *field) {
  int32_t relative = *field;
  if (relative == 0) {
    return NULL;
  }
  return (const uint8_t *)field + relative;
}

static const void *BridgeResolveRelativeIndirectable(const int32_t *field) {
  int32_t relative = *field;
  if (relative == 0) {
    return NULL;
  }
  const uint8_t *target = (const uint8_t *)field + (relative & ~1);
  if ((relative & 1) != 0) {
    return *(const void *const *)target;
  }
  return target;
}

static const char *BridgeContextDescriptorName(const void *descriptor) {
  if (!descriptor) {
    return NULL;
  }
  const int32_t *nameField = (const int32_t *)((const uint8_t *)descriptor + 8);
  return BridgeResolveRelative(nameField);
}

static bool BridgeSectionRange(const struct mach_header_64 *header,
                               intptr_t slide, const char *segmentName,
                               const char *sectionName,
                               const uint8_t **start, size_t *size) {
  const uint8_t *cursor = (const uint8_t *)(header + 1);
  for (uint32_t index = 0; index < header->ncmds; index++) {
    const struct load_command *command = (const struct load_command *)cursor;
    if (command->cmd == LC_SEGMENT_64) {
      const struct segment_command_64 *segment =
          (const struct segment_command_64 *)cursor;
      if (strncmp(segment->segname, segmentName, sizeof(segment->segname)) == 0) {
        const struct section_64 *sections =
            (const struct section_64 *)(segment + 1);
        for (uint32_t sectionIndex = 0; sectionIndex < segment->nsects;
             sectionIndex++) {
          const struct section_64 *section = &sections[sectionIndex];
          if (strncmp(section->sectname, sectionName,
                      sizeof(section->sectname)) == 0) {
            *start = (const uint8_t *)(uintptr_t)(section->addr + slide);
            *size = (size_t)section->size;
            return true;
          }
        }
      }
    }
    cursor += command->cmdsize;
  }
  return false;
}

void *bridge_resolve_shortcuts_language_ir_backend(uint32_t *contextSize,
                                                   const void **conformance) {
  if (contextSize) {
    *contextSize = 0;
  }
  if (conformance) {
    *conformance = NULL;
  }

  for (uint32_t imageIndex = 0; imageIndex < _dyld_image_count(); imageIndex++) {
    const char *imageName = _dyld_get_image_name(imageIndex);
    if (!imageName ||
        strstr(imageName,
               "/ShortcutsLanguage.framework/ShortcutsLanguage") == NULL) {
      continue;
    }

    const struct mach_header *rawHeader = _dyld_get_image_header(imageIndex);
    if (!rawHeader || rawHeader->magic != MH_MAGIC_64) {
      continue;
    }
    const struct mach_header_64 *header =
        (const struct mach_header_64 *)rawHeader;
    intptr_t slide = _dyld_get_image_vmaddr_slide(imageIndex);
    const uint8_t *protocolsStart = NULL;
    const uint8_t *textStart = NULL;
    size_t protocolsSize = 0;
    size_t textSize = 0;
    if (!BridgeSectionRange(header, slide, "__TEXT", "__swift5_proto",
                            &protocolsStart, &protocolsSize) ||
        !BridgeSectionRange(header, slide, "__TEXT", "__text", &textStart,
                            &textSize)) {
      continue;
    }

    for (size_t offset = 0; offset + sizeof(int32_t) <= protocolsSize;
         offset += sizeof(int32_t)) {
      const int32_t *entry = (const int32_t *)(protocolsStart + offset);
      const BridgeProtocolConformanceDescriptor *candidate =
          BridgeResolveRelative(entry);
      if (!candidate || ((candidate->flags >> 3) & 0x7) != 0) {
        continue;
      }
      const void *protocolDescriptor =
          BridgeResolveRelativeIndirectable(&candidate->protocol);
      const void *typeDescriptor = BridgeResolveRelative(&candidate->type);
      const char *protocolName = BridgeContextDescriptorName(protocolDescriptor);
      const char *typeName = BridgeContextDescriptorName(typeDescriptor);
      if (!protocolName || !typeName || strcmp(protocolName, "Backend") != 0 ||
          strcmp(typeName, "IRToShortcut") != 0) {
        continue;
      }

      const BridgeAsyncFunctionDescriptor *asyncDescriptor =
          (const BridgeAsyncFunctionDescriptor *)(candidate + 1);
      const uint8_t *implementation =
          BridgeResolveRelative(&asyncDescriptor->implementation);
      uint32_t requiredContextSize = asyncDescriptor->contextSize;
      if (!implementation || implementation < textStart ||
          implementation >= textStart + textSize || requiredContextSize < 0x80 ||
          requiredContextSize > 0x4000 ||
          (requiredContextSize & 0xf) != 0) {
        return NULL;
      }

      if (contextSize) {
        *contextSize = requiredContextSize;
      }
      if (conformance) {
        *conformance = candidate;
      }
      return (void *)implementation;
    }
  }
  return NULL;
}

typedef struct {
  const void *metadata;
  uintptr_t state;
} BridgeMetadataResponse;

typedef BridgeMetadataResponse (*BridgeMetadataAccessor)(uintptr_t request);
typedef void *(*BridgeValueInitializeWithCopy)(void *destination,
                                               const void *source,
                                               const void *metadata);
typedef void (*BridgeValueDestroy)(void *value, const void *metadata);

typedef struct {
  uint32_t flags;
  int32_t mangledTypeName;
  int32_t fieldName;
} BridgeFieldRecord;

typedef struct {
  uint64_t magic;
  void *allocation;
  const void *metadata;
} BridgeOwnedValueHeader;

static const uint64_t kBridgeOwnedValueMagic = 0x534850594952424bULL;
static _Thread_local char gBridgeIRBackendError[512];

extern void *swift_allocObject(const void *metadata, size_t requiredSize,
                               size_t requiredAlignmentMask);
extern void *swift_retain(void *object);
extern void swift_release(void *object);

static void BridgeSetIRBackendError(const char *format, ...) {
  va_list arguments;
  va_start(arguments, format);
  vsnprintf(gBridgeIRBackendError, sizeof(gBridgeIRBackendError), format,
            arguments);
  va_end(arguments);
}

const char *bridge_shortpy_ir_backend_last_error(void) {
  return gBridgeIRBackendError;
}

static const void *BridgeMetadataForAccessorSymbol(const char *symbolName) {
  BridgeMetadataAccessor accessor =
      (BridgeMetadataAccessor)dlsym(RTLD_DEFAULT, symbolName);
  if (!accessor) {
    return NULL;
  }
  return accessor(0).metadata;
}

static const void *BridgeValueWitnessTable(const void *metadata) {
  if (!metadata) {
    return NULL;
  }
  return ((const void *const *)metadata)[-1];
}

static size_t BridgeValueSize(const void *metadata) {
  const uintptr_t *witnesses = BridgeValueWitnessTable(metadata);
  return witnesses ? (size_t)witnesses[8] : 0;
}

static size_t BridgeValueAlignmentMask(const void *metadata) {
  const uint8_t *witnesses = BridgeValueWitnessTable(metadata);
  return witnesses ? (size_t)witnesses[0x50] : 0;
}

static BridgeValueInitializeWithCopy
BridgeValueCopyInitializer(const void *metadata) {
  const void *const *witnesses = BridgeValueWitnessTable(metadata);
  return witnesses ? (BridgeValueInitializeWithCopy)witnesses[2] : NULL;
}

static BridgeValueDestroy BridgeValueDestroyer(const void *metadata) {
  const void *const *witnesses = BridgeValueWitnessTable(metadata);
  return witnesses ? (BridgeValueDestroy)witnesses[1] : NULL;
}

bool bridge_copy_shortcuts_language_ir_program(void *destination,
                                                const void *source) {
  const void *metadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage9IRProgramVMa");
  BridgeValueInitializeWithCopy initialize =
      BridgeValueCopyInitializer(metadata);
  if (!destination || !source || !metadata || !initialize ||
      BridgeValueSize(metadata) != 16) {
    return false;
  }
  initialize(destination, source, metadata);
  return true;
}

void bridge_destroy_shortcuts_language_ir_program(void *program) {
  const void *metadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage9IRProgramVMa");
  BridgeValueDestroy destroy = BridgeValueDestroyer(metadata);
  if (program && metadata && destroy) {
    destroy(program, metadata);
  }
}

void bridge_destroy_shortcuts_language_frontend_result(void *result) {
  const void *metadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage14FrontendResultVMa");
  BridgeValueDestroy destroy = BridgeValueDestroyer(metadata);
  if (result && metadata && destroy) {
    destroy(result, metadata);
  }
}

static void *BridgeAllocateOwnedValue(const void *metadata) {
  size_t size = BridgeValueSize(metadata);
  size_t alignmentMask = BridgeValueAlignmentMask(metadata);
  if (size == 0 || alignmentMask > 0xfff) {
    return NULL;
  }
  size_t total = sizeof(BridgeOwnedValueHeader) + size + alignmentMask;
  uint8_t *allocation = calloc(1, total);
  if (!allocation) {
    return NULL;
  }
  uintptr_t candidate =
      (uintptr_t)(allocation + sizeof(BridgeOwnedValueHeader));
  uintptr_t valueAddress = (candidate + alignmentMask) & ~alignmentMask;
  BridgeOwnedValueHeader *header =
      (BridgeOwnedValueHeader *)(valueAddress - sizeof(*header));
  header->magic = kBridgeOwnedValueMagic;
  header->allocation = allocation;
  header->metadata = metadata;
  return (void *)valueAddress;
}

void bridge_destroy_shortcuts_language_ir_backend(void *backend) {
  if (!backend) {
    return;
  }
  BridgeOwnedValueHeader *header =
      (BridgeOwnedValueHeader *)((uint8_t *)backend -
                                 sizeof(BridgeOwnedValueHeader));
  if (header->magic != kBridgeOwnedValueMagic || !header->allocation ||
      !header->metadata) {
    return;
  }
  BridgeValueDestroy destroy = BridgeValueDestroyer(header->metadata);
  if (destroy) {
    destroy(backend, header->metadata);
  }
  void *allocation = header->allocation;
  header->magic = 0;
  free(allocation);
}

static bool BridgeStructFields(const void *typeDescriptor,
                               const void *metadata,
                               const char *const *requiredNames,
                               size_t requiredCount, size_t *offsets) {
  if (!typeDescriptor || !metadata || !requiredNames || !offsets) {
    return false;
  }
  const uint8_t *descriptor = typeDescriptor;
  const void *fieldDescriptor =
      BridgeResolveRelative((const int32_t *)(descriptor + 16));
  uint32_t fieldCount = *(const uint32_t *)(descriptor + 20);
  uint32_t fieldOffsetVectorWords = *(const uint32_t *)(descriptor + 24);
  if (!fieldDescriptor || fieldCount == 0 || fieldCount > 128 ||
      fieldOffsetVectorWords == 0 || fieldOffsetVectorWords > 128) {
    return false;
  }

  const uint8_t *fields = fieldDescriptor;
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  if (recordSize < sizeof(BridgeFieldRecord) || recordCount != fieldCount) {
    return false;
  }

  const uint32_t *fieldOffsets = (const uint32_t *)(
      (const uintptr_t *)metadata + fieldOffsetVectorWords);
  for (size_t requiredIndex = 0; requiredIndex < requiredCount;
       requiredIndex++) {
    bool found = false;
    for (uint32_t fieldIndex = 0; fieldIndex < recordCount; fieldIndex++) {
      const BridgeFieldRecord *record =
          (const BridgeFieldRecord *)(fields + 16 + fieldIndex * recordSize);
      const char *fieldName = BridgeResolveRelative(&record->fieldName);
      if (fieldName && strcmp(fieldName, requiredNames[requiredIndex]) == 0) {
        offsets[requiredIndex] = (size_t)fieldOffsets[fieldIndex];
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

static void *BridgeAllocateSwiftMatcher(const void *metadata) {
  if (!metadata) {
    return NULL;
  }
  const uint8_t *bytes = metadata;
  uint32_t instanceSize = *(const uint32_t *)(bytes + 0x30);
  uint16_t alignmentMask = *(const uint16_t *)(bytes + 0x34);
  if (instanceSize < 16 || instanceSize > 0x10000 || alignmentMask > 0xfff) {
    return NULL;
  }
  return swift_allocObject(metadata, instanceSize, alignmentMask);
}

void *bridge_create_shortcuts_language_ir_backend(
    const void *flags, id catalog, id database, const void *toolVisibility) {
  gBridgeIRBackendError[0] = '\0';
  if (!flags || !catalog || !database || !toolVisibility) {
    BridgeSetIRBackendError("missing flags, catalog, database, or visibility");
    return NULL;
  }

  uint32_t contextSize = 0;
  const void *conformance = NULL;
  if (!bridge_resolve_shortcuts_language_ir_backend(&contextSize,
                                                    &conformance) ||
      !conformance) {
    BridgeSetIRBackendError("IRToShortcut Backend conformance was not found");
    return NULL;
  }

  const BridgeProtocolConformanceDescriptor *descriptor = conformance;
  const uint8_t *typeDescriptor = BridgeResolveRelative(&descriptor->type);
  BridgeMetadataAccessor backendAccessor = typeDescriptor
      ? (BridgeMetadataAccessor)BridgeResolveRelative(
            (const int32_t *)(typeDescriptor + 12))
      : NULL;
  const void *backendMetadata =
      backendAccessor ? backendAccessor(0).metadata : NULL;
  const void *flagsMetadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage5FlagsVMa");
  const void *visibilityMetadata = BridgeMetadataForAccessorSymbol(
      "$s7ToolKit0A16VisibilityFilterVMa");
  const void *toolMatcherMetadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage17PythonToolMatcherCMa");
  const void *triggerMatcherMetadata = BridgeMetadataForAccessorSymbol(
      "$s17ShortcutsLanguage20PythonTriggerMatcherCMa");
  if (!backendMetadata || !flagsMetadata || !visibilityMetadata ||
      !toolMatcherMetadata || !triggerMatcherMetadata) {
    BridgeSetIRBackendError(
        "missing backend/flags/visibility/tool matcher metadata");
    return NULL;
  }

  const char *backendFieldNames[] = {
      "workflow", "flags",       "catalog",
      "database", "toolMatcher", "triggerMatcher",
  };
  size_t backendFieldOffsets[6] = {0};
  if (!BridgeStructFields(typeDescriptor, backendMetadata, backendFieldNames,
                          6, backendFieldOffsets)) {
    BridgeSetIRBackendError("IRToShortcut field metadata did not match");
    return NULL;
  }

  Ivar toolDatabaseIvar =
      class_getInstanceVariable((__bridge Class)toolMatcherMetadata, "db");
  Ivar toolVisibilityIvar =
      class_getInstanceVariable((__bridge Class)toolMatcherMetadata,
                                "visibility");
  Ivar triggerDatabaseIvar =
      class_getInstanceVariable((__bridge Class)triggerMatcherMetadata, "db");
  BridgeValueInitializeWithCopy copyFlags =
      BridgeValueCopyInitializer(flagsMetadata);
  BridgeValueInitializeWithCopy copyVisibility =
      BridgeValueCopyInitializer(visibilityMetadata);
  if (!toolDatabaseIvar || !toolVisibilityIvar || !triggerDatabaseIvar ||
      !copyFlags || !copyVisibility) {
    BridgeSetIRBackendError("matcher ivars or value witnesses were unavailable");
    return NULL;
  }

  void *backend = BridgeAllocateOwnedValue(backendMetadata);
  void *toolMatcher = BridgeAllocateSwiftMatcher(toolMatcherMetadata);
  void *triggerMatcher = BridgeAllocateSwiftMatcher(triggerMatcherMetadata);
  if (!backend || !toolMatcher || !triggerMatcher) {
    BridgeSetIRBackendError("failed to allocate IRToShortcut state");
    if (backend) {
      BridgeOwnedValueHeader *header =
          (BridgeOwnedValueHeader *)((uint8_t *)backend -
                                     sizeof(BridgeOwnedValueHeader));
      free(header->allocation);
    }
    return NULL;
  }

  Class workflowClass = objc_getClass("WFWorkflow");
  id workflowAllocation = workflowClass
      ? ((id (*)(Class, SEL))objc_msgSend)(workflowClass,
                                           sel_registerName("alloc"))
      : nil;
  id workflow = workflowAllocation
      ? ((id (*)(id, SEL))objc_msgSend)(workflowAllocation,
                                        sel_registerName("init"))
      : nil;
  if (!workflow) {
    BridgeSetIRBackendError("WFWorkflow initialization failed");
    return NULL;
  }

  uint8_t *toolBytes = toolMatcher;
  uint8_t *triggerBytes = triggerMatcher;
  *(void **)(toolBytes + ivar_getOffset(toolDatabaseIvar)) =
      swift_retain((__bridge void *)database);
  copyVisibility(toolBytes + ivar_getOffset(toolVisibilityIvar), toolVisibility,
                 visibilityMetadata);
  *(void **)(triggerBytes + ivar_getOffset(triggerDatabaseIvar)) =
      swift_retain((__bridge void *)database);

  uint8_t *backendBytes = backend;
  *(const void **)(backendBytes + backendFieldOffsets[0]) =
      CFBridgingRetain(workflow);
  copyFlags(backendBytes + backendFieldOffsets[1], flags, flagsMetadata);
  *(const void **)(backendBytes + backendFieldOffsets[2]) =
      CFBridgingRetain(catalog);
  *(void **)(backendBytes + backendFieldOffsets[3]) =
      swift_retain((__bridge void *)database);
  *(void **)(backendBytes + backendFieldOffsets[4]) = toolMatcher;
  *(void **)(backendBytes + backendFieldOffsets[5]) = triggerMatcher;
  return backend;
}

id bridge_objc_alloc_class(const char *class_name) {
  Class cls = class_name ? objc_getClass(class_name) : Nil;
  if (!cls) {
    return nil;
  }
  return ((id (*)(Class, SEL))objc_msgSend)(cls, sel_registerName("alloc"));
}

id bridge_objc_class_msg_send0(const char *class_name, const char *selector_name) {
  Class cls = class_name ? objc_getClass(class_name) : Nil;
  if (!cls || !selector_name) {
    return nil;
  }
  return ((id (*)(Class, SEL))objc_msgSend)(cls, sel_registerName(selector_name));
}

BOOL bridge_objc_responds(id object, const char *selector_name) {
  if (!object || !selector_name) {
    return NO;
  }
  return [object respondsToSelector:sel_registerName(selector_name)];
}

id bridge_objc_msg_send0(id object, const char *selector_name) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL))objc_msgSend)(object, sel_registerName(selector_name));
}

void bridge_objc_msg_send_void0(id object, const char *selector_name) {
  if (!object || !selector_name) {
    return;
  }
  ((void (*)(id, SEL))objc_msgSend)(object, sel_registerName(selector_name));
}

void bridge_objc_msg_send_void0_barrier_sync(id queue, id object, const char *selector_name) {
  if (!queue || !object || !selector_name) {
    return;
  }
  SEL selector = sel_registerName(selector_name);
  dispatch_barrier_sync((dispatch_queue_t)queue, ^{
    ((void (*)(id, SEL))objc_msgSend)(object, selector);
  });
}

id bridge_objc_msg_send1(id object, const char *selector_name, id arg1) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL, id))objc_msgSend)(object, sel_registerName(selector_name), arg1);
}

id bridge_objc_msg_send2(id object, const char *selector_name, id arg1, id arg2) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL, id, id))objc_msgSend)(object, sel_registerName(selector_name), arg1, arg2);
}

id bridge_objc_msg_send3(id object, const char *selector_name, id arg1, id arg2, id arg3) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL, id, id, id))objc_msgSend)(object, sel_registerName(selector_name), arg1, arg2, arg3);
}

id bridge_objc_msg_send4(id object, const char *selector_name, id arg1, id arg2, id arg3, id arg4) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL, id, id, id, id))objc_msgSend)(object, sel_registerName(selector_name), arg1, arg2, arg3, arg4);
}

id bridge_objc_msg_send2_bool(id object, const char *selector_name, id arg1, id arg2, BOOL arg3) {
  if (!object || !selector_name) {
    return nil;
  }
  return ((id (*)(id, SEL, id, id, BOOL))objc_msgSend)(object, sel_registerName(selector_name), arg1, arg2, arg3);
}

uint64_t bridge_objc_msg_send_uint64(id object, const char *selector_name) {
  if (!object || !selector_name) {
    return 0;
  }
  return ((uint64_t (*)(id, SEL))objc_msgSend)(object, sel_registerName(selector_name));
}

void bridge_objc_msg_send_uint64_arg(id object, const char *selector_name, uint64_t arg1) {
  if (!object || !selector_name) {
    return;
  }
  ((void (*)(id, SEL, uint64_t))objc_msgSend)(object, sel_registerName(selector_name), arg1);
}
