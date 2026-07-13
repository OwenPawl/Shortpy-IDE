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
typedef const char *(*EnumCaseName)(void *value, const void *metadata);
typedef const void *(*TypeByMangledNameInContext)(
    const char *name, size_t length, const void *context,
    const void *const *genericArguments);
typedef intptr_t (*SwiftArrayCount)(uintptr_t storage,
                                   const void *elementMetadata);
typedef void *(*SwiftProjectBox)(void *box);
typedef void (*SwiftRelease)(void *object);

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
  bool hasConflictingWrite;
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
  uintptr_t *bodyStorage;
  void *appendStatement;
  const void *expressionTemplate;
  int64_t reference;
} PendingControlFlowRewrite;

typedef struct {
  PendingControlFlowRewrite *items;
  size_t count;
  size_t capacity;
} ControlFlowRewritePlan;

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
  const void *valueInterpolationPayload;
  const void *interpolationArray;
  const void *interpolationPart;
  const void *interpolationVariablePayload;
  const void *valueListPayload;
  const void *valueListArray;
  const void *variable;
  const void *variableAtom;
  const void *statementReference;
  const void *sourceReferencedString;

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
  size_t conditionalBranchBody;
  size_t repeatBody;
  size_t finiteRepeatBody;
  size_t matchCases;
  size_t matchCaseBody;
  size_t functionCallFunctionName;
  size_t functionCallArgumentsOffset;
  size_t keywordArgumentKeyword;
  size_t keywordArgumentValue;
  size_t statementReferenceID;
  size_t sourceReferencedValue;

  EnumCaseName enumCaseName;
  SwiftArrayCount arrayCount;
} AdapterContext;

static _Thread_local char gAdapterError[512];
static _Thread_local char gAdapterTrace[256];

extern bool bridge_shortpy_swift_string_equal(const void *lhs,
                                               const void *rhs);
extern int64_t bridge_shortpy_ir_statement_id(const void *statement);
extern void bridge_shortpy_source_referenced_get_value(
    void *result, const void *sourceReferenced, const void *metadata);
extern void bridge_shortpy_array_remove_last_generic(
    uintptr_t *array, const void *elementMetadata);

static bool SameVariable(const void *lhs, const void *rhs);
static const uint8_t *ConstStatementPayload(const void *statement);

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

static const uint8_t *TypeDescriptor(const void *metadata) {
  return metadata ? (const uint8_t *)((const void *const *)metadata)[1] : NULL;
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
      !context->value || !context->valueInterpolationPayload ||
      !context->interpolationArray || !context->interpolationPart ||
      !context->interpolationVariablePayload ||
      !context->valueListPayload || !context->valueListArray ||
      !context->variable || !context->variableAtom ||
      !context->statementReference || !context->sourceReferencedString ||
      !context->enumCaseName || !context->arrayCount) {
    SetError("required ShortcutsLanguage IR metadata is unavailable");
    return false;
  }
  if (context->interpolationVariablePayload != context->variable ||
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
  const char *referenceNames[] = {"reference"};
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
      !StructFieldOffsets(context->statementReference, referenceNames, 1,
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
                                  bool hasConflictingWrite) {
  if (!context || !bindings || !sourceReferencedName) {
    return false;
  }
  if (bindings->count == bindings->capacity) {
    size_t nextCapacity = bindings->capacity ? bindings->capacity * 2 : 16;
    ControlFlowBinding *next = realloc(
        bindings->items, nextCapacity * sizeof(*bindings->items));
    if (!next) {
      SetError("could not grow control-flow binding context");
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
  binding->hasConflictingWrite = hasConflictingWrite;
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

static bool AddPendingControlFlowRewrite(ControlFlowRewritePlan *plan,
                                         uintptr_t *bodyStorage,
                                         int64_t reference) {
  if (!plan || !bodyStorage) {
    return false;
  }
  if (plan->count == plan->capacity) {
    size_t nextCapacity = plan->capacity ? plan->capacity * 2 : 8;
    PendingControlFlowRewrite *next =
        realloc(plan->items, nextCapacity * sizeof(*next));
    if (!next) {
      SetError("could not grow control-flow rewrite plan");
      return false;
    }
    plan->items = next;
    plan->capacity = nextCapacity;
  }
  plan->items[plan->count++] = (PendingControlFlowRewrite){
      .bodyStorage = bodyStorage,
      .reference = reference,
  };
  return true;
}

static bool AddPendingAppendToExpression(
    ControlFlowRewritePlan *plan, void *appendStatement,
    const void *expressionTemplate) {
  if (!plan || !appendStatement || !expressionTemplate) {
    return false;
  }
  if (plan->count == plan->capacity) {
    size_t nextCapacity = plan->capacity ? plan->capacity * 2 : 8;
    PendingControlFlowRewrite *next =
        realloc(plan->items, nextCapacity * sizeof(*next));
    if (!next) {
      SetError("could not grow control-flow rewrite plan");
      return false;
    }
    plan->items = next;
    plan->capacity = nextCapacity;
  }
  plan->items[plan->count++] = (PendingControlFlowRewrite){
      .appendStatement = appendStatement,
      .expressionTemplate = expressionTemplate,
  };
  return true;
}

static void DestroyControlFlowRewritePlan(ControlFlowRewritePlan *plan) {
  if (!plan) {
    return;
  }
  free(plan->items);
  memset(plan, 0, sizeof(*plan));
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

static void *AllocateValue(const void *metadata, uint8_t **allocation) {
  size_t size = ValueSize(metadata);
  size_t alignmentMask = ValueAlignmentMask(metadata);
  if (!metadata || !allocation || size == 0) {
    return NULL;
  }
  *allocation = calloc(1, size + alignmentMask);
  return *allocation
      ? (void *)(((uintptr_t)*allocation + alignmentMask) &
                 ~(uintptr_t)alignmentMask)
      : NULL;
}

static bool ConvertAppendToExpression(const AdapterContext *context,
                                      void *statement,
                                      void *preparedExpression,
                                      const void *expressionTemplate) {
  uint8_t *temporaryAllocation = NULL;
  void *temporary =
      AllocateValue(context->statement, &temporaryAllocation);
  ValueInitializeWithCopy copyStatement = CopyInitializer(context->statement);
  ValueInitializeWithTake takeStatement = TakeInitializer(context->statement);
  ValueDestroy destroyExpression = Destroyer(context->expression);
  ValueInitializeWithCopy copyExpression = CopyInitializer(context->expression);
  ValueDestroy destroyStatement = Destroyer(context->statement);
  if (!preparedExpression || !expressionTemplate || !temporary ||
      !copyStatement || !takeStatement || !destroyExpression ||
      !copyExpression || !destroyStatement) {
    free(temporaryAllocation);
    SetError("IR value witnesses are unavailable");
    return false;
  }
  copyStatement(temporary, expressionTemplate, context->statement);
  destroyExpression(StatementPayload(temporary), context->expression);
  copyExpression(StatementPayload(temporary), preparedExpression,
                 context->expression);
  *(int64_t *)temporary = bridge_shortpy_ir_statement_id(statement);
  const char *actual =
      ReflectedCaseName(context, temporary, context->statement);
  if (!actual || strcmp(actual, "expression") != 0) {
    destroyStatement(temporary, context->statement);
    free(temporaryAllocation);
    snprintf(gAdapterError, sizeof(gAdapterError),
             "expression template produced case '%s' after payload replacement",
             actual ? actual : "<unknown>");
    return false;
  }
  destroyStatement(statement, context->statement);
  takeStatement(statement, temporary, context->statement);
  free(temporaryAllocation);
  return true;
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

static bool ExpressionStatementReference(const AdapterContext *context,
                                         const void *expression,
                                         int64_t *reference) {
  if (!CaseNameEquals(context, expression, context->expression, "value")) {
    return false;
  }
  ProjectedValue value = {0};
  ProjectedValue variable = {0};
  ProjectedValue statementReference = {0};
  bool found = false;
  if (!ProjectPayloadCopy(expression, context->expression, "value",
                          context->value,
                          &value)) {
    goto cleanup;
  }
  const char *valueCase = ReflectedCaseName(context, value.value, context->value);
  if (!valueCase || strcmp(valueCase, "variable") != 0 ||
      !ProjectPayloadCopy(value.value, context->value, "variable",
                          context->variable,
                          &variable)) {
    goto cleanup;
  }
  const char *variableCase =
      ReflectedCaseName(context, variable.value, context->variable);
  if (!variableCase || strcmp(variableCase, "statement") != 0 ||
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

static bool ResolveAtomControlReference(
    const AdapterContext *context, const ControlFlowBindings *bindings,
    int64_t ownerStatementID, const void *expression, int64_t *reference) {
  ProjectedValue value = {0};
  ProjectedValue variable = {0};
  ProjectedValue atom = {0};
  ProjectedValue name = {0};
  bool found = false;
  if (!bindings || !reference ||
      !CaseNameEquals(context, expression, context->expression, "value") ||
      !ProjectPayloadCopy(expression, context->expression, "value",
                          context->value, &value) ||
      !CaseNameEquals(context, value.value, context->value, "variable") ||
      !ProjectPayloadCopy(value.value, context->value, "variable",
                          context->variable, &variable) ||
      !CaseNameEquals(context, variable.value, context->variable, "atom") ||
      !ProjectPayloadCopy(variable.value, context->variable, "atom",
                          context->variableAtom, &atom)) {
    goto cleanup;
  }

  const char *atomCase =
      ReflectedCaseName(context, atom.value, context->variableAtom);
  if (!atomCase ||
      (strcmp(atomCase, "custom") != 0 && strcmp(atomCase, "unknown") != 0) ||
      !ProjectPayloadCopy(atom.value, context->variableAtom, atomCase,
                          context->sourceReferencedString, &name)) {
    goto cleanup;
  }

  const void *string = SourceReferencedValue(context, name.value);
  for (size_t index = 0; index < bindings->count; index++) {
    const ControlFlowBinding *binding = &bindings->items[index];
    if (binding->ownerStatementID == ownerStatementID &&
        SameVariable(binding->name, string)) {
      *reference = binding->controlStatementID;
      found = true;
    }
  }

cleanup:
  DestroyProjectedValue(&name);
  DestroyProjectedValue(&atom);
  DestroyProjectedValue(&variable);
  DestroyProjectedValue(&value);
  return found;
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
                                     const void *name) {
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
      return bridge_shortpy_ir_statement_id(statement);
    }
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
    bool accumulatorUsesAppend = true;
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
      if (recurrenceStatus == 1) {
        int64_t seedStatementID = PrecedingAssignmentID(
            context, &statements, index, recurrence.seedName);
        if (seedStatementID != 0 &&
            !AddRecurrenceBinding(bindings, recurrence.targetName,
                                  recurrence.seedName,
                                  recurrence.targetBranchIndices,
                                  recurrence.targetBranchCount,
                                  recurrence.seedBranchIndices,
                                  recurrence.seedBranchCount,
                                  recurrence.controlKind,
                                  seedStatementID,
                                  recurrence.controlStatementID)) {
          DestroyRecurrenceCandidate(context, &recurrence);
          return -1;
        }
      }
      DestroyRecurrenceCandidate(context, &recurrence);
    }

    if (accumulator &&
        (!accumulatorUsesAppend ||
         PrecedingEmptyListAssignment(context, &statements, index,
                                      accumulator)) &&
        !AddControlFlowBinding(context, bindings, accumulator, statementID,
                               ownerStatementID,
                               accumulatorUsesAppend &&
                                   NestedBodiesHaveAssignment(
                                       context, tag, payload, accumulator))) {
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

void *bridge_shortpy_capture_control_flow_bindings(void *program) {
  AdapterContext context;
  if (!program || !InitializeContext(&context)) {
    return NULL;
  }
  ControlFlowBindings *bindings = calloc(1, sizeof(*bindings));
  if (!bindings) {
    SetError("could not allocate control-flow binding context");
    return NULL;
  }
  bindings->stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
  if (!bindings->stringMetadata ||
      CaptureBindingsArray(&context, *(uintptr_t *)program, 0, bindings) != 0) {
    DestroyControlFlowBindings(bindings);
    return NULL;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace),
           "bindings=%zu recurrences=%zu", bindings->count,
           bindings->recurrenceCount);
  return bindings;
}

void bridge_shortpy_destroy_control_flow_bindings(void *opaqueBindings) {
  DestroyControlFlowBindings((ControlFlowBindings *)opaqueBindings);
}

uint32_t bridge_shortpy_control_flow_binding_count(
    const void *opaqueBindings) {
  const ControlFlowBindings *bindings = opaqueBindings;
  return bindings
      ? (uint32_t)(bindings->count + bindings->recurrenceCount)
      : 0;
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

int bridge_shortpy_prepare_loop_carried_recurrences(
    void *program, const void *opaqueBindings, uint32_t *changeCount) {
  AdapterContext context;
  const ControlFlowBindings *bindings = opaqueBindings;
  uint32_t changes = 0;
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
      SetError("loop-carried seed binding changed before recurrence pass");
      return -1;
    }

    const void *stringMetadata = dlsym(RTLD_DEFAULT, "$sSSN");
    ValueDestroy destroy = Destroyer(stringMetadata);
    ValueInitializeWithCopy copy = CopyInitializer(stringMetadata);
    if (!stringMetadata || !destroy || !copy) {
      SetError("Swift String value witnesses are unavailable");
      return -1;
    }
    destroy(seedName, stringMetadata);
    copy(seedName, binding->targetName, stringMetadata);

    int result = FindAndPrepareControlRecurrence(
        &context, *(uintptr_t *)program, binding);
    if (result < 0) {
      return -1;
    }
    if (result == 0) {
      SetError("captured loop-carried recurrence was not found after passes");
      return -1;
    }
    if (result == 1) {
      SetError("captured recurrence had no seed reference to prepare");
      return -1;
    }
    changes += (uint32_t)result;
  }
  if (changeCount) {
    *changeCount = changes;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace), "recurrence_rewrites=%u",
           changes);
  return 0;
}

static bool BodyContainsControlStatement(const AdapterContext *context,
                                         uintptr_t bodyWord,
                                         int64_t reference) {
  ArrayView statements;
  if (!ArrayFromWord(bodyWord, context->statement, &statements)) {
    return false;
  }
  for (size_t index = 0; index < statements.count; index++) {
    const void *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    if ((tag == context->statementConditional ||
         tag == context->statementRepeat ||
         tag == context->statementFiniteRepeat ||
         tag == context->statementMatch) &&
        bridge_shortpy_ir_statement_id(statement) == reference) {
      return true;
    }
  }
  return false;
}

static const void *FindExpressionTemplateInArray(AdapterContext *context,
                                                 uintptr_t arrayWord);

static const void *FindExpressionTemplateInConditional(
    AdapterContext *context, void *conditional) {
  uint8_t *ifBranch =
      (uint8_t *)conditional + context->conditionalIfBranch;
  const void *result = FindExpressionTemplateInArray(
      context, *(uintptr_t *)(ifBranch + context->conditionalBranchBody));
  if (result) {
    return result;
  }
  ArrayView branches;
  if (!ArrayFromWord(*(uintptr_t *)((uint8_t *)conditional +
                                   context->conditionalElseIfBranches),
                     context->conditionalBranch, &branches)) {
    return NULL;
  }
  for (size_t index = 0; index < branches.count && !result; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    result = FindExpressionTemplateInArray(
        context, *(uintptr_t *)(branch + context->conditionalBranchBody));
  }
  return result ? result : FindExpressionTemplateInArray(
                               context,
                               *(uintptr_t *)((uint8_t *)conditional +
                                              context->conditionalElseBody));
}

static const void *FindExpressionTemplateInMatch(AdapterContext *context,
                                                 void *match) {
  ArrayView cases;
  if (!ArrayFromWord(*(uintptr_t *)((uint8_t *)match + context->matchCases),
                     context->matchCase, &cases)) {
    return NULL;
  }
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    const void *result = FindExpressionTemplateInArray(
        context, *(uintptr_t *)(matchCase + context->matchCaseBody));
    if (result) {
      return result;
    }
  }
  return NULL;
}

static const void *FindExpressionTemplateInArray(AdapterContext *context,
                                                 uintptr_t arrayWord) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return NULL;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    if (tag == context->statementExpression) {
      return statement;
    }
    const void *result = NULL;
    if (tag == context->statementFunction) {
      result = FindExpressionTemplateInArray(
          context, *(uintptr_t *)(payload + context->functionBody));
    } else if (tag == context->statementConditional) {
      result = FindExpressionTemplateInConditional(context, payload);
    } else if (tag == context->statementRepeat) {
      result = FindExpressionTemplateInArray(
          context, *(uintptr_t *)(payload + context->repeatBody));
    } else if (tag == context->statementFiniteRepeat) {
      result = FindExpressionTemplateInArray(
          context, *(uintptr_t *)(payload + context->finiteRepeatBody));
    } else if (tag == context->statementMatch) {
      result = FindExpressionTemplateInMatch(context, payload);
    }
    if (result) {
      return result;
    }
  }
  return NULL;
}

static int PlanNestedArray(AdapterContext *context, uintptr_t arrayWord,
                           int64_t ownerStatementID,
                           const ControlFlowBindings *bindings,
                           const void *expressionTemplate,
                           ControlFlowRewritePlan *plan);

static const ControlFlowBinding *BindingForControl(
    const ControlFlowBindings *bindings, int64_t controlStatementID) {
  for (size_t index = 0; bindings && index < bindings->count; index++) {
    if (bindings->items[index].controlStatementID == controlStatementID) {
      return &bindings->items[index];
    }
  }
  return NULL;
}

static int PlanControlAssignmentTail(
    AdapterContext *context, uintptr_t *bodyStorage,
    int64_t controlStatementID, const ControlFlowBindings *bindings,
    ControlFlowRewritePlan *plan) {
  uintptr_t bodyWord = bodyStorage ? *bodyStorage : 0;
  ArrayView body;
  void *last = LastStatement(context, bodyWord, &body);
  if (!last || StatementTag(context, last) != context->statementAssignment) {
    return 0;
  }
  const ControlFlowBinding *binding =
      BindingForControl(bindings, controlStatementID);
  uint8_t *assignment = StatementPayload(last);
  if (!binding ||
      !SameVariable(binding->name,
                    assignment + context->assignmentVariable)) {
    return 0;
  }
  int64_t reference = 0;
  bool hasReference = ExpressionStatementReference(
      context, assignment + context->assignmentExpression, &reference);
  if (!hasReference) {
    hasReference = ResolveAtomControlReference(
        context, bindings, controlStatementID,
        assignment + context->assignmentExpression, &reference);
  }
  if (!hasReference ||
      !BodyContainsControlStatement(context, bodyWord, reference)) {
    return 0;
  }
  return AddPendingControlFlowRewrite(plan, bodyStorage, reference) ? 0 : -1;
}

static int PlanNestedConditional(AdapterContext *context, void *conditional,
                                 int64_t conditionalStatementID,
                                 const ControlFlowBindings *bindings,
                                 const void *expressionTemplate,
                                 ControlFlowRewritePlan *plan) {
  uint8_t *ifBranch =
      (uint8_t *)conditional + context->conditionalIfBranch;
  uintptr_t *ifBody =
      (uintptr_t *)(ifBranch + context->conditionalBranchBody);
  uintptr_t *elseBody =
      (uintptr_t *)((uint8_t *)conditional + context->conditionalElseBody);
  if (PlanControlAssignmentTail(context, ifBody, conditionalStatementID,
                                bindings, plan) != 0 ||
      PlanNestedArray(
          context, *ifBody,
          conditionalStatementID, bindings, expressionTemplate, plan) != 0 ||
      PlanControlAssignmentTail(context, elseBody, conditionalStatementID,
                                bindings, plan) != 0 ||
      PlanNestedArray(
          context, *elseBody,
          conditionalStatementID, bindings, expressionTemplate, plan) != 0) {
    return -1;
  }
  ArrayView branches;
  if (!ArrayFromWord(*(uintptr_t *)((uint8_t *)conditional +
                                   context->conditionalElseIfBranches),
                     context->conditionalBranch, &branches)) {
    return -1;
  }
  for (size_t index = 0; index < branches.count; index++) {
    uint8_t *branch = branches.elements + index * branches.stride;
    uintptr_t *body =
        (uintptr_t *)(branch + context->conditionalBranchBody);
    if (PlanControlAssignmentTail(context, body, conditionalStatementID,
                                  bindings, plan) != 0 ||
        PlanNestedArray(
            context, *body,
            conditionalStatementID, bindings, expressionTemplate, plan) != 0) {
      return -1;
    }
  }
  return 0;
}

static int PlanNestedMatch(AdapterContext *context, void *match,
                           int64_t matchStatementID,
                           const ControlFlowBindings *bindings,
                           const void *expressionTemplate,
                           ControlFlowRewritePlan *plan) {
  ArrayView cases;
  if (!ArrayFromWord(*(uintptr_t *)((uint8_t *)match + context->matchCases),
                     context->matchCase, &cases)) {
    return -1;
  }
  for (size_t index = 0; index < cases.count; index++) {
    uint8_t *matchCase = cases.elements + index * cases.stride;
    uintptr_t *body = (uintptr_t *)(matchCase + context->matchCaseBody);
    if (PlanControlAssignmentTail(context, body, matchStatementID, bindings,
                                  plan) != 0 ||
        PlanNestedArray(
            context, *body,
            matchStatementID, bindings, expressionTemplate, plan) != 0) {
      return -1;
    }
  }
  return 0;
}

static int PlanRepeatTail(AdapterContext *context, uintptr_t *bodyStorage,
                          int64_t ownerStatementID,
                          int64_t repeatStatementID,
                          const ControlFlowBindings *bindings,
                          const void *expressionTemplate,
                          ControlFlowRewritePlan *plan) {
  uintptr_t bodyWord = bodyStorage ? *bodyStorage : 0;
  ArrayView body;
  void *last = LastStatement(context, bodyWord, &body);
  if (!last || StatementTag(context, last) != context->statementAppend) {
    return 0;
  }
  uint8_t *append = StatementPayload(last);
  int64_t reference = 0;
  const ControlFlowBinding *binding =
      BindingForControl(bindings, repeatStatementID);
  bool hasBinding = binding && binding->ownerStatementID == ownerStatementID &&
                    SameVariable(binding->name,
                                 append + context->appendVariable);
  bool hasWrite = binding && binding->hasConflictingWrite;
  bool hasReference = ExpressionStatementReference(
      context, append + context->appendExpression, &reference);
  bool atomReference = false;
  if (!hasReference) {
    atomReference = ResolveAtomControlReference(
        context, bindings, repeatStatementID,
        append + context->appendExpression, &reference);
    hasReference = atomReference;
  }
  bool containsReference =
      hasReference && BodyContainsControlStatement(context, bodyWord, reference);
  if (!hasBinding || hasWrite) {
    return 0;
  }
  if (hasReference && containsReference) {
    return AddPendingControlFlowRewrite(plan, bodyStorage, reference) ? 0 : -1;
  }
  if (!expressionTemplate) {
    SetError("repeat result action requires a native IR expression template");
    return -1;
  }
  return AddPendingAppendToExpression(plan, last, expressionTemplate) ? 0 : -1;
}

static int PlanNestedArray(AdapterContext *context, uintptr_t arrayWord,
                           int64_t ownerStatementID,
                           const ControlFlowBindings *bindings,
                           const void *expressionTemplate,
                           ControlFlowRewritePlan *plan) {
  ArrayView statements;
  if (!ArrayFromWord(arrayWord, context->statement, &statements)) {
    return -1;
  }
  for (size_t index = 0; index < statements.count; index++) {
    uint8_t *statement = statements.elements + index * statements.stride;
    unsigned tag = StatementTag(context, statement);
    uint8_t *payload = StatementPayload(statement);
    int64_t statementID = bridge_shortpy_ir_statement_id(statement);
    if (tag == context->statementFunction) {
      uintptr_t body = *(uintptr_t *)(payload + context->functionBody);
      if (PlanNestedArray(context, body, statementID, bindings,
                          expressionTemplate, plan) != 0) {
        return -1;
      }
    } else if (tag == context->statementConditional) {
      if (PlanNestedConditional(context, payload, statementID, bindings,
                                expressionTemplate, plan) != 0) {
        return -1;
      }
    } else if (tag == context->statementRepeat) {
      uintptr_t *bodyStorage =
          (uintptr_t *)(payload + context->repeatBody);
      uintptr_t body = *bodyStorage;
      if (PlanRepeatTail(context, bodyStorage, ownerStatementID, statementID,
                         bindings, expressionTemplate, plan) != 0 ||
          PlanNestedArray(context, body, statementID, bindings,
                          expressionTemplate, plan) != 0) {
        return -1;
      }
    } else if (tag == context->statementFiniteRepeat) {
      uintptr_t *bodyStorage =
          (uintptr_t *)(payload + context->finiteRepeatBody);
      uintptr_t body = *bodyStorage;
      if (PlanRepeatTail(context, bodyStorage, ownerStatementID, statementID,
                         bindings, expressionTemplate, plan) != 0 ||
          PlanNestedArray(context, body, statementID, bindings,
                          expressionTemplate, plan) != 0) {
        return -1;
      }
    } else if (tag == context->statementMatch) {
      if (PlanNestedMatch(context, payload, statementID, bindings,
                          expressionTemplate, plan) != 0) {
        return -1;
      }
    }
  }
  return 0;
}

int bridge_shortpy_rewrite_nested_control_flow_results(
    void *program, const void *opaqueBindings, uint32_t *changeCount) {
  AdapterContext context;
  uint32_t changes = 0;
  if (!program || !opaqueBindings || !InitializeContext(&context)) {
    return -1;
  }
  ControlFlowRewritePlan plan = {0};
  uint32_t conversions = 0;
  uint32_t removals = 0;
  uintptr_t body = *(uintptr_t *)program;
  const void *expressionTemplate =
      FindExpressionTemplateInArray(&context, body);
  if (PlanNestedArray(&context, body, 0, opaqueBindings,
                      expressionTemplate, &plan) != 0) {
    DestroyControlFlowRewritePlan(&plan);
    return -1;
  }
  for (size_t index = 0; index < plan.count; index++) {
    PendingControlFlowRewrite *rewrite = &plan.items[index];
    if (!rewrite->appendStatement) {
      continue;
    }
    uint8_t *append = StatementPayload(rewrite->appendStatement);
    if (!ConvertAppendToExpression(
            &context, rewrite->appendStatement,
            append + context.appendExpression,
            rewrite->expressionTemplate)) {
      DestroyControlFlowRewritePlan(&plan);
      return -1;
    }
    changes++;
    conversions++;
  }
  for (size_t index = plan.count; index > 0; index--) {
    PendingControlFlowRewrite *rewrite = &plan.items[index - 1];
    if (!rewrite->bodyStorage) {
      continue;
    }
    bridge_shortpy_array_remove_last_generic(rewrite->bodyStorage,
                                             context.statement);
    changes++;
    removals++;
  }
  DestroyControlFlowRewritePlan(&plan);
  if (changeCount) {
    *changeCount = changes;
  }
  snprintf(gAdapterTrace, sizeof(gAdapterTrace),
           "conversions=%u removals=%u", conversions, removals);
  return 0;
}
