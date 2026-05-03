cmake_minimum_required(VERSION 3.24)
project(compwas-gamut-wasm VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This project must be configured with emcmake (Emscripten).")
endif()

# ── nlohmann/json ────────────────────────────────────────────────────────────
# Symlink the host-system nlohmann/ dir into the build tree so Emscripten's
# sysroot doesn't try to pull in host glibc headers alongside it.
find_path(NLOHMANN_JSON_SRC
  NAMES nlohmann/json.hpp
  PATHS /usr/include /usr/local/include
  NO_CMAKE_FIND_ROOT_PATH
  NO_DEFAULT_PATH)
if(NOT NLOHMANN_JSON_SRC)
  message(FATAL_ERROR "nlohmann/json.hpp not found — install nlohmann-json3-dev")
endif()
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/third-party")
file(CREATE_LINK
  "${NLOHMANN_JSON_SRC}/nlohmann"
  "${CMAKE_CURRENT_BINARY_DIR}/third-party/nlohmann"
  SYMBOLIC)

# ── lcms2 ────────────────────────────────────────────────────────────────────
# Compile all lcms2 .c sources directly into the WASM target so we get full
# linker dead-code elimination without an intermediate static library step.
file(GLOB LCMS2_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/third-party/lcms2/src/*.c")
if(NOT LCMS2_SOURCES)
  message(FATAL_ERROR "lcms2 sources not found — run: git submodule update --init --recursive")
endif()

# ── compwas-gamut target ─────────────────────────────────────────────────────
add_executable(compwas-gamut gamut-wrapper.cpp ${LCMS2_SOURCES})

target_include_directories(compwas-gamut PRIVATE
  "${CMAKE_CURRENT_BINARY_DIR}/third-party"
  "${CMAKE_CURRENT_SOURCE_DIR}/third-party/lcms2/include")

target_compile_options(compwas-gamut PRIVATE
  -O3
  -fexceptions)

target_link_options(compwas-gamut PRIVATE
  -O3
  -fexceptions
  -lembind
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createGamutModule
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=32MB
  -sMAXIMUM_MEMORY=512MB
  -sSTACK_SIZE=1MB
  # CSP-safe: no eval() / new Function()
  -sDYNAMIC_EXECUTION=0
  # Unwrap embind CppException → .what() on the JS side
  -sEXPORTED_RUNTIME_METHODS=getExceptionMessage,decrementExceptionRefcount)

set_target_properties(compwas-gamut PROPERTIES SUFFIX ".mjs")
