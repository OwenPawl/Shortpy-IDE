#include <dlfcn.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  const void *metadata;
  uintptr_t state;
} MetadataResponse;

typedef MetadataResponse (*MetadataAccessor)(uintptr_t request);
typedef MetadataResponse (*GenericMetadataAccessor)(uintptr_t request,
                                                    const void *argument);
typedef void *(*ValueInitializeWithCopy)(void *destination,
                                         const void *source,
                                         const void *metadata);
typedef void *(*ValueInitializeWithTake)(void *destination, void *source,
                                         const void *metadata);
typedef void (*ValueDestroy)(void *value, const void *metadata);
typedef void (*ProjectEnumData)(void *value, const void *metadata);
typedef void (*InjectEnumTag)(void *value, unsigned tag,
                              const void *metadata);
typedef const char *(*EnumCaseName)(void *value, const void *metadata);
typedef const void *(*TypeByMangledNameInContext)(
    const char *name, size_t length, const void *context,
    const void *const *genericArguments);
typedef intptr_t (*SwiftArrayCount)(uintptr_t storage,
                                   const void *elementMetadata);
typedef void *(*SwiftProjectBox)(void *box);
typedef void (*SwiftRelease)(void *object);

typedef struct {
  void *object;
  void *buffer;
} SwiftBoxPair;

typedef SwiftBoxPair (*SwiftAllocBox)(const void *metadata);

typedef struct {
  uint32_t flags;
  int32_t mangledTypeName;
  int32_t fieldName;
} FieldRecord;

typedef struct {
  uint8_t *elements;
  size_t count;
  size_t stride;
} ArrayView;

typedef struct {
  uint8_t *allocation;
  void *value;
  const void *payloadMetadata;
  void *box;
} ProjectedValue;

typedef struct {
  uint8_t *allocation;
  void *name;
  int64_t controlStatementID;
  int64_t ownerStatementID;
  int64_t initializerStatementID;
  bool hasConflictingWrite;
  bool initializerOnly;
  bool oneSidedNone;
} ControlFlowBinding;

typedef struct {
  uint8_t *targetAllocation;
  void *targetName;
  uint8_t *seedAllocation;
  void *seedName;
  size_t *targetBranchIndices;
  size_t targetBranchCount;
  size_t targetBranchCapacity;
  size_t *seedBranchIndices;
  size_t seedBranchCount;
  size_t seedBranchCapacity;
  uint32_t controlKind;
  int64_t seedStatementID;
  int64_t seedAliasStatementID;
  int64_t controlStatementID;
} RecurrenceBinding;

typedef struct {
  uint8_t *targetAllocation;
  void *targetName;
  uint8_t *seedAllocation;
  void *seedName;
  size_t *targetBranchIndices;
  size_t targetBranchCount;
  size_t targetBranchCapacity;
  size_t *seedBranchIndices;
  size_t seedBranchCount;
  size_t seedBranchCapacity;
  uint32_t controlKind;
  int64_t controlStatementID;
} RecurrenceCandidate;

typedef struct {
  ControlFlowBinding *items;
  size_t count;
  size_t capacity;
  RecurrenceBinding *recurrences;
  size_t recurrenceCount;
  size_t recurrenceCapacity;
  const void *stringMetadata;
} ControlFlowBindings;

typedef struct {
  uint32_t initializerRepairs;
  uint32_t forwardingRemovals;
  uint32_t forwardingConversions;
  uint32_t structuralNoneRemovals;
  uint32_t oneSidedNoneRepairs;
  uint32_t structuralBindingMatches;
  uint32_t structuralBindingMisses;
  uint32_t structuralExpressionTails;
  uint32_t structuralValueExpressionTails;
  uint32_t structuralNoneValueTails;
  const char *lastStructuralValueCase;
  const char *lastStructuralAtomCase;
} ControlFlowOutputRepairCounts;

typedef struct {
  int64_t targetStatementID;
  uint32_t targetOrdinal;
  int64_t *witnessStatementIDs;
  uint32_t *witnessOrdinals;
  size_t witnessCount;
} ElseIfWitnessEntry;

typedef struct {
  ElseIfWitnessEntry *entries;
  size_t count;
  size_t capacity;
  size_t witnessCount;
} ElseIfWitnessPlan;

typedef enum {
  kAdapterCapabilityBase = 1U << 0,
  kAdapterCapabilityStatementReferenceConstruction = 1U << 1,
  kAdapterCapabilityStatementExpressionConstruction = 1U << 2,
} AdapterCapability;

typedef struct {
  const void *statement;
  const void *assignment;
  const void *append;
  const void *functionDefinition;
  const void *conditional;
  const void *conditionalBranch;
  const void *repeatDefinition;
  const void *finiteRepeatDefinition;
  const void *matchDefinition;
  const void *matchCase;
  const void *expression;
  const void *functionCall;
  const char *expressionFunctionCallCase;
  const void *functionCallArgumentsMetadata;
  const void *functionCallArgumentArray;
  const void *argument;
  const char *argumentKeywordCase;
  const void *keywordArgument;
  const void *keywordArgumentValueMetadata;
  const void *value;
  const void *valueAtom;
  const void *valueInterpolationPayload;
  const void *interpolationArray;
  const void *interpolationPart;
  const void *interpolationVariablePayload;
  const void *valueListPayload;
  const void *valueListArray;
  const void *variable;
  const void *variableAtom;
  const void *statementReference;
  const void *statementExpressionPayload;
  const void *sourceReferencedString;
  uint32_t loadedCapabilities;

  unsigned statementAssignment;
  unsigned statementConditional;
  unsigned statementRepeat;
  unsigned statementFiniteRepeat;
  unsigned statementFunction;
  unsigned statementAppend;
  unsigned statementMatch;
  unsigned statementExpression;
  size_t assignmentVariable;
  size_t assignmentExpression;
  size_t appendVariable;
  size_t appendExpression;
  size_t functionBody;
  size_t conditionalIfBranch;
  size_t conditionalElseIfBranches;
  size_t conditionalElseBody;
  size_t conditionalSourceReference;
  size_t conditionalBranchBody;
  size_t repeatBody;
  size_t repeatSourceReference;
  size_t finiteRepeatBody;
  size_t finiteRepeatSourceReference;
  size_t matchCases;
  size_t matchCaseBody;
  size_t functionCallFunctionName;
  size_t functionCallArgumentsOffset;
  size_t keywordArgumentKeyword;
  size_t keywordArgumentValue;
  size_t statementReferenceID;
  size_t statementReferenceSource;
  size_t sourceReferencedValue;

  EnumCaseName enumCaseName;
  SwiftArrayCount arrayCount;
} AdapterContext;

static _Thread_local char gAdapterError[512];
static _Thread_local char gAdapterTrace[512];

extern bool bridge_shortpy_swift_string_equal(const void *lhs,
                                               const void *rhs);
extern bool bridge_shortpy_swift_string_equal_utf8(const void *value,
                                                    const char *expected);
extern int64_t bridge_shortpy_ir_statement_id(const void *statement);
extern void bridge_shortpy_source_referenced_get_value(
    void *result, const void *sourceReferenced, const void *metadata);
extern void bridge_shortpy_array_remove_last_generic(
    uintptr_t *array, const void *elementMetadata);
extern void bridge_shortpy_array_insert_copy_generic(
    uintptr_t *array, const void *element, size_t index,
    const void *elementMetadata);
static bool SameVariable(const void *lhs, const void *rhs);
static const uint8_t *ConstStatementPayload(const void *statement);
static const ControlFlowBinding *BindingForControlStatement(
    const ControlFlowBindings *bindings, int64_t statementID,
    int64_t ownerStatementID);
static bool LoadStatementExpressionConstructorCapabilities(
    AdapterContext *context);
static bool RequireCapabilities(AdapterContext *context,
                                AdapterCapability capabilities);

static void SetError(const char *message) {
  snprintf(gAdapterError, sizeof(gAdapterError), "%s", message);
}

const char *bridge_shortpy_ir_adapter_last_error(void) {
  return gAdapterError;
}

const char *bridge_shortpy_ir_adapter_last_trace(void) {
  return gAdapterTrace;
}

static const void *ResolveRelative(const int32_t *relative) {
  if (!relative || *relative == 0) {
    return NULL;
  }
  return (const uint8_t *)relative + *relative;
}

static const void *MetadataForSymbol(const char *symbol) {
  MetadataAccessor accessor = (MetadataAccessor)dlsym(RTLD_DEFAULT, symbol);
  return accessor ? accessor(0).metadata : NULL;
}

static const void *GenericMetadataForSymbol(const char *symbol,
                                            const void *argument) {
  if (!argument) {
    return NULL;
  }
  GenericMetadataAccessor accessor =
      (GenericMetadataAccessor)dlsym(RTLD_DEFAULT, symbol);
  return accessor ? accessor(0, argument).metadata : NULL;
}

static const void *ValueWitnessTable(const void *metadata) {
  return metadata ? ((const void *const *)metadata)[-1] : NULL;
}

static size_t ValueSize(const void *metadata) {
  const uintptr_t *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (size_t)witnesses[8] : 0;
}

static size_t ValueStride(const void *metadata) {
  const uintptr_t *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (size_t)witnesses[9] : 0;
}

static size_t ValueAlignmentMask(const void *metadata) {
  const uint8_t *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (size_t)witnesses[0x50] : 0;
}

static ValueInitializeWithCopy CopyInitializer(const void *metadata) {
  const void *const *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (ValueInitializeWithCopy)witnesses[2] : NULL;
}

static ValueInitializeWithTake TakeInitializer(const void *metadata) {
  const void *const *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (ValueInitializeWithTake)witnesses[4] : NULL;
}

static ValueDestroy Destroyer(const void *metadata) {
  const void *const *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (ValueDestroy)witnesses[1] : NULL;
}

static ProjectEnumData EnumDataProjector(const void *metadata) {
  const void *const *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (ProjectEnumData)witnesses[12] : NULL;
}

static InjectEnumTag EnumDataInjector(const void *metadata) {
  const void *const *witnesses = ValueWitnessTable(metadata);
  return witnesses ? (InjectEnumTag)witnesses[13] : NULL;
}

static const uint8_t *TypeDescriptor(const void *metadata) {
  return metadata ? (const uint8_t *)((const void *const *)metadata)[1] : NULL;
}

static uint32_t ReflectedFieldCount(const void *metadata) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  const uint8_t *fields = descriptor
      ? ResolveRelative((const int32_t *)(descriptor + 16))
      : NULL;
  if (!descriptor || !fields) {
    return 0;
  }
  uint32_t fieldCount = *(const uint32_t *)(descriptor + 20);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  return fieldCount == recordCount ? recordCount : 0;
}

static bool StructFieldOffsets(const void *metadata,
                               const char *const *names, size_t nameCount,
                               size_t *offsets) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  if (!descriptor || !names || !offsets) {
    return false;
  }
  const uint8_t *fields = ResolveRelative((const int32_t *)(descriptor + 16));
  uint32_t fieldCount = *(const uint32_t *)(descriptor + 20);
  uint32_t offsetVectorWords = *(const uint32_t *)(descriptor + 24);
  if (!fields || fieldCount == 0 || fieldCount > 128 ||
      offsetVectorWords == 0 || offsetVectorWords > 128) {
    return false;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  if (recordSize < sizeof(FieldRecord) || recordCount != fieldCount) {
    return false;
  }
  const uint32_t *fieldOffsets =
      (const uint32_t *)((const uintptr_t *)metadata + offsetVectorWords);
  for (size_t requested = 0; requested < nameCount; requested++) {
    bool found = false;
    for (uint32_t index = 0; index < recordCount; index++) {
      const FieldRecord *record =
          (const FieldRecord *)(fields + 16 + index * recordSize);
      const char *fieldName = ResolveRelative(&record->fieldName);
      if (fieldName && strcmp(fieldName, names[requested]) == 0) {
        offsets[requested] = fieldOffsets[index];
        found = true;
        break;
      }
    }
    if (!found) {
      size_t used = (size_t)snprintf(
          gAdapterError, sizeof(gAdapterError),
          "native field metadata has no '%s' field; fields=", names[requested]);
      for (uint32_t index = 0;
           index < recordCount && used < sizeof(gAdapterError) - 1; index++) {
        const FieldRecord *record =
            (const FieldRecord *)(fields + 16 + index * recordSize);
        const char *fieldName = ResolveRelative(&record->fieldName);
        used += (size_t)snprintf(gAdapterError + used,
                                 sizeof(gAdapterError) - used, "%s%s",
                                 index ? "," : "",
                                 fieldName ? fieldName : "<unnamed>");
      }
      return false;
    }
  }
  return true;
}

static bool EnumCaseIndex(const void *metadata, const char *name,
                          unsigned *result) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  if (!descriptor || !name || !result) {
    return false;
  }
  const uint8_t *fields = ResolveRelative((const int32_t *)(descriptor + 16));
  if (!fields) {
    return false;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  if (recordSize < sizeof(FieldRecord) || recordCount == 0 ||
      recordCount > 256) {
    return false;
  }
  for (uint32_t index = 0; index < recordCount; index++) {
    const FieldRecord *record =
        (const FieldRecord *)(fields + 16 + index * recordSize);
    const char *caseName = ResolveRelative(&record->fieldName);
    if (caseName && strcmp(caseName, name) == 0) {
      *result = index;
      return true;
    }
  }
  return false;
}

static size_t SymbolicMangledNameLength(const uint8_t *name) {
  size_t length = 0;
  if (!name) {
    return 0;
  }
  while (name[length] != 0) {
    uint8_t byte = name[length++];
    if (byte >= 0x01 && byte <= 0x1f) {
      length += sizeof(int32_t);
    }
  }
  return length;
}

static const void *EnumCasePayloadMetadata(const void *metadata,
                                           const char *name) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  const uint8_t *fields = descriptor
      ? ResolveRelative((const int32_t *)(descriptor + 16))
      : NULL;
  TypeByMangledNameInContext resolve =
      (TypeByMangledNameInContext)dlsym(
          RTLD_DEFAULT, "swift_getTypeByMangledNameInContext");
  if (!fields || !resolve || !name) {
    return NULL;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  for (uint32_t index = 0; index < recordCount; index++) {
    const FieldRecord *record =
        (const FieldRecord *)(fields + 16 + index * recordSize);
    const char *caseName = ResolveRelative(&record->fieldName);
    if (!caseName || strcmp(caseName, name) != 0) {
      continue;
    }
    const uint8_t *mangledName = ResolveRelative(&record->mangledTypeName);
    size_t length = SymbolicMangledNameLength(mangledName);
    return length ? resolve((const char *)mangledName, length, descriptor, NULL)
                  : NULL;
  }
  return NULL;
}

static const void *StructFieldMetadata(const void *metadata,
                                       const char *name) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  const uint8_t *fields = descriptor
      ? ResolveRelative((const int32_t *)(descriptor + 16))
      : NULL;
  TypeByMangledNameInContext resolve =
      (TypeByMangledNameInContext)dlsym(
          RTLD_DEFAULT, "swift_getTypeByMangledNameInContext");
  if (!fields || !resolve || !name) {
    return NULL;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  for (uint32_t index = 0; index < recordCount; index++) {
    const FieldRecord *record =
        (const FieldRecord *)(fields + 16 + index * recordSize);
    const char *fieldName = ResolveRelative(&record->fieldName);
    if (!fieldName || strcmp(fieldName, name) != 0) {
      continue;
    }
    const uint8_t *mangledName = ResolveRelative(&record->mangledTypeName);
    size_t length = SymbolicMangledNameLength(mangledName);
    return length ? resolve((const char *)mangledName, length, descriptor, NULL)
                  : NULL;
  }
  return NULL;
}

static const char *EnumCaseForPayloadMetadata(const void *metadata,
                                              const void *payloadMetadata) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  const uint8_t *fields = descriptor
      ? ResolveRelative((const int32_t *)(descriptor + 16))
      : NULL;
  TypeByMangledNameInContext resolve =
      (TypeByMangledNameInContext)dlsym(
          RTLD_DEFAULT, "swift_getTypeByMangledNameInContext");
  if (!fields || !resolve || !payloadMetadata) {
    return NULL;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  for (uint32_t index = 0; index < recordCount; index++) {
    const FieldRecord *record =
        (const FieldRecord *)(fields + 16 + index * recordSize);
    const uint8_t *mangledName = ResolveRelative(&record->mangledTypeName);
    size_t length = SymbolicMangledNameLength(mangledName);
    if (!length ||
        resolve((const char *)mangledName, length, descriptor, NULL) !=
            payloadMetadata) {
      continue;
    }
    return ResolveRelative(&record->fieldName);
  }
  return NULL;
}

static bool EnumCaseIsIndirect(const void *metadata, const char *name,
                               bool *isIndirect) {
  const uint8_t *descriptor = TypeDescriptor(metadata);
  const uint8_t *fields = descriptor
      ? ResolveRelative((const int32_t *)(descriptor + 16))
      : NULL;
  if (!fields || !name || !isIndirect) {
    return false;
  }
  uint16_t recordSize = *(const uint16_t *)(fields + 10);
  uint32_t recordCount = *(const uint32_t *)(fields + 12);
  for (uint32_t index = 0; index < recordCount; index++) {
    const FieldRecord *record =
        (const FieldRecord *)(fields + 16 + index * recordSize);
    const char *caseName = ResolveRelative(&record->fieldName);
    if (caseName && strcmp(caseName, name) == 0) {
      *isIndirect = (record->flags & 1U) != 0;
      return true;
    }
  }
  return false;
}

static bool LoadMetadata(AdapterContext *context) {
  context->statement =
      MetadataForSymbol("$s17ShortcutsLanguage11IRStatementOMa");
  context->assignment = MetadataForSymbol(
      "$s17ShortcutsLanguage11IRStatementO12IRAssignmentVMa");
  context->append =
      MetadataForSymbol("$s17ShortcutsLanguage18IRAppendDefinitionVMa");
  context->functionDefinition = MetadataForSymbol(
      "$s17ShortcutsLanguage20IRFunctionDefinitionVMa");
  context->conditional =
      MetadataForSymbol("$s17ShortcutsLanguage13IRConditionalVMa");
  context->conditionalBranch = MetadataForSymbol(
      "$s17ShortcutsLanguage13IRConditionalV6BranchVMa");
  context->repeatDefinition =
      MetadataForSymbol("$s17ShortcutsLanguage18IRRepeatDefinitionVMa");
  context->finiteRepeatDefinition = MetadataForSymbol(
      "$s17ShortcutsLanguage24IRFiniteRepeatDefinitionVMa");
  context->matchDefinition =
      MetadataForSymbol("$s17ShortcutsLanguage17IRMatchDefinitionVMa");
  context->matchCase = MetadataForSymbol(
      "$s17ShortcutsLanguage17IRMatchDefinitionV4CaseVMa");
  context->expression =
      MetadataForSymbol("$s17ShortcutsLanguage12IRExpressionOMa");
  context->functionCall =
      MetadataForSymbol("$s17ShortcutsLanguage14IRFunctionCallVMa");
  context->argument =
      MetadataForSymbol("$s17ShortcutsLanguage10IRArgumentOMa");
  context->keywordArgument =
      MetadataForSymbol("$s17ShortcutsLanguage17IRKeywordArgumentVMa");
  context->keywordArgumentValueMetadata = StructFieldMetadata(
      context->keywordArgument, "value");
  context->expressionFunctionCallCase = EnumCaseForPayloadMetadata(
      context->expression, context->functionCall);
  context->argumentKeywordCase = EnumCaseForPayloadMetadata(
      context->argument, context->keywordArgument);
  context->functionCallArgumentsMetadata = StructFieldMetadata(
      context->functionCall, "arguments");
  context->functionCallArgumentArray = context->functionCallArgumentsMetadata
      ? ((const void *const *)context->functionCallArgumentsMetadata)[2]
      : NULL;
  context->value = MetadataForSymbol("$s17ShortcutsLanguage7IRValueOMa");
  context->valueAtom =
      MetadataForSymbol("$s17ShortcutsLanguage7IRValueO4AtomOMa");
  context->valueInterpolationPayload =
      EnumCasePayloadMetadata(context->value, "interpolation");
  context->interpolationArray = context->valueInterpolationPayload
      ? ((const void *const *)context->valueInterpolationPayload)[2]
      : NULL;
  context->interpolationPart = context->interpolationArray
      ? ((const void *const *)context->interpolationArray)[2]
      : NULL;
  context->interpolationVariablePayload = EnumCasePayloadMetadata(
      context->interpolationPart, "variable");
  context->valueListPayload =
      EnumCasePayloadMetadata(context->value, "list");
  context->valueListArray = context->valueListPayload
      ? ((const void *const *)context->valueListPayload)[2]
      : NULL;
  context->variable =
      MetadataForSymbol("$s17ShortcutsLanguage10IRVariableOMa");
  context->variableAtom =
      MetadataForSymbol("$s17ShortcutsLanguage10IRVariableO4AtomOMa");
  context->statementReference = MetadataForSymbol(
      "$s17ShortcutsLanguage10IRVariableO18StatementReferenceVMa");
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  context->sourceReferencedString = GenericMetadataForSymbol(
      "$s17ShortcutsLanguage16SourceReferencedVMa", stringMetadata);
  context->enumCaseName =
      (EnumCaseName)dlsym(RTLD_DEFAULT, "swift_EnumCaseName");
  context->arrayCount =
      (SwiftArrayCount)dlsym(RTLD_DEFAULT, "$sSa5countSivg");

  if (!context->statement || !context->assignment || !context->append ||
      !context->functionDefinition || !context->conditional ||
      !context->conditionalBranch || !context->repeatDefinition ||
      !context->finiteRepeatDefinition || !context->matchDefinition ||
      !context->matchCase || !context->expression || !context->functionCall ||
      !context->expressionFunctionCallCase ||
      !context->functionCallArgumentsMetadata ||
      !context->functionCallArgumentArray || !context->argument ||
      !context->argumentKeywordCase || !context->keywordArgument ||
      !context->keywordArgumentValueMetadata ||
      !context->value || !context->valueAtom ||
      !context->valueInterpolationPayload ||
      !context->interpolationArray || !context->interpolationPart ||
      !context->interpolationVariablePayload ||
      !context->valueListPayload || !context->valueListArray ||
      !context->variable || !context->variableAtom ||
      !context->statementReference ||
      !context->sourceReferencedString ||
      !context->enumCaseName || !context->arrayCount) {
    SetError("required ShortcutsLanguage IR metadata is unavailable");
    return false;
  }
  if (EnumCasePayloadMetadata(context->value, "atom") != context->valueAtom ||
      context->interpolationVariablePayload != context->variable ||
      context->keywordArgumentValueMetadata != context->value) {
    SetError("ShortcutsLanguage call/interpolation value metadata changed");
    return false;
  }
  return true;
}

static bool LoadCases(AdapterContext *context) {
  return EnumCaseIndex(context->statement, "assignment",
                       &context->statementAssignment) &&
         EnumCaseIndex(context->statement, "conditional",
                       &context->statementConditional) &&
         EnumCaseIndex(context->statement, "repeat",
                       &context->statementRepeat) &&
         EnumCaseIndex(context->statement, "finiteRepeat",
                       &context->statementFiniteRepeat) &&
         EnumCaseIndex(context->statement, "functionDefinition",
                       &context->statementFunction) &&
         EnumCaseIndex(context->statement, "append",
                       &context->statementAppend) &&
         EnumCaseIndex(context->statement, "match", &context->statementMatch) &&
         EnumCaseIndex(context->statement, "expression",
                       &context->statementExpression);
}

static bool LoadOffsets(AdapterContext *context) {
  const char *assignmentNames[] = {"variable", "expression"};
  size_t assignmentOffsets[2] = {0};
  const char *appendNames[] = {"variable", "expression"};
  size_t appendOffsets[2] = {0};
  const char *functionNames[] = {"body"};
  const char *conditionalNames[] = {"ifBranch", "elseIfBranches",
                                    "elseBranchBody"};
  size_t conditionalOffsets[3] = {0};
  const char *branchNames[] = {"body"};
  const char *repeatNames[] = {"body"};
  const char *finiteNames[] = {"body"};
  const char *matchNames[] = {"cases"};
  const char *caseNames[] = {"body"};
  const char *functionCallNames[] = {"functionName", "arguments"};
  size_t functionCallOffsets[2] = {0};
  const char *keywordArgumentNames[] = {"keyword", "value"};
  size_t keywordArgumentOffsets[2] = {0};
  const char *statementReferenceNames[] = {"reference"};
  const char *sourceReferencedNames[] = {"value"};

  if (!StructFieldOffsets(context->assignment, assignmentNames, 2,
                          assignmentOffsets) ||
      !StructFieldOffsets(context->append, appendNames, 2, appendOffsets) ||
      !StructFieldOffsets(context->functionDefinition, functionNames, 1,
                          &context->functionBody) ||
      !StructFieldOffsets(context->conditional, conditionalNames, 3,
                          conditionalOffsets) ||
      !StructFieldOffsets(context->conditionalBranch, branchNames, 1,
                          &context->conditionalBranchBody) ||
      !StructFieldOffsets(context->repeatDefinition, repeatNames, 1,
                          &context->repeatBody) ||
      !StructFieldOffsets(context->finiteRepeatDefinition, finiteNames, 1,
                          &context->finiteRepeatBody) ||
      !StructFieldOffsets(context->matchDefinition, matchNames, 1,
                          &context->matchCases) ||
      !StructFieldOffsets(context->matchCase, caseNames, 1,
                          &context->matchCaseBody) ||
      !StructFieldOffsets(context->functionCall, functionCallNames, 2,
                          functionCallOffsets) ||
      !StructFieldOffsets(context->keywordArgument, keywordArgumentNames, 2,
                          keywordArgumentOffsets) ||
      !StructFieldOffsets(context->statementReference,
                          statementReferenceNames, 1,
                          &context->statementReferenceID) ||
      !StructFieldOffsets(context->sourceReferencedString,
                          sourceReferencedNames, 1,
                          &context->sourceReferencedValue)) {
    if (gAdapterError[0] == '\0') {
      SetError("ShortcutsLanguage IR field metadata did not match");
    }
    return false;
  }

  context->assignmentVariable = assignmentOffsets[0];
  context->assignmentExpression = assignmentOffsets[1];
  context->appendVariable = appendOffsets[0];
  context->appendExpression = appendOffsets[1];
  context->conditionalIfBranch = conditionalOffsets[0];
  context->conditionalElseIfBranches = conditionalOffsets[1];
  context->conditionalElseBody = conditionalOffsets[2];
  context->functionCallFunctionName = functionCallOffsets[0];
  context->functionCallArgumentsOffset = functionCallOffsets[1];
  context->keywordArgumentKeyword = keywordArgumentOffsets[0];
  context->keywordArgumentValue = keywordArgumentOffsets[1];
  return true;
}

static bool InitializeContext(AdapterContext *context) {
  memset(context, 0, sizeof(*context));
  gAdapterError[0] = '\0';
  gAdapterTrace[0] = '\0';
  if (!LoadMetadata(context) || !LoadCases(context) || !LoadOffsets(context)) {
    if (gAdapterError[0] == '\0') {
      SetError("ShortcutsLanguage IR enum metadata did not match");
    }
    return false;
  }
  if (ValueSize(context->statement) < sizeof(int64_t) +
                                          ValueSize(context->expression)) {
    SetError("IRStatement payload is too small for IRExpression");
    return false;
  }
  context->loadedCapabilities = kAdapterCapabilityBase;
  return true;
}

static bool LoadStatementReferenceConstructorCapabilities(
    AdapterContext *context) {
  const char *repeatNames[] = {"body", "sourceReference"};
  size_t repeatOffsets[2] = {0};
  const char *finiteRepeatNames[] = {"body", "sourceReference"};
  size_t finiteRepeatOffsets[2] = {0};
  const char *conditionalNames[] = {"sourceReference"};
  size_t conditionalSourceReference = 0;
  const char *statementReferenceNames[] = {"reference", "sourceReference"};
  size_t statementReferenceOffsets[2] = {0};
  const void *referenceMetadata = NULL;
  const void *sourceReferenceMetadata = NULL;
  bool statementIndirect = false;
  bool valueIndirect = false;
  bool expressionIndirect = false;

  if (!context) {
    SetError("statement-reference constructor context is unavailable");
    return false;
  }
  referenceMetadata =
      StructFieldMetadata(context->statementReference, "reference");
  sourceReferenceMetadata =
      StructFieldMetadata(context->statementReference, "sourceReference");
  if (!StructFieldOffsets(context->repeatDefinition, repeatNames, 2,
                          repeatOffsets) ||
      !StructFieldOffsets(context->finiteRepeatDefinition,
                          finiteRepeatNames, 2, finiteRepeatOffsets) ||
      !StructFieldOffsets(context->conditional, conditionalNames, 1,
                          &conditionalSourceReference) ||
      !StructFieldOffsets(context->statementReference,
                          statementReferenceNames, 2,
                          statementReferenceOffsets)) {
    if (gAdapterError[0] == '\0') {
      SetError("statement-reference constructor fields are unavailable");
    }
    return false;
  }
  if (repeatOffsets[0] != context->repeatBody ||
      finiteRepeatOffsets[0] != context->finiteRepeatBody ||
      statementReferenceOffsets[0] != context->statementReferenceID ||
      ReflectedFieldCount(context->statementReference) != 2) {
    SetError("statement-reference constructor layout changed");
    return false;
  }
  if (repeatOffsets[1] + sizeof(void *) >
          ValueSize(context->repeatDefinition) ||
      finiteRepeatOffsets[1] + sizeof(void *) >
          ValueSize(context->finiteRepeatDefinition) ||
      conditionalSourceReference + sizeof(void *) >
          ValueSize(context->conditional) ||
      statementReferenceOffsets[0] + sizeof(int64_t) >
          ValueSize(context->statementReference) ||
      statementReferenceOffsets[1] + sizeof(void *) >
          ValueSize(context->statementReference) ||
      !referenceMetadata || ValueSize(referenceMetadata) != sizeof(int64_t) ||
      !sourceReferenceMetadata ||
      ValueSize(sourceReferenceMetadata) != sizeof(void *)) {
    SetError("statement-reference constructor field storage changed");
    return false;
  }
  if (EnumCasePayloadMetadata(context->variable, "statement") !=
          context->statementReference ||
      EnumCasePayloadMetadata(context->value, "variable") !=
          context->variable ||
      EnumCasePayloadMetadata(context->expression, "value") !=
          context->value) {
    SetError("statement-reference enum payload metadata changed");
    return false;
  }
  if (!EnumCaseIsIndirect(context->variable, "statement",
                          &statementIndirect) ||
      !EnumCaseIsIndirect(context->value, "variable", &valueIndirect) ||
      !EnumCaseIsIndirect(context->expression, "value",
                          &expressionIndirect) ||
      !CopyInitializer(context->statementReference) ||
      !CopyInitializer(context->variable) ||
      !CopyInitializer(context->value) ||
      !Destroyer(context->variable) ||
      !Destroyer(context->value) ||
      !EnumDataInjector(context->variable) ||
      !EnumDataInjector(context->value) ||
      !EnumDataInjector(context->expression) ||
      !Destroyer(context->expression) ||
      !TakeInitializer(context->expression) ||
      ((statementIndirect || valueIndirect || expressionIndirect) &&
       !dlsym(RTLD_DEFAULT, "swift_allocBox"))) {
    SetError("statement-reference value witnesses are unavailable");
    return false;
  }

  context->repeatSourceReference = repeatOffsets[1];
  context->finiteRepeatSourceReference = finiteRepeatOffsets[1];
  context->conditionalSourceReference = conditionalSourceReference;
  context->statementReferenceSource = statementReferenceOffsets[1];
  return true;
}

static bool ArrayFromWord(uintptr_t word, const void *elementMetadata,
                          ArrayView *view) {
  if (!view || !elementMetadata) {
    return false;
  }
  memset(view, 0, sizeof(*view));
  if (word == 0) {
    return true;
  }
  uint8_t *storage = (uint8_t *)(word & ~(uintptr_t)7);
  size_t count = *(const size_t *)(storage + 16);
  size_t stride = ValueStride(elementMetadata);
  size_t alignmentMask = ValueAlignmentMask(elementMetadata);
  if (count > 100000 || stride == 0 || stride > 0x10000 ||
      alignmentMask > 0xfff) {
    SetError("invalid native Swift Array storage");
    return false;
  }
  uintptr_t elements = ((uintptr_t)storage + 32 + alignmentMask) &
                       ~(uintptr_t)alignmentMask;
  view->elements = (uint8_t *)elements;
  view->count = count;
  view->stride = stride;
  return true;
}

static const char *ReflectedCaseName(const AdapterContext *context,
                                     const void *value,
                                     const void *metadata) {
  size_t size = ValueSize(metadata);
  size_t alignmentMask = ValueAlignmentMask(metadata);
  ValueInitializeWithCopy copy = CopyInitializer(metadata);
  if (!context || !value || !metadata || size == 0 || !copy) {
    return NULL;
  }
  uint8_t *allocation = calloc(1, size + alignmentMask);
  if (!allocation) {
    SetError("could not allocate reflected IR value copy");
    return NULL;
  }
  void *temporary = (void *)(((uintptr_t)allocation + alignmentMask) &
                             ~(uintptr_t)alignmentMask);
  copy(temporary, value, metadata);
  const char *actual = context->enumCaseName(temporary, metadata);
  free(allocation);
  return actual;
}

static bool CaseNameEquals(const AdapterContext *context, const void *value,
                           const void *metadata, const char *expected) {
  const char *actual = ReflectedCaseName(context, value, metadata);
  return actual && expected && strcmp(actual, expected) == 0;
}

static bool ProjectPayloadCopy(const void *value, const void *enumMetadata,
                               const char *caseName,
                               const void *payloadMetadata,
                               ProjectedValue *result) {
  size_t size = ValueSize(enumMetadata);
  size_t alignmentMask = ValueAlignmentMask(enumMetadata);
  ValueInitializeWithCopy copy = CopyInitializer(enumMetadata);
  ProjectEnumData project = EnumDataProjector(enumMetadata);
  bool isIndirect = false;
  if (!value || !enumMetadata || !payloadMetadata || !result || size == 0 ||
      !copy || !project ||
      !EnumCaseIsIndirect(enumMetadata, caseName, &isIndirect)) {
    SetError("IR enum projection metadata is unavailable");
    return false;
  }
  memset(result, 0, sizeof(*result));
  result->allocation = calloc(1, size + alignmentMask);
  if (!result->allocation) {
    SetError("could not allocate projected IR payload copy");
    return false;
  }
  result->value = (void *)(((uintptr_t)result->allocation + alignmentMask) &
                           ~(uintptr_t)alignmentMask);
  result->payloadMetadata = payloadMetadata;
  copy(result->value, value, enumMetadata);
  project(result->value, enumMetadata);
  if (isIndirect) {
    SwiftProjectBox projectBox =
        (SwiftProjectBox)dlsym(RTLD_DEFAULT, "swift_projectBox");
    result->box = *(void **)result->value;
    if (!projectBox || !result->box) {
      SetError("could not project indirect IR enum payload");
      free(result->allocation);
      memset(result, 0, sizeof(*result));
      return false;
    }
    result->value = projectBox(result->box);
  }
  return true;
}

static void DestroyProjectedValue(ProjectedValue *value) {
  if (!value || !value->allocation) {
    return;
  }
  if (value->box) {
    SwiftRelease release =
        (SwiftRelease)dlsym(RTLD_DEFAULT, "swift_release");
    if (release) {
      release(value->box);
    }
  } else {
    ValueDestroy destroy = Destroyer(value->payloadMetadata);
    if (destroy) {
      destroy(value->value, value->payloadMetadata);
    }
  }
  free(value->allocation);
  memset(value, 0, sizeof(*value));
}

static void *EnumPayloadAddress(const AdapterContext *context, void *value,
                                const void *enumMetadata,
                                const char *caseName) {
  bool isIndirect = false;
  if (!context || !value || !enumMetadata || !caseName ||
      !CaseNameEquals(context, value, enumMetadata, caseName) ||
      !EnumCaseIsIndirect(enumMetadata, caseName, &isIndirect)) {
    return NULL;
  }
  if (!isIndirect) {
    return value;
  }
  SwiftProjectBox projectBox =
      (SwiftProjectBox)dlsym(RTLD_DEFAULT, "swift_projectBox");
  void *box = *(void **)value;
  return projectBox && box ? projectBox(box) : NULL;
}

static const void *SourceReferencedValue(const AdapterContext *context,
                                         const void *sourceReferenced) {
  return (const uint8_t *)sourceReferenced + context->sourceReferencedValue;
}

static bool CopySwiftString(const void *stringMetadata, const void *source,
                            uint8_t **allocation, void **value) {
  size_t size = ValueSize(stringMetadata);
  size_t alignmentMask = ValueAlignmentMask(stringMetadata);
  ValueInitializeWithCopy copy = CopyInitializer(stringMetadata);
  if (!stringMetadata || !source || !allocation || !value || size == 0 ||
      !copy) {
    return false;
  }
  *allocation = calloc(1, size + alignmentMask);
  if (!*allocation) {
    return false;
  }
  *value = (void *)(((uintptr_t)*allocation + alignmentMask) &
                    ~(uintptr_t)alignmentMask);
  copy(*value, source, stringMetadata);
  return true;
}

static void DestroySwiftString(const void *stringMetadata,
                               uint8_t **allocation, void **value) {
  if (!allocation || !*allocation) {
    return;
  }
  ValueDestroy destroy = Destroyer(stringMetadata);
  if (destroy && value && *value) {
    destroy(*value, stringMetadata);
  }
  free(*allocation);
  *allocation = NULL;
  if (value) {
    *value = NULL;
  }
}

static bool AddBranchIndex(size_t **items, size_t *count, size_t *capacity,
                           size_t branchIndex) {
  if (!items || !count || !capacity) {
    return false;
  }
  for (size_t index = 0; index < *count; index++) {
    if ((*items)[index] == branchIndex) {
      return true;
    }
  }
  if (*count == *capacity) {
    size_t nextCapacity = *capacity ? *capacity * 2 : 4;
    size_t *next = realloc(*items, nextCapacity * sizeof(*next));
    if (!next) {
      return false;
    }
    *items = next;
    *capacity = nextCapacity;
  }
  (*items)[(*count)++] = branchIndex;
  return true;
}

static void DestroyBranchIndices(size_t **items, size_t *count,
                                 size_t *capacity) {
  if (items) {
    free(*items);
    *items = NULL;
  }
  if (count) {
    *count = 0;
  }
  if (capacity) {
    *capacity = 0;
  }
}

static void DestroyRecurrenceCandidate(const AdapterContext *context,
                                       RecurrenceCandidate *candidate) {
  if (!candidate) {
    return;
  }
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  DestroySwiftString(stringMetadata, &candidate->targetAllocation,
                     &candidate->targetName);
  DestroySwiftString(stringMetadata, &candidate->seedAllocation,
                     &candidate->seedName);
  DestroyBranchIndices(&candidate->targetBranchIndices,
                       &candidate->targetBranchCount,
                       &candidate->targetBranchCapacity);
  DestroyBranchIndices(&candidate->seedBranchIndices,
                       &candidate->seedBranchCount,
                       &candidate->seedBranchCapacity);
  memset(candidate, 0, sizeof(*candidate));
  (void)context;
}

static bool CopyVariableAtomName(const AdapterContext *context,
                                 const void *variable,
                                 uint8_t **allocation, void **name) {
  ProjectedValue atom = {0};
  ProjectedValue sourceName = {0};
  bool copied = false;
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  if (!stringMetadata ||
      !CaseNameEquals(context, variable, context->variable, "atom") ||
      !ProjectPayloadCopy(variable, context->variable, "atom",
                          context->variableAtom, &atom)) {
    goto cleanup;
  }
  const char *atomCase =
      ReflectedCaseName(context, atom.value, context->variableAtom);
  if (!atomCase ||
      (strcmp(atomCase, "custom") != 0 && strcmp(atomCase, "unknown") != 0) ||
      !ProjectPayloadCopy(atom.value, context->variableAtom, atomCase,
                          context->sourceReferencedString, &sourceName)) {
    goto cleanup;
  }
  copied = CopySwiftString(stringMetadata,
                           SourceReferencedValue(context, sourceName.value),
                           allocation, name);

cleanup:
  DestroyProjectedValue(&sourceName);
  DestroyProjectedValue(&atom);
  return copied;
}

static bool CopyInterpolationVariableName(const AdapterContext *context,
                                          const void *value,
                                          uint8_t **allocation, void **name) {
  ProjectedValue interpolation = {0};
  uintptr_t partsWord = 0;
  ArrayView parts = {0};
  size_t variableCount = 0;
  bool copied = false;
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  ValueDestroy destroyArray = Destroyer(context->interpolationArray);
  if (!stringMetadata ||
      !ProjectPayloadCopy(value, context->value, "interpolation",
                          context->valueInterpolationPayload,
                          &interpolation)) {
    goto cleanup;
  }
  bridge_shortpy_source_referenced_get_value(
      &partsWord, interpolation.value, context->valueInterpolationPayload);
  if (!ArrayFromWord(partsWord, context->interpolationPart, &parts)) {
    goto cleanup;
  }
  for (size_t index = 0; index < parts.count; index++) {
    const void *part = parts.elements + index * parts.stride;
    if (!CaseNameEquals(context, part, context->interpolationPart,
                        "variable")) {
      continue;
    }
    variableCount++;
    if (variableCount > 1) {
      DestroySwiftString(stringMetadata, allocation, name);
      copied = false;
      break;
    }
    ProjectedValue variable = {0};
    if (ProjectPayloadCopy(part, context->interpolationPart, "variable",
                           context->interpolationVariablePayload,
                           &variable)) {
      copied = CopyVariableAtomName(context, variable.value, allocation, name);
    }
    DestroyProjectedValue(&variable);
  }

cleanup:
  if (destroyArray && partsWord) {
    destroyArray(&partsWord, context->interpolationArray);
  }
  DestroyProjectedValue(&interpolation);
  return copied && variableCount == 1;
}

static bool CopyValueAtomName(const AdapterContext *context,
                              const void *value,
                              uint8_t **allocation, void **name) {
  const char *valueCase = ReflectedCaseName(context, value, context->value);
  if (valueCase && strcmp(valueCase, "variable") == 0) {
    ProjectedValue variable = {0};
    bool copied = false;
    if (ProjectPayloadCopy(value, context->value, "variable",
                           context->variable, &variable)) {
      copied =
          CopyVariableAtomName(context, variable.value, allocation, name);
    }
    DestroyProjectedValue(&variable);
    return copied;
  }
  if (valueCase && strcmp(valueCase, "interpolation") == 0) {
    return CopyInterpolationVariableName(context, value, allocation, name);
  }
  return false;
}

static bool FunctionCallArguments(const AdapterContext *context,
                                  const void *functionCall,
                                  uintptr_t *argumentsWord,
                                  ArrayView *arguments) {
  if (!context || !functionCall || !argumentsWord || !arguments) {
    return false;
  }
  *argumentsWord = 0;
  bridge_shortpy_source_referenced_get_value(
      argumentsWord,
      (const uint8_t *)functionCall + context->functionCallArgumentsOffset,
      context->functionCallArgumentsMetadata);
  return ArrayFromWord(*argumentsWord, context->argument, arguments);
}

static void DestroyFunctionCallArguments(const AdapterContext *context,
                                         uintptr_t *argumentsWord) {
  ValueDestroy destroy = Destroyer(context->functionCallArgumentArray);
  if (destroy && argumentsWord) {
    destroy(argumentsWord, context->functionCallArgumentArray);
    *argumentsWord = 0;
  }
}

static bool BuildRecurrenceCandidate(const AdapterContext *context,
                                     const void *target,
                                     const void *leftExpression,
                                     size_t leftBranchIndex,
                                     const void *rightExpression,
                                     size_t rightBranchIndex,
                                     RecurrenceCandidate *candidate) {
  ProjectedValue leftCall = {0};
  ProjectedValue rightCall = {0};
  uintptr_t leftArgumentsWord = 0;
  uintptr_t rightArgumentsWord = 0;
  ArrayView leftArguments = {0};
  ArrayView rightArguments = {0};
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  bool found = false;
  if (!candidate || !target || !stringMetadata ||
      !CaseNameEquals(context, leftExpression, context->expression,
                      context->expressionFunctionCallCase) ||
      !CaseNameEquals(context, rightExpression, context->expression,
                      context->expressionFunctionCallCase) ||
      !ProjectPayloadCopy(leftExpression, context->expression,
                          context->expressionFunctionCallCase,
                          context->functionCall, &leftCall) ||
      !ProjectPayloadCopy(rightExpression, context->expression,
                          context->expressionFunctionCallCase,
                          context->functionCall, &rightCall) ||
      !SameVariable(
          SourceReferencedValue(context,
                                (const uint8_t *)leftCall.value +
                                    context->functionCallFunctionName),
          SourceReferencedValue(context,
                                (const uint8_t *)rightCall.value +
                                    context->functionCallFunctionName)) ||
      !FunctionCallArguments(context, leftCall.value, &leftArgumentsWord,
                             &leftArguments) ||
      !FunctionCallArguments(context, rightCall.value, &rightArgumentsWord,
                             &rightArguments)) {
    goto cleanup;
  }

  for (size_t leftIndex = 0; leftIndex < leftArguments.count && !found;
       leftIndex++) {
    ProjectedValue leftKeyword = {0};
    const void *leftArgument =
        leftArguments.elements + leftIndex * leftArguments.stride;
    if (!CaseNameEquals(context, leftArgument, context->argument,
                        context->argumentKeywordCase) ||
        !ProjectPayloadCopy(leftArgument, context->argument,
                            context->argumentKeywordCase,
                            context->keywordArgument, &leftKeyword)) {
      DestroyProjectedValue(&leftKeyword);
      continue;
    }
    for (size_t rightIndex = 0;
         rightIndex < rightArguments.count && !found; rightIndex++) {
      ProjectedValue rightKeyword = {0};
      const void *rightArgument =
          rightArguments.elements + rightIndex * rightArguments.stride;
      if (!CaseNameEquals(context, rightArgument, context->argument,
                          context->argumentKeywordCase) ||
          !ProjectPayloadCopy(rightArgument, context->argument,
                              context->argumentKeywordCase,
                              context->keywordArgument, &rightKeyword)) {
        DestroyProjectedValue(&rightKeyword);
        continue;
      }
      const void *leftKeywordName = SourceReferencedValue(
          context, (const uint8_t *)leftKeyword.value +
                       context->keywordArgumentKeyword);
      const void *rightKeywordName = SourceReferencedValue(
          context, (const uint8_t *)rightKeyword.value +
                       context->keywordArgumentKeyword);
      if (SameVariable(leftKeywordName, rightKeywordName)) {
        uint8_t *leftNameAllocation = NULL;
        void *leftName = NULL;
        uint8_t *rightNameAllocation = NULL;
        void *rightName = NULL;
        const void *leftValue = (const uint8_t *)leftKeyword.value +
                                context->keywordArgumentValue;
        const void *rightValue = (const uint8_t *)rightKeyword.value +
                                 context->keywordArgumentValue;
        bool leftAtom = CopyValueAtomName(
            context, leftValue, &leftNameAllocation, &leftName);
        bool rightAtom = CopyValueAtomName(
            context, rightValue, &rightNameAllocation, &rightName);
        bool leftSelf = leftAtom && SameVariable(leftName, target);
        bool rightSelf = rightAtom && SameVariable(rightName, target);
        const void *seed = leftSelf && rightAtom && !rightSelf
            ? rightName
            : rightSelf && leftAtom && !leftSelf ? leftName : NULL;
        if (seed &&
            CopySwiftString(stringMetadata, target,
                            &candidate->targetAllocation,
                            &candidate->targetName) &&
            CopySwiftString(stringMetadata, seed,
                            &candidate->seedAllocation,
                            &candidate->seedName) &&
            AddBranchIndex(&candidate->targetBranchIndices,
                           &candidate->targetBranchCount,
                           &candidate->targetBranchCapacity,
                           leftSelf ? leftBranchIndex : rightBranchIndex) &&
            AddBranchIndex(&candidate->seedBranchIndices,
                           &candidate->seedBranchCount,
                           &candidate->seedBranchCapacity,
                           leftSelf ? rightBranchIndex : leftBranchIndex)) {
          found = true;
        } else if (candidate->targetAllocation || candidate->seedAllocation ||
                   candidate->targetBranchIndices ||
                   candidate->seedBranchIndices) {
          DestroyRecurrenceCandidate(context, candidate);
        }
        DestroySwiftString(stringMetadata, &rightNameAllocation, &rightName);
        DestroySwiftString(stringMetadata, &leftNameAllocation, &leftName);
      }
      DestroyProjectedValue(&rightKeyword);
    }
    DestroyProjectedValue(&leftKeyword);
  }

cleanup:
  DestroyFunctionCallArguments(context, &rightArgumentsWord);
  DestroyFunctionCallArguments(context, &leftArgumentsWord);
  DestroyProjectedValue(&rightCall);
  DestroyProjectedValue(&leftCall);
  return found;
}

static bool AddControlFlowBinding(const AdapterContext *context,
                                  ControlFlowBindings *bindings,
                                  const void *sourceReferencedName,
                                  int64_t controlStatementID,
                                  int64_t ownerStatementID,
                                  int64_t initializerStatementID,
                                  bool hasConflictingWrite,
                                  bool initializerOnly,
                                  bool oneSidedNone) {
  if (!context || !bindings || !sourceReferencedName) {
    return false;
  }
  if (bindings->count == bindings->capacity) {
    size_t nextCapacity = bindings->capacity ? bindings->capacity * 2 : 16;
    ControlFlowBinding *next = realloc(
        bindings->items, nextCapacity * sizeof(*bindings->items));
    if (!next) {
      SetError("could not grow control-flow plan");
      return false;
    }
    memset(next + bindings->capacity, 0,
           (nextCapacity - bindings->capacity) * sizeof(*next));
    bindings->items = next;
    bindings->capacity = nextCapacity;
  }

  size_t size = ValueSize(bindings->stringMetadata);
  size_t alignmentMask = ValueAlignmentMask(bindings->stringMetadata);
  ValueInitializeWithCopy copy = CopyInitializer(bindings->stringMetadata);
  ControlFlowBinding *binding = &bindings->items[bindings->count];
  binding->allocation = calloc(1, size + alignmentMask);
  if (!binding->allocation || !copy) {
    free(binding->allocation);
    memset(binding, 0, sizeof(*binding));
    SetError("could not copy control-flow accumulator name");
    return false;
  }
  binding->name = (void *)(((uintptr_t)binding->allocation + alignmentMask) &
                           ~(uintptr_t)alignmentMask);
  copy(binding->name, SourceReferencedValue(context, sourceReferencedName),
       bindings->stringMetadata);
  binding->controlStatementID = controlStatementID;
  binding->ownerStatementID = ownerStatementID;
  binding->initializerStatementID = initializerStatementID;
  binding->hasConflictingWrite = hasConflictingWrite;
  binding->initializerOnly = initializerOnly;
  binding->oneSidedNone = oneSidedNone;
  bindings->count++;
  return true;
}

static bool AddRecurrenceBinding(ControlFlowBindings *bindings,
                                 const void *targetName,
                                 const void *seedName,
                                 const size_t *targetBranchIndices,
                                 size_t targetBranchCount,
                                 const size_t *seedBranchIndices,
                                 size_t seedBranchCount,
                                 uint32_t controlKind,
                                 int64_t seedStatementID,
                                 int64_t seedAliasStatementID,
                                 int64_t controlStatementID) {
  if (!bindings || !targetName || !seedName || seedStatementID == 0 ||
      controlStatementID == 0 || !targetBranchIndices ||
      targetBranchCount == 0 || !seedBranchIndices || seedBranchCount == 0 ||
      (controlKind != 1 && controlKind != 2)) {
    return false;
  }
  for (size_t index = 0; index < bindings->recurrenceCount; index++) {
    RecurrenceBinding *existing = &bindings->recurrences[index];
    if (existing->controlStatementID == controlStatementID) {
      if (existing->seedStatementID == seedStatementID &&
          existing->seedAliasStatementID == seedAliasStatementID &&
          SameVariable(existing->targetName, targetName) &&
          SameVariable(existing->seedName, seedName) &&
          existing->controlKind == controlKind) {
        for (size_t branchIndex = 0; branchIndex < targetBranchCount;
             branchIndex++) {
          if (!AddBranchIndex(&existing->targetBranchIndices,
                              &existing->targetBranchCount,
                              &existing->targetBranchCapacity,
                              targetBranchIndices[branchIndex])) {
            SetError("could not merge recurrence target branches");
            return false;
          }
        }
        for (size_t branchIndex = 0; branchIndex < seedBranchCount;
             branchIndex++) {
          if (!AddBranchIndex(&existing->seedBranchIndices,
                              &existing->seedBranchCount,
                              &existing->seedBranchCapacity,
                              seedBranchIndices[branchIndex])) {
            SetError("could not merge recurrence seed branches");
            return false;
          }
        }
        return true;
      }
      SetError("one control statement has ambiguous recurrence bindings");
      return false;
    }
  }
  if (bindings->recurrenceCount == bindings->recurrenceCapacity) {
    size_t nextCapacity =
        bindings->recurrenceCapacity ? bindings->recurrenceCapacity * 2 : 4;
    RecurrenceBinding *next = realloc(
        bindings->recurrences, nextCapacity * sizeof(*bindings->recurrences));
    if (!next) {
      SetError("could not grow loop-carried recurrence context");
      return false;
    }
    memset(next + bindings->recurrenceCapacity, 0,
           (nextCapacity - bindings->recurrenceCapacity) * sizeof(*next));
    bindings->recurrences = next;
    bindings->recurrenceCapacity = nextCapacity;
  }
  RecurrenceBinding *binding =
      &bindings->recurrences[bindings->recurrenceCount];
  if (!CopySwiftString(bindings->stringMetadata, targetName,
                       &binding->targetAllocation, &binding->targetName) ||
      !CopySwiftString(bindings->stringMetadata, seedName,
                       &binding->seedAllocation, &binding->seedName)) {
    DestroySwiftString(bindings->stringMetadata, &binding->targetAllocation,
                       &binding->targetName);
    DestroySwiftString(bindings->stringMetadata, &binding->seedAllocation,
                       &binding->seedName);
    SetError("could not copy loop-carried recurrence target");
    return false;
  }
  for (size_t index = 0; index < targetBranchCount; index++) {
    if (!AddBranchIndex(&binding->targetBranchIndices,
                        &binding->targetBranchCount,
                        &binding->targetBranchCapacity,
                        targetBranchIndices[index])) {
      SetError("could not copy recurrence target branches");
      goto recurrence_copy_failure;
    }
  }
  for (size_t index = 0; index < seedBranchCount; index++) {
    if (!AddBranchIndex(&binding->seedBranchIndices,
                        &binding->seedBranchCount,
                        &binding->seedBranchCapacity,
                        seedBranchIndices[index])) {
      SetError("could not copy recurrence seed branches");
      goto recurrence_copy_failure;
    }
  }
  binding->controlKind = controlKind;
  binding->seedStatementID = seedStatementID;
  binding->seedAliasStatementID = seedAliasStatementID;
  binding->controlStatementID = controlStatementID;
  bindings->recurrenceCount++;
  return true;

recurrence_copy_failure:
  DestroySwiftString(bindings->stringMetadata,
                     &binding->targetAllocation, &binding->targetName);
  DestroySwiftString(bindings->stringMetadata,
                     &binding->seedAllocation, &binding->seedName);
  DestroyBranchIndices(&binding->targetBranchIndices,
                       &binding->targetBranchCount,
                       &binding->targetBranchCapacity);
  DestroyBranchIndices(&binding->seedBranchIndices,
                       &binding->seedBranchCount,
                       &binding->seedBranchCapacity);
  return false;
}

static void DestroyControlFlowBindings(ControlFlowBindings *bindings) {
  if (!bindings) {
    return;
  }
  ValueDestroy destroy = Destroyer(bindings->stringMetadata);
  for (size_t index = 0; index < bindings->count; index++) {
    ControlFlowBinding *binding = &bindings->items[index];
    if (binding->allocation && destroy) {
      destroy(binding->name, bindings->stringMetadata);
    }
    free(binding->allocation);
  }
  free(bindings->items);
  for (size_t index = 0; index < bindings->recurrenceCount; index++) {
    RecurrenceBinding *binding = &bindings->recurrences[index];
    DestroySwiftString(bindings->stringMetadata, &binding->targetAllocation,
                       &binding->targetName);
    DestroySwiftString(bindings->stringMetadata, &binding->seedAllocation,
                       &binding->seedName);
    DestroyBranchIndices(&binding->targetBranchIndices,
                         &binding->targetBranchCount,
                         &binding->targetBranchCapacity);
    DestroyBranchIndices(&binding->seedBranchIndices,
                         &binding->seedBranchCount,
                         &binding->seedBranchCapacity);
  }
  free(bindings->recurrences);
  free(bindings);
}

static unsigned StatementTag(const AdapterContext *context,
                             const void *statement) {
  const char *name = ReflectedCaseName(context, statement, context->statement);
  if (!name) {
    return UINT_MAX;
  }
  if (strcmp(name, "assignment") == 0) {
    return context->statementAssignment;
  }
  if (strcmp(name, "conditional") == 0) {
    return context->statementConditional;
  }
  if (strcmp(name, "repeat") == 0) {
    return context->statementRepeat;
  }
  if (strcmp(name, "finiteRepeat") == 0) {
    return context->statementFiniteRepeat;
  }
  if (strcmp(name, "functionDefinition") == 0) {
    return context->statementFunction;
  }
  if (strcmp(name, "append") == 0) {
    return context->statementAppend;
  }
  if (strcmp(name, "match") == 0) {
    return context->statementMatch;
  }
  if (strcmp(name, "expression") == 0) {
    return context->statementExpression;
  }
  return UINT_MAX;
}

static uint8_t *StatementPayload(void *statement) {
  return (uint8_t *)statement + sizeof(int64_t);
}

static const uint8_t *ConstStatementPayload(const void *statement) {
  return (const uint8_t *)statement + sizeof(int64_t);
}

static bool SameVariable(const void *lhs, const void *rhs) {
  return bridge_shortpy_swift_string_equal(lhs, rhs);
}

static bool EmptyListExpression(const AdapterContext *context,
                                const void *expression) {
  const char *expressionCase =
      ReflectedCaseName(context, expression, context->expression);
  if (!expressionCase || strcmp(expressionCase, "value") != 0) {
    return false;
  }
  ProjectedValue value = {0};
  ProjectedValue list = {0};
  if (!ProjectPayloadCopy(expression, context->expression, "value",
                          context->value,
                          &value)) {
    return false;
  }
  const char *valueCase =
      ReflectedCaseName(context, value.value, context->value);
  bool empty = false;
  if (valueCase && strcmp(valueCase, "list") == 0 &&
      ProjectPayloadCopy(value.value, context->value, "list",
                         context->valueListPayload, &list)) {
    uintptr_t listWord = 0;
    bridge_shortpy_source_referenced_get_value(
        &listWord, list.value, context->valueListPayload);
    size_t listCount = (size_t)context->arrayCount(listWord, context->value);
    empty = listCount == 0;
    ValueDestroy destroyArray = Destroyer(context->valueListArray);
    if (destroyArray) {
      destroyArray(&listWord, context->valueListArray);
    }
  }
  DestroyProjectedValue(&list);
  DestroyProjectedValue(&value);
  return empty;
}

static int ExpressionIsNoneAtom(const AdapterContext *context,
                                const void *expression,
                                const char **valueCaseResult,
                                const char **atomCaseResult) {
  ProjectedValue value = {0};
  ProjectedValue atom = {0};
  if (!context || !expression) {
    SetError("structural None expression is unavailable");
    return -1;
  }
  if (!CaseNameEquals(context, expression, context->expression, "value")) {
    return 0;
  }
  if (!ProjectPayloadCopy(expression, context->expression, "value",
                          context->value, &value)) {
    return -1;
  }
  const char *valueCase =
      ReflectedCaseName(context, value.value, context->value);
  if (valueCaseResult) {
    *valueCaseResult = valueCase;
  }
  int isNone = 0;
  if (valueCase && strcmp(valueCase, "atom") == 0) {
    if (!ProjectPayloadCopy(value.value, context->value, "atom",
                            context->valueAtom, &atom)) {
      DestroyProjectedValue(&value);
      return -1;
    }
    const char *atomCase =
        ReflectedCaseName(context, atom.value, context->valueAtom);
    if (atomCaseResult) {
      *atomCaseResult = atomCase;
    }
    isNone = atomCase && strcmp(atomCase, "none") == 0 ? 1 : 0;
  }
  DestroyProjectedValue(&atom);
  DestroyProjectedValue(&value);
  return isNone;
}

static int NoneExpression(const AdapterContext *context,
                          const void *expression,
                          ControlFlowOutputRepairCounts *counts) {
  const char *valueCase = NULL;
  const char *atomCase = NULL;
  if (!counts) {
    SetError("structural None counters are unavailable");
    return -1;
  }
  int isNone = ExpressionIsNoneAtom(
      context, expression, &valueCase, &atomCase);
  if (isNone < 0) {
    return -1;
  }
  counts->structuralValueExpressionTails++;
  counts->lastStructuralValueCase = valueCase;
  counts->lastStructuralAtomCase = atomCase;
  counts->structuralNoneValueTails += isNone ? 1U : 0U;
  return isNone;
}

static int StatementIsNoneExpression(AdapterContext *context,
                                     const void *statement,
                                     ControlFlowOutputRepairCounts *counts) {
  ProjectedValue payload = {0};
  if (!context || !statement || !counts) {
    SetError("structural None statement is unavailable");
    return -1;
  }
  if (StatementTag(context, statement) != context->statementExpression) {
    return 0;
  }
  if (!RequireCapabilities(
          context, kAdapterCapabilityStatementExpressionConstruction) ||
      !ProjectPayloadCopy(statement, context->statement, "expression",
                          context->statementExpressionPayload, &payload)) {
    return -1;
  }
  int isNone = NoneExpression(
      context, (const uint8_t *)payload.value + sizeof(int64_t), counts);
  DestroyProjectedValue(&payload);
  return isNone;
}

static bool PrecedingEmptyListAssignment(const AdapterContext *context,
                                         const ArrayView *scope,
                                         size_t beforeIndex,
                                         const void *variable) {
  for (size_t index = beforeIndex; index > 0; index--) {
    const uint8_t *statement =
        scope->elements + (index - 1) * scope->stride;
    if (StatementTag(context, statement) != context->statementAssignment) {
      continue;
    }
    const uint8_t *assignment = ConstStatementPayload(statement);
    const void *candidate = assignment + context->assignmentVariable;
    bool same = SameVariable(variable, candidate);
    if (same && EmptyListExpression(
                    context, assignment + context->assignmentExpression)) {
      return true;
    }
  }
  return false;
}

static const void *ImmediateEmptyListAssignmentVariable(
    const AdapterContext *context, const ArrayView *scope,
    size_t beforeIndex, int64_t *statementID) {
  if (!context || !scope || beforeIndex == 0) {
    return NULL;
  }
  const void *statement =
      scope->elements + (beforeIndex - 1) * scope->stride;
  if (StatementTag(context, statement) != context->statementAssignment) {
    return NULL;
  }
  const uint8_t *assignment = ConstStatementPayload(statement);
  if (!EmptyListExpression(
          context, assignment + context->assignmentExpression)) {
    return NULL;
  }
  if (statementID) {
    *statementID = bridge_shortpy_ir_statement_id(statement);
  }
  return assignment + context->assignmentVariable;
}

static void *LastStatement(const AdapterContext *context, uintptr_t arrayWord,
                           ArrayView *view) {
  if (!ArrayFromWord(arrayWord, context->statement, view) || view->count == 0) {
    return NULL;
  }
  return view->elements + (view->count - 1) * view->stride;
}

static const void *FinalAppendVariable(const AdapterContext *context,
                                       uintptr_t bodyWord, void **statement) {
  ArrayView body;
  void *last = LastStatement(context, bodyWord, &body);
  if (!last || StatementTag(context, last) != context->statementAppend) {
    return NULL;
  }
  if (statement) {
    *statement = last;
  }
  return StatementPayload(last) + context->appendVariable;
}

static const void *FinalAssignmentVariable(const AdapterContext *context,
                                           uintptr_t bodyWord,
                                           void **statement) {
  ArrayView body;
  void *last = LastStatement(context, bodyWord, &body);
  if (!last || StatementTag(context, last) != context->statementAssignment) {
    return NULL;
  }
  if (statement) {
    *statement = last;
  }
  return StatementPayload(last) + context->assignmentVariable;
}

static bool FunctionHasAssignment(AdapterContext *context,
                                  uintptr_t arrayWord,
                                  const void *variable);

static bool NestedBodiesHaveAssignment(AdapterContext *context, unsigned tag,
                                       uint8_t *payload,
                                       const void *variable) {
  if (tag == context->statementConditional) {
    uint8_t *ifBranch = payload + context->conditionalIfBranch;
    if (FunctionHasAssignment(
            context,
            *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
            variable) ||
        FunctionHasAssignment(context,
                              *(uintptr_t *)(payload +
                                             context->conditionalElseBody),
                              variable)) {
      return true;
    }
    ArrayView branches;
    if (!ArrayFromWord(*(uintptr_t *)(payload +
                                     context->conditionalElseIfBranches),
                       context->conditionalBranch, &branches)) {
      return true;
    }
    for (size_t index = 0; index < branches.count; index++) {
      uint8_t *branch = branches.elements + index * branches.stride;
      if (FunctionHasAssignment(
              context,
              *(uintptr_t *)(branch + context->conditionalBranchBody),
              variable)) {
        return true;
      }
    }
  } else if (tag == context->statementRepeat) {
    return FunctionHasAssignment(
        context, *(uintptr_t *)(payload + context->repeatBody), variable);
  } else if (tag == context->statementFiniteRepeat) {
    return FunctionHasAssignment(
        context, *(uintptr_t *)(payload + context->finiteRepeatBody), variable);
  } else if (tag == context->statementMatch) {
    ArrayView cases;
    if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                       context->matchCase, &cases)) {
      return true;
    }
    for (size_t index = 0; index < cases.count; index++) {
      uint8_t *matchCase = cases.elements + index * cases.stride;
      if (FunctionHasAssignment(
              context, *(uintptr_t *)(matchCase + context->matchCaseBody),
              variable)) {
        return true;
      }
    }
  }
  return false;
}

static bool FunctionHasAssignment(AdapterContext *context,
                                  uintptr_t arrayWord,
                                  const void *variable) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return true;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    if (tag == context->statementAssignment &&
        SameVariable(variable, payload + context->assignmentVariable)) {
      return true;
    }
    if (tag != context->statementFunction &&
        NestedBodiesHaveAssignment(context, tag, payload, variable)) {
      return true;
    }
  }
  return false;
}

static bool FunctionHasVariableWrite(AdapterContext *context,
                                     uintptr_t arrayWord,
                                     const void *name);

static bool NestedBodiesHaveVariableWrite(AdapterContext *context,
                                          unsigned tag, uint8_t *payload,
                                          const void *name) {
  if (tag == context->statementConditional) {
    uint8_t *ifBranch = payload + context->conditionalIfBranch;
    if (FunctionHasVariableWrite(
            context,
            *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
            name) ||
        FunctionHasVariableWrite(
            context, *(uintptr_t *)(payload + context->conditionalElseBody),
            name)) {
      return true;
    }
    ArrayView branches;
    if (!ArrayFromWord(
            *(uintptr_t *)(payload + context->conditionalElseIfBranches),
            context->conditionalBranch, &branches)) {
      return true;
    }
    for (size_t index = 0; index < branches.count; index++) {
      uint8_t *branch = branches.elements + index * branches.stride;
      if (FunctionHasVariableWrite(
              context,
              *(uintptr_t *)(branch + context->conditionalBranchBody),
              name)) {
        return true;
      }
    }
  } else if (tag == context->statementRepeat) {
    return FunctionHasVariableWrite(
        context, *(uintptr_t *)(payload + context->repeatBody), name);
  } else if (tag == context->statementFiniteRepeat) {
    return FunctionHasVariableWrite(
        context, *(uintptr_t *)(payload + context->finiteRepeatBody), name);
  } else if (tag == context->statementMatch) {
    ArrayView cases;
    if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                       context->matchCase, &cases)) {
      return true;
    }
    for (size_t index = 0; index < cases.count; index++) {
      uint8_t *matchCase = cases.elements + index * cases.stride;
      if (FunctionHasVariableWrite(
              context, *(uintptr_t *)(matchCase + context->matchCaseBody),
              name)) {
        return true;
      }
    }
  }
  return false;
}

static bool FunctionHasVariableWrite(AdapterContext *context,
                                     uintptr_t arrayWord,
                                     const void *name) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return true;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    if (tag == context->statementAssignment &&
        SameVariable(
            SourceReferencedValue(
                context, payload + context->assignmentVariable),
            name)) {
      return true;
    }
    if (tag == context->statementAppend &&
        SameVariable(
            SourceReferencedValue(context,
                                  payload + context->appendVariable),
            name)) {
      return true;
    }
    if (tag != context->statementFunction &&
        NestedBodiesHaveVariableWrite(context, tag, payload, name)) {
      return true;
    }
  }
  return false;
}

static const void *FinalControlResultVariable(const AdapterContext *context,
                                              uintptr_t bodyWord,
                                              bool useAppend) {
  return useAppend ? FinalAppendVariable(context, bodyWord, NULL)
                   : FinalAssignmentVariable(context, bodyWord, NULL);
}

static const void *ConditionalAccumulator(const AdapterContext *context,
                                          const void *conditional,
                                          bool *usesAppend) {
  const uint8_t *payload = conditional;
  const uint8_t *ifBranch = payload + context->conditionalIfBranch;
  uintptr_t ifBody =
      *(const uintptr_t *)(ifBranch + context->conditionalBranchBody);
  uintptr_t elseBody =
      *(const uintptr_t *)(payload + context->conditionalElseBody);
  bool append = FinalAppendVariable(context, ifBody, NULL) != NULL;
  const void *variable =
      FinalControlResultVariable(context, ifBody, append);
  const void *elseVariable =
      FinalControlResultVariable(context, elseBody, append);
  if (!variable || !elseVariable || !SameVariable(variable, elseVariable)) {
    return NULL;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(const uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return NULL;
  }
  for (size_t index = 0; index < branches.count; index++) {
    const uint8_t *branch = branches.elements + index * branches.stride;
    const void *candidate = FinalControlResultVariable(
        context,
        *(const uintptr_t *)(branch + context->conditionalBranchBody), append);
    if (!candidate || !SameVariable(variable, candidate)) {
      return NULL;
    }
  }
  if (usesAppend) {
    *usesAppend = append;
  }
  return variable;
}

static int OneSidedNoneAccumulator(const AdapterContext *context,
                                   const void *conditional,
                                   const void **accumulator) {
  const uint8_t *payload = conditional;
  const uint8_t *ifBranch = NULL;
  ArrayView ifBody;
  ArrayView elseBody;
  ArrayView elseIfBranches;
  if (!context || !conditional || !accumulator) {
    SetError("one-sided conditional input is unavailable");
    return -1;
  }
  *accumulator = NULL;
  ifBranch = payload + context->conditionalIfBranch;
  if (!ArrayFromWord(
          *(const uintptr_t *)(ifBranch + context->conditionalBranchBody),
          context->statement, &ifBody) ||
      !ArrayFromWord(
          *(const uintptr_t *)(payload + context->conditionalElseBody),
          context->statement, &elseBody) ||
      !ArrayFromWord(
          *(const uintptr_t *)(payload +
                               context->conditionalElseIfBranches),
          context->conditionalBranch, &elseIfBranches)) {
    return -1;
  }
  if (ifBody.count != 1 || elseBody.count != 0 ||
      elseIfBranches.count != 0) {
    return 0;
  }
  const void *statement = ifBody.elements;
  if (StatementTag(context, statement) != context->statementAssignment) {
    return 0;
  }
  const uint8_t *assignment = ConstStatementPayload(statement);
  int isNone = ExpressionIsNoneAtom(
      context, assignment + context->assignmentExpression, NULL, NULL);
  if (isNone <= 0) {
    return isNone;
  }
  *accumulator = assignment + context->assignmentVariable;
  return 1;
}

static const void *MatchAccumulator(const AdapterContext *context,
                                    const void *match,
                                    bool *usesAppend) {
  ArrayView cases;
  if (!ArrayFromWord(
          *(const uintptr_t *)((const uint8_t *)match + context->matchCases),
          context->matchCase, &cases) ||
      cases.count == 0) {
    return NULL;
  }
  const void *variable = NULL;
  bool append = false;
  for (size_t index = 0; index < cases.count; index++) {
    const uint8_t *matchCase = cases.elements + index * cases.stride;
    uintptr_t body =
        *(const uintptr_t *)(matchCase + context->matchCaseBody);
    if (index == 0) {
      append = FinalAppendVariable(context, body, NULL) != NULL;
    }
    const void *candidate =
        FinalControlResultVariable(context, body, append);
    if (!candidate || (variable && !SameVariable(variable, candidate))) {
      return NULL;
    }
    variable = candidate;
  }
  if (usesAppend) {
    *usesAppend = append;
  }
  return variable;
}

static int MergeRecurrenceCandidate(const AdapterContext *context,
                                    RecurrenceCandidate *result,
                                    RecurrenceCandidate *candidate) {
  if (!candidate->targetName || !candidate->seedName) {
    DestroyRecurrenceCandidate(context, candidate);
    return 0;
  }
  if (!result->targetName) {
    *result = *candidate;
    memset(candidate, 0, sizeof(*candidate));
    return 1;
  }
  bool same = SameVariable(result->targetName, candidate->targetName) &&
              SameVariable(result->seedName, candidate->seedName) &&
              result->controlStatementID == candidate->controlStatementID &&
              (result->controlKind == 0 || candidate->controlKind == 0 ||
               result->controlKind == candidate->controlKind);
  if (same) {
    if (result->controlKind == 0) {
      result->controlKind = candidate->controlKind;
    }
    for (size_t index = 0; same && index < candidate->targetBranchCount;
         index++) {
      same = AddBranchIndex(&result->targetBranchIndices,
                            &result->targetBranchCount,
                            &result->targetBranchCapacity,
                            candidate->targetBranchIndices[index]);
    }
    for (size_t index = 0; same && index < candidate->seedBranchCount;
         index++) {
      same = AddBranchIndex(&result->seedBranchIndices,
                            &result->seedBranchCount,
                            &result->seedBranchCapacity,
                            candidate->seedBranchIndices[index]);
    }
    if (!same) {
      SetError("could not merge recurrence branch indices");
    }
  }
  DestroyRecurrenceCandidate(context, candidate);
  return same ? 1 : 2;
}

static int FindRecurrenceInArray(AdapterContext *context, uintptr_t arrayWord,
                                 RecurrenceCandidate *result);

static int FindRecurrenceAcrossBodies(AdapterContext *context,
                                      const uintptr_t *bodies,
                                      size_t bodyCount,
                                      RecurrenceCandidate *result) {
  int status = 0;
  for (size_t leftIndex = 0; leftIndex < bodyCount; leftIndex++) {
    const void *leftVariable =
        FinalAssignmentVariable(context, bodies[leftIndex], NULL);
    ArrayView leftBody;
    void *leftLast = LastStatement(context, bodies[leftIndex], &leftBody);
    if (!leftVariable || !leftLast) {
      continue;
    }
    const uint8_t *leftAssignment = ConstStatementPayload(leftLast);
    for (size_t rightIndex = leftIndex + 1; rightIndex < bodyCount;
         rightIndex++) {
      const void *rightVariable =
          FinalAssignmentVariable(context, bodies[rightIndex], NULL);
      ArrayView rightBody;
      void *rightLast = LastStatement(context, bodies[rightIndex], &rightBody);
      if (!rightVariable || !rightLast ||
          !SameVariable(leftVariable, rightVariable)) {
        continue;
      }
      const uint8_t *rightAssignment = ConstStatementPayload(rightLast);
      RecurrenceCandidate candidate = {0};
      if (!BuildRecurrenceCandidate(
              context, SourceReferencedValue(context, leftVariable),
              leftAssignment + context->assignmentExpression,
              leftIndex,
              rightAssignment + context->assignmentExpression, rightIndex,
              &candidate)) {
        continue;
      }
      int merged = MergeRecurrenceCandidate(context, result, &candidate);
      if (merged == 2) {
        return 2;
      }
      status = 1;
    }
  }
  for (size_t index = 0; index < bodyCount; index++) {
    RecurrenceCandidate nested = {0};
    int nestedStatus = FindRecurrenceInArray(context, bodies[index], &nested);
    if (nestedStatus == 2) {
      DestroyRecurrenceCandidate(context, &nested);
      return 2;
    }
    if (nestedStatus == 1) {
      int merged = MergeRecurrenceCandidate(context, result, &nested);
      if (merged == 2) {
        return 2;
      }
      status = 1;
    }
  }
  return status;
}

static int FindConditionalRecurrence(AdapterContext *context,
                                     const void *conditional,
                                     RecurrenceCandidate *result) {
  uintptr_t bodies[130] = {0};
  size_t bodyCount = 0;
  const uint8_t *payload = conditional;
  const uint8_t *ifBranch = payload + context->conditionalIfBranch;
  bodies[bodyCount++] =
      *(const uintptr_t *)(ifBranch + context->conditionalBranchBody);
  ArrayView branches;
  if (!ArrayFromWord(
          *(const uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &branches) ||
      branches.count > 128) {
    return 2;
  }
  for (size_t index = 0; index < branches.count; index++) {
    const uint8_t *branch = branches.elements + index * branches.stride;
    bodies[bodyCount++] =
        *(const uintptr_t *)(branch + context->conditionalBranchBody);
  }
  uintptr_t elseBody =
      *(const uintptr_t *)(payload + context->conditionalElseBody);
  if (elseBody) {
    bodies[bodyCount++] = elseBody;
  }
  int status = FindRecurrenceAcrossBodies(context, bodies, bodyCount, result);
  if (status == 1) {
    result->controlKind = 1;
  }
  return status;
}

static int FindMatchRecurrence(AdapterContext *context, const void *match,
                               RecurrenceCandidate *result) {
  ArrayView cases;
  if (!ArrayFromWord(
          *(const uintptr_t *)((const uint8_t *)match + context->matchCases),
          context->matchCase, &cases) ||
      cases.count > 256) {
    return 2;
  }
  uintptr_t *bodies = calloc(cases.count, sizeof(*bodies));
  if (cases.count && !bodies) {
    SetError("could not allocate match recurrence body list");
    return 2;
  }
  for (size_t index = 0; index < cases.count; index++) {
    const uint8_t *matchCase = cases.elements + index * cases.stride;
    bodies[index] =
        *(const uintptr_t *)(matchCase + context->matchCaseBody);
  }
  int status = FindRecurrenceAcrossBodies(context, bodies, cases.count, result);
  if (status == 1) {
    result->controlKind = 2;
  }
  free(bodies);
  return status;
}

static int FindRecurrenceInArray(AdapterContext *context, uintptr_t arrayWord,
                                 RecurrenceCandidate *result) {
  ArrayView statements;
  int status = 0;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return 2;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    RecurrenceCandidate candidate = {0};
    int candidateStatus = 0;
    if (tag == context->statementConditional) {
      candidateStatus =
          FindConditionalRecurrence(context, payload, &candidate);
    } else if (tag == context->statementMatch) {
      candidateStatus = FindMatchRecurrence(context, payload, &candidate);
    }
    if (candidateStatus == 2) {
      DestroyRecurrenceCandidate(context, &candidate);
      return 2;
    }
    if (candidateStatus == 1) {
      if (candidate.controlStatementID == 0) {
        candidate.controlStatementID =
            bridge_shortpy_ir_statement_id(statement);
      }
      int merged = MergeRecurrenceCandidate(context, result, &candidate);
      if (merged == 2) {
        return 2;
      }
      status = 1;
    }
  }
  return status;
}

static int64_t PrecedingAssignmentID(const AdapterContext *context,
                                     const ArrayView *scope,
                                     size_t beforeIndex,
                                     const void *name,
                                     size_t *statementIndex) {
  for (size_t index = beforeIndex; index > 0; index--) {
    const void *statement =
        scope->elements + (index - 1) * scope->stride;
    if (StatementTag(context, statement) != context->statementAssignment) {
      continue;
    }
    const uint8_t *assignment = ConstStatementPayload(statement);
    if (SameVariable(
            SourceReferencedValue(
                context, assignment + context->assignmentVariable),
            name)) {
      if (statementIndex) {
        *statementIndex = index - 1;
      }
      return bridge_shortpy_ir_statement_id(statement);
    }
  }
  return 0;
}

static bool CopyDirectExpressionVariableName(
    const AdapterContext *context, const void *expression,
    uint8_t **allocation, void **name) {
  ProjectedValue value = {0};
  ProjectedValue variable = {0};
  bool copied = false;
  if (!context || !expression || !allocation || !name ||
      !ProjectPayloadCopy(expression, context->expression, "value",
                          context->value, &value) ||
      !CaseNameEquals(context, value.value, context->value, "variable") ||
      !ProjectPayloadCopy(value.value, context->value, "variable",
                          context->variable, &variable)) {
    goto cleanup;
  }
  copied = CopyVariableAtomName(context, variable.value, allocation, name);

cleanup:
  DestroyProjectedValue(&variable);
  DestroyProjectedValue(&value);
  return copied;
}

static int FindPrecedingSeedAlias(
    const AdapterContext *context, const ArrayView *scope,
    size_t beforeIndex, size_t seedIndex, const void *targetName,
    const void *seedName, int64_t *aliasStatementID) {
  if (!context || !scope || !targetName || !seedName || !aliasStatementID) {
    SetError("loop-carried alias search input is unavailable");
    return -1;
  }
  *aliasStatementID = 0;
  for (size_t index = beforeIndex; index > seedIndex + 1; index--) {
    const void *statement =
        scope->elements + (index - 1) * scope->stride;
    if (StatementTag(context, statement) != context->statementAssignment) {
      continue;
    }
    const uint8_t *assignment = ConstStatementPayload(statement);
    const void *candidateTarget = SourceReferencedValue(
        context, assignment + context->assignmentVariable);
    if (!SameVariable(candidateTarget, targetName)) {
      continue;
    }

    uint8_t *sourceAllocation = NULL;
    void *sourceName = NULL;
    bool aliasesSeed = CopyDirectExpressionVariableName(
        context, assignment + context->assignmentExpression,
        &sourceAllocation, &sourceName) &&
        SameVariable(sourceName, seedName);
    DestroySwiftString(dlsym(RTLD_DEFAULT, "$sSSN"), &sourceAllocation,
                       &sourceName);
    if (!aliasesSeed) {
      SetError(
          "loop-carried target has a distinct reaching assignment after its "
          "seed");
      return -1;
    }
    *aliasStatementID = bridge_shortpy_ir_statement_id(statement);
    return 0;
  }
  return 0;
}

static int CaptureBindingsArray(AdapterContext *context, uintptr_t arrayWord,
                                int64_t ownerStatementID,
                                ControlFlowBindings *bindings);

static int CaptureConditionalChildren(AdapterContext *context,
                                      const void *conditional,
                                      int64_t ownerStatementID,
                                      ControlFlowBindings *bindings) {
  const uint8_t *payload = conditional;
  const uint8_t *ifBranch = payload + context->conditionalIfBranch;
  if (CaptureBindingsArray(
          context,
          *(const uintptr_t *)(ifBranch + context->conditionalBranchBody),
          ownerStatementID, bindings) != 0 ||
      CaptureBindingsArray(
          context,
          *(const uintptr_t *)(payload + context->conditionalElseBody),
          ownerStatementID, bindings) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(const uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    const uint8_t *branch = branches.elements + index * branches.stride;
    if (CaptureBindingsArray(
            context,
            *(const uintptr_t *)(branch + context->conditionalBranchBody),
            ownerStatementID, bindings) != 0) {
      return -1;
    }
  }
  return 0;
}

static int CaptureMatchChildren(AdapterContext *context, const void *match,
                                int64_t ownerStatementID,
                                ControlFlowBindings *bindings) {
  ArrayView cases;
  if (!ArrayFromWord(
          *(const uintptr_t *)((const uint8_t *)match + context->matchCases),
          context->matchCase, &cases)) {
    return -1;
  }
  for (size_t index = 0; index < cases.count; index++) {
    const uint8_t *matchCase = cases.elements + index * cases.stride;
    if (CaptureBindingsArray(
            context,
            *(const uintptr_t *)(matchCase + context->matchCaseBody),
            ownerStatementID, bindings) != 0) {
      return -1;
    }
  }
  return 0;
}

static int CaptureBindingsArray(AdapterContext *context, uintptr_t arrayWord,
                                int64_t ownerStatementID,
                                ControlFlowBindings *bindings) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int64_t statementID = bridge_shortpy_ir_statement_id(statement);
    const void *accumulator = NULL;
    const void *initializerOnlyVariable = NULL;
    int64_t initializerStatementID = 0;
    bool accumulatorUsesAppend = true;
    bool oneSidedNone = false;
    uintptr_t childBody = 0;

    if (tag == context->statementFunction) {
      childBody = *(uintptr_t *)(payload + context->functionBody);
      if (CaptureBindingsArray(context, childBody, statementID, bindings) != 0) {
        return -1;
      }
      continue;
    }
    if (tag == context->statementRepeat) {
      childBody = *(uintptr_t *)(payload + context->repeatBody);
      accumulator = FinalAppendVariable(context, childBody, NULL);
    } else if (tag == context->statementFiniteRepeat) {
      childBody = *(uintptr_t *)(payload + context->finiteRepeatBody);
      accumulator = FinalAppendVariable(context, childBody, NULL);
    } else if (tag == context->statementConditional) {
      accumulator = ConditionalAccumulator(
          context, payload, &accumulatorUsesAppend);
      if (!accumulator) {
        int oneSidedStatus =
            OneSidedNoneAccumulator(context, payload, &accumulator);
        if (oneSidedStatus < 0) {
          return -1;
        }
        oneSidedNone = oneSidedStatus == 1;
        if (oneSidedNone) {
          accumulatorUsesAppend = false;
        }
      }
    } else if (tag == context->statementMatch) {
      accumulator = MatchAccumulator(context, payload, &accumulatorUsesAppend);
    } else {
      continue;
    }

    if ((tag == context->statementRepeat ||
         tag == context->statementFiniteRepeat) &&
        childBody) {
      RecurrenceCandidate recurrence = {0};
      int recurrenceStatus =
          FindRecurrenceInArray(context, childBody, &recurrence);
      if (recurrenceStatus == 2) {
        DestroyRecurrenceCandidate(context, &recurrence);
        if (gAdapterError[0] == '\0') {
          SetError("could not classify loop-carried recurrence");
        }
        return -1;
      }
      if (recurrenceStatus == 1) {
        size_t seedIndex = 0;
        int64_t seedStatementID = PrecedingAssignmentID(
            context, &statements, index, recurrence.seedName, &seedIndex);
        int64_t seedAliasStatementID = 0;
        if (seedStatementID == 0) {
          DestroyRecurrenceCandidate(context, &recurrence);
          SetError("loop-carried recurrence has no preceding seed assignment");
          return -1;
        }
        if (FindPrecedingSeedAlias(
                context, &statements, index, seedIndex,
                recurrence.targetName, recurrence.seedName,
                &seedAliasStatementID) != 0 ||
            !AddRecurrenceBinding(bindings, recurrence.targetName,
                                  recurrence.seedName,
                                  recurrence.targetBranchIndices,
                                  recurrence.targetBranchCount,
                                  recurrence.seedBranchIndices,
                                  recurrence.seedBranchCount,
                                  recurrence.controlKind,
                                  seedStatementID,
                                  seedAliasStatementID,
                                  recurrence.controlStatementID)) {
          DestroyRecurrenceCandidate(context, &recurrence);
          return -1;
        }
      }
      DestroyRecurrenceCandidate(context, &recurrence);

      if (!accumulator) {
        const void *candidate = ImmediateEmptyListAssignmentVariable(
            context, &statements, index, &initializerStatementID);
        const void *candidateName = candidate
            ? SourceReferencedValue(context, candidate)
            : NULL;
        if (candidateName &&
            !FunctionHasVariableWrite(context, childBody, candidateName)) {
          initializerOnlyVariable = candidate;
        } else {
          initializerStatementID = 0;
        }
      }
    }

    if (accumulator &&
        (!accumulatorUsesAppend ||
         PrecedingEmptyListAssignment(context, &statements, index,
                                      accumulator)) &&
        !AddControlFlowBinding(context, bindings, accumulator, statementID,
                               ownerStatementID, 0,
                               accumulatorUsesAppend &&
                                   NestedBodiesHaveAssignment(
                                       context, tag, payload, accumulator),
                               false, oneSidedNone)) {
      return -1;
    }
    if (initializerOnlyVariable &&
        !AddControlFlowBinding(
            context, bindings, initializerOnlyVariable, statementID,
            ownerStatementID, initializerStatementID, false, true, false)) {
      return -1;
    }

    if ((tag == context->statementRepeat ||
         tag == context->statementFiniteRepeat) &&
        CaptureBindingsArray(context, childBody, statementID, bindings) != 0) {
      return -1;
    }
    if (tag == context->statementConditional &&
        CaptureConditionalChildren(context, payload, statementID, bindings) !=
            0) {
      return -1;
    }
    if (tag == context->statementMatch &&
        CaptureMatchChildren(context, payload, statementID, bindings) != 0) {
      return -1;
    }
  }
  return 0;
}

void *bridge_shortpy_capture_control_flow_plan(void *program) {
  AdapterContext context;
  if (!program || !InitializeContext(&context)) {
    return NULL;
  }
  ControlFlowBindings *bindings = calloc(1, sizeof(*bindings));
  if (!bindings) {
    SetError("could not allocate control-flow plan");
    return NULL;
  }
  bindings->stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  if (!bindings->stringMetadata ||
      CaptureBindingsArray(&context, *(uintptr_t *)program, 0, bindings) != 0) {
    DestroyControlFlowBindings(bindings);
    return NULL;
  }
  size_t initializerOnlyCount = 0;
  size_t oneSidedNoneCount = 0;
  for (size_t index = 0; index < bindings->count; index++) {
    initializerOnlyCount += bindings->items[index].initializerOnly ? 1 : 0;
    oneSidedNoneCount += bindings->items[index].oneSidedNone ? 1 : 0;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace),
           "plan_bindings=%zu initializer_only=%zu one_sided_none=%zu "
           "recurrences=%zu",
           bindings->count, initializerOnlyCount, oneSidedNoneCount,
           bindings->recurrenceCount);
  return bindings;
}

void bridge_shortpy_destroy_control_flow_plan(void *opaqueBindings) {
  DestroyControlFlowBindings((ControlFlowBindings *)opaqueBindings);
}

uint32_t bridge_shortpy_recurrence_binding_count(
    const void *opaqueBindings) {
  const ControlFlowBindings *bindings = opaqueBindings;
  return bindings ? (uint32_t)bindings->recurrenceCount : 0;
}

uint32_t bridge_shortpy_recurrence_control_kind(
    const void *opaqueBindings, uint32_t recurrenceIndex) {
  const ControlFlowBindings *bindings = opaqueBindings;
  return bindings && recurrenceIndex < bindings->recurrenceCount
      ? bindings->recurrences[recurrenceIndex].controlKind
      : 0;
}

uint32_t bridge_shortpy_recurrence_target_branch_count(
    const void *opaqueBindings, uint32_t recurrenceIndex) {
  const ControlFlowBindings *bindings = opaqueBindings;
  return bindings && recurrenceIndex < bindings->recurrenceCount
      ? (uint32_t)bindings->recurrences[recurrenceIndex].targetBranchCount
      : 0;
}

uint32_t bridge_shortpy_recurrence_target_branch_at(
    const void *opaqueBindings, uint32_t recurrenceIndex,
    uint32_t branchIndex) {
  const ControlFlowBindings *bindings = opaqueBindings;
  if (!bindings || recurrenceIndex >= bindings->recurrenceCount) {
    return UINT32_MAX;
  }
  const RecurrenceBinding *binding = &bindings->recurrences[recurrenceIndex];
  return branchIndex < binding->targetBranchCount
      ? (uint32_t)binding->targetBranchIndices[branchIndex]
      : UINT32_MAX;
}

uint32_t bridge_shortpy_recurrence_seed_branch_count(
    const void *opaqueBindings, uint32_t recurrenceIndex) {
  const ControlFlowBindings *bindings = opaqueBindings;
  return bindings && recurrenceIndex < bindings->recurrenceCount
      ? (uint32_t)bindings->recurrences[recurrenceIndex].seedBranchCount
      : 0;
}

uint32_t bridge_shortpy_recurrence_seed_branch_at(
    const void *opaqueBindings, uint32_t recurrenceIndex,
    uint32_t branchIndex) {
  const ControlFlowBindings *bindings = opaqueBindings;
  if (!bindings || recurrenceIndex >= bindings->recurrenceCount) {
    return UINT32_MAX;
  }
  const RecurrenceBinding *binding = &bindings->recurrences[recurrenceIndex];
  return branchIndex < binding->seedBranchCount
      ? (uint32_t)binding->seedBranchIndices[branchIndex]
      : UINT32_MAX;
}

static int RewriteSeedVariableAtom(
    AdapterContext *context, void *variable,
    const RecurrenceBinding *binding) {
  void *atom = EnumPayloadAddress(
      context, variable, context->variable, "atom");
  if (!atom) {
    return 0;
  }
  const char *atomCase = ReflectedCaseName(context, atom, context->variableAtom);
  if (!atomCase ||
      (strcmp(atomCase, "custom") != 0 && strcmp(atomCase, "unknown") != 0)) {
    return 0;
  }
  void *sourceName = EnumPayloadAddress(
      context, atom, context->variableAtom, atomCase);
  void *name = sourceName
      ? (void *)SourceReferencedValue(context, sourceName)
      : NULL;
  if (!name || !SameVariable(name, binding->seedName)) {
    return 0;
  }
  const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  ValueDestroy destroy = Destroyer(stringMetadata);
  ValueInitializeWithCopy copy = CopyInitializer(stringMetadata);
  if (!stringMetadata || !destroy || !copy) {
    SetError("Swift String value witnesses are unavailable");
    return -1;
  }
  destroy(name, stringMetadata);
  copy(name, binding->targetName, stringMetadata);
  return 1;
}

static int RewriteSeedValueInPlace(AdapterContext *context, void *value,
                                   const RecurrenceBinding *binding) {
  const char *valueCase = ReflectedCaseName(context, value, context->value);
  if (!valueCase) {
    return 0;
  }
  if (strcmp(valueCase, "variable") == 0) {
    void *variable = EnumPayloadAddress(context, value, context->value,
                                        "variable");
    return variable ? RewriteSeedVariableAtom(
                          context, variable, binding)
                    : 0;
  }
  if (strcmp(valueCase, "interpolation") != 0) {
    return 0;
  }
  void *interpolation = EnumPayloadAddress(
      context, value, context->value, "interpolation");
  if (!interpolation) {
    return 0;
  }
  uintptr_t partsWord = *(uintptr_t *)SourceReferencedValue(
      context, interpolation);
  ArrayView parts;
  if (!ArrayFromWord(partsWord, context->interpolationPart, &parts)) {
    return -1;
  }
  int changes = 0;
  for (size_t index = 0; index < parts.count; index++) {
    void *part = parts.elements + index * parts.stride;
    void *variable = EnumPayloadAddress(
        context, part, context->interpolationPart, "variable");
    if (!variable) {
      continue;
    }
    int result = RewriteSeedVariableAtom(
        context, variable, binding);
    if (result < 0) {
      return -1;
    }
    changes += result;
  }
  return changes;
}

static int RewriteSeedExpressionInPlace(
    AdapterContext *context, void *expression,
    const RecurrenceBinding *binding) {
  const char *expressionCase =
      ReflectedCaseName(context, expression, context->expression);
  if (!expressionCase) {
    return 0;
  }
  if (strcmp(expressionCase, "value") == 0) {
    void *value = EnumPayloadAddress(context, expression, context->expression,
                                     "value");
    return value ? RewriteSeedValueInPlace(
                       context, value, binding)
                 : 0;
  }
  if (strcmp(expressionCase, context->expressionFunctionCallCase) != 0) {
    return 0;
  }
  void *functionCall = EnumPayloadAddress(
      context, expression, context->expression,
      context->expressionFunctionCallCase);
  if (!functionCall) {
    return 0;
  }
  void *sourceArguments =
      (uint8_t *)functionCall + context->functionCallArgumentsOffset;
  uintptr_t argumentsWord =
      *(uintptr_t *)SourceReferencedValue(context, sourceArguments);
  ArrayView arguments;
  if (!ArrayFromWord(argumentsWord, context->argument, &arguments)) {
    return -1;
  }
  int changes = 0;
  for (size_t index = 0; index < arguments.count; index++) {
    void *argument = arguments.elements + index * arguments.stride;
    void *keyword = EnumPayloadAddress(
        context, argument, context->argument, context->argumentKeywordCase);
    if (!keyword) {
      continue;
    }
    void *value = (uint8_t *)keyword + context->keywordArgumentValue;
    int result = RewriteSeedValueInPlace(
        context, value, binding);
    if (result < 0) {
      return -1;
    }
    changes += result;
  }
  return changes;
}

static int RewriteSeedReferencesInBody(AdapterContext *context,
                                       uintptr_t arrayWord,
                                       const RecurrenceBinding *binding) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  int changes = 0;
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    if (tag == context->statementAssignment) {
      int expressionChanges = RewriteSeedExpressionInPlace(
          context, payload + context->assignmentExpression, binding);
      if (expressionChanges < 0) {
        return -1;
      }
      changes += expressionChanges;
    } else if (tag == context->statementExpression) {
      int expressionChanges = RewriteSeedExpressionInPlace(
          context, payload, binding);
      if (expressionChanges < 0) {
        return -1;
      }
      changes += expressionChanges;
    }
  }
  return changes;
}

static int RewriteControlSeedReferences(AdapterContext *context,
                                        unsigned tag, void *payload,
                                        const RecurrenceBinding *binding) {
  int changes = 0;
  if (tag == context->statementConditional) {
    uint8_t *ifBranch = (uint8_t *)payload + context->conditionalIfBranch;
    int result = RewriteSeedReferencesInBody(
        context, *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
        binding);
    if (result < 0) {
      return -1;
    }
    changes += result;
    ArrayView branches;
    if (!ArrayFromWord(
            *(uintptr_t *)((uint8_t *)payload +
                           context->conditionalElseIfBranches),
            context->conditionalBranch, &branches)) {
      return -1;
    }
    for (size_t index = 0; index < branches.count; index++) {
      uint8_t *branch = branches.elements + index * branches.stride;
      result = RewriteSeedReferencesInBody(
          context, *(uintptr_t *)(branch + context->conditionalBranchBody),
          binding);
      if (result < 0) {
        return -1;
      }
      changes += result;
    }
    result = RewriteSeedReferencesInBody(
        context,
        *(uintptr_t *)((uint8_t *)payload + context->conditionalElseBody),
        binding);
    return result < 0 ? -1 : changes + result;
  }
  if (tag == context->statementMatch) {
    ArrayView cases;
    if (!ArrayFromWord(
            *(uintptr_t *)((uint8_t *)payload + context->matchCases),
            context->matchCase, &cases)) {
      return -1;
    }
    for (size_t index = 0; index < cases.count; index++) {
      uint8_t *matchCase = cases.elements + index * cases.stride;
      int result = RewriteSeedReferencesInBody(
          context, *(uintptr_t *)(matchCase + context->matchCaseBody),
          binding);
      if (result < 0) {
        return -1;
      }
      changes += result;
    }
  }
  return changes;
}

static int FindAndPrepareControlRecurrence(
    AdapterContext *context, uintptr_t arrayWord,
    const RecurrenceBinding *binding) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    if (bridge_shortpy_ir_statement_id(statement) ==
        binding->controlStatementID) {
      if (tag != context->statementConditional &&
          tag != context->statementMatch) {
        SetError("recurrence control statement changed native IR kind");
        return -1;
      }
      int changes = RewriteControlSeedReferences(
          context, tag, payload, binding);
      return changes < 0 ? -1 : changes + 1;
    }
    int result = 0;
    if (tag == context->statementFunction) {
      result = FindAndPrepareControlRecurrence(
          context, *(uintptr_t *)(payload + context->functionBody), binding);
    } else if (tag == context->statementConditional) {
      uint8_t *ifBranch = payload + context->conditionalIfBranch;
      result = FindAndPrepareControlRecurrence(
          context,
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody), binding);
      if (result == 0) {
        ArrayView branches;
        if (!ArrayFromWord(
                *(uintptr_t *)(payload +
                               context->conditionalElseIfBranches),
                context->conditionalBranch, &branches)) {
          return -1;
        }
        for (size_t branchIndex = 0;
             branchIndex < branches.count && result == 0; branchIndex++) {
          uint8_t *branch =
              branches.elements + branchIndex * branches.stride;
          result = FindAndPrepareControlRecurrence(
              context,
              *(uintptr_t *)(branch + context->conditionalBranchBody),
              binding);
        }
      }
      if (result == 0) {
        result = FindAndPrepareControlRecurrence(
            context, *(uintptr_t *)(payload + context->conditionalElseBody),
            binding);
      }
    } else if (tag == context->statementRepeat) {
      result = FindAndPrepareControlRecurrence(
          context, *(uintptr_t *)(payload + context->repeatBody), binding);
    } else if (tag == context->statementFiniteRepeat) {
      result = FindAndPrepareControlRecurrence(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody),
          binding);
    } else if (tag == context->statementMatch) {
      ArrayView cases;
      if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                         context->matchCase, &cases)) {
        return -1;
      }
      for (size_t caseIndex = 0;
           caseIndex < cases.count && result == 0; caseIndex++) {
        uint8_t *matchCase =
            cases.elements + caseIndex * cases.stride;
        result = FindAndPrepareControlRecurrence(
            context, *(uintptr_t *)(matchCase + context->matchCaseBody),
            binding);
      }
    }
    if (result != 0) {
      return result;
    }
  }
  return 0;
}

static void *FindStatementByID(AdapterContext *context, uintptr_t arrayWord,
                               int64_t statementID) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return NULL;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    if (bridge_shortpy_ir_statement_id(statement) == statementID) {
      return statement;
    }
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    void *result = NULL;
    if (tag == context->statementFunction) {
      result = FindStatementByID(
          context, *(uintptr_t *)(payload + context->functionBody), statementID);
    } else if (tag == context->statementConditional) {
      uint8_t *ifBranch = payload + context->conditionalIfBranch;
      result = FindStatementByID(
          context,
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
          statementID);
      if (!result) {
        ArrayView branches;
        if (!ArrayFromWord(
                *(uintptr_t *)(payload +
                               context->conditionalElseIfBranches),
                context->conditionalBranch, &branches)) {
          return NULL;
        }
        for (size_t branchIndex = 0;
             branchIndex < branches.count && !result; branchIndex++) {
          uint8_t *branch =
              branches.elements + branchIndex * branches.stride;
          result = FindStatementByID(
              context,
              *(uintptr_t *)(branch + context->conditionalBranchBody),
              statementID);
        }
      }
      if (!result) {
        result = FindStatementByID(
            context, *(uintptr_t *)(payload + context->conditionalElseBody),
            statementID);
      }
    } else if (tag == context->statementRepeat) {
      result = FindStatementByID(
          context, *(uintptr_t *)(payload + context->repeatBody), statementID);
    } else if (tag == context->statementFiniteRepeat) {
      result = FindStatementByID(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody),
          statementID);
    } else if (tag == context->statementMatch) {
      ArrayView cases;
      if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                         context->matchCase, &cases)) {
        return NULL;
      }
      for (size_t caseIndex = 0;
           caseIndex < cases.count && !result; caseIndex++) {
        uint8_t *matchCase =
            cases.elements + caseIndex * cases.stride;
        result = FindStatementByID(
            context, *(uintptr_t *)(matchCase + context->matchCaseBody),
            statementID);
      }
    }
    if (result) {
      return result;
    }
  }
  return NULL;
}

int bridge_shortpy_prepare_control_flow_input(
    void *program, const void *opaqueBindings, uint32_t *changeCount) {
  AdapterContext context;
  const ControlFlowBindings *bindings = opaqueBindings;
  uint32_t changes = 0;
  uint32_t seedRenames = 0;
  uint32_t preservedAliases = 0;
  uint32_t branchRewrites = 0;
  if (!program || !bindings || !InitializeContext(&context)) {
    return -1;
  }
  for (size_t index = 0; index < bindings->recurrenceCount; index++) {
    const RecurrenceBinding *binding = &bindings->recurrences[index];
    void *seedStatement = FindStatementByID(
        &context, *(uintptr_t *)program, binding->seedStatementID);
    if (!seedStatement ||
        StatementTag(&context, seedStatement) != context.statementAssignment) {
      SetError("loop-carried seed assignment was not found");
      return -1;
    }
    uint8_t *seedAssignment = StatementPayload(seedStatement);
    void *seedName = (void *)SourceReferencedValue(
        &context, seedAssignment + context.assignmentVariable);
    if (!SameVariable(seedName, binding->seedName)) {
      SetError("loop-carried seed binding changed before input preparation");
      return -1;
    }

    bool renameSeed = binding->seedAliasStatementID == 0;
    if (renameSeed) {
      const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
      ValueDestroy destroy = Destroyer(stringMetadata);
      ValueInitializeWithCopy copy = CopyInitializer(stringMetadata);
      if (!stringMetadata || !destroy || !copy) {
        SetError("Swift String value witnesses are unavailable");
        return -1;
      }
      destroy(seedName, stringMetadata);
      copy(seedName, binding->targetName, stringMetadata);
      seedRenames++;
    } else {
      void *aliasStatement = FindStatementByID(
          &context, *(uintptr_t *)program, binding->seedAliasStatementID);
      if (!aliasStatement ||
          StatementTag(&context, aliasStatement) !=
              context.statementAssignment) {
        SetError("loop-carried seed alias was not found");
        return -1;
      }
      uint8_t *aliasAssignment = StatementPayload(aliasStatement);
      const void *aliasTarget = SourceReferencedValue(
          &context, aliasAssignment + context.assignmentVariable);
      uint8_t *aliasSourceAllocation = NULL;
      void *aliasSource = NULL;
      bool aliasValid = SameVariable(aliasTarget, binding->targetName) &&
          CopyDirectExpressionVariableName(
              &context, aliasAssignment + context.assignmentExpression,
              &aliasSourceAllocation, &aliasSource) &&
          SameVariable(aliasSource, binding->seedName);
      DestroySwiftString(dlsym(RTLD_DEFAULT, "$sSSN"),
                         &aliasSourceAllocation, &aliasSource);
      if (!aliasValid) {
        SetError("loop-carried seed alias changed before input preparation");
        return -1;
      }
      preservedAliases++;
    }

    int result = FindAndPrepareControlRecurrence(
        &context, *(uintptr_t *)program, binding);
    if (result < 0) {
      return -1;
    }
    if (result == 0) {
      SetError(
          "captured loop-carried recurrence was not found during input "
          "preparation");
      return -1;
    }
    if (result == 1) {
      SetError("captured recurrence had no seed reference to prepare");
      return -1;
    }
    uint32_t rewritten = (uint32_t)(result - 1);
    if (changes > UINT32_MAX - rewritten - (renameSeed ? 1U : 0U)) {
      SetError("loop-carried recurrence rewrite count exceeded UInt32");
      return -1;
    }
    branchRewrites += rewritten;
    changes += rewritten + (renameSeed ? 1U : 0U);
  }
  if (changeCount) {
    *changeCount = changes;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace),
           "recurrence_rewrites=%u seed_renames=%u preserved_aliases=%u "
           "branch_rewrites=%u",
           changes, seedRenames, preservedAliases, branchRewrites);
  return 0;
}

static bool AllocateNativeValue(const void *metadata, uint8_t **allocation,
                                void **value) {
  if (!allocation || !value) {
    SetError("native value output storage is unavailable");
    return false;
  }
  *allocation = NULL;
  *value = NULL;
  size_t size = ValueSize(metadata);
  size_t alignmentMask = ValueAlignmentMask(metadata);
  if (!metadata || size == 0 ||
      size > SIZE_MAX - alignmentMask) {
    SetError("native value allocation metadata is unavailable");
    return false;
  }
  *allocation = calloc(1, size + alignmentMask);
  if (!*allocation) {
    SetError("could not allocate native value storage");
    return false;
  }
  *value = (void *)(((uintptr_t)*allocation + alignmentMask) &
                    ~(uintptr_t)alignmentMask);
  return true;
}

static void DestroyNativeValue(const void *metadata, uint8_t **allocation,
                               void **value) {
  if (!allocation || !*allocation) {
    return;
  }
  ValueDestroy destroy = Destroyer(metadata);
  if (destroy && value && *value) {
    destroy(*value, metadata);
  }
  free(*allocation);
  *allocation = NULL;
  if (value) {
    *value = NULL;
  }
}

static bool InitializeEnumCaseWithPayloadCopy(
    const AdapterContext *context, void *destination,
    const void *enumMetadata, const char *caseName,
    const void *payloadMetadata, const void *payload) {
  unsigned caseIndex = 0;
  bool isIndirect = false;
  ValueInitializeWithCopy copyPayload = CopyInitializer(payloadMetadata);
  InjectEnumTag inject = EnumDataInjector(enumMetadata);
  size_t enumSize = ValueSize(enumMetadata);
  size_t payloadSize = ValueSize(payloadMetadata);
  if (!context || !destination || !enumMetadata || !caseName ||
      !payloadMetadata || !payload || !copyPayload || !inject ||
      enumSize == 0 || payloadSize == 0 ||
      !EnumCaseIndex(enumMetadata, caseName, &caseIndex) ||
      !EnumCaseIsIndirect(enumMetadata, caseName, &isIndirect)) {
    SetError("native enum case construction metadata is unavailable");
    return false;
  }

  memset(destination, 0, enumSize);
  if (isIndirect) {
    SwiftAllocBox allocateBox =
        (SwiftAllocBox)dlsym(RTLD_DEFAULT, "swift_allocBox");
    if (!allocateBox || enumSize < sizeof(void *)) {
      SetError("indirect native enum storage is unavailable");
      return false;
    }
    SwiftBoxPair box = allocateBox(payloadMetadata);
    if (!box.object || !box.buffer) {
      SetError("swift_allocBox returned empty storage");
      return false;
    }
    copyPayload(box.buffer, payload, payloadMetadata);
    *(void **)destination = box.object;
  } else {
    if (payloadSize > enumSize) {
      SetError("native enum payload exceeds enum storage");
      return false;
    }
    copyPayload(destination, payload, payloadMetadata);
  }

  inject(destination, caseIndex, enumMetadata);
  const char *actual = context->enumCaseName(destination, enumMetadata);
  if (!actual || strcmp(actual, caseName) != 0) {
    ValueDestroy destroy = Destroyer(enumMetadata);
    if (destroy) {
      destroy(destination, enumMetadata);
    }
    SetError("native enum value-witness injection produced the wrong case");
    return false;
  }
  return true;
}

static bool BuildStatementVariable(
    const AdapterContext *context, int64_t statementID,
    void *sourceReference, void *destination) {
  uint8_t *payloadAllocation = NULL;
  void *payload = NULL;
  if (!context || !sourceReference || !destination) {
    SetError("statement-variable constructor input is unavailable");
    return false;
  }
  if (!AllocateNativeValue(context->statementReference, &payloadAllocation,
                           &payload)) {
    return false;
  }
  *(int64_t *)((uint8_t *)payload + context->statementReferenceID) =
      statementID;
  *(void **)((uint8_t *)payload + context->statementReferenceSource) =
      sourceReference;

  // The payload witness copy retains the borrowed SourceReference.
  bool result = InitializeEnumCaseWithPayloadCopy(
      context, destination, context->variable, "statement",
      context->statementReference, payload);
  free(payloadAllocation);
  return result;
}

static bool BuildStatementExpression(
    const AdapterContext *context, int64_t statementID,
    void *sourceReference, uint8_t **expressionAllocation,
    void **expression) {
  uint8_t *variableAllocation = NULL;
  uint8_t *valueAllocation = NULL;
  void *variable = NULL;
  void *value = NULL;
  bool variableInitialized = false;
  bool valueInitialized = false;
  bool result = false;

  if (!context || !sourceReference || !expressionAllocation || !expression) {
    SetError("statement-expression constructor input is unavailable");
    return false;
  }
  *expressionAllocation = NULL;
  *expression = NULL;
  if (!AllocateNativeValue(context->variable, &variableAllocation,
                           &variable) ||
      !BuildStatementVariable(
          context, statementID, sourceReference, variable)) {
    goto cleanup;
  }
  variableInitialized = true;
  if (!AllocateNativeValue(context->value, &valueAllocation, &value) ||
      !InitializeEnumCaseWithPayloadCopy(
          context, value, context->value, "variable", context->variable,
          variable)) {
    goto cleanup;
  }
  valueInitialized = true;
  if (!AllocateNativeValue(context->expression, expressionAllocation,
                           expression) ||
      !InitializeEnumCaseWithPayloadCopy(
          context, *expression, context->expression, "value",
          context->value, value)) {
    free(*expressionAllocation);
    *expressionAllocation = NULL;
    *expression = NULL;
    goto cleanup;
  }
  result = true;

cleanup:
  if (valueInitialized) {
    DestroyNativeValue(context->value, &valueAllocation, &value);
  } else {
    free(valueAllocation);
  }
  if (variableInitialized) {
    DestroyNativeValue(context->variable, &variableAllocation, &variable);
  } else {
    free(variableAllocation);
  }
  return result;
}

static bool ReplaceExpressionWithStatementReference(
    AdapterContext *context, void *expression, int64_t statementID,
    void *sourceReference) {
  uint8_t *newExpressionAllocation = NULL;
  void *newExpression = NULL;
  if (!context || !expression || !sourceReference ||
      !BuildStatementExpression(
          context, statementID, sourceReference,
          &newExpressionAllocation, &newExpression)) {
    free(newExpressionAllocation);
    if (!sourceReference) {
      SetError("statement-reference replacement has no SourceReference");
    }
    return false;
  }
  ValueDestroy destroyExpression = Destroyer(context->expression);
  ValueInitializeWithTake takeExpression =
      TakeInitializer(context->expression);
  if (!destroyExpression || !takeExpression) {
    DestroyNativeValue(context->expression, &newExpressionAllocation,
                       &newExpression);
    SetError("IRExpression replacement witnesses are unavailable");
    return false;
  }
  destroyExpression(expression, context->expression);
  takeExpression(expression, newExpression, context->expression);
  free(newExpressionAllocation);
  return true;
}

static bool LoadStatementExpressionConstructorCapabilities(
    AdapterContext *context) {
  bool isIndirect = false;
  const void *payload = context
      ? EnumCasePayloadMetadata(context->statement, "expression")
      : NULL;
  size_t expressionSize = context ? ValueSize(context->expression) : 0;
  size_t expressionAlignment =
      context ? ValueAlignmentMask(context->expression) : SIZE_MAX;
  size_t payloadSize = ValueSize(payload);
  size_t payloadAlignment = ValueAlignmentMask(payload);
  size_t expectedAlignment = expressionAlignment > 7 ? expressionAlignment : 7;
  if (!context || !payload || expressionSize == 0 ||
      expressionAlignment > 7 ||
      payloadSize != sizeof(int64_t) + expressionSize ||
      payloadAlignment != expectedAlignment ||
      !EnumCaseIsIndirect(context->statement, "expression", &isIndirect) ||
      isIndirect || !CopyInitializer(payload) ||
      !Destroyer(payload) || !EnumDataInjector(context->statement) ||
      !Destroyer(context->statement) ||
      !TakeInitializer(context->statement)) {
    SetError("IRStatement.expression constructor metadata changed");
    return false;
  }
  context->statementExpressionPayload = payload;
  return true;
}

/* Constructor metadata stays lazy: a change to an unused optional IR shape
 * must not disable parsing and inspection that only need the base context. */
static bool RequireCapabilities(AdapterContext *context,
                                AdapterCapability capabilities) {
  const uint32_t knownCapabilities =
      kAdapterCapabilityBase |
      kAdapterCapabilityStatementReferenceConstruction |
      kAdapterCapabilityStatementExpressionConstruction;
  if (!context ||
      !(context->loadedCapabilities & kAdapterCapabilityBase)) {
    SetError("ShortcutsLanguage IR adapter context is not initialized");
    return false;
  }
  if (capabilities & ~knownCapabilities) {
    SetError("unknown ShortcutsLanguage IR capability requested");
    return false;
  }
  if ((capabilities & kAdapterCapabilityStatementReferenceConstruction) &&
      !(context->loadedCapabilities &
        kAdapterCapabilityStatementReferenceConstruction)) {
    if (!LoadStatementReferenceConstructorCapabilities(context)) {
      return false;
    }
    context->loadedCapabilities |=
        kAdapterCapabilityStatementReferenceConstruction;
  }
  if ((capabilities & kAdapterCapabilityStatementExpressionConstruction) &&
      !(context->loadedCapabilities &
        kAdapterCapabilityStatementExpressionConstruction)) {
    if (!LoadStatementExpressionConstructorCapabilities(context)) {
      return false;
    }
    context->loadedCapabilities |=
        kAdapterCapabilityStatementExpressionConstruction;
  }
  return true;
}

static bool ReplaceAppendWithExpression(AdapterContext *context,
                                        void *statement,
                                        const void *expression) {
  uint8_t *payloadAllocation = NULL;
  void *payload = NULL;
  uint8_t *replacementAllocation = NULL;
  void *replacement = NULL;
  bool payloadInitialized = false;
  bool replacementInitialized = false;
  bool result = false;
  if (!context || !statement || !expression ||
      !RequireCapabilities(
          context, kAdapterCapabilityStatementExpressionConstruction)) {
    return false;
  }

  ValueInitializeWithCopy copyExpression =
      CopyInitializer(context->expression);
  ValueDestroy destroyStatement = Destroyer(context->statement);
  ValueInitializeWithTake takeStatement =
      TakeInitializer(context->statement);
  if (!copyExpression || !destroyStatement || !takeStatement ||
      !AllocateNativeValue(context->statementExpressionPayload,
                           &payloadAllocation, &payload) ||
      !AllocateNativeValue(context->statement, &replacementAllocation,
                           &replacement)) {
    SetError("IRStatement.expression value witnesses are unavailable");
    goto cleanup;
  }

  *(int64_t *)payload = bridge_shortpy_ir_statement_id(statement);
  copyExpression((uint8_t *)payload + sizeof(int64_t), expression,
                 context->expression);
  payloadInitialized = true;
  if (!InitializeEnumCaseWithPayloadCopy(
          context, replacement, context->statement, "expression",
          context->statementExpressionPayload, payload)) {
    goto cleanup;
  }
  replacementInitialized = true;
  if (StatementTag(context, replacement) != context->statementExpression ||
      bridge_shortpy_ir_statement_id(replacement) !=
          bridge_shortpy_ir_statement_id(statement)) {
    SetError("IRStatement.expression construction produced the wrong value");
    goto cleanup;
  }

  destroyStatement(statement, context->statement);
  takeStatement(statement, replacement, context->statement);
  replacementInitialized = false;
  result = true;

cleanup:
  if (replacementInitialized) {
    DestroyNativeValue(context->statement, &replacementAllocation,
                       &replacement);
  } else {
    free(replacementAllocation);
  }
  if (payloadInitialized) {
    DestroyNativeValue(context->statementExpressionPayload,
                       &payloadAllocation, &payload);
  } else {
    free(payloadAllocation);
  }
  return result;
}

static int RepairOneInitializerOnlyRepeat(
    AdapterContext *context, const ArrayView *scope, size_t index,
    void *statement, unsigned tag, int64_t ownerStatementID,
    const ControlFlowBindings *bindings, uint32_t *repairs) {
  int64_t statementID = bridge_shortpy_ir_statement_id(statement);
  const ControlFlowBinding *binding = BindingForControlStatement(
      bindings, statementID, ownerStatementID);
  if (!binding || !binding->initializerOnly) {
    return 0;
  }
  if (index == 0 || binding->initializerStatementID == 0) {
    SetError("initializer-only Repeat lost its preceding assignment");
    return -1;
  }

  void *initializer = scope->elements + (index - 1) * scope->stride;
  if (bridge_shortpy_ir_statement_id(initializer) !=
          binding->initializerStatementID ||
      StatementTag(context, initializer) != context->statementAssignment) {
    SetError("initializer-only Repeat assignment identity changed");
    return -1;
  }
  uint8_t *assignment = StatementPayload(initializer);
  const void *initializerName = SourceReferencedValue(
      context, assignment + context->assignmentVariable);
  void *oldExpression = assignment + context->assignmentExpression;
  if (!SameVariable(initializerName, binding->name) ||
      !EmptyListExpression(context, oldExpression)) {
    SetError("initializer-only Repeat assignment shape changed");
    return -1;
  }

  uint8_t *payload = StatementPayload(statement);
  size_t bodyOffset = tag == context->statementRepeat
      ? context->repeatBody
      : context->finiteRepeatBody;
  size_t sourceOffset = tag == context->statementRepeat
      ? context->repeatSourceReference
      : context->finiteRepeatSourceReference;
  uintptr_t bodyWord = *(uintptr_t *)(payload + bodyOffset);
  if (FunctionHasVariableWrite(context, bodyWord, binding->name)) {
    SetError("initializer-only Repeat gained a body write");
    return -1;
  }

  void *sourceReference = *(void **)(payload + sourceOffset);
  if (*repairs == UINT32_MAX) {
    SetError("initializer-only Repeat repair count exceeded UInt32");
    return -1;
  }
  if (!sourceReference ||
      !ReplaceExpressionWithStatementReference(
          context, oldExpression, statementID, sourceReference)) {
    if (!sourceReference) {
      SetError("initializer-only Repeat has no SourceReference");
    }
    return -1;
  }
  (*repairs)++;
  return 0;
}

static bool ExpressionStatementReference(const AdapterContext *context,
                                         const void *expression,
                                         int64_t *reference) {
  ProjectedValue value = {0};
  ProjectedValue variable = {0};
  ProjectedValue statementReference = {0};
  bool found = false;
  if (!context || !expression || !reference ||
      !ProjectPayloadCopy(expression, context->expression, "value",
                          context->value, &value) ||
      !ProjectPayloadCopy(value.value, context->value, "variable",
                          context->variable, &variable) ||
      !ProjectPayloadCopy(variable.value, context->variable, "statement",
                          context->statementReference,
                          &statementReference)) {
    goto cleanup;
  }
  *reference = *(const int64_t *)((const uint8_t *)statementReference.value +
                                  context->statementReferenceID);
  found = true;

cleanup:
  DestroyProjectedValue(&statementReference);
  DestroyProjectedValue(&variable);
  DestroyProjectedValue(&value);
  return found;
}

static const ControlFlowBinding *BindingForControlStatement(
    const ControlFlowBindings *bindings, int64_t statementID,
    int64_t ownerStatementID) {
  if (!bindings) {
    return NULL;
  }
  for (size_t index = 0; index < bindings->count; index++) {
    const ControlFlowBinding *binding = &bindings->items[index];
    if (binding->controlStatementID == statementID &&
        binding->ownerStatementID == ownerStatementID) {
      return binding;
    }
  }
  return NULL;
}

static int FinalizeOneRepeatResultForwarding(
    AdapterContext *context, void *statement, unsigned tag,
    int64_t ownerStatementID, const ControlFlowBindings *bindings,
    uint32_t *removals, uint32_t *conversions) {
  int64_t statementID = bridge_shortpy_ir_statement_id(statement);
  uint8_t *payload = StatementPayload(statement);
  uintptr_t *bodyStorage = tag == context->statementRepeat
      ? (uintptr_t *)(payload + context->repeatBody)
      : (uintptr_t *)(payload + context->finiteRepeatBody);
  const ControlFlowBinding *binding = BindingForControlStatement(
      bindings, statementID, ownerStatementID);
  ArrayView body;
  if (!binding || binding->initializerOnly ||
      !ArrayFromWord(*bodyStorage, context->statement, &body) ||
      body.count == 0) {
    return 0;
  }

  void *last = body.elements + (body.count - 1) * body.stride;
  if (StatementTag(context, last) != context->statementAppend) {
    return 0;
  }

  uint8_t *append = StatementPayload(last);
  const void *appendName = SourceReferencedValue(
      context, append + context->appendVariable);
  if (!SameVariable(binding->name, appendName)) {
    SetError("captured Repeat result tail changed accumulator identity");
    return -1;
  }
  if (binding->hasConflictingWrite) {
    SetError("captured Repeat result has conflicting nested writes");
    return -1;
  }

  int64_t reference = 0;
  if (ExpressionStatementReference(
          context, append + context->appendExpression, &reference)) {
    if (body.count < 2) {
      SetError("captured Repeat forwarding has no preceding statement");
      return -1;
    }
    void *previous = body.elements + (body.count - 2) * body.stride;
    unsigned previousTag = StatementTag(context, previous);
    bool previousIsControl =
        previousTag == context->statementConditional ||
        previousTag == context->statementRepeat ||
        previousTag == context->statementFiniteRepeat ||
        previousTag == context->statementMatch;
    if (!previousIsControl ||
        reference != bridge_shortpy_ir_statement_id(previous)) {
      SetError(
          "captured Repeat forwarding does not reference the immediately "
          "preceding control statement");
      return -1;
    }
    if (*removals == UINT32_MAX) {
      SetError("Repeat forwarding removal count exceeded UInt32");
      return -1;
    }
    bridge_shortpy_array_remove_last_generic(bodyStorage, context->statement);
    (*removals)++;
    return 0;
  }

  if (*conversions == UINT32_MAX) {
    SetError("Repeat forwarding conversion count exceeded UInt32");
    return -1;
  }
  if (!ReplaceAppendWithExpression(
          context, last, append + context->appendExpression)) {
    return -1;
  }
  (*conversions)++;
  return 0;
}

static int RepairControlFlowOutputsInArray(
    AdapterContext *context, uintptr_t *arrayStorage,
    int64_t ownerStatementID,
    const ControlFlowBindings *bindings,
    ControlFlowOutputRepairCounts *counts);

static int RemoveStructuralNoneTail(
    AdapterContext *context, uintptr_t *bodyStorage,
    const ControlFlowBinding *binding,
    ControlFlowOutputRepairCounts *counts) {
  ArrayView body;
  if (!context || !bodyStorage || !counts) {
    return 0;
  }
  if (!binding) {
    counts->structuralBindingMisses++;
    return 0;
  }
  counts->structuralBindingMatches++;
  if (!ArrayFromWord(*bodyStorage, context->statement, &body)) {
    return -1;
  }
  if (body.count == 0) {
    return 0;
  }
  void *last = body.elements + (body.count - 1) * body.stride;
  if (StatementTag(context, last) == context->statementExpression) {
    counts->structuralExpressionTails++;
  }
  int isNone = StatementIsNoneExpression(context, last, counts);
  if (isNone < 0) {
    return -1;
  }
  if (isNone == 0) {
    return 0;
  }
  if (counts->structuralNoneRemovals == UINT32_MAX) {
    SetError("structural None removal count exceeded UInt32");
    return -1;
  }
  bridge_shortpy_array_remove_last_generic(bodyStorage, context->statement);
  counts->structuralNoneRemovals++;
  return 0;
}

static int RepairOneSidedNoneConditional(
    AdapterContext *context, uintptr_t *parentStorage,
    size_t conditionalIndex, uint8_t *payload, int64_t statementID,
    const ControlFlowBinding *binding,
    ControlFlowOutputRepairCounts *counts) {
  ArrayView parent;
  ArrayView ifBody;
  ArrayView elseBody;
  ArrayView elseIfBranches;
  uint8_t *ifBranch = payload + context->conditionalIfBranch;
  if (!binding || !binding->oneSidedNone) {
    return 0;
  }
  if (!parentStorage ||
      !ArrayFromWord(*parentStorage, context->statement, &parent) ||
      conditionalIndex >= parent.count ||
      !ArrayFromWord(
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
          context->statement, &ifBody) ||
      !ArrayFromWord(*(uintptr_t *)(payload + context->conditionalElseBody),
                     context->statement, &elseBody) ||
      !ArrayFromWord(
          *(uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &elseIfBranches)) {
    return -1;
  }
  if (ifBody.count != 1 || elseBody.count != 0 ||
      elseIfBranches.count != 0) {
    SetError("one-sided structural None conditional changed branch shape");
    return -1;
  }
  void *statement = ifBody.elements;
  int64_t assignmentStatementID = bridge_shortpy_ir_statement_id(statement);
  if (StatementTag(context, statement) != context->statementAssignment) {
    SetError("one-sided structural None assignment was not preserved");
    return -1;
  }
  uint8_t *assignment = StatementPayload(statement);
  const void *name = SourceReferencedValue(
      context, assignment + context->assignmentVariable);
  int isNone = ExpressionIsNoneAtom(
      context, assignment + context->assignmentExpression, NULL, NULL);
  if (isNone < 0) {
    return -1;
  }
  if (!SameVariable(name, binding->name) || isNone == 0) {
    SetError("one-sided structural None assignment changed identity");
    return -1;
  }
  if (counts->oneSidedNoneRepairs == UINT32_MAX) {
    SetError("one-sided structural None repair count exceeded UInt32");
    return -1;
  }
  void *sourceReference =
      *(void **)(payload + context->conditionalSourceReference);
  if (!sourceReference ||
      !ReplaceExpressionWithStatementReference(
          context, assignment + context->assignmentExpression,
          statementID, sourceReference)) {
    if (!sourceReference) {
      SetError("one-sided conditional has no SourceReference");
    }
    return -1;
  }

  uint8_t *statementAllocation = NULL;
  void *statementCopy = NULL;
  ValueInitializeWithCopy copyStatement = CopyInitializer(context->statement);
  if (!copyStatement ||
      !AllocateNativeValue(context->statement, &statementAllocation,
                           &statementCopy)) {
    free(statementAllocation);
    SetError("one-sided assignment copy witnesses are unavailable");
    return -1;
  }
  copyStatement(statementCopy, statement, context->statement);
  bridge_shortpy_array_remove_last_generic(
      (uintptr_t *)(ifBranch + context->conditionalBranchBody),
      context->statement);
  bridge_shortpy_array_insert_copy_generic(
      parentStorage, statementCopy, conditionalIndex, context->statement);
  DestroyNativeValue(context->statement, &statementAllocation,
                     &statementCopy);

  ArrayView updatedParent;
  if (!ArrayFromWord(*parentStorage, context->statement, &updatedParent) ||
      updatedParent.count != parent.count + 1) {
    SetError("one-sided assignment relocation changed parent shape");
    return -1;
  }
  void *relocated =
      updatedParent.elements + conditionalIndex * updatedParent.stride;
  if (StatementTag(context, relocated) != context->statementAssignment ||
      bridge_shortpy_ir_statement_id(relocated) !=
          assignmentStatementID) {
    SetError("one-sided assignment relocation changed statement identity");
    return -1;
  }
  counts->oneSidedNoneRepairs++;
  return 0;
}

static int RepairControlFlowOutputsInConditional(
    AdapterContext *context, uint8_t *payload, int64_t statementID,
    int64_t ownerStatementID,
    const ControlFlowBindings *bindings,
    ControlFlowOutputRepairCounts *counts) {
  uint8_t *ifBranch = payload + context->conditionalIfBranch;
  uintptr_t *ifBody =
      (uintptr_t *)(ifBranch + context->conditionalBranchBody);
  uintptr_t *elseBody =
      (uintptr_t *)(payload + context->conditionalElseBody);
  const ControlFlowBinding *binding = BindingForControlStatement(
      bindings, statementID, ownerStatementID);
  if (RepairControlFlowOutputsInArray(
          context, ifBody,
          statementID, bindings, counts) != 0 ||
      RepairControlFlowOutputsInArray(
          context, elseBody, statementID, bindings, counts) != 0 ||
      RemoveStructuralNoneTail(context, ifBody, binding, counts) != 0 ||
      RemoveStructuralNoneTail(context, elseBody, binding, counts) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    uintptr_t *body =
        (uintptr_t *)(branch + context->conditionalBranchBody);
    if (RepairControlFlowOutputsInArray(
            context, body, statementID, bindings, counts) != 0 ||
        RemoveStructuralNoneTail(context, body, binding, counts) != 0) {
      return -1;
    }
  }
  return 0;
}

static int RepairControlFlowOutputsInMatch(
    AdapterContext *context, uint8_t *payload, int64_t statementID,
    int64_t ownerStatementID,
    const ControlFlowBindings *bindings,
    ControlFlowOutputRepairCounts *counts) {
  ArrayView cases;
  if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                     context->matchCase, &cases)) {
    return -1;
  }
  const ControlFlowBinding *binding = BindingForControlStatement(
      bindings, statementID, ownerStatementID);
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    uintptr_t *body = (uintptr_t *)(matchCase + context->matchCaseBody);
    if (RepairControlFlowOutputsInArray(
            context, body, statementID, bindings, counts) != 0 ||
        RemoveStructuralNoneTail(context, body, binding, counts) != 0) {
      return -1;
    }
  }
  return 0;
}

static int RepairControlFlowOutputsInArray(
    AdapterContext *context, uintptr_t *arrayStorage,
    int64_t ownerStatementID,
    const ControlFlowBindings *bindings,
    ControlFlowOutputRepairCounts *counts) {
  ArrayView statements;
  if (!context || !arrayStorage ||
      !ArrayFromWord(*arrayStorage, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int64_t statementID = bridge_shortpy_ir_statement_id(statement);
    if (tag == context->statementFunction) {
      if (RepairControlFlowOutputsInArray(
              context, (uintptr_t *)(payload + context->functionBody),
              statementID, bindings, counts) != 0) {
        return -1;
      }
    } else if (tag == context->statementConditional) {
      const ControlFlowBinding *binding = BindingForControlStatement(
          bindings, statementID, ownerStatementID);
      if (binding && binding->oneSidedNone) {
        if (RepairOneSidedNoneConditional(
                context, arrayStorage, index, payload, statementID,
                binding, counts) != 0 ||
            !ArrayFromWord(*arrayStorage, context->statement, &statements)) {
          return -1;
        }
        index++;
        if (index >= statements.count) {
          SetError("relocated one-sided conditional left parent scope");
          return -1;
        }
        statement = statements.elements + index * statements.stride;
        tag = StatementTag(context, statement);
        payload = StatementPayload(statement);
        if (tag != context->statementConditional ||
            bridge_shortpy_ir_statement_id(statement) != statementID) {
          SetError("relocated one-sided conditional changed identity");
          return -1;
        }
      }
      if (RepairControlFlowOutputsInConditional(
              context, payload, statementID, ownerStatementID,
              bindings, counts) != 0) {
        return -1;
      }
    } else if (tag == context->statementRepeat ||
               tag == context->statementFiniteRepeat) {
      /* Repair the current initializer first, then clean forwarding inner-first. */
      if (RepairOneInitializerOnlyRepeat(
              context, &statements, index, statement, tag,
              ownerStatementID, bindings, &counts->initializerRepairs) != 0) {
        return -1;
      }
      uintptr_t *body = tag == context->statementRepeat
          ? (uintptr_t *)(payload + context->repeatBody)
          : (uintptr_t *)(payload + context->finiteRepeatBody);
      if (RepairControlFlowOutputsInArray(
              context, body, statementID, bindings, counts) != 0 ||
          FinalizeOneRepeatResultForwarding(
              context, statement, tag, ownerStatementID, bindings,
              &counts->forwardingRemovals,
              &counts->forwardingConversions) != 0) {
        return -1;
      }
    } else if (tag == context->statementMatch) {
      if (RepairControlFlowOutputsInMatch(
              context, payload, statementID, ownerStatementID,
              bindings, counts) != 0) {
        return -1;
      }
    }
  }
  return 0;
}

int bridge_shortpy_repair_control_flow_output(
    void *program, const void *opaqueBindings, uint32_t *changeCount) {
  AdapterContext context;
  const ControlFlowBindings *bindings = opaqueBindings;
  ControlFlowOutputRepairCounts counts = {0};
  size_t initializerCandidateCount = 0;
  size_t oneSidedNoneCandidateCount = 0;
  if (changeCount) {
    *changeCount = 0;
  }
  if (!program || !bindings || !InitializeContext(&context)) {
    return -1;
  }
  for (size_t index = 0; index < bindings->count; index++) {
    initializerCandidateCount +=
        bindings->items[index].initializerOnly ? 1 : 0;
    oneSidedNoneCandidateCount +=
        bindings->items[index].oneSidedNone ? 1 : 0;
  }
  if (initializerCandidateCount > UINT32_MAX ||
      oneSidedNoneCandidateCount > UINT32_MAX) {
    SetError("control-flow output candidate count exceeded UInt32");
    return -1;
  }
  if (((initializerCandidateCount > 0 || oneSidedNoneCandidateCount > 0) &&
       !RequireCapabilities(
           &context, kAdapterCapabilityStatementReferenceConstruction)) ||
      RepairControlFlowOutputsInArray(
          &context, (uintptr_t *)program, 0, bindings, &counts) != 0) {
    return -1;
  }
  if (counts.initializerRepairs !=
      (uint32_t)initializerCandidateCount) {
    snprintf(gAdapterError, sizeof(gAdapterError),
             "repaired %u of %zu captured initializer-only Repeats",
             counts.initializerRepairs, initializerCandidateCount);
    return -1;
  }
  if (counts.oneSidedNoneRepairs !=
      (uint32_t)oneSidedNoneCandidateCount) {
    snprintf(gAdapterError, sizeof(gAdapterError),
             "repaired %u of %zu captured one-sided None conditionals",
             counts.oneSidedNoneRepairs, oneSidedNoneCandidateCount);
    return -1;
  }
  if (counts.initializerRepairs >
      UINT32_MAX - counts.forwardingRemovals) {
    SetError("control-flow output repair count exceeded UInt32");
    return -1;
  }
  uint32_t changes = counts.initializerRepairs + counts.forwardingRemovals;
  if (changes > UINT32_MAX - counts.forwardingConversions) {
    SetError("control-flow output repair count exceeded UInt32");
    return -1;
  }
  changes += counts.forwardingConversions;
  if (changes > UINT32_MAX - counts.structuralNoneRemovals) {
    SetError("control-flow output repair count exceeded UInt32");
    return -1;
  }
  changes += counts.structuralNoneRemovals;
  if (changes > UINT32_MAX - counts.oneSidedNoneRepairs) {
    SetError("control-flow output repair count exceeded UInt32");
    return -1;
  }
  changes += counts.oneSidedNoneRepairs;
  if (changeCount) {
    *changeCount = changes;
  }
  snprintf(
      gAdapterTrace, sizeof(gAdapterTrace),
      "control_flow_output_changes=%u initializer_repairs=%u "
      "forwarding_removals=%u forwarding_conversions=%u "
      "structural_none_removals=%u one_sided_none_repairs=%u "
      "structural_binding_matches=%u "
      "structural_binding_misses=%u structural_expression_tails=%u "
      "structural_value_expression_tails=%u structural_none_value_tails=%u "
      "last_structural_value_case=%s last_structural_atom_case=%s "
      "initializer_candidates=%zu constructor=%s",
      changes, counts.initializerRepairs, counts.forwardingRemovals,
      counts.forwardingConversions, counts.structuralNoneRemovals,
      counts.oneSidedNoneRepairs, counts.structuralBindingMatches,
      counts.structuralBindingMisses,
      counts.structuralExpressionTails, counts.structuralValueExpressionTails,
      counts.structuralNoneValueTails,
      counts.lastStructuralValueCase ? counts.lastStructuralValueCase
                                     : "<unavailable>",
      counts.lastStructuralAtomCase ? counts.lastStructuralAtomCase
                                    : "<unavailable>",
      initializerCandidateCount,
      initializerCandidateCount > 0 || oneSidedNoneCandidateCount > 0
          ? "swift_allocBox+value_witnesses"
          : counts.forwardingConversions > 0 ? "value_witnesses"
                                             : "not-required");
  return 0;
}

static int CountNamedCallsInArray(AdapterContext *context,
                                  uintptr_t arrayWord,
                                  const char *functionName,
                                  uint64_t *count);

static int CountNamedCallExpression(AdapterContext *context,
                                    void *expression,
                                    const char *functionName,
                                    uint64_t *count) {
  const char *expressionCase =
      ReflectedCaseName(context, expression, context->expression);
  if (!expressionCase ||
      strcmp(expressionCase, context->expressionFunctionCallCase) != 0) {
    return 0;
  }
  void *functionCall = EnumPayloadAddress(
      context, expression, context->expression,
      context->expressionFunctionCallCase);
  if (!functionCall) {
    SetError("could not project native IR function call");
    return -1;
  }
  const void *referencedName =
      (const uint8_t *)functionCall + context->functionCallFunctionName;
  const void *name = SourceReferencedValue(context, referencedName);
  if (bridge_shortpy_swift_string_equal_utf8(name, functionName)) {
    (*count)++;
  }
  return 0;
}

static int CountNamedCallsInConditional(AdapterContext *context,
                                         void *conditional,
                                         const char *functionName,
                                         uint64_t *count) {
  uint8_t *payload = conditional;
  uint8_t *ifBranch = payload + context->conditionalIfBranch;
  if (CountNamedCallsInArray(
          context,
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
          functionName, count) != 0 ||
      CountNamedCallsInArray(
          context, *(uintptr_t *)(payload + context->conditionalElseBody),
          functionName, count) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(uintptr_t *)(payload + context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    if (CountNamedCallsInArray(
            context,
            *(uintptr_t *)(branch + context->conditionalBranchBody),
            functionName, count) != 0) {
      return -1;
    }
  }
  return 0;
}

static int CountNamedCallsInMatch(AdapterContext *context, void *match,
                                  const char *functionName,
                                  uint64_t *count) {
  ArrayView cases;
  if (!ArrayFromWord(
          *(uintptr_t *)((uint8_t *)match + context->matchCases),
          context->matchCase, &cases)) {
    return -1;
  }
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    if (CountNamedCallsInArray(
            context, *(uintptr_t *)(matchCase + context->matchCaseBody),
            functionName, count) != 0) {
      return -1;
    }
  }
  return 0;
}

static int CountNamedCallsInArray(AdapterContext *context,
                                  uintptr_t arrayWord,
                                  const char *functionName,
                                  uint64_t *count) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int result = 0;
    if (tag == context->statementAssignment) {
      result = CountNamedCallExpression(
          context, payload + context->assignmentExpression,
          functionName, count);
    } else if (tag == context->statementAppend) {
      result = CountNamedCallExpression(
          context, payload + context->appendExpression,
          functionName, count);
    } else if (tag == context->statementExpression) {
      result = CountNamedCallExpression(
          context, payload, functionName, count);
    } else if (tag == context->statementFunction) {
      result = CountNamedCallsInArray(
          context, *(uintptr_t *)(payload + context->functionBody),
          functionName, count);
    } else if (tag == context->statementConditional) {
      result = CountNamedCallsInConditional(
          context, payload, functionName, count);
    } else if (tag == context->statementRepeat) {
      result = CountNamedCallsInArray(
          context, *(uintptr_t *)(payload + context->repeatBody),
          functionName, count);
    } else if (tag == context->statementFiniteRepeat) {
      result = CountNamedCallsInArray(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody),
          functionName, count);
    } else if (tag == context->statementMatch) {
      result = CountNamedCallsInMatch(
          context, payload, functionName, count);
    }
    if (result != 0) {
      return result;
    }
  }
  return 0;
}

int bridge_shortpy_count_function_calls(const void *program,
                                        const char *functionName,
                                        uint32_t *count) {
  AdapterContext context;
  uint64_t total = 0;
  if (!program || !functionName || !count || !InitializeContext(&context)) {
    return -1;
  }
  if (CountNamedCallsInArray(&context, *(const uintptr_t *)program,
                             functionName, &total) != 0) {
    return -1;
  }
  if (total > UINT32_MAX) {
    SetError("native IR function call count exceeded UInt32");
    return -1;
  }
  *count = (uint32_t)total;
  return 0;
}

/* Terminal IRToShortcut compatibility: native Branch values become empty
 * mode-0 witnesses, while the canonical post-pass IR has already been saved. */

static void DestroyElseIfWitnessPlan(ElseIfWitnessPlan *plan) {
  if (!plan) {
    return;
  }
  for (size_t index = 0; index < plan->count; index++) {
    free(plan->entries[index].witnessStatementIDs);
    free(plan->entries[index].witnessOrdinals);
  }
  free(plan->entries);
  free(plan);
}

static ElseIfWitnessEntry *AppendElseIfWitnessEntry(
    ElseIfWitnessPlan *plan, int64_t targetStatementID,
    size_t witnessCount) {
  if (!plan || witnessCount == 0 || witnessCount > UINT32_MAX ||
      plan->witnessCount > UINT32_MAX - witnessCount) {
    SetError("Else If witness plan count exceeded UInt32");
    return NULL;
  }
  if (plan->count == plan->capacity) {
    size_t nextCapacity = plan->capacity ? plan->capacity * 2 : 4;
    if (nextCapacity < plan->capacity ||
        nextCapacity > SIZE_MAX / sizeof(*plan->entries)) {
      SetError("Else If witness plan capacity overflowed");
      return NULL;
    }
    ElseIfWitnessEntry *next =
        realloc(plan->entries, nextCapacity * sizeof(*next));
    if (!next) {
      SetError("could not allocate Else If witness plan");
      return NULL;
    }
    plan->entries = next;
    plan->capacity = nextCapacity;
  }
  ElseIfWitnessEntry *entry = &plan->entries[plan->count];
  memset(entry, 0, sizeof(*entry));
  entry->targetStatementID = targetStatementID;
  entry->targetOrdinal = UINT32_MAX;
  entry->witnessCount = witnessCount;
  entry->witnessStatementIDs =
      calloc(witnessCount, sizeof(*entry->witnessStatementIDs));
  entry->witnessOrdinals =
      malloc(witnessCount * sizeof(*entry->witnessOrdinals));
  if (!entry->witnessStatementIDs || !entry->witnessOrdinals) {
    free(entry->witnessStatementIDs);
    free(entry->witnessOrdinals);
    memset(entry, 0, sizeof(*entry));
    SetError("could not allocate Else If witness entry");
    return NULL;
  }
  for (size_t index = 0; index < witnessCount; index++) {
    entry->witnessOrdinals[index] = UINT32_MAX;
  }
  plan->count++;
  plan->witnessCount += witnessCount;
  return entry;
}

static int FindMaximumStatementIDInArray(
    AdapterContext *context, uintptr_t arrayWord,
    int64_t *maximum, bool *found);

static int FindMaximumStatementIDInConditional(
    AdapterContext *context, uint8_t *conditional,
    int64_t *maximum, bool *found) {
  uint8_t *ifBranch = conditional + context->conditionalIfBranch;
  if (FindMaximumStatementIDInArray(
          context,
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
          maximum, found) != 0 ||
      FindMaximumStatementIDInArray(
          context,
          *(uintptr_t *)(conditional + context->conditionalElseBody),
          maximum, found) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(uintptr_t *)(conditional +
                         context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    if (FindMaximumStatementIDInArray(
            context,
            *(uintptr_t *)(branch + context->conditionalBranchBody),
            maximum, found) != 0) {
      return -1;
    }
  }
  return 0;
}

static int FindMaximumStatementIDInMatch(
    AdapterContext *context, uint8_t *match,
    int64_t *maximum, bool *found) {
  ArrayView cases;
  if (!ArrayFromWord(
          *(uintptr_t *)(match + context->matchCases),
          context->matchCase, &cases)) {
    return -1;
  }
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    if (FindMaximumStatementIDInArray(
            context,
            *(uintptr_t *)(matchCase + context->matchCaseBody),
            maximum, found) != 0) {
      return -1;
    }
  }
  return 0;
}

static int FindMaximumStatementIDInArray(
    AdapterContext *context, uintptr_t arrayWord,
    int64_t *maximum, bool *found) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    int64_t statementID = bridge_shortpy_ir_statement_id(statement);
    if (!*found || statementID > *maximum) {
      *maximum = statementID;
      *found = true;
    }
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int result = 0;
    if (tag == context->statementFunction) {
      result = FindMaximumStatementIDInArray(
          context, *(uintptr_t *)(payload + context->functionBody),
          maximum, found);
    } else if (tag == context->statementConditional) {
      result = FindMaximumStatementIDInConditional(
          context, payload, maximum, found);
    } else if (tag == context->statementRepeat) {
      result = FindMaximumStatementIDInArray(
          context, *(uintptr_t *)(payload + context->repeatBody),
          maximum, found);
    } else if (tag == context->statementFiniteRepeat) {
      result = FindMaximumStatementIDInArray(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody),
          maximum, found);
    } else if (tag == context->statementMatch) {
      result = FindMaximumStatementIDInMatch(
          context, payload, maximum, found);
    }
    if (result != 0) {
      return result;
    }
  }
  return 0;
}

static int ClearNativeArray(uintptr_t *arrayStorage,
                            const void *elementMetadata) {
  ArrayView values;
  if (!arrayStorage ||
      !ArrayFromWord(*arrayStorage, elementMetadata, &values)) {
    return -1;
  }
  while (values.count > 0) {
    bridge_shortpy_array_remove_last_generic(arrayStorage, elementMetadata);
    if (!ArrayFromWord(*arrayStorage, elementMetadata, &values)) {
      return -1;
    }
  }
  return 0;
}

static int BuildElseIfWitnessStatement(
    AdapterContext *context, const void *targetStatement,
    size_t branchIndex, int64_t witnessStatementID,
    uint8_t **allocation, void **witnessStatement) {
  ValueInitializeWithCopy copyStatement = CopyInitializer(context->statement);
  ValueInitializeWithCopy copyBranch =
      CopyInitializer(context->conditionalBranch);
  ValueDestroy destroyBranch = Destroyer(context->conditionalBranch);
  if (!copyStatement || !copyBranch || !destroyBranch ||
      !AllocateNativeValue(context->statement, allocation,
                           witnessStatement)) {
    SetError("Else If witness value witnesses are unavailable");
    return -1;
  }
  copyStatement(*witnessStatement, targetStatement, context->statement);
  *(int64_t *)*witnessStatement = witnessStatementID;

  if (StatementTag(context, *witnessStatement) !=
      context->statementConditional) {
    SetError("copied Else If witness changed statement case");
    goto failure;
  }
  uint8_t *conditional = StatementPayload(*witnessStatement);
  uintptr_t *branchesStorage =
      (uintptr_t *)(conditional + context->conditionalElseIfBranches);
  ArrayView branches;
  if (!ArrayFromWord(*branchesStorage, context->conditionalBranch,
                     &branches) ||
      branchIndex >= branches.count) {
    SetError("Else If witness branch index changed during construction");
    goto failure;
  }
  void *sourceBranch = branches.elements + branchIndex * branches.stride;
  void *ifBranch = conditional + context->conditionalIfBranch;
  destroyBranch(ifBranch, context->conditionalBranch);
  copyBranch(ifBranch, sourceBranch, context->conditionalBranch);

  if (ClearNativeArray(
          (uintptr_t *)((uint8_t *)ifBranch +
                        context->conditionalBranchBody),
          context->statement) != 0 ||
      ClearNativeArray(branchesStorage,
                       context->conditionalBranch) != 0 ||
      ClearNativeArray(
          (uintptr_t *)(conditional + context->conditionalElseBody),
          context->statement) != 0) {
    if (gAdapterError[0] == '\0') {
      SetError("could not clear Else If witness bodies");
    }
    goto failure;
  }
  return 0;

failure:
  DestroyNativeValue(context->statement, allocation, witnessStatement);
  return -1;
}

static int PrepareElseIfWitnessesInArray(
    AdapterContext *context, uintptr_t *arrayStorage,
    ElseIfWitnessPlan *plan, int64_t *nextStatementID);

static int PrepareElseIfWitnessesInConditionalChildren(
    AdapterContext *context, uint8_t *conditional,
    ElseIfWitnessPlan *plan, int64_t *nextStatementID) {
  uint8_t *ifBranch = conditional + context->conditionalIfBranch;
  if (PrepareElseIfWitnessesInArray(
          context,
          (uintptr_t *)(ifBranch + context->conditionalBranchBody),
          plan, nextStatementID) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(uintptr_t *)(conditional +
                         context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    if (PrepareElseIfWitnessesInArray(
            context,
            (uintptr_t *)(branch + context->conditionalBranchBody),
            plan, nextStatementID) != 0) {
      return -1;
    }
  }
  return PrepareElseIfWitnessesInArray(
      context,
      (uintptr_t *)(conditional + context->conditionalElseBody),
      plan, nextStatementID);
}

static int PrepareElseIfWitnessesInMatchChildren(
    AdapterContext *context, uint8_t *match,
    ElseIfWitnessPlan *plan, int64_t *nextStatementID) {
  ArrayView cases;
  if (!ArrayFromWord(*(uintptr_t *)(match + context->matchCases),
                     context->matchCase, &cases)) {
    return -1;
  }
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    if (PrepareElseIfWitnessesInArray(
            context,
            (uintptr_t *)(matchCase + context->matchCaseBody),
            plan, nextStatementID) != 0) {
      return -1;
    }
  }
  return 0;
}

static int PrepareElseIfWitnessesInArray(
    AdapterContext *context, uintptr_t *arrayStorage,
    ElseIfWitnessPlan *plan, int64_t *nextStatementID) {
  ArrayView statements;
  if (!arrayStorage ||
      !ArrayFromWord(*arrayStorage, context->statement, &statements)) {
    return -1;
  }
  for (size_t cursor = statements.count; cursor > 0; cursor--) {
    size_t index = cursor - 1;
    if (!ArrayFromWord(*arrayStorage, context->statement, &statements) ||
        index >= statements.count) {
      SetError("Else If parent statement array changed unexpectedly");
      return -1;
    }
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int result = 0;
    if (tag == context->statementFunction) {
      result = PrepareElseIfWitnessesInArray(
          context, (uintptr_t *)(payload + context->functionBody),
          plan, nextStatementID);
    } else if (tag == context->statementConditional) {
      result = PrepareElseIfWitnessesInConditionalChildren(
          context, payload, plan, nextStatementID);
    } else if (tag == context->statementRepeat) {
      result = PrepareElseIfWitnessesInArray(
          context, (uintptr_t *)(payload + context->repeatBody),
          plan, nextStatementID);
    } else if (tag == context->statementFiniteRepeat) {
      result = PrepareElseIfWitnessesInArray(
          context, (uintptr_t *)(payload + context->finiteRepeatBody),
          plan, nextStatementID);
    } else if (tag == context->statementMatch) {
      result = PrepareElseIfWitnessesInMatchChildren(
          context, payload, plan, nextStatementID);
    }
    if (result != 0) {
      return result;
    }

    if (!ArrayFromWord(*arrayStorage, context->statement, &statements) ||
        index >= statements.count) {
      SetError("Else If target statement moved during nested preparation");
      return -1;
    }
    statement = statements.elements + index * statements.stride;
    if (StatementTag(context, statement) !=
        context->statementConditional) {
      continue;
    }
    payload = StatementPayload(statement);
    ArrayView branches;
    if (!ArrayFromWord(
            *(uintptr_t *)(payload + context->conditionalElseIfBranches),
            context->conditionalBranch, &branches)) {
      return -1;
    }
    if (branches.count == 0) {
      continue;
    }
    ElseIfWitnessEntry *entry = AppendElseIfWitnessEntry(
        plan, bridge_shortpy_ir_statement_id(statement), branches.count);
    if (!entry) {
      return -1;
    }
    size_t inserted = 0;
    for (size_t branchCursor = branches.count;
         branchCursor > 0; branchCursor--) {
      size_t branchIndex = branchCursor - 1;
      if (*nextStatementID == INT64_MAX) {
        SetError("IR statement ID space is exhausted");
        return -1;
      }
      int64_t witnessStatementID = ++*nextStatementID;
      entry->witnessStatementIDs[branchIndex] = witnessStatementID;

      if (!ArrayFromWord(*arrayStorage, context->statement, &statements) ||
          index + inserted >= statements.count) {
        SetError("Else If target moved during witness insertion");
        return -1;
      }
      const void *currentTarget =
          statements.elements + (index + inserted) * statements.stride;
      if (StatementTag(context, currentTarget) !=
              context->statementConditional ||
          bridge_shortpy_ir_statement_id(currentTarget) !=
              entry->targetStatementID) {
        SetError("Else If target identity changed during witness insertion");
        return -1;
      }
      uint8_t *witnessAllocation = NULL;
      void *witnessStatement = NULL;
      if (BuildElseIfWitnessStatement(
              context, currentTarget, branchIndex, witnessStatementID,
              &witnessAllocation, &witnessStatement) != 0) {
        return -1;
      }
      bridge_shortpy_array_insert_copy_generic(
          arrayStorage, witnessStatement, index, context->statement);
      DestroyNativeValue(context->statement, &witnessAllocation,
                         &witnessStatement);
      inserted++;
    }
  }
  return 0;
}

static int RecordElseIfConditionalOrdinal(
    ElseIfWitnessPlan *plan, int64_t statementID, uint32_t ordinal) {
  for (size_t entryIndex = 0; entryIndex < plan->count; entryIndex++) {
    ElseIfWitnessEntry *entry = &plan->entries[entryIndex];
    if (entry->targetStatementID == statementID) {
      if (entry->targetOrdinal != UINT32_MAX) {
        SetError("duplicate Else If target statement identity");
        return -1;
      }
      entry->targetOrdinal = ordinal;
      return 0;
    }
    for (size_t witnessIndex = 0;
         witnessIndex < entry->witnessCount; witnessIndex++) {
      if (entry->witnessStatementIDs[witnessIndex] == statementID) {
        if (entry->witnessOrdinals[witnessIndex] != UINT32_MAX) {
          SetError("duplicate Else If witness statement identity");
          return -1;
        }
        entry->witnessOrdinals[witnessIndex] = ordinal;
        return 0;
      }
    }
  }
  return 0;
}

static int AssignElseIfOrdinalsInArray(
    AdapterContext *context, uintptr_t arrayWord,
    ElseIfWitnessPlan *plan, uint64_t *ordinal);

static int AssignElseIfOrdinalsInConditionalChildren(
    AdapterContext *context, uint8_t *conditional,
    ElseIfWitnessPlan *plan, uint64_t *ordinal) {
  uint8_t *ifBranch = conditional + context->conditionalIfBranch;
  if (AssignElseIfOrdinalsInArray(
          context,
          *(uintptr_t *)(ifBranch + context->conditionalBranchBody),
          plan, ordinal) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(
          *(uintptr_t *)(conditional +
                         context->conditionalElseIfBranches),
          context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    if (AssignElseIfOrdinalsInArray(
            context,
            *(uintptr_t *)(branch + context->conditionalBranchBody),
            plan, ordinal) != 0) {
      return -1;
    }
  }
  return AssignElseIfOrdinalsInArray(
      context,
      *(uintptr_t *)(conditional + context->conditionalElseBody),
      plan, ordinal);
}

static int AssignElseIfOrdinalsInArray(
    AdapterContext *context, uintptr_t arrayWord,
    ElseIfWitnessPlan *plan, uint64_t *ordinal) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int result = 0;
    if (tag == context->statementConditional) {
      if (*ordinal > UINT32_MAX ||
          RecordElseIfConditionalOrdinal(
              plan, bridge_shortpy_ir_statement_id(statement),
              (uint32_t)*ordinal) != 0) {
        if (*ordinal > UINT32_MAX) {
          SetError("conditional group ordinal exceeded UInt32");
        }
        return -1;
      }
      (*ordinal)++;
      result = AssignElseIfOrdinalsInConditionalChildren(
          context, payload, plan, ordinal);
    } else if (tag == context->statementFunction) {
      result = AssignElseIfOrdinalsInArray(
          context, *(uintptr_t *)(payload + context->functionBody),
          plan, ordinal);
    } else if (tag == context->statementRepeat) {
      result = AssignElseIfOrdinalsInArray(
          context, *(uintptr_t *)(payload + context->repeatBody),
          plan, ordinal);
    } else if (tag == context->statementFiniteRepeat) {
      result = AssignElseIfOrdinalsInArray(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody),
          plan, ordinal);
    } else if (tag == context->statementMatch) {
      ArrayView cases;
      if (!ArrayFromWord(*(uintptr_t *)(payload + context->matchCases),
                         context->matchCase, &cases)) {
        return -1;
      }
      for (size_t caseIndex = 0; caseIndex < cases.count; caseIndex++) {
        uint8_t *matchCase =
            cases.elements + caseIndex * cases.stride;
        result = AssignElseIfOrdinalsInArray(
            context,
            *(uintptr_t *)(matchCase + context->matchCaseBody),
            plan, ordinal);
        if (result != 0) {
          break;
        }
      }
    }
    if (result != 0) {
      return result;
    }
  }
  return 0;
}

void *bridge_shortpy_prepare_else_if_witnesses(
    void *program, uint32_t *changeCount) {
  AdapterContext context;
  int64_t maximumStatementID = 0;
  bool foundStatement = false;
  uint64_t conditionalOrdinal = 0;
  if (changeCount) {
    *changeCount = 0;
  }
  if (!program || !InitializeContext(&context)) {
    return NULL;
  }
  if (FindMaximumStatementIDInArray(
          &context, *(uintptr_t *)program, &maximumStatementID,
          &foundStatement) != 0) {
    return NULL;
  }
  if (!foundStatement) {
    maximumStatementID = -1;
  }
  ElseIfWitnessPlan *plan = calloc(1, sizeof(*plan));
  if (!plan) {
    SetError("could not allocate Else If witness plan");
    return NULL;
  }
  if (PrepareElseIfWitnessesInArray(
          &context, (uintptr_t *)program, plan,
          &maximumStatementID) != 0 ||
      AssignElseIfOrdinalsInArray(
          &context, *(uintptr_t *)program, plan,
          &conditionalOrdinal) != 0) {
    DestroyElseIfWitnessPlan(plan);
    return NULL;
  }
  for (size_t entryIndex = 0; entryIndex < plan->count; entryIndex++) {
    ElseIfWitnessEntry *entry = &plan->entries[entryIndex];
    if (entry->targetOrdinal == UINT32_MAX ||
        entry->targetOrdinal < entry->witnessCount) {
      SetError("Else If target ordinal was not recovered");
      DestroyElseIfWitnessPlan(plan);
      return NULL;
    }
    uint32_t firstExpected =
        entry->targetOrdinal - (uint32_t)entry->witnessCount;
    for (size_t witnessIndex = 0;
         witnessIndex < entry->witnessCount; witnessIndex++) {
      if (entry->witnessOrdinals[witnessIndex] !=
          firstExpected + witnessIndex) {
        SetError("Else If witnesses were not contiguous before their target");
        DestroyElseIfWitnessPlan(plan);
        return NULL;
      }
    }
  }
  if (changeCount) {
    *changeCount = (uint32_t)plan->witnessCount;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace),
           "else_if_targets=%zu witnesses=%zu "
           "insertion=terminal_in_place constructor=value_witnesses",
           plan->count, plan->witnessCount);
  return plan;
}

void bridge_shortpy_destroy_else_if_witness_plan(void *opaquePlan) {
  DestroyElseIfWitnessPlan((ElseIfWitnessPlan *)opaquePlan);
}

uint32_t bridge_shortpy_else_if_witness_entry_count(
    const void *opaquePlan) {
  const ElseIfWitnessPlan *plan = opaquePlan;
  return plan && plan->count <= UINT32_MAX
      ? (uint32_t)plan->count : UINT32_MAX;
}

uint32_t bridge_shortpy_else_if_target_ordinal(
    const void *opaquePlan, uint32_t entryIndex) {
  const ElseIfWitnessPlan *plan = opaquePlan;
  return plan && entryIndex < plan->count
      ? plan->entries[entryIndex].targetOrdinal : UINT32_MAX;
}

uint32_t bridge_shortpy_else_if_witness_count(
    const void *opaquePlan, uint32_t entryIndex) {
  const ElseIfWitnessPlan *plan = opaquePlan;
  return plan && entryIndex < plan->count &&
                 plan->entries[entryIndex].witnessCount <= UINT32_MAX
      ? (uint32_t)plan->entries[entryIndex].witnessCount : UINT32_MAX;
}

uint32_t bridge_shortpy_else_if_witness_ordinal(
    const void *opaquePlan, uint32_t entryIndex,
    uint32_t witnessIndex) {
  const ElseIfWitnessPlan *plan = opaquePlan;
  if (!plan || entryIndex >= plan->count) {
    return UINT32_MAX;
  }
  const ElseIfWitnessEntry *entry = &plan->entries[entryIndex];
  return witnessIndex < entry->witnessCount
      ? entry->witnessOrdinals[witnessIndex] : UINT32_MAX;
}
