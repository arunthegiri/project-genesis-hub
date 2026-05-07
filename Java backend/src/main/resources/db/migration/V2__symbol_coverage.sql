CREATE TABLE IF NOT EXISTS symbol_coverage (
    symbol    VARCHAR(20)  PRIMARY KEY,
    from_time TIMESTAMPTZ  NOT NULL,
    to_time   TIMESTAMPTZ  NOT NULL
);
