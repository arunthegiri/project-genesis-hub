// Hermes — V1 C++ Trading Execution Engine
//
// Loads the deploy contract, overrides secrets from the environment,
// validates, then starts the HermesEngine (feed -> features -> ONNX ->
// Themis -> execution -> logging) with the HTTP status server alongside.
// SIGINT / SIGTERM or POST /stop shut the engine down gracefully.
//
// When built without the optional dependencies (ONNX / OpenSSL / Asio /
// libpqxx), HERMES_HAVE_ENGINE is undefined and main() degrades to the
// Parts 1-2 behaviour: load -> validate -> print -> exit.

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>

#include "config/EngineConfig.hpp"

#ifdef HERMES_HAVE_ENGINE
#include <thread>

#include <httplib.h>

#include "engine/HermesEngine.hpp"

namespace {

// SIGINT/SIGTERM handlers may only do async-signal-safe work; stop() is a
// single atomic store, so flipping the engine through a global is safe.
hermes::HermesEngine* g_engine = nullptr;

void handleSignal(int) {
    if (g_engine) g_engine->stop();
}

}  // namespace
#endif

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: hermes <config_path>" << std::endl;
        return 1;
    }

    const std::string config_path = argv[1];

    hermes::EngineConfig config;
    try {
        config = hermes::EngineConfig::fromFile(config_path);
        config.validate();
    } catch (const std::exception& e) {
        std::cerr << "Config error: " << e.what() << std::endl;
        return 1;
    }

    // Override API keys from the environment, keeping secrets out of the
    // config file. Falls back to whatever was in the file (normally blank).
    if (const char* key = std::getenv("ALPACA_API_KEY")) {
        config.alpaca_key = key;
    }
    if (const char* secret = std::getenv("ALPACA_API_SECRET")) {
        config.alpaca_secret = secret;
    }

    config.print();

    if (config.alpaca_key.empty() || config.alpaca_secret.empty()) {
        std::cout << "\n[warn] ALPACA_API_KEY / ALPACA_API_SECRET not set in "
                     "the environment — required before live trading.\n";
    }

#ifndef HERMES_HAVE_ENGINE
    std::cout << "\nConfig loaded and validated. This build lacks the "
                 "optional dependencies for the live engine.\n";
    return 0;
#else
    try {
        hermes::HermesEngine engine(config);
        g_engine = &engine;
        std::signal(SIGINT, handleSignal);
        std::signal(SIGTERM, handleSignal);

        // ---- Part 9: HTTP status server (background thread) ----
        httplib::Server server;

        server.Get("/health", [](const httplib::Request&, httplib::Response& res) {
            res.set_content(R"({"status":"ok","version":"0.1.0"})",
                            "application/json");
        });
        server.Get("/status", [&engine](const httplib::Request&,
                                        httplib::Response& res) {
            res.set_content(engine.getStatus().dump(2), "application/json");
        });
        server.Post("/stop", [&engine](const httplib::Request&,
                                       httplib::Response& res) {
            res.set_content(R"({"status":"stopping"})", "application/json");
            engine.stop();
        });

        std::thread server_thread([&server, &config] {
            if (!server.listen("0.0.0.0", config.http_port)) {
                std::cerr << "[http] failed to listen on port "
                          << config.http_port << "\n";
            }
        });
        std::cout << "[http] status server on port " << config.http_port
                  << " (/status, /health, POST /stop)\n";

        engine.start();  // blocks until stop() / SIGINT / POST /stop

        server.stop();
        server_thread.join();
        g_engine = nullptr;
    } catch (const std::exception& e) {
        std::cerr << "Engine error: " << e.what() << std::endl;
        return 1;
    }

    std::cout << "Hermes stopped cleanly." << std::endl;
    return 0;
#endif
}
