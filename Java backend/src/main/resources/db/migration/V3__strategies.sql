CREATE TABLE IF NOT EXISTS strategies (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    definition  JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backtest_results (
    id              BIGSERIAL PRIMARY KEY,
    strategy_id     BIGINT REFERENCES strategies(id) ON DELETE CASCADE,
    symbol          VARCHAR(20),
    from_ts         TIMESTAMPTZ,
    to_ts           TIMESTAMPTZ,
    interval        VARCHAR(20) NOT NULL DEFAULT '1Min',
    total_trades    INT,
    winning_trades  INT,
    losing_trades   INT,
    win_rate        NUMERIC(8,4),
    total_pnl       NUMERIC(18,4),
    total_pnl_pct   NUMERIC(8,4),
    avg_win         NUMERIC(18,4),
    avg_loss        NUMERIC(18,4),
    largest_win     NUMERIC(18,4),
    largest_loss    NUMERIC(18,4),
    profit_factor   NUMERIC(8,4),
    max_drawdown    NUMERIC(8,4),
    sharpe_ratio    NUMERIC(8,4),
    trades          JSONB,
    equity_curve    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_name ON strategies(name);
CREATE INDEX IF NOT EXISTS idx_backtest_strategy_id ON backtest_results(strategy_id);
