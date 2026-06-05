"""
FULL-RANGE re-backfill of 1-min bars for all 5 symbols into TimescaleDB.

Unlike backfill_multi.py / backfill_nvda.py (which only gap-fill WITHIN the
current [min,max] span), this pulls the entire history 2020-07-27 -> now for
each symbol. Needed after the 90-day retention policy dropped the 2020-2025
history. Same ingestion pattern: Alpaca IEX /v2/stocks/{sym}/bars, 1Min,
sort=asc, paginated, ON CONFLICT (time,symbol) DO NOTHING. Inserts page-by-page
for bounded memory + live progress.
"""
import time, datetime as dt
import requests, psycopg2
from psycopg2.extras import execute_values

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env

ENV = load_env("/Users/phantom/Quant/Anake/.env")
BASE = "https://data.alpaca.markets"
HEADERS = {"APCA-API-KEY-ID": ENV["ALPACA_API_KEY"],
           "APCA-API-SECRET-KEY": ENV["ALPACA_API_SECRET"], "Accept": "application/json"}
SYMBOLS = ["NVDA", "AMD", "SPY", "TSLA", "MSFT"]
START = "2020-07-27T00:00:00Z"
END   = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

INSERT_SQL = """
    INSERT INTO stock_prices (time, symbol, open, high, low, close, volume, vwap, trade_count)
    VALUES %s ON CONFLICT (time, symbol) DO NOTHING"""

def insert_page(conn, symbol, bars):
    if not bars:
        return 0
    rows = [(b["t"], symbol, b.get("o"), b.get("h"), b.get("l"), b["c"],
             b.get("v"), b.get("vw"), b.get("n")) for b in bars]
    with conn.cursor() as cur:
        execute_values(cur, INSERT_SQL, rows)
    conn.commit()
    return len(rows)

def backfill_symbol(conn, symbol):
    page_token, fetched, pages = None, 0, 0
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM stock_prices WHERE symbol=%s", (symbol,))
        before = cur.fetchone()[0]
    while True:
        params = {"timeframe": "1Min", "start": START, "end": END,
                  "limit": 10000, "feed": "iex", "sort": "asc"}
        if page_token:
            params["page_token"] = page_token
        r = requests.get(f"{BASE}/v2/stocks/{symbol}/bars", headers=HEADERS, params=params, timeout=90)
        if r.status_code == 429:
            time.sleep(2); continue
        r.raise_for_status()
        body = r.json()
        bars = body.get("bars") or []
        insert_page(conn, symbol, bars)
        fetched += len(bars); pages += 1
        page_token = body.get("next_page_token")
        if pages % 10 == 0 or not page_token:
            print(f"  {symbol}: {pages} pages, {fetched:,} bars fetched...", flush=True)
        if not page_token:
            break
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), MIN(time), MAX(time) FROM stock_prices WHERE symbol=%s", (symbol,))
        after, mn, mx = cur.fetchone()
    print(f"== {symbol}: fetched {fetched:,} | rows {before:,} -> {after:,} (+{after-before:,}) | {mn} -> {mx}", flush=True)
    return after

def main():
    print(f"Full re-backfill {START} -> {END}\n")
    conn = psycopg2.connect(host="localhost", port=5432, dbname="stockdb",
                            user="postgres", password="postgres")
    for sym in SYMBOLS:
        print(f"===== {sym} =====", flush=True)
        backfill_symbol(conn, sym)
        print()
    # Final per-symbol month coverage summary
    print("========== FINAL COVERAGE ==========")
    with conn.cursor() as cur:
        for sym in SYMBOLS:
            cur.execute("""SELECT COUNT(*), MIN(time), MAX(time),
                           COUNT(DISTINCT DATE_TRUNC('month',time))
                           FROM stock_prices WHERE symbol=%s""", (sym,))
            n, mn, mx, months = cur.fetchone()
            print(f"{sym:5s}: {n:>9,} rows | {months} months | {mn} -> {mx}")
    conn.close()

if __name__ == "__main__":
    main()
