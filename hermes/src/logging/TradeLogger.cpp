#include "logging/TradeLogger.hpp"

#include <ctime>
#include <iostream>
#include <stdexcept>

#include <pqxx/pqxx>

namespace hermes {

namespace {

// Format a UTC time_point as a Postgres TIMESTAMPTZ literal
// ("2026-06-09 16:30:00+00"). Alpaca/engine times are always UTC.
std::string toTimestamptz(std::chrono::system_clock::time_point tp) {
    const std::time_t tt = std::chrono::system_clock::to_time_t(tp);
    std::tm tm{};
    gmtime_r(&tt, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S", &tm);
    return std::string(buf) + "+00";
}

constexpr const char* kSchemaSql = R"sql(
CREATE TABLE IF NOT EXISTS hermes_trades (
    id            BIGSERIAL PRIMARY KEY,
    strategy_name VARCHAR(100),
    symbol        VARCHAR(20),
    direction     VARCHAR(10),
    entry_time    TIMESTAMPTZ,
    entry_price   NUMERIC(18,4),
    exit_time     TIMESTAMPTZ,
    exit_price    NUMERIC(18,4),
    quantity      INT,
    pnl           NUMERIC(18,4),
    pnl_pct       NUMERIC(8,4),
    win           BOOLEAN,
    exit_reason   VARCHAR(50),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hermes_signals (
    id            BIGSERIAL PRIMARY KEY,
    strategy_name VARCHAR(100),
    symbol        VARCHAR(20),
    signal        VARCHAR(10),
    confidence    NUMERIC(6,4),
    signal_time   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hermes_events (
    id         BIGSERIAL PRIMARY KEY,
    event      VARCHAR(100),
    details    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
)sql";

}  // namespace

struct TradeLogger::Impl {
    explicit Impl(const std::string& connection_string)
        : conn_(connection_string) {
        ensureSchema();
    }

    void ensureSchema() {
        pqxx::work txn(conn_);
        txn.exec(kSchemaSql);
        txn.commit();
    }

    void logTrade(const CompletedTrade& t) {
        try {
            pqxx::work txn(conn_);
            txn.exec_params(
                "INSERT INTO hermes_trades (strategy_name, symbol, direction, "
                "entry_time, entry_price, exit_time, exit_price, quantity, "
                "pnl, pnl_pct, win, exit_reason) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                t.strategy_name, t.symbol, t.direction,
                toTimestamptz(t.entry_time), t.entry_price,
                toTimestamptz(t.exit_time), t.exit_price, t.quantity,
                t.pnl, t.pnl_pct, t.win, t.exit_reason);
            txn.commit();
        } catch (const std::exception& e) {
            std::cerr << "[logger] logTrade failed: " << e.what() << "\n";
        }
    }

    void logSignal(const std::string& strategy, const std::string& symbol,
                   const std::string& signal, float confidence,
                   std::chrono::system_clock::time_point time) {
        try {
            pqxx::work txn(conn_);
            txn.exec_params(
                "INSERT INTO hermes_signals (strategy_name, symbol, signal, "
                "confidence, signal_time) VALUES ($1,$2,$3,$4,$5)",
                strategy, symbol, signal, confidence, toTimestamptz(time));
            txn.commit();
        } catch (const std::exception& e) {
            std::cerr << "[logger] logSignal failed: " << e.what() << "\n";
        }
    }

    void logEvent(const std::string& event, const std::string& details) {
        try {
            pqxx::work txn(conn_);
            txn.exec_params(
                "INSERT INTO hermes_events (event, details) VALUES ($1,$2)",
                event, details);
            txn.commit();
        } catch (const std::exception& e) {
            std::cerr << "[logger] logEvent failed: " << e.what() << "\n";
        }
    }

    pqxx::connection conn_;
};

TradeLogger::TradeLogger(const std::string& connection_string)
    : impl_(std::make_unique<Impl>(connection_string)) {}

TradeLogger::~TradeLogger() = default;

void TradeLogger::logTrade(const CompletedTrade& trade) {
    impl_->logTrade(trade);
}

void TradeLogger::logSignal(const std::string& strategy,
                            const std::string& symbol,
                            const std::string& signal, float confidence,
                            std::chrono::system_clock::time_point time) {
    impl_->logSignal(strategy, symbol, signal, confidence, time);
}

void TradeLogger::logEvent(const std::string& event, const std::string& details) {
    impl_->logEvent(event, details);
}

}  // namespace hermes
