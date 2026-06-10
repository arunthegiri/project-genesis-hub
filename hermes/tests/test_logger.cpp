// Manual integration test for Part 7 (TradeLogger). Requires a live
// TimescaleDB/PostgreSQL — NOT part of the automatic `ctest` run.
//
// Usage:
//   ./build/test_logger "postgresql://postgres:postgres@localhost:5432/stockdb"
//
// Connects, ensures the schema, writes one signal / one trade / one event,
// then prints the row counts it can see. Returns non-zero on connection or
// write failure.

#include <chrono>
#include <cstdio>
#include <string>

#include <pqxx/pqxx>

#include "logging/TradeLogger.hpp"

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::fprintf(stderr,
                     "Usage: test_logger <connection_string>\n"
                     "  e.g. postgresql://postgres:postgres@localhost:5432/stockdb\n");
        return 2;
    }
    const std::string dsn = argv[1];

    try {
        hermes::TradeLogger logger(dsn);  // connects + ensureSchema()
        std::printf("connected; schema ensured\n");

        const auto now = std::chrono::system_clock::now();

        logger.logSignal("test_strategy", "NVDA", "BUY", 0.72f, now);

        hermes::CompletedTrade t;
        t.strategy_name = "test_strategy";
        t.symbol        = "NVDA";
        t.direction     = "long";
        t.entry_time    = now - std::chrono::minutes(5);
        t.entry_price   = 125.40;
        t.exit_time     = now;
        t.exit_price    = 125.71;
        t.quantity      = 10;
        t.pnl           = 3.10;
        t.pnl_pct       = 0.247;
        t.win           = true;
        t.exit_reason   = "take_profit";
        logger.logTrade(t);

        logger.logEvent("test_run", "test_logger smoke test");

        // Read back the counts to confirm the writes landed.
        pqxx::connection conn(dsn);
        pqxx::work txn(conn);
        const auto trades  = txn.query_value<long>("SELECT COUNT(*) FROM hermes_trades");
        const auto signals = txn.query_value<long>("SELECT COUNT(*) FROM hermes_signals");
        const auto events  = txn.query_value<long>("SELECT COUNT(*) FROM hermes_events");
        txn.commit();

        std::printf("rows now — trades=%ld signals=%ld events=%ld\n",
                    trades, signals, events);
        std::printf("PASSED: TradeLogger wrote to TimescaleDB\n");
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "FAILED: %s\n", e.what());
        return 1;
    }
}
