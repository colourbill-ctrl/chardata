#!/usr/bin/env bash
# build-icc-viewer-wasm.sh — compile the chardata ICC viewer WASM module via Emscripten.
#
# Builds IccProfLib (from iccDEV) into a standalone .mjs/.wasm pair, lazy-loaded
# by index.html when the user clicks "Display File" on an ICC profile slot.
#
# Run from WSL:
#   scripts/build-icc-viewer-wasm.sh
#
# Prerequisites (WSL):
#   source ~/emsdk-install/emsdk/emsdk_env.sh   (or let this script do it)
#   sudo apt install nlohmann-json3-dev
#   iccDEV source at /home/colour/code/iccdev   (override with ICCDEV_ROOT=...)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$PROJECT_ROOT/icc-viewer-wasm"
BUILD_DIR="$SRC_DIR/build"
OUT_DIR="$PROJECT_ROOT/public/wasm"
ICCDEV_ROOT="${ICCDEV_ROOT:-/home/colour/code/iccdev}"

echo "=== chardata icc-viewer WASM build ==="
echo "Project root : $PROJECT_ROOT"
echo "iccDEV root  : $ICCDEV_ROOT"
echo "Source dir   : $SRC_DIR"
echo "Build dir    : $BUILD_DIR"
echo "Output dir   : $OUT_DIR"
echo ""

if ! command -v emcmake &>/dev/null; then
  EMSDK_ENV="$HOME/emsdk-install/emsdk/emsdk_env.sh"
  if [[ ! -f "$EMSDK_ENV" ]]; then
    echo "ERROR: emcmake not found and emsdk_env.sh not at $EMSDK_ENV"
    exit 1
  fi
  echo "Sourcing emsdk..."
  # shellcheck source=/dev/null
  source "$EMSDK_ENV"
fi

if [[ ! -f "$ICCDEV_ROOT/IccProfLib/IccProfile.h" ]]; then
  echo "ERROR: iccDEV source not found at $ICCDEV_ROOT"
  echo "       set ICCDEV_ROOT=/path/to/iccdev"
  exit 1
fi

echo "Emscripten: $(emcc --version | head -1)"
echo ""

mkdir -p "$BUILD_DIR" "$OUT_DIR"

emcmake cmake -S "$SRC_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DICCDEV_ROOT="$ICCDEV_ROOT"

cmake --build "$BUILD_DIR" -j"$(nproc)"

cp "$BUILD_DIR/icc-viewer.mjs" "$BUILD_DIR/icc-viewer.wasm" "$OUT_DIR/"

echo ""
echo "=== Build complete ==="
ls -lh "$OUT_DIR"/icc-viewer.*
