"""
Backfill missing/incomplete 1-min bars for AMD, SPY, TSLA, MSFT into TimescaleDB.
Same ingestion pattern as backfill_nvda.py (Alpaca IEX, /v2/stocks/{sym}/bars, 1Min,
sort=asc, paginated). Targets per symbol are computed live: every month that is either
entirely absent in the symbol's data span, or present with < 5000 bars.
Prints rows added per month per symbol, then verifies interior-month coverage.
"""
import time, datetime as dt
from datetime import date
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
SYMBOLS = ["AMD", "SPY", "TSLA", "MSFT"]
BOUNDARY = {date(2020, 7, 1)}  # dataset-start month; current month added dynamically

def fetch_historical_bars(symbol, start_iso, end_iso):
    all_bars, page_token = [], None
    while True:
        params = {"timeframe": "1Min", "start": start_iso, "end": end_iso,
                  "limit": 10000, "feed": "iex", "sort": "asc"}
        if page_token:
            params["page_token"] = page_token
        r = requests.get(f"{BASE}/v2/stocks/{symbol}/bars", headers=HEADERS, params=params, timeout=60)
        if r.status_code == 429:
            time.sleep(2); continue
        r.raise_for_status()
        body = r.json()
        all_bars.extend(body.get("bars") or [])
        page_token = body.get("next_page_token")
        if not page_token:
            break
    return all_bars

def insert_bars(conn, symbol, bars):
    if not bars:
        return 0
    rows = [(b["t"], symbol, b.get("o"), b.get("h"), b.get("l"), b["c"],
             b.get("v"), b.get("vw"), b.get("n")) for b in bars]
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM stock_prices WHERE symbol=%s", (symbol,))
        before = cur.fetchone()[0]
        execute_values(cur, """
            INSERT INTO stock_prices (time, symbol, open, high, low, close, volume, vwap, trade_count)
            VALUES %s ON CONFLICT (time, symbol) DO NOTHING""", rows)
        cur.execute("SELECT COUNT(*) FROM stock_prices WHERE symbol=%s", (symbol,))
        after = cur.fetchone()[0]
    conn.commit()
    return after - before

def month_iter(start, end):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield date(y, m, 1)
        m += 1
        if m > 12: m = 1; y += 1

def month_range(d):
    start = dt.datetime(d.year, d.month, 1, tzinfo=dt.timezone.utc)
    end = dt.datetime(d.year + (d.month // 12), (d.month % 12) + 1, 1, tzinfo=dt.timezone.utc)
    now = dt.datetime.now(dt.timezone.utc)
    if end > now:
        end = now
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")

def targets_for(cur, symbol):
    cur.execute("SELECT MIN(time), MAX(time) FROM stock_prices WHERE symbol=%s", (symbol,))
    mn, mx = cur.fetchone()
    cur.execute("SELECT DATE_TRUNC('month',time), COUNT(*) FROM stock_prices WHERE symbol=%s GROUP BY 1", (symbol,))
    present = {r[0].date(): r[1] for r in cur.fetchall()}
    tgts = []
    for d in month_iter(mn.date(), mx.date()):
        if d not in present or present[d] < 5000:
            tgts.append(d)
    return tgts

def main():
    conn = psycopg2.connect(host="localhost", port=5432, dbname="stockdb",
                            user="postgres", password="postgres")
    cur = conn.cursor()
    grand = {}
    for sym in SYMBOLS:
        tgts = targets_for(cur, sym)
        print(f"\n===== {sym} — {len(tgts)} target month(s) =====")
        print(f"{'MONTH':<9} {'FETCHED':>9} {'ADDED':>9}")
        print("-" * 32)
        total = 0
        for d in tgts:
            s, e = month_range(d)
            bars = fetch_historical_bars(sym, s, e)
            added = insert_bars(conn, sym, bars)
            total += added
            print(f"{d:%Y-%m}   {len(bars):>9} {added:>9}", flush=True)
        print("-" * 32)
        print(f"{sym} total rows added: {total}")
        grand[sym] = total

    # ── Verification: interior months (excluding boundary + current) must be >= 5000 ──
    now = dt.datetime.now(dt.timezone.utc)
    current_month = date(now.year, now.month, 1)
    print("\n\n========== VERIFICATION — interior-month coverage ==========")
    all_ok = True
    for sym in SYMBOLS:
        cur.execute("SELECT DATE_TRUNC('month',time), COUNT(*) FROM stock_prices WHERE symbol=%s GROUP BY 1 ORDER BY 1", (sym,))
        rows = [(r[0].date(), r[1]) for r in cur.fetchall()]
        interior_low = [(d, c) for d, c in rows
                        if c < 5000 and d not in BOUNDARY and d != current_month]
        boundary_low = [(d, c) for d, c in rows
                        if c < 5000 and (d in BOUNDARY or d == current_month)]
        status = "✓ OK" if not interior_low else "✗ STILL LOW"
        if interior_low:
            all_ok = False
        print(f"\n{sym}: {len(rows)} months | added {grand[sym]} rows | {status}")
        print(f"   interior months < 5000: {[(d.strftime('%Y-%m'), c) for d, c in interior_low] or 'NONE'}")
        print(f"   excluded boundaries < 5000 (expected): {[(d.strftime('%Y-%m'), c) for d, c in boundary_low]}")
    print("\n" + ("✓ ALL SYMBOLS: every interior month has >= 5000 bars"
                  if all_ok else "✗ Some interior months still below 5000"))
    cur.close(); conn.close()

if __name__ == "__main__":
    main()
