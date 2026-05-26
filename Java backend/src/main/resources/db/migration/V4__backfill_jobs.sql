CREATE TABLE IF NOT EXISTS backfill_jobs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(20) NOT NULL,
    from_time           TIMESTAMPTZ NOT NULL,
    to_time             TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    total_chunks        INT         NOT NULL DEFAULT 0,
    completed_chunks    INT         NOT NULL DEFAULT 0,
    total_bars          INT         NOT NULL DEFAULT 0,
    current_chunk_from  TIMESTAMPTZ,
    current_chunk_to    TIMESTAMPTZ,
    error_message       TEXT,
    failed_at_chunk     INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_jobs_symbol ON backfill_jobs(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backfill_jobs_status ON backfill_jobs(status);
