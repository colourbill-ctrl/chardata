cmake_minimum_required(VERSION 3.24)
project(chardata-icc-viewer VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This project must be configured with emcmake (Emscripten).")
endif()

# ── Locate iccDEV source ────────────────────────────────────────────────────
# Same default as ~/code/profiletool/validator-wasm — overridable via -DICCDEV_ROOT.
set(ICCDEV_ROOT "/home/colour/code/iccdev" CACHE PATH "Root of iccDEV source tree")
set(ICCPROFLIB_DIR "${ICCDEV_ROOT}/IccProfLib")

if(NOT EXISTS "${ICCPROFLIB_DIR}/IccProfile.h")
  message(FATAL_ERROR "IccProfLib headers not found at ${ICCPROFLIB_DIR}")
endif()

# Mirror Build/Cmake/IccProfLib/CMakeLists.txt's authoritative source list.
set(ICCPROFLIB_SOURCES
  IccApplyBPC.cpp IccArrayBasic.cpp IccArrayFactory.cpp IccCAM.cpp IccCmm.cpp
  IccConvertUTF.cpp IccEncoding.cpp IccEnvVar.cpp IccEval.cpp IccIO.cpp
  IccMatrixMath.cpp IccMpeACS.cpp IccMpeBasic.cpp IccMpeCalc.cpp IccMpeFactory.cpp
  IccMpeSpectral.cpp IccPrmg.cpp IccPcc.cpp IccProfile.cpp IccSolve.cpp
  IccSparseMatrix.cpp IccStructBasic.cpp IccStructFactory.cpp IccTagBasic.cpp
  IccTagComposite.cpp IccTagDict.cpp IccTagEmbedIcc.cpp IccTagFactory.cpp
  IccTagLut.cpp IccTagMPE.cpp IccTagProfSeqId.cpp IccUtil.cpp IccXformFactory.cpp
  IccMD5.cpp IccCmmSearch.cpp)

list(TRANSFORM ICCPROFLIB_SOURCES PREPEND "${ICCPROFLIB_DIR}/")

set(ICCPROFLIB_VERSION_STRING "${PROJECT_VERSION}-wasm")
configure_file(
  "${ICCPROFLIB_DIR}/IccProfLibVer.h.in"
  "${CMAKE_CURRENT_BINARY_DIR}/generated/IccProfLibVer.h"
  @ONLY)

# ── nlohmann/json (symlinked from host install) ─────────────────────────────
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

# ── Target ──────────────────────────────────────────────────────────────────
add_executable(icc-viewer wrapper.cpp ${ICCPROFLIB_SOURCES})

target_include_directories(icc-viewer PRIVATE
  "${ICCPROFLIB_DIR}"
  "${CMAKE_CURRENT_BINARY_DIR}/generated"
  "${CMAKE_CURRENT_BINARY_DIR}/third-party")

target_compile_options(icc-viewer PRIVATE
  -O3
  -fexceptions
  -Wno-deprecated-declarations)

target_link_options(icc-viewer PRIVATE
  -O3
  -fexceptions
  -lembind
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createIccViewerModule
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=16MB
  -sMAXIMUM_MEMORY=512MB
  -sSTACK_SIZE=1MB
  # CSP-safe: no eval() / new Function() — matches chardata-gamut.
  -sDYNAMIC_EXECUTION=0)

set_target_properties(icc-viewer PROPERTIES SUFFIX ".mjs")
