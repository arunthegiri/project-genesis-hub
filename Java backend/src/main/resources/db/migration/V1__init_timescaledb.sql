-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Tracked symbols table
CREATE TABLE IF NOT EXISTS tracked_symbols (
    id          BIGSERIAL PRIMARY KEY,
    symbol      VARCHAR(20)  NOT NULL UNIQUE,
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Stock prices table (will become a TimescaleDB hypertable)
CREATE TABLE IF NOT EXISTS stock_prices (
    time        TIMESTAMPTZ  NOT NULL,
    symbol      VARCHAR(20)  NOT NULL,
    open        NUMERIC(18, 4),
    high        NUMERIC(18, 4),
    low         NUMERIC(18, 4),
    close       NUMERIC(18, 4)  NOT NULL,
    volume      BIGINT,
    vwap        NUMERIC(18, 4),
    trade_count INTEGER,
    PRIMARY KEY (time, symbol)
);

-- Convert stock_prices into a TimescaleDB hypertable partitioned by time
SELECT create_hypertable('stock_prices', 'time', if_not_exists => TRUE);

-- Index for fast symbol lookups
CREATE INDEX IF NOT EXISTS idx_stock_prices_symbol_time
    ON stock_prices (symbol, time DESC);

-- Continuous aggregate: 1-hour OHLCV candles
CREATE MATERIALIZED VIEW IF NOT EXISTS stock_prices_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    FIRST(open,  time)          AS open,
    MAX(high)                   AS high,
    MIN(low)                    AS low,
    LAST(close,  time)          AS close,
    SUM(volume)                 AS volume
FROM stock_prices
GROUP BY bucket, symbol
WITH NO DATA;

-- Refresh policy: keep the aggregate up to date
SELECT add_continuous_aggregate_policy(
    'stock_prices_1h',
    start_offset => INTERVAL '3 hours',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Retention policy: drop raw data older than 90 days
SELECT add_retention_policy(
    'stock_prices',
    INTERVAL '90 days',
    if_not_exists => TRUE
);
