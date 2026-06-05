// Hermes — V1 C++ Trading Execution Engine
//
// Parts 1-2 scope: load the deploy contract, override secrets from the
// environment, validate, and print a summary. The live engine (feed,
// inference, execution, logging, HTTP status server) is wired up in later
// parts; for now main() exits cleanly after printing the validated config.

#include <cstdlib>
#include <iostream>
#include <string>

#include "config/EngineConfig.hpp"

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

    std::cout << "\nConfig loaded and validated. "
                 "Engine startup is implemented in later parts.\n";
    return 0;
}
