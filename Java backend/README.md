# Stock Tracker — Alpaca API → TimescaleDB

A Spring Boot service that polls the **Alpaca Market Data API** for real-time stock prices and stores them in **TimescaleDB** (PostgreSQL hypertable).

---

## Architecture

```
REST Client (you)
      │
      ▼
┌─────────────────────┐
│  Spring Boot App    │
│  ┌───────────────┐  │
│  │SymbolController│  │  POST /api/symbols      → add a ticker
│  │PriceController│  │  GET  /api/prices/{sym} → query history
│  └──────┬────────┘  │
│         │           │
│  ┌──────▼────────┐  │
│  │StockPriceService│ │  Orchestrates fetch + persist
│  └──────┬────────┘  │
│         │           │
│  ┌──────▼────────┐  │     ┌──────────────────┐
│  │  AlpacaClient │──┼────▶│  Alpaca Data API │
│  └───────────────┘  │     └──────────────────┘
│                     │
│  ┌───────────────┐  │     ┌──────────────────┐
│  │PriceFetchSched│──┼────▶│  TimescaleDB     │
│  └───────────────┘  │     │  (hypertable)    │
└─────────────────────┘     └──────────────────┘
```

---

## Quick Start

### 1. Prerequisites
- Java 17+
- Docker & Docker Compose
- A free [Alpaca](https://alpaca.markets) account (Paper trading keys work)

### 2. Set environment variables

```bash
export ALPACA_API_KEY=your_key_here
export ALPACA_API_SECRET=your_secret_here
```

### 3. Run with Docker Compose

```bash
docker-compose up --build
```

This starts TimescaleDB and the app. Flyway will auto-create the hypertable on first boot.

### 4. Run locally (TimescaleDB via Docker)

```bash
# Start only the DB
docker-compose up -d timescaledb

# Run the app
./mvnw spring-boot:run \
  -Dspring-boot.run.jvmArguments="-DALPACA_API_KEY=$ALPACA_API_KEY -DALPACA_API_SECRET=$ALPACA_API_SECRET"
```

---

## REST API

### Symbols

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/symbols` | List all tracked symbols |
| `POST` | `/api/symbols` | Add a symbol to track |
| `DELETE` | `/api/symbols/{symbol}` | Stop tracking a symbol |

**Add a symbol:**
```bash
curl -X POST http://localhost:8080/api/symbols \
  -H "Content-Type: application/json" \
  -d '{"symbol": "AAPL"}'
```

### Prices

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/prices/{symbol}/latest?hours=1` | Latest N hours of bars |
| `GET`  | `/api/prices/{symbol}/range?from=...&to=...` | Bars in explicit time range |
| `POST` | `/api/prices/fetch` | Manually trigger a fetch now |
| `POST` | `/api/prices/{symbol}/backfill?from=...&to=...` | Backfill historical data |

**Get latest 2 hours of AAPL:**
```bash
curl "http://localhost:8080/api/prices/AAPL/latest?hours=2"
```

**Backfill a day of data:**
```bash
curl -X POST "http://localhost:8080/api/prices/AAPL/backfill?\
from=2024-01-15T09:30:00Z&to=2024-01-15T16:00:00Z"
```

---

## TimescaleDB Features Used

| Feature | Detail |
|---------|--------|
| **Hypertable** | `stock_prices` auto-partitioned by `time` |
| **Continuous Aggregate** | `stock_prices_1h` — hourly OHLCV candles, auto-refreshed |
| **Retention Policy** | Raw data auto-dropped after **90 days** |
| **Composite PK** | `(time, symbol)` — idempotent upserts |

Query the hourly aggregate directly in psql:
```sql
SELECT * FROM stock_prices_1h
WHERE symbol = 'AAPL'
  AND bucket > NOW() - INTERVAL '7 days'
ORDER BY bucket DESC;
```

---

## Configuration

| Property | Env Var | Default | Description |
|----------|---------|---------|-------------|
| `alpaca.api.key` | `ALPACA_API_KEY` | — | Alpaca key ID |
| `alpaca.api.secret` | `ALPACA_API_SECRET` | — | Alpaca secret key |
| `alpaca.fetch.interval-ms` | `FETCH_INTERVAL_MS` | `60000` | Poll interval (ms) |
| `spring.datasource.url` | `SPRING_DATASOURCE_URL` | localhost | TimescaleDB JDBC URL |
