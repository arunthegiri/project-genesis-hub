#!/bin/bash
set -e

# Portable core count: nproc on Linux, sysctl on macOS, fallback to 4.
if command -v nproc >/dev/null 2>&1; then
    JOBS=$(nproc)
elif command -v sysctl >/dev/null 2>&1; then
    JOBS=$(sysctl -n hw.ncpu)
else
    JOBS=4
fi

mkdir -p build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j"${JOBS}"
echo "Build complete: build/hermes"
