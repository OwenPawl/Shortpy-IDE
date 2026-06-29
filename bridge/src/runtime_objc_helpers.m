#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

static NSString *const kBridgeLogicalGeneratorAssetRoot =
    @"/System/Library/AssetsV2/"
     "com_apple_MobileAsset_UAF_Shortcuts_Generator/";
static NSString *const kBridgeHostGeneratorAssetRoot =
    @"/Volumes/reSSD/MacMoved/Developer/CoreSimulator/Devices/"
     "9B1C6AA3-3917-418B-95F9-A14D24411062/data/private/var/"
     "MobileAsset/AssetsV2/com_apple_MobileAsset_UAF_Shortcuts_Generator/";

static NSString *BridgeMappedGeneratorAssetPath(NSString *path) {
  if (![path isKindOfClass:[NSString class]] ||
      ![path hasPrefix:kBridgeLogicalGeneratorAssetRoot]) {
    return path;
  }
  NSString *suffix = [path substringFromIndex:kBridgeLogicalGeneratorAssetRoot.length];
  return [kBridgeHostGeneratorAssetRoot stringByAppendingString:suffix];
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
  fprintf(file,
          "[asset-path-bridge] installed logical=%s host=%s\n",
          kBridgeLogicalGeneratorAssetRoot.UTF8String,
          kBridgeHostGeneratorAssetRoot.UTF8String);
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
