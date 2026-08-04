# Ananke

Named after the Greek primordial goddess of necessity, Ananke transforms chaotic market data into a deterministic, permanent record of financial truth. This terminal serves as the "mathematical blueprint" for your trading, where every tick is captured with inescapable precision to drive high-performance execution.

A full-stack quant trading terminal. Select any stock, view interactive OHLCV candlestick charts with technical indicators (SMA, EMA, Bollinger Bands, RSI, MACD), inspect raw tick data, and replay backtests bar-by-bar. Price history is fetched on demand from Alpaca Markets and stored permanently in TimescaleDB — so every chart loads faster over time.

Terminal-grade touches: a ⌘K command palette and chart hotkeys, a live status rail (market session, data staleness, backend health), a coverage timeline showing exactly which ranges are stored, and one-click export of any chart query into a JupyterLab notebook.

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
docker compose --profile full up -d --build
```

The frontend container lives behind the `full` profile — plain `docker compose up -d` starts only TimescaleDB, the backend, and Jupyter (see **Daily development** below). It serves the **production build** (TanStack Start server bundle via wrangler/workerd) — no dev server, no HMR — so what you launch is what would be deployed. First cold build takes 5–10 minutes (Maven + npm); subsequent builds reuse Docker layer and BuildKit caches and are much faster.

### 4. Open the app

| Service | URL |
|---|---|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8080/api |
| **JupyterLab** | http://localhost:8890 (no token; `ananke-sdk` pre-installed) |
| **TimescaleDB** | localhost:5432 (user: `postgres`, db: `stockdb`) |

> JupyterLab maps to host port **8890**, not 8888 — a host-local `jupyter-lab` process may already occupy 8888, and the container keeps a consistent port of its own.

---

## Daily development (recommended)

Running the frontend in Docker means an image rebuild for every UI change. For day-to-day work, run only the data services in Docker and the frontend on your host:

```bash
docker compose up -d                          # timescaledb + backend + jupyter
VITE_API_BASE_URL=http://localhost:8080 npm run dev   # frontend with instant HMR
```

Use `docker compose --profile full up -d` when you want the whole stack containerized (e.g. testing the production-like setup).

---

## How it works

- **Select a stock** from the sidebar → the backend fetches that symbol's price history from Alpaca on demand and stores it in TimescaleDB.
- **Change the date range** → only the data not already in the database is fetched. Everything else loads instantly from local storage.
- **Switch stocks** → same behaviour. Each symbol builds up its own history as you browse it.
- **Restart the stack** → all stored data persists in a Docker volume. Nothing is lost.

---

## Managing containers

All commands must be run from the **repo root** (`Ananke/`) where `docker-compose.yml` lives. Remember the frontend is behind the `full` profile — add `--profile full` to any command that should include it:
```bash
cd /path/to/Ananke
```

**Stop and restart with no changes (preserves all data):**
```bash
docker compose --profile full down
docker compose --profile full up -d
```
Stops and removes the containers but keeps the database volume. Use this when you just want to turn the app off and back on — no code changes, no data loss.

**Stop, rebuild, restart (after code changes):**
```bash
docker compose --profile full down
docker compose --profile full up -d --build
```
Same as above but rebuilds the Docker images from source first. Use this any time you edit backend code, or frontend code when running the containerized frontend. Builds use BuildKit cache mounts for npm and Maven, so dependency downloads persist across rebuilds.

**Wipe the database and start fresh:**
```bash
docker compose --profile full down -v
docker compose --profile full up -d --build
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
| `GET` | `/api/prices/{symbol}/coverage-blocks?from=&to=` | Contiguous stored blocks in a range (gap detection; read-only) |
| `POST` | `/api/prices/{symbol}/backfill?from=&to=` | Force-backfill a symbol (synchronous) |
| `POST` | `/api/prices/{symbol}/backfill/async?from=&to=` | Start an async backfill job |
| `GET` | `/api/prices/jobs?symbol=` | List backfill jobs (poll for status/progress) |
| `GET` | `/api/prices/jobs/{jobId}` | One backfill job |
| `POST` | `/api/prices/jobs/{jobId}/retry` | Retry a failed job |
| `POST` | `/api/prices/jobs/{jobId}/cancel` | Cancel a running job |
| `POST` | `/api/prices/backfill-all?from=&to=` | Force-backfill all tracked symbols |
| `POST` | `/api/prices/fetch` | Trigger an immediate live price fetch |

Dates use ISO-8601 format, e.g. `2026-01-01T00:00:00Z`.

---

## Open in JupyterLab

The export panel on the Charts and Data pages has an **Open in JupyterLab** button: it writes the generated pandas/SQLAlchemy snippet as a ready-to-run `.ipynb` into `Test Trading Strategies/` (the Jupyter container's `strategies/` volume) and opens it in a new browser tab. The notebook can pull data through the pre-installed `ananke-sdk`:

```python
from ananke import get_data
df = get_data("AAPL", "2026-07-01", "2026-08-01", "1min")
```

`get_data` self-heals missing ranges (coverage check → async backfill → progress bar → resampled DataFrame). This feature targets the local Docker stack — API calls go through the Vite dev proxy `/jupyter-api`, so it works on any frontend port during development.

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
│   ├── routes/                 # File-based pages (Charts, Data, Backtesting, Live, Models…)
│   ├── components/             # PriceChart, ChartPanel, CommandPalette, StatusRail…
│   └── lib/
│       ├── api/                # Typed fetch client for the Spring backend
│       ├── indicators.ts       # SMA, EMA, RSI, MACD, Bollinger (pure JS)
│       └── price-bars.ts       # Client-side OHLCV aggregation by interval
├── ananke-sdk/                 # Python SDK (ananke.get_data) — pip-installed into Jupyter
├── ananke-copilot/             # Standalone AI copilot app (Vite + Kimi-backed chat endpoint)
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
| Containers | Docker Compose (frontend behind `full` profile), Eclipse Temurin JRE (backend) |
