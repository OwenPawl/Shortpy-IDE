PRODUCT := build/headless-shortcuts
SOURCES := Sources/HeadlessShortcuts/main.swift
ARCH ?= $(shell uname -m)
MACOSX_DEPLOYMENT_TARGET ?= 26.0
SWIFTC ?= xcrun swiftc

.PHONY: all clean

all: $(PRODUCT)

$(PRODUCT): $(SOURCES)
	mkdir -p build
	$(SWIFTC) -warnings-as-errors -target $(ARCH)-apple-macosx$(MACOSX_DEPLOYMENT_TARGET) -framework Foundation $(SOURCES) -o $(PRODUCT)

clean:
	rm -rf build
