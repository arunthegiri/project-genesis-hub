# Hermes — V1 C++ Trading Execution Engine

Hermes is the C++ execution engine for the Ananke algorithmic trading
platform. It loads a model exported as ONNX from Jupyter, subscribes to live
market data via the Alpaca WebSocket, runs inference on every bar, and executes
trades on an Alpaca paper-trading account.

- **Version:** 0.1.0
- **Language:** C++20
- **Build system:** CMake 3.20+

> **Build status:** Part 1 (build system) and Part 2 (config loader) are
> implemented. Parts 3–11 (feature calculator, ONNX inference, market-data
> feed, order executor, trade logger, engine loop, HTTP status server) are
> scaffolded in the source tree and built incrementally.

## Dependencies

Fetched automatically by CMake (FetchContent):

- [nlohmann/json](https://github.com/nlohmann/json) v3.11.3 — JSON parsing
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) v0.14.3 — HTTP client/server
- [websocketpp](https://github.com/zaphoyd/websocketpp) 0.8.2 — Alpaca WebSocket feed

System dependencies (install before building):

```bash
# macOS (Homebrew)
brew install openssl@3 libpqxx postgresql@16 cmake
```

```bash
# Debian/Ubuntu
sudo apt install libssl-dev libpq-dev libpqxx-dev cmake build-essential
```

ONNX Runtime (required for inference, Part 4 onward) — download the prebuilt
binary from the [releases page](https://github.com/microsoft/onnxruntime/releases)
and extract it:

```bash
# macOS ARM example
tar xzf onnxruntime-osx-arm64-1.18.0.tgz
sudo mv onnxruntime-osx-arm64-1.18.0 /usr/local/onnxruntime
```

CMake auto-detects ONNX Runtime at `/usr/local/onnxruntime`. When it is absent
the build still succeeds for Parts 1–2 (a warning is printed); override the
location with `-DONNXRUNTIME_ROOT=/path/to/onnxruntime`.

## Build

```bash
./build.sh
# → build/hermes
```

## Configuration

A deploy contract is a JSON file (written by Kairos on `k.deploy()`). See
[`configs/rf_v1_deploy.json`](configs/rf_v1_deploy.json) for a complete
example. Key fields:

| Field | Meaning |
|---|---|
| `strategy_name` | Strategy identifier |
| `model_file` | Path to the `.onnx` model |
| `features` | **Ordered** feature list — must match training column order exactly |
| `input_shape` | Model input shape, e.g. `[1, N]` where `N == features.length` |
| `output_classes` | Class labels, e.g. `["SHORT", "NEUTRAL", "LONG"]` |
| `buy_threshold` / `sell_threshold` | Probability thresholds to act |
| `stop_loss` / `take_profit` | Exit levels as fractions (`0.0015` = 0.15%) |
| `deploy_mode` | `"paper"` or `"live"` |
| `symbols` | Symbols to trade |
| `themis` | Risk-management limits |
| `http_port` | Status-server port (default 9090) |

**Secrets are never stored in the config file.** `alpaca_key` / `alpaca_secret`
are left blank and read from the environment instead:

```bash
export ALPACA_API_KEY=...
export ALPACA_API_SECRET=...
```

## Run

```bash
./run.sh configs/rf_v1_deploy.json
```

In the current (Parts 1–2) build this loads and validates the contract, prints
a summary, and exits.

## Status

(Available once the HTTP server, Part 9, is built.)

```bash
curl http://localhost:9090/status
curl http://localhost:9090/health
```

## How the ONNX contract works

The `features` array in the config defines the exact, ordered set of inputs the
model expects. The feature calculator (Part 3) produces values in that same
order, and they are fed to the ONNX session as a `[1, N]` tensor. The model
returns class probabilities ordered per `output_classes`; `buy_threshold` /
`sell_threshold` then map those probabilities to a BUY / SELL / HOLD signal.

> If the feature order does not match the training order, inference is silently
> wrong — keep `features` in sync with the training pipeline.
