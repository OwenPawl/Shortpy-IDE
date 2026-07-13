#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <dlfcn.h>
#import <mach-o/dyld.h>
#import <mach-o/loader.h>
#import <stdbool.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdarg.h>
#import <stdlib.h>

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
  id exported = implementation(action, selector, error);
  Class appendClass = NSClassFromString(@"WFAppendVariableAction");
  Class setClass = NSClassFromString(@"WFSetVariableAction");
  bool needsVariableParameter =
      (appendClass && [action isKindOfClass:appendClass]) ||
      (setClass && [action isKindOfClass:setClass]);
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
  return execution ? ((id(*)(id, SEL, id))objc_msgSend)(
                         nodeClass, @selector(group:), execution)
                   : exported;
}

static id BridgeShortpyFilteredActionParameters(id action, SEL selector) {
  Class adapterClass = object_getClass(action);
  Class originalClass = class_getSuperclass(adapterClass);
  Method originalMethod = class_getInstanceMethod(originalClass, selector);
  if (!originalMethod) {
    return nil;
  }
  id (*implementation)(id, SEL) =
      (id(*)(id, SEL))method_getImplementation(originalMethod);
  NSArray *parameters = implementation(action, selector);
  Class unsupportedClass = NSClassFromString(@"WFVariableFieldParameter");
  if (!unsupportedClass || ![parameters isKindOfClass:[NSArray class]]) {
    return parameters;
  }
  NSMutableArray *filtered = [NSMutableArray arrayWithCapacity:parameters.count];
  for (id parameter in parameters) {
    if (![parameter isKindOfClass:unsupportedClass]) {
      [filtered addObject:parameter];
    }
  }
  return filtered;
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
                      (IMP)BridgeShortpyFilteredActionParameters,
                      method_getTypeEncoding(parametersMethod));
    }
    objc_registerClassPair(subclass);
    return subclass;
  }
}

id bridge_shortpy_make_edit_export_workflow(id workflow,
                                             uint64_t *adaptedActionCount) {
  if (adaptedActionCount) {
    *adaptedActionCount = 0;
  }
  if (!workflow) {
    return nil;
  }
  id copy = [workflow copy];
  NSArray *sourceActions = [copy respondsToSelector:@selector(actions)]
                               ? ((id(*)(id, SEL))objc_msgSend)(copy,
                                                                @selector(actions))
                               : nil;
  if (![sourceActions isKindOfClass:[NSArray class]]) {
    return nil;
  }

  Class baseClass = NSClassFromString(@"WFAction");
  Class controlFlowClass = NSClassFromString(@"WFControlFlowAction");
  Method baseMethod = class_getInstanceMethod(baseClass, @selector(exportWithError:));
  IMP baseImplementation = baseMethod ? method_getImplementation(baseMethod) : NULL;
  NSArray<Class> *explicitActionClasses = @[
    NSClassFromString(@"WFAppendVariableAction") ?: NSObject.class,
    NSClassFromString(@"WFSetVariableAction") ?: NSObject.class,
    NSClassFromString(@"WFGetVariableAction") ?: NSObject.class,
    NSClassFromString(@"WFCommentAction") ?: NSObject.class,
  ];
  if (!baseClass || !baseImplementation) {
    return nil;
  }

  NSMutableArray *actions = [sourceActions mutableCopy];
  uint64_t adapted = 0;
  for (NSUInteger index = 0; index < actions.count; index++) {
    id action = actions[index];
    if (controlFlowClass && [action isKindOfClass:controlFlowClass]) {
      continue;
    }
    bool explicitlyRendered = false;
    for (Class candidate in explicitActionClasses) {
      if (candidate != NSObject.class && [action isKindOfClass:candidate]) {
        explicitlyRendered = true;
        break;
      }
    }
    if (!explicitlyRendered) {
      continue;
    }
    IMP actionImplementation = class_getMethodImplementation(
        object_getClass(action), @selector(exportWithError:));
    if (!actionImplementation || actionImplementation == baseImplementation) {
      continue;
    }
    id actionCopy = [action copy];
    Class adapterClass = BridgeShortpyExportSubclass(object_getClass(actionCopy));
    if (!actionCopy || !adapterClass) {
      return nil;
    }
    object_setClass(actionCopy, adapterClass);
    actions[index] = actionCopy;
    adapted++;
  }
  if (![copy respondsToSelector:@selector(setActions:)]) {
    return nil;
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
