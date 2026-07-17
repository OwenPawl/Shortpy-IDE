RUNTIME_RESOLVER := "$(CURDIR)/tools/resolve_sim_runtime_root.py" $(if $(SIM_RUNTIME_BUILD),--build $(SIM_RUNTIME_BUILD),)
XCODE_DEVELOPER_DIR ?= $(shell $(RUNTIME_RESOLVER) --developer-dir)
ifneq ($(strip $(XCODE_DEVELOPER_DIR)),)
export DEVELOPER_DIR := $(XCODE_DEVELOPER_DIR)
endif
XCRUN := DEVELOPER_DIR="$(XCODE_DEVELOPER_DIR)" xcrun

CC := $(XCRUN) --sdk iphonesimulator clang
SWIFTC := $(XCRUN) --sdk iphonesimulator swiftc

BUILD_DIR ?= build-sim
SDKROOT ?= $(shell $(XCRUN) --sdk iphonesimulator --show-sdk-path)
SIM_IOS_VERSION ?= $(shell $(RUNTIME_RESOLVER) --version)
TARGET ?= arm64-apple-ios$(SIM_IOS_VERSION)-simulator
SIM_RUNTIME_ROOT ?= $(shell $(RUNTIME_RESOLVER) --runtime-root)
PRIVATE_FRAMEWORKS := $(SIM_RUNTIME_ROOT)/System/Library/PrivateFrameworks
TOOLKIT_LINK_FLAGS := $(shell if [ -f "$(PRIVATE_FRAMEWORKS)/ToolKit.framework/ToolKit" ]; then printf '%s' "-Xlinker -framework -Xlinker ToolKit"; else printf '%s' "-Xlinker -undefined -Xlinker dynamic_lookup"; fi)

DYLIB := $(BUILD_DIR)/libShortcutsIDESimBridge-v020.dylib
C_BRIDGE := $(BUILD_DIR)/ShortcutsIDESimBridge.o
SHIMS := $(BUILD_DIR)/runtime_direct_shims_sim.o
OBJC_HELPERS := $(BUILD_DIR)/runtime_objc_helpers_sim.o
IR_ADAPTER := $(BUILD_DIR)/shortpy_ir_adapter_sim.o
SWIFT_SOURCE := src/ShortcutsRuntimeDirectSim.swift
OBJC_BRIDGING_HEADER := $(CURDIR)/src/runtime_objc_helpers.h
ENABLE_SHORTPY_PIPELINE ?= 1

ifeq ($(ENABLE_SHORTPY_PIPELINE),1)
SHORTPY_OBJECTS := $(IR_ADAPTER)
SHORTPY_SWIFT_FLAGS := -D SHORTPY_PIPELINE
SHORTPY_LINK_FLAGS :=
else
SHORTPY_OBJECTS :=
SHORTPY_SWIFT_FLAGS :=
SHORTPY_LINK_FLAGS := -Xlinker -undefined -Xlinker dynamic_lookup
endif

CFLAGS ?= -std=c11 -Wall -Wextra -O2 -g
TARGET_FLAGS := -target $(TARGET) -isysroot "$(SDKROOT)"
PRIVATE_LINK_FLAGS := -Xlinker -F -Xlinker "$(PRIVATE_FRAMEWORKS)" \
	-Xlinker -framework -Xlinker ShortcutsLanguage \
	-Xlinker -framework -Xlinker ShortcutsAgent \
	-Xlinker -framework -Xlinker ToolRenderer \
	$(TOOLKIT_LINK_FLAGS) \
	-Xlinker -framework -Xlinker WorkflowKit
FRAMEWORK_FLAGS := $(PRIVATE_LINK_FLAGS) -framework FoundationModels -framework Foundation

.PHONY: all clean inspect verify-symbols runtime-info

all: $(DYLIB)

$(BUILD_DIR):
	mkdir -p $@

$(C_BRIDGE): src/ShortcutsIDESimBridge.c | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) $(CFLAGS) -c -o $@ $<

$(SHIMS): src/runtime_direct_shims_sim.S | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) -c -o $@ $<

$(OBJC_HELPERS): src/runtime_objc_helpers.m $(OBJC_BRIDGING_HEADER) | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) -fobjc-arc -O2 -g -c -o $@ $<

$(IR_ADAPTER): src/shortpy/shortpy_ir_adapter.c | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) $(CFLAGS) -c -o $@ $<

$(DYLIB): $(SWIFT_SOURCE) $(OBJC_BRIDGING_HEADER) $(C_BRIDGE) $(SHIMS) $(OBJC_HELPERS) $(SHORTPY_OBJECTS) | $(BUILD_DIR)
	$(SWIFTC) -swift-version 5 -O -g -emit-library $(SHORTPY_SWIFT_FLAGS) -target $(TARGET) -sdk "$(SDKROOT)" -import-objc-header "$(OBJC_BRIDGING_HEADER)" -module-name ShortcutsIDESimBridge -o $@ $(SWIFT_SOURCE) $(C_BRIDGE) $(SHIMS) $(OBJC_HELPERS) $(SHORTPY_OBJECTS) $(FRAMEWORK_FLAGS) $(SHORTPY_LINK_FLAGS)
	codesign --force --sign - $@

inspect: $(DYLIB)
	file $(DYLIB)
	otool -L $(DYLIB)
	nm -u $(DYLIB) | sort

verify-symbols: $(DYLIB)
	"$(CURDIR)/tools/verify_runtime_symbols.py" --dylib "$(DYLIB)" --runtime-root "$(SIM_RUNTIME_ROOT)"

runtime-info:
	$(RUNTIME_RESOLVER) --json

clean:
	rm -rf $(BUILD_DIR)
