cmake_minimum_required(VERSION 3.20)
project(Hermes VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ---------------------------------------------------------------------------
# Homebrew keg-only prefixes (macOS). These let find_package / find_library
# locate openssl, postgresql and libpqxx that brew does not symlink globally.
# ---------------------------------------------------------------------------
if(APPLE)
    foreach(_pkg openssl@3 postgresql@16 libpqxx libpq)
        execute_process(
            COMMAND brew --prefix ${_pkg}
            OUTPUT_VARIABLE _prefix
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_QUIET)
        if(_prefix)
            list(APPEND CMAKE_PREFIX_PATH "${_prefix}")
        endif()
    endforeach()
endif()

# ---------------------------------------------------------------------------
# Threads (always required)
# ---------------------------------------------------------------------------
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)

# ---------------------------------------------------------------------------
# FetchContent dependencies
# ---------------------------------------------------------------------------
include(FetchContent)

# nlohmann/json — JSON parsing (header-only, well-behaved CMake)
FetchContent_Declare(json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3)

# cpp-httplib — HTTP client and server (header-only)
FetchContent_Declare(httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG v0.14.3)

FetchContent_MakeAvailable(json httplib)

# websocketpp — WebSocket client for the Alpaca feed.
# websocketpp's own CMakeLists pulls in Boost and builds tests, so we only
# populate the sources and expose its (header-only) include directory.
FetchContent_Declare(websocketpp
    GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
    GIT_TAG 0.8.2)
FetchContent_GetProperties(websocketpp)
if(NOT websocketpp_POPULATED)
    FetchContent_Populate(websocketpp)
endif()

# ---------------------------------------------------------------------------
# ONNX Runtime (inference — Part 4). Optional: when the prebuilt runtime is
# not present we still build Parts 1-2 (config / build system) without it.
# Install: download onnxruntime-osx-arm64-1.18.0.tgz from
#   https://github.com/microsoft/onnxruntime/releases
# and extract to ${ONNXRUNTIME_ROOT}.
# ---------------------------------------------------------------------------
set(ONNXRUNTIME_ROOT "/usr/local/onnxruntime" CACHE PATH "ONNX Runtime root")
if(EXISTS "${ONNXRUNTIME_ROOT}/include")
    set(HERMES_HAVE_ONNX ON)
    # On macOS, verify the runtime's architecture matches the build target.
    # A mismatch (e.g. an arm64 runtime on an x86_64 toolchain) links silently
    # now — because nothing references ONNX yet — but breaks at Part 4.
    if(APPLE)
        set(_onnx_lib "${ONNXRUNTIME_ROOT}/lib/libonnxruntime.dylib")
        if(EXISTS "${_onnx_lib}")
            execute_process(COMMAND lipo -archs "${_onnx_lib}"
                OUTPUT_VARIABLE _onnx_arch
                OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
            set(_target_arch "${CMAKE_SYSTEM_PROCESSOR}")
            if(_onnx_arch AND NOT _onnx_arch MATCHES "${_target_arch}")
                set(HERMES_HAVE_ONNX OFF)
                message(WARNING
                    "Hermes: ONNX Runtime at ${ONNXRUNTIME_ROOT} is '${_onnx_arch}' "
                    "but the build target is '${_target_arch}'. Disabling inference. "
                    "Install the ${_target_arch} ONNX Runtime for Part 4.")
            endif()
        endif()
    endif()
    if(HERMES_HAVE_ONNX)
        message(STATUS "Hermes: ONNX Runtime found at ${ONNXRUNTIME_ROOT}")
    endif()
else()
    set(HERMES_HAVE_ONNX OFF)
    message(WARNING
        "Hermes: ONNX Runtime not found at ${ONNXRUNTIME_ROOT}. "
        "Building without inference (Parts 1-2 only). "
        "Inference (Part 4) requires the prebuilt runtime.")
endif()

# ---------------------------------------------------------------------------
# System dependencies (Parts 6-7). Optional for the Parts 1-2 build.
#   OpenSSL    — HTTPS / WSS
#   PostgreSQL — TimescaleDB client
#   libpqxx    — C++ PostgreSQL wrapper
# ---------------------------------------------------------------------------
find_package(OpenSSL)
find_package(PostgreSQL)
find_library(PQXX_LIB pqxx)
find_path(PQXX_INCLUDE_DIR pqxx/pqxx)

# ---------------------------------------------------------------------------
# Source files. Uncomment each entry as the corresponding Part is built.
# Currently implemented: Part 1 (build system) + Part 2 (EngineConfig).
# ---------------------------------------------------------------------------
set(HERMES_SOURCES
    src/main.cpp
    src/config/EngineConfig.cpp
    src/engine/FeatureCalculator.cpp    # Part 3
    # src/engine/HermesEngine.cpp       # Part 8
    # src/feed/MarketDataFeed.cpp       # Part 5
    # src/execution/OrderExecutor.cpp   # Part 6
    # src/logging/TradeLogger.cpp       # Part 7
)

# Part 4 — ONNXModel. Compiled only when the ONNX Runtime is available
# (it includes the ONNX Runtime headers).
if(HERMES_HAVE_ONNX)
    list(APPEND HERMES_SOURCES src/inference/ONNXModel.cpp)
endif()

add_executable(hermes ${HERMES_SOURCES})

target_include_directories(hermes PRIVATE
    src/
    ${websocketpp_SOURCE_DIR})

target_link_libraries(hermes PRIVATE
    nlohmann_json::nlohmann_json
    httplib::httplib
    Threads::Threads)

# ONNX Runtime (when present)
if(HERMES_HAVE_ONNX)
    target_include_directories(hermes PRIVATE "${ONNXRUNTIME_ROOT}/include")
    target_link_directories(hermes PRIVATE "${ONNXRUNTIME_ROOT}/lib")
    target_link_libraries(hermes PRIVATE onnxruntime)
    target_compile_definitions(hermes PRIVATE HERMES_HAVE_ONNX=1)
    # The runtime's install name is @rpath/...; embed the lib dir explicitly so
    # the binary runs from any working directory.
    set_target_properties(hermes PROPERTIES
        BUILD_RPATH "${ONNXRUNTIME_ROOT}/lib")
endif()

# OpenSSL (when present)
if(OpenSSL_FOUND)
    target_link_libraries(hermes PRIVATE OpenSSL::SSL OpenSSL::Crypto)
endif()

# PostgreSQL + libpqxx (when present)
if(PostgreSQL_FOUND)
    target_include_directories(hermes PRIVATE ${PostgreSQL_INCLUDE_DIRS})
    target_link_libraries(hermes PRIVATE ${PostgreSQL_LIBRARIES})
endif()
if(PQXX_LIB AND PQXX_INCLUDE_DIR)
    target_include_directories(hermes PRIVATE ${PQXX_INCLUDE_DIR})
    target_link_libraries(hermes PRIVATE ${PQXX_LIB})
endif()

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
enable_testing()

# Part 3 — FeatureCalculator parity against the Ananke Python SDK.
add_executable(test_features
    tests/test_features.cpp
    src/engine/FeatureCalculator.cpp)
target_include_directories(test_features PRIVATE src/)
target_link_libraries(test_features PRIVATE
    nlohmann_json::nlohmann_json
    Threads::Threads)
add_test(NAME features
         COMMAND test_features ${CMAKE_SOURCE_DIR}/tests/feature_fixture.json)

# Part 4 — ONNXModel inference (only when the ONNX Runtime is available).
if(HERMES_HAVE_ONNX)
    add_executable(test_inference
        tests/test_inference.cpp
        src/inference/ONNXModel.cpp
        src/config/EngineConfig.cpp)
    target_include_directories(test_inference PRIVATE
        src/ "${ONNXRUNTIME_ROOT}/include")
    target_link_directories(test_inference PRIVATE "${ONNXRUNTIME_ROOT}/lib")
    target_link_libraries(test_inference PRIVATE
        onnxruntime
        nlohmann_json::nlohmann_json
        Threads::Threads)
    set_target_properties(test_inference PROPERTIES
        BUILD_RPATH "${ONNXRUNTIME_ROOT}/lib")
    add_test(NAME inference
             COMMAND test_inference
                 ${CMAKE_SOURCE_DIR}/tests/test_model.onnx
                 ${CMAKE_SOURCE_DIR}/tests/test_contract.json)
endif()
