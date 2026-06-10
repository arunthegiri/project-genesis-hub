// Offline integration test for Part 8 (HermesEngine). Requires a live
// TimescaleDB (the TradeLogger connects at engine construction) but NO Alpaca
// connection: the config carries no credentials, so the engine runs in
// simulated-fill mode and bars are injected directly via onBar().
//
// Drives one synthetic NVDA trading day (2026-06-10, EDT) through the full
// loop — features -> ONNX -> Themis -> simulated execution -> TimescaleDB —
// then asserts against both the engine status and the rows written to the DB.
//
// Usage:
//   ./build/test_engine [contract.json] [db_connection_string]

#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <pqxx/pqxx>

#include "config/EngineConfig.hpp"
#include "engine/HermesEngine.hpp"

using hermes::Bar;
using hermes::EngineConfig;
using hermes::HermesEngine;
using std::chrono::system_clock;

namespace {

int g_failures = 0;

void check(bool cond, const char* what) {
    std::printf("  %-58s %s\n", what, cond ? "OK" : "FAILED");
    if (!cond) ++g_failures;
}

// UTC time_point for the given instant on 2026-06-10 (EDT day: ET = UTC-4).
system_clock::time_point utc(int hour, int min) {
    std::tm tm{};
    tm.tm_year = 2026 - 1900;
    tm.tm_mon  = 5;   // June
    tm.tm_mday = 10;
    tm.tm_hour = hour;
    tm.tm_min  = min;
    return system_clock::from_time_t(timegm(&tm));
}

Bar makeBar(int i, system_clock::time_point time, double prev_close) {
    Bar b;
    b.symbol = "NVDA";
    b.time   = time;
    // Gentle drift + oscillation; the ±0.20 bar range comfortably straddles
    // the 0.15% stop / 0.25% target so entered positions resolve quickly.
    b.open   = prev_close;
    b.close  = 100.0 + 0.01 * i + 0.30 * std::sin(i / 3.0);
    b.high   = std::max(b.open, b.close) + 0.20;
    b.low    = std::min(b.open, b.close) - 0.20;
    b.volume = 1000.0 + 200.0 * std::sin(i / 2.0);
    b.vwap   = (b.high + b.low + b.close) / 3.0;
    return b;
}

}  // namespace

int main(int argc, char* argv[]) {
    const std::string contract_path =
        argc > 1 ? argv[1] : "tests/test_engine_contract.json";

    EngineConfig config;
    try {
        config = EngineConfig::fromFile(contract_path);
        if (argc > 2) config.db_connection_string = argv[2];
        config.validate();
    } catch (const std::exception& e) {
        std::fprintf(stderr, "contract error: %s\n", e.what());
        return 2;
    }

    try {
        // Clean previous runs so DB row counts are deterministic.
        {
            pqxx::connection conn(config.db_connection_string);
            pqxx::work txn(conn);
            txn.exec("DELETE FROM hermes_trades  WHERE strategy_name = 'engine_test'");
            txn.exec("DELETE FROM hermes_signals WHERE strategy_name = 'engine_test'");
            txn.commit();
        }

        HermesEngine engine(config);

        // 90 in-session bars: 11:00–12:30 ET (15:00–16:30 UTC on an EDT day).
        double prev_close = 100.0;
        int    bar_index  = 0;
        for (int i = 0; i < 90; ++i) {
            Bar b = makeBar(bar_index++, utc(15, 0) + std::chrono::minutes(i),
                            prev_close);
            prev_close = b.close;
            engine.onBar("NVDA", b);
        }

        // Three bars inside the close window (15:45+ ET) force an eod flatten.
        for (int i = 0; i < 3; ++i) {
            Bar b = makeBar(bar_index++, utc(19, 45) + std::chrono::minutes(i),
                            prev_close);
            prev_close = b.close;
            engine.onBar("NVDA", b);
        }

        const auto status = engine.getStatus();
        std::printf("\nstatus: %s\n\n", status.dump(2).c_str());

        // Read back what the engine persisted.
        long db_signals = 0, db_trades = 0, open_db_positions = 0;
        {
            pqxx::connection conn(config.db_connection_string);
            pqxx::work txn(conn);
            db_signals = txn.query_value<long>(
                "SELECT COUNT(*) FROM hermes_signals WHERE strategy_name = 'engine_test'");
            db_trades = txn.query_value<long>(
                "SELECT COUNT(*) FROM hermes_trades WHERE strategy_name = 'engine_test'");
            open_db_positions = txn.query_value<long>(
                "SELECT COUNT(*) FROM hermes_trades "
                "WHERE strategy_name = 'engine_test' AND exit_time IS NULL");
            txn.commit();
        }

        std::printf("db: signals=%ld trades=%ld\n\n", db_signals, db_trades);

        check(status["status"] == "stopped", "engine reports stopped (never started)");
        check(status["simulated_fills"] == true, "simulated-fill mode active");
        check(db_signals >= 1, "at least one signal persisted to TimescaleDB");
        check(status["open_positions"].empty(),
              "no open positions after eod flatten");
        check(open_db_positions == 0, "no half-written trade rows in DB");
        // Every entry must have produced exactly one completed trade row
        // (stop/target/eod all flatten the same day).
        check(db_trades == status["trades_today"].get<long>(),
              "completed trades == entries taken");

        if (g_failures == 0) {
            std::printf("\nPASSED: full engine loop verified offline\n");
            return 0;
        }
        std::printf("\nFAILED: %d check(s)\n", g_failures);
        return 1;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "FAILED: %s\n", e.what());
        return 1;
    }
}
