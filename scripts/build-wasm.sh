#!/usr/bin/env bash
# build-wasm.sh — compile the compwas gamut WASM module via Emscripten.
#
# Run from WSL:
#   cd /mnt/c/Users/colou/code/compwas
#   scripts/build-wasm.sh
#
# Prerequisites (WSL):
#   source ~/emsdk-install/emsdk/emsdk_env.sh   (or let this script do it)
#   sudo apt install nlohmann-json3-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GAMUT_WASM_DIR="$PROJECT_ROOT/gamut-wasm"
BUILD_DIR="$GAMUT_WASM_DIR/build"
OUT_DIR="$PROJECT_ROOT/public/wasm"

echo "=== compwas WASM build ==="
echo "Project root : $PROJECT_ROOT"
echo "Source dir   : $GAMUT_WASM_DIR"
echo "Build dir    : $BUILD_DIR"
echo "Output dir   : $OUT_DIR"
echo ""

# ── Ensure Emscripten is available ───────────────────────────────────────────
if ! command -v emcmake &>/dev/null; then
  EMSDK_ENV="$HOME/emsdk-install/emsdk/emsdk_env.sh"
  if [[ ! -f "$EMSDK_ENV" ]]; then
    echo "ERROR: emcmake not found and emsdk_env.sh not at $EMSDK_ENV"
    echo "       Install emsdk or source it manually before running this script."
    exit 1
  fi
  echo "Sourcing emsdk..."
  # shellcheck source=/dev/null
  source "$EMSDK_ENV"
fi

echo "Emscripten: $(emcc --version | head -1)"
echo ""

# ── Configure ────────────────────────────────────────────────────────────────
mkdir -p "$BUILD_DIR" "$OUT_DIR"
cd "$BUILD_DIR"

emcmake cmake "$GAMUT_WASM_DIR" \
  -DCMAKE_BUILD_TYPE=Release

# ── Build ────────────────────────────────────────────────────────────────────
emmake make -j"$(nproc)"

# ── Copy artifacts ───────────────────────────────────────────────────────────
cp compwas-gamut.mjs compwas-gamut.wasm "$OUT_DIR/"

echo ""
echo "=== Build complete ==="
ls -lh "$OUT_DIR"/compwas-gamut.*
