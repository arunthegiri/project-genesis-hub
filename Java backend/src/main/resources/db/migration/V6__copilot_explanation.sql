-- Copilot build doc M1: the AI explanation is stored per backtest run, not per
-- strategy — one strategy has many runs and each deserves its own analysis.
-- Nullable so every pre-existing row stays valid under ddl-auto=validate.
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS
    copilot_explanation TEXT;
