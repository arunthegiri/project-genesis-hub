"""
Backfill missing/incomplete NVDA 1-min bars into TimescaleDB.
Mirrors the Java backend's AlpacaClient.fetchHistoricalBars ingestion pattern:
  GET https://data.alpaca.markets/v2/stocks/{symbol}/bars
      ?timeframe=1Min&start=&end=&limit=10000&feed=iex&sort=asc
  paginated via next_page_token, headers APCA-API-KEY-ID / APCA-API-SECRET-KEY.
Inserts into stock_prices(time, symbol, open, high, low, close, volume, vwap, trade_count)
with ON CONFLICT (time, symbol) DO NOTHING.
"""
import os, time, datetime as dt
import requests
import psycopg2
from psycopg2.extras import execute_values

# --- credentials from .env ---
def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

ENV = load_env("/Users/phantom/Quant/Anake/.env")
KEY, SECRET = ENV["ALPACA_API_KEY"], ENV["ALPACA_API_SECRET"]

BASE = "https://data.alpaca.markets"
SYMBOL = "NVDA"
HEADERS = {"APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET, "Accept": "application/json"}

def fetch_historical_bars(symbol, start_iso, end_iso):
    """Replicates AlpacaClient.fetchHistoricalBars: paginated 1Min IEX bars asc."""
    all_bars = []
    page_token = None
    while True:
        params = {
            "timeframe": "1Min", "start": start_iso, "end": end_iso,
            "limit": 10000, "feed": "iex", "sort": "asc",
        }
        if page_token:
            params["page_token"] = page_token
        r = requests.get(f"{BASE}/v2/stocks/{symbol}/bars", headers=HEADERS, params=params, timeout=60)
        if r.status_code == 429:
            time.sleep(2); continue
        r.raise_for_status()
        body = r.json()
        bars = body.get("bars") or []
        all_bars.extend(bars)
        page_token = body.get("next_page_token")
        if not page_token:
            break
    return all_bars

def insert_bars(conn, symbol, bars):
    if not bars:
        return 0
    rows = [(
        b["t"], symbol, b.get("o"), b.get("h"), b.get("l"), b["c"],
        b.get("v"), b.get("vw"), b.get("n"),
    ) for b in bars]
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM stock_prices WHERE symbol=%s", (symbol,))
        before = cur.fetchone()[0]
        execute_values(cur, """
            INSERT INTO stock_prices (time, symbol, open, high, low, close, volume, vwap, trade_count)
            VALUES %s ON CONFLICT (time, symbol) DO NOTHING
        """, rows)
        cur.execute("SELECT COUNT(*) FROM stock_prices WHERE symbol=%s", (symbol,))
        after = cur.fetchone()[0]
    conn.commit()
    return after - before

# Months to backfill: every missing or incomplete month identified in Step 1.
# (year, month, label). The 13-month block 2025-02..2026-02 was entirely absent;
# 2020-07 and 2026-06 are boundary/partial months we top off to whatever exists.
def month_range(y, m):
    start = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
    end = dt.datetime(y + (m // 12), (m % 12) + 1, 1, tzinfo=dt.timezone.utc)
    now = dt.datetime.now(dt.timezone.utc)
    if end > now:
        end = now
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")

TARGETS = [(2020, 7)] + [(2025, m) for m in range(2, 13)] + [(2026, m) for m in range(1, 7)]

def main():
    conn = psycopg2.connect(host="localhost", port=5432, dbname="stockdb",
                            user="postgres", password="postgres")
    grand_total = 0
    print(f"{'MONTH':<9} {'FETCHED':>9} {'INSERTED':>9}")
    print("-" * 32)
    for y, m in TARGETS:
        s, e = month_range(y, m)
        bars = fetch_historical_bars(SYMBOL, s, e)
        added = insert_bars(conn, SYMBOL, bars)
        grand_total += added
        print(f"{y}-{m:02d}   {len(bars):>9} {added:>9}", flush=True)
    print("-" * 32)
    print(f"TOTAL ROWS ADDED: {grand_total}")
    conn.close()

if __name__ == "__main__":
    main()
