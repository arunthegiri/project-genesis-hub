# Ananke

Named after the Greek primordial goddess of necessity, Ananke transforms chaotic market data into a deterministic, permanent record of financial truth. This terminal serves as the "mathematical blueprint" for your trading, where every tick is captured with inescapable precision to drive high-performance execution.

A full-stack quant trading terminal. Select any stock, view interactive OHLCV candlestick charts with technical indicators (SMA, EMA, Bollinger Bands, RSI, MACD), and inspect raw tick data. Price history is fetched on demand from Alpaca Markets and stored permanently in TimescaleDB — so every chart loads faster over time.

---

## Prerequisites

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** — all services (Spring Boot backend, React frontend, TimescaleDB) run as containers defined in `docker-compose.yml`. No local Java or Node.js installation required.
- **Alpaca Markets API keys** — create a free account at [alpaca.markets](https://alpaca.markets), then find your keys under **Paper Trading → API Keys** in the dashboard. Paper Trading keys work fine — a funded brokerage account is not required.

---

## Quickstart

### 1. Clone the repo

```bash
git clone https://github.com/arunthegiri/Ananke.git
cd Ananke
```

### 2. Add your API keys

```bash
cp .env.example .env
```

Open `.env` and replace the placeholder values:

```
ALPACA_API_KEY=your_key_here
ALPACA_API_SECRET=your_secret_here
```

You can find your keys at [app.alpaca.markets](https://app.alpaca.markets) → **Paper Trading** → **API Keys**.

### 3. Run

```bash
docker compose up --build
```

First run takes 2–3 minutes to build the images. Subsequent starts are instant.

### 4. Open the app

| Service | URL |
|---|---|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8080/api |
| **TimescaleDB** | localhost:5432 (user: `postgres`, db: `stockdb`) |

---

## How it works

- **Select a stock** from the sidebar → the backend fetches that symbol's price history from Alpaca on demand and stores it in TimescaleDB.
- **Change the date range** → only the data not already in the database is fetched. Everything else loads instantly from local storage.
- **Switch stocks** → same behaviour. Each symbol builds up its own history as you browse it.
- **Restart the stack** → all stored data persists in a Docker volume. Nothing is lost.

---

## Managing containers

**Stop and restart with no changes (preserves all data):**
```bash
docker compose down
docker compose up -d
```
Stops and removes the containers but keeps the database volume. Use this when you just want to turn the app off and back on — no code changes, no data loss.

**Stop, rebuild, restart (after code changes):**
```bash
docker compose down
docker compose up -d --build
```
Same as above but rebuilds the Docker images from source first. Use this any time you edit backend or frontend code.

**Wipe the database and start fresh:**
```bash
docker compose down -v
docker compose up -d --build
```
The `-v` flag deletes the volume along with the containers. TimescaleDB starts completely empty and all stored price history is gone.

**Pause and resume without removing containers:**
```bash
docker compose stop
docker compose start
```
Faster than down/up — containers are paused rather than removed and recreated.

**Rebuild only one service without touching the others:**
```bash
docker compose up -d --build frontend
docker compose up -d --build stock-tracker
```
Useful when you only changed the frontend or only the Java backend. The database container keeps running uninterrupted.

---

## API Reference

All endpoints on `http://localhost:8080`.

### Symbols

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/symbols` | List all tracked symbols |
| `POST` | `/api/symbols` | Add a symbol `{"symbol": "AAPL"}` |
| `DELETE` | `/api/symbols/{symbol}` | Stop tracking a symbol |

### Prices

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/prices/{symbol}/range?from=&to=` | Fetch bars for a date range (auto-fills from Alpaca) |
| `GET` | `/api/prices/{symbol}/latest?hours=` | Most recent N hours of bars |
| `POST` | `/api/prices/{symbol}/backfill?from=&to=` | Force-backfill a symbol |
| `POST` | `/api/prices/backfill-all?from=&to=` | Force-backfill all tracked symbols |
| `POST` | `/api/prices/fetch` | Trigger an immediate live price fetch |

Dates use ISO-8601 format, e.g. `2026-01-01T00:00:00Z`.

---

## Project layout

```
Ananke/
├── Java backend/               # Spring Boot API + TimescaleDB migrations
│   ├── Dockerfile
│   ├── docker-compose.yml      # Standalone backend-only compose
│   └── src/
│       └── main/resources/
│           └── db/migration/   # Flyway SQL migrations (TimescaleDB schema)
├── src/                        # React frontend source
│   ├── routes/                 # File-based pages (Charts, Data, Replay…)
│   ├── components/             # PriceChart, SymbolPicker, DateRangePicker…
│   └── lib/
│       ├── api/                # Typed fetch client for the Spring backend
│       ├── indicators.ts       # SMA, EMA, RSI, MACD, Bollinger (pure JS)
│       └── price-bars.ts       # Client-side OHLCV aggregation by interval
├── docker-compose.yml          # Root compose — runs everything
├── Dockerfile                  # Frontend container
├── .env.example                # Copy to .env and fill in your keys
└── README.md
```

## Tech stack

| Layer | Technology |
|---|---|
| Database | TimescaleDB (PostgreSQL hypertable, 90-day retention) |
| Backend | Spring Boot 3, Java 17, Flyway, Spring Data JPA |
| Market data | Alpaca Markets API v2 (1-min bars, paginated) |
| Frontend | React 19, TanStack Router, TanStack Query, Vite |
| Charts | lightweight-charts (candlestick + RSI/MACD sub-panes) |
| UI components | shadcn/ui + Tailwind CSS v4 |
| Containers | Docker Compose, nginx (frontend), Eclipse Temurin JRE (backend) |
