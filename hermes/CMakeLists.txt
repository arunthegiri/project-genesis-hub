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

# Standalone Asio — transport layer for websocketpp (Part 5). Header-only, so
# Boost is NOT required. Pinned to 1.18.2: websocketpp 0.8.2 predates Asio's
# removal of the deprecated io_service API, so a newer Asio will not compile.
FetchContent_Declare(asio
    GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
    GIT_TAG asio-1-18-2)
FetchContent_GetProperties(asio)
if(NOT asio_POPULATED)
    FetchContent_Populate(asio)
endif()
# Asio ships under <root>/asio/include; only mark it available if that exists.
if(EXISTS "${asio_SOURCE_DIR}/asio/include/asio.hpp")
    set(HERMES_HAVE_ASIO ON)
    set(ASIO_INCLUDE_DIR "${asio_SOURCE_DIR}/asio/include")
    message(STATUS "Hermes: standalone Asio at ${ASIO_INCLUDE_DIR}")
else()
    set(HERMES_HAVE_ASIO OFF)
    message(WARNING "Hermes: Asio not available — building without the market-data feed (Part 5)")
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

# libpqxx is built from source (the v7.x C++17 series) and installed to a
# dedicated keg-style prefix, because Homebrew only ships libpqxx 8.x which
# requires C++20 <source_location> — unavailable in AppleClang 14 on macOS 13.
# Override HERMES_LIBPQXX_ROOT at configure time if installed elsewhere.
set(HERMES_LIBPQXX_ROOT "/usr/local/opt/libpqxx"
    CACHE PATH "Root of a manually-installed libpqxx (7.x, C++17)")
find_library(PQXX_LIB pqxx
    HINTS "${HERMES_LIBPQXX_ROOT}/lib")
find_path(PQXX_INCLUDE_DIR pqxx/pqxx
    HINTS "${HERMES_LIBPQXX_ROOT}/include")

# ---------------------------------------------------------------------------
# Source files. Uncomment each entry as the corresponding Part is built.
# Currently implemented: Parts 1-6 (build system, config, features, ONNX,
# market-data feed, order executor).
# ---------------------------------------------------------------------------
set(HERMES_SOURCES
    src/main.cpp
    src/config/EngineConfig.cpp
    src/engine/FeatureCalculator.cpp    # Part 3
    # src/engine/HermesEngine.cpp       # Part 8
    # src/logging/TradeLogger.cpp       # Part 7
)

# Part 4 — ONNXModel. Compiled only when the ONNX Runtime is available
# (it includes the ONNX Runtime headers).
if(HERMES_HAVE_ONNX)
    list(APPEND HERMES_SOURCES src/inference/ONNXModel.cpp)
endif()

# Parts 5-6 — market-data feed and order executor. Both depend on OpenSSL
# (TLS for WSS / HTTPS). The shared Alpaca JSON parsing layer comes with them.
# The feed additionally needs an Asio transport for websocketpp; standalone
# Asio is fetched below (HERMES_HAVE_ASIO).
if(OpenSSL_FOUND)
    list(APPEND HERMES_SOURCES
        src/alpaca/AlpacaJson.cpp
        src/execution/OrderExecutor.cpp)   # Part 6
    if(HERMES_HAVE_ASIO)
        list(APPEND HERMES_SOURCES src/feed/MarketDataFeed.cpp)  # Part 5
    endif()
endif()

# Part 7 — TradeLogger. Needs libpqxx (+ libpq); skipped if not installed
# (install with `brew install libpqxx`). pqxx stays behind a PIMPL, so the rest
# of the engine still builds when libpqxx is absent.
if(PostgreSQL_FOUND AND PQXX_LIB AND PQXX_INCLUDE_DIR)
    set(HERMES_HAVE_PQXX ON)
    list(APPEND HERMES_SOURCES src/logging/TradeLogger.cpp)
    message(STATUS "Hermes: libpqxx found — building TradeLogger (Part 7)")
else()
    set(HERMES_HAVE_PQXX OFF)
    message(WARNING "Hermes: libpqxx not found — building without TradeLogger (Part 7). Install with `brew install libpqxx`.")
endif()

# Part 8 — HermesEngine. The wiring layer needs every optional dependency:
# ONNX (inference), OpenSSL + Asio (feed/executor), libpqxx (logger).
if(HERMES_HAVE_ONNX AND OpenSSL_FOUND AND HERMES_HAVE_ASIO AND HERMES_HAVE_PQXX)
    set(HERMES_HAVE_ENGINE ON)
    list(APPEND HERMES_SOURCES src/engine/HermesEngine.cpp)
    add_compile_definitions(HERMES_HAVE_ENGINE=1)  # main.cpp engine + HTTP path
    message(STATUS "Hermes: all deps present — building HermesEngine (Part 8)")
else()
    set(HERMES_HAVE_ENGINE OFF)
    message(WARNING "Hermes: missing optional deps — building without HermesEngine (Part 8)")
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

# OpenSSL (when present). Enables HTTPS in cpp-httplib (Part 6, OrderExecutor)
# and TLS for the websocketpp feed (Part 5).
if(OpenSSL_FOUND)
    target_link_libraries(hermes PRIVATE OpenSSL::SSL OpenSSL::Crypto)
    target_compile_definitions(hermes PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT=1)
endif()

# Standalone Asio for the websocketpp market-data feed (Part 5).
if(HERMES_HAVE_ASIO)
    target_include_directories(hermes PRIVATE "${ASIO_INCLUDE_DIR}")
    target_compile_definitions(hermes PRIVATE
        ASIO_STANDALONE=1
        _WEBSOCKETPP_CPP11_STL_=1
        # Asio 1.18.2 predates C++20's removal of std::result_of; force it onto
        # std::invoke_result so co_spawn.hpp compiles under -std=c++20.
        ASIO_HAS_STD_INVOKE_RESULT=1)
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
# Backtest driver — offline replay of historical bars through the real engine
# (simulated fills) -> performance stats JSON for the frontend. Needs the full
# engine, so it is gated on the same deps.
# ---------------------------------------------------------------------------
if(HERMES_HAVE_ENGINE)
    set(BACKTEST_SOURCES ${HERMES_SOURCES})
    list(REMOVE_ITEM BACKTEST_SOURCES src/main.cpp)
    list(APPEND BACKTEST_SOURCES tools/backtest_main.cpp)
    add_executable(hermes_backtest ${BACKTEST_SOURCES})
    target_include_directories(hermes_backtest PRIVATE
        src/
        ${websocketpp_SOURCE_DIR}
        "${ONNXRUNTIME_ROOT}/include"
        "${ASIO_INCLUDE_DIR}")
    target_link_directories(hermes_backtest PRIVATE "${ONNXRUNTIME_ROOT}/lib")
    target_link_libraries(hermes_backtest PRIVATE
        nlohmann_json::nlohmann_json
        httplib::httplib
        Threads::Threads
        onnxruntime
        OpenSSL::SSL OpenSSL::Crypto)
    target_compile_definitions(hermes_backtest PRIVATE
        HERMES_HAVE_ONNX=1
        CPPHTTPLIB_OPENSSL_SUPPORT=1
        ASIO_STANDALONE=1
        _WEBSOCKETPP_CPP11_STL_=1
        ASIO_HAS_STD_INVOKE_RESULT=1)
    if(PostgreSQL_FOUND)
        target_include_directories(hermes_backtest PRIVATE ${PostgreSQL_INCLUDE_DIRS})
        target_link_libraries(hermes_backtest PRIVATE ${PostgreSQL_LIBRARIES})
    endif()
    if(PQXX_LIB AND PQXX_INCLUDE_DIR)
        target_include_directories(hermes_backtest PRIVATE ${PQXX_INCLUDE_DIR})
        target_link_libraries(hermes_backtest PRIVATE ${PQXX_LIB})
    endif()
    set_target_properties(hermes_backtest PROPERTIES
        BUILD_RPATH "${ONNXRUNTIME_ROOT}/lib")
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

# Part 3 (B4) — HMMRegime causal forward filter parity against numpy.
add_executable(test_hmm
    tests/test_hmm.cpp
    src/engine/HMMRegime.cpp)
target_include_directories(test_hmm PRIVATE src/)
target_link_libraries(test_hmm PRIVATE
    nlohmann_json::nlohmann_json
    Threads::Threads)
add_test(NAME hmm
         COMMAND test_hmm ${CMAKE_SOURCE_DIR}/tests/hmm_fixture.json)

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

# Parts 5-6 — Alpaca JSON parsing (offline; no network). Covers bar-stream
# parsing for the feed and account/position parsing for the executor.
add_executable(test_alpaca_parse
    tests/test_alpaca_parse.cpp
    src/alpaca/AlpacaJson.cpp)
target_include_directories(test_alpaca_parse PRIVATE src/)
target_link_libraries(test_alpaca_parse PRIVATE
    nlohmann_json::nlohmann_json
    Threads::Threads)
add_test(NAME alpaca_parse COMMAND test_alpaca_parse)

# Part 7 — TradeLogger integration test. Requires a live database, so it is
# registered with ctest only when -DHERMES_DB_TEST_DSN="postgresql://..." is
# passed at configure time; otherwise the binary is built for manual runs.
if(HERMES_HAVE_PQXX)
    add_executable(test_logger
        tests/test_logger.cpp
        src/logging/TradeLogger.cpp)
    target_include_directories(test_logger PRIVATE
        src/ ${PostgreSQL_INCLUDE_DIRS} ${PQXX_INCLUDE_DIR})
    target_link_libraries(test_logger PRIVATE
        ${PQXX_LIB} ${PostgreSQL_LIBRARIES} Threads::Threads)
    if(HERMES_DB_TEST_DSN)
        add_test(NAME logger COMMAND test_logger ${HERMES_DB_TEST_DSN})
    endif()
endif()

# Part 8 — HermesEngine offline integration test. Drives a synthetic trading
# day through the full loop with simulated fills. Needs a live TimescaleDB
# (TradeLogger connects in the engine constructor) but no Alpaca connection,
# so it is ctest-registered only when -DHERMES_DB_TEST_DSN is set.
if(HERMES_HAVE_ENGINE)
    add_executable(test_engine
        tests/test_engine.cpp
        src/engine/HermesEngine.cpp
        src/engine/FeatureCalculator.cpp
        src/config/EngineConfig.cpp
        src/inference/ONNXModel.cpp
        src/alpaca/AlpacaJson.cpp
        src/execution/OrderExecutor.cpp
        src/feed/MarketDataFeed.cpp
        src/logging/TradeLogger.cpp)
    target_include_directories(test_engine PRIVATE
        src/
        "${ONNXRUNTIME_ROOT}/include"
        ${websocketpp_SOURCE_DIR}
        "${ASIO_INCLUDE_DIR}"
        ${PostgreSQL_INCLUDE_DIRS}
        ${PQXX_INCLUDE_DIR})
    target_compile_definitions(test_engine PRIVATE
        ASIO_STANDALONE=1
        _WEBSOCKETPP_CPP11_STL_=1
        ASIO_HAS_STD_INVOKE_RESULT=1
        CPPHTTPLIB_OPENSSL_SUPPORT=1)
    target_link_directories(test_engine PRIVATE "${ONNXRUNTIME_ROOT}/lib")
    target_link_libraries(test_engine PRIVATE
        onnxruntime
        OpenSSL::SSL OpenSSL::Crypto
        ${PQXX_LIB} ${PostgreSQL_LIBRARIES}
        nlohmann_json::nlohmann_json
        httplib::httplib
        Threads::Threads)
    set_target_properties(test_engine PROPERTIES
        BUILD_RPATH "${ONNXRUNTIME_ROOT}/lib")
    if(HERMES_DB_TEST_DSN)
        # Run from the source dir: the contract's model_file path is relative.
        add_test(NAME engine
                 COMMAND test_engine
                     ${CMAKE_SOURCE_DIR}/tests/test_engine_contract.json
                     ${HERMES_DB_TEST_DSN})
        set_tests_properties(engine PROPERTIES
            WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
    endif()
endif()
