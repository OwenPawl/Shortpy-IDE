CC ?= xcrun --sdk iphonesimulator clang
SWIFTC ?= xcrun --sdk iphonesimulator swiftc

BUILD_DIR ?= build-sim
TARGET ?= arm64-apple-ios27.0-simulator
SDKROOT ?= $(shell xcrun --sdk iphonesimulator --show-sdk-path)
SIM_RUNTIME_ROOT ?= /Library/Developer/CoreSimulator/Volumes/iOS_24A5355p/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot
PRIVATE_FRAMEWORKS := $(SIM_RUNTIME_ROOT)/System/Library/PrivateFrameworks

DYLIB := $(BUILD_DIR)/libShortcutsIDESimBridge-v019.dylib
C_BRIDGE := $(BUILD_DIR)/ShortcutsIDESimBridge.o
SHIMS := $(BUILD_DIR)/runtime_direct_shims_sim.o
OBJC_HELPERS := $(BUILD_DIR)/runtime_objc_helpers_sim.o
SWIFT_SOURCE := src/ShortcutsRuntimeDirectSim.swift

CFLAGS ?= -std=c11 -Wall -Wextra -O2 -g
TARGET_FLAGS := -target $(TARGET) -isysroot "$(SDKROOT)"
PRIVATE_LINK_FLAGS := -Xlinker -F -Xlinker "$(PRIVATE_FRAMEWORKS)" \
	-Xlinker -framework -Xlinker ShortcutsLanguage \
	-Xlinker -framework -Xlinker ShortcutsAgent \
	-Xlinker -framework -Xlinker ToolRenderer \
	-Xlinker -framework -Xlinker ToolKit \
	-Xlinker -framework -Xlinker WorkflowKit
FRAMEWORK_FLAGS := $(PRIVATE_LINK_FLAGS) -framework FoundationModels -framework Foundation

.PHONY: all clean inspect

all: $(DYLIB)

$(BUILD_DIR):
	mkdir -p $@

$(C_BRIDGE): src/ShortcutsIDESimBridge.c | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) $(CFLAGS) -c -o $@ $<

$(SHIMS): src/runtime_direct_shims_sim.S | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) -c -o $@ $<

$(OBJC_HELPERS): src/runtime_objc_helpers.m | $(BUILD_DIR)
	$(CC) $(TARGET_FLAGS) -fobjc-arc -O2 -g -c -o $@ $<

$(DYLIB): $(SWIFT_SOURCE) $(C_BRIDGE) $(SHIMS) $(OBJC_HELPERS) | $(BUILD_DIR)
	$(SWIFTC) -swift-version 5 -O -g -emit-library -target $(TARGET) -sdk "$(SDKROOT)" -module-name ShortcutsIDESimBridge -o $@ $(SWIFT_SOURCE) $(C_BRIDGE) $(SHIMS) $(OBJC_HELPERS) $(FRAMEWORK_FLAGS)
	codesign --force --sign - $@

inspect: $(DYLIB)
	file $(DYLIB)
	otool -L $(DYLIB)
	nm -u $(DYLIB) | sort

clean:
	rm -rf $(BUILD_DIR)
