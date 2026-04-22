# Quant Trading Platform — Frontend

Desktop-first dark trading terminal that integrates with the Spring Boot backend
documented in your `stock-tracker` repo.

## Backend it expects

| Method | Endpoint | Used by |
|---|---|---|
| `GET`    | `/api/symbols` | sidebar, pickers |
| `POST`   | `/api/symbols` | symbol manager |
| `DELETE` | `/api/symbols/{symbol}` | symbol manager |
| `GET`    | `/api/prices/{symbol}/range?from=&to=` | Charts, Data |
| `GET`    | `/api/prices/{symbol}/latest?hours=` | (future) Live |
| `POST`   | `/api/prices/fetch` | (future) manual refresh |
| `POST`   | `/api/prices/{symbol}/backfill?from=&to=` | (future) backfill UI |

Pages that need endpoints **not yet implemented** render a clear "pending"
state listing the exact endpoints required (see `Replay`, `Live`, `Metrics`,
`Models`).

## Configuration

| Env var | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8080` | Spring backend base URL |
| `VITE_WS_URL` | derived from base URL | Future WebSocket endpoint |

## Running locally against your Spring backend

```bash
npm install
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

Make sure your Spring backend has CORS enabled for `http://localhost:3000`
(or whatever port Vite picks):

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
  @Override public void addCorsMappings(CorsRegistry r) {
    r.addMapping("/api/**")
     .allowedOrigins("http://localhost:3000", "http://localhost:5173")
     .allowedMethods("GET", "POST", "DELETE", "OPTIONS");
  }
}
```

## Running in Lovable preview against your local backend

The Lovable preview runs in the cloud and **cannot** reach `localhost:8080`.
Expose your backend via a tunnel:

```bash
ngrok http 8080
# → https://abc123.ngrok-free.app
```

Then set `VITE_API_BASE_URL=https://abc123.ngrok-free.app` in your project env.

## Docker

```bash
docker build --build-arg VITE_API_BASE_URL=https://your-backend-url -t quant-frontend .
docker run -p 3000:80 quant-frontend
```

Or use `docker-compose.frontend.yml`.

## Architecture

```
src/
  lib/api/           ← typed client for the Spring backend
  lib/indicators.ts  ← SMA / EMA / RSI / MACD / Bollinger
  lib/python-export  ← generates pandas+SQLAlchemy snippets
  components/        ← shared (PriceChart, SymbolPicker, PythonExport, …)
  routes/            ← file-based routing
    index.tsx        → Charts
    data.tsx         → Data
    replay.tsx       → Replay (pending backend)
    live.tsx         → Live   (pending WebSocket)
    metrics.tsx      → stub
    models.tsx       → stub
```

Charts and Data are wired against your real `/api/prices/{symbol}/range` endpoint.
The Python export reproduces the same query directly against TimescaleDB
(`stock_prices` hypertable, columns `time, symbol, open, high, low, close, volume, vwap, trade_count`).
