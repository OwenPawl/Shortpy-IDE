PRODUCT := build/headless-shortcuts
SOURCES := Sources/HeadlessShortcuts/main.swift

.PHONY: all clean

all: $(PRODUCT)

$(PRODUCT): $(SOURCES)
	mkdir -p build
	swiftc -warnings-as-errors -framework Foundation $(SOURCES) -o $(PRODUCT)

clean:
	rm -rf build
