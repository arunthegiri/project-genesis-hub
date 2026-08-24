# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

> **`AGENTS.md` is the long-form reference** — full component map, v5 chart gotchas, theme
> mechanics, realtime architecture, Docker/Jupyter setup. This file is the orientation; when the
> two disagree, AGENTS.md is newer. Keep both in sync in the same commit as any architectural
> change (build-doc working agreement §1.6).

## Commands

```bash
nvm use              # Node 24 (.nvmrc); an 18.x shell cannot build this repo at all
npm run dev          # Vite dev server
npm run build        # production build
npm run lint         # ESLint
npm run format       # Prettier (write)

npm run test:visual        # Playwright suite (visual baselines + behavioural contracts)
npm run test:visual:update # re-record baselines — review every diff
npm run test:unit          # plain-node unit tests (chart theme, calendar, correlation, distributions)
```

To run against the Spring Boot backend: `VITE_API_BASE_URL=http://localhost:8080 npm run dev`.

**Building the Java backend:** there is no local Maven — it builds in Docker. There are also *two*
`docker-compose.yml` files (repo root and `Java backend/`), so always be explicit or a bare
`docker compose` from the wrong cwd silently builds a different project's image and your fix
appears to do nothing:

```bash
docker compose -f ./docker-compose.yml --project-directory . build stock-tracker
docker compose -f ./docker-compose.yml --project-directory . up -d stock-tracker
```

## Architecture

A **desktop-first dark trading terminal** — a TanStack Start SSR app (NOT a plain SPA) that
visualises and explores OHLCV market data from a Spring Boot + TimescaleDB backend (the
`stock-tracker` repo), replays backtests, and ranks strategies.

The UI was rebuilt against `Dev-notes/Ananke Frontend Terminal Build Doc.md` (§-numbered; the
companion plan holds the *why*). Section numbers in code comments refer to it — a comment saying
`§8.1` is pointing at a contract, not decoration.

### Stack

| Layer | Library |
|---|---|
| Router | TanStack Router (file-based, `src/routes/`) |
| Data fetching | TanStack Query (React Query) — the **cold** path only |
| Tables | TanStack Table 8.21.3 (pinned; **not** 9.x) + TanStack Virtual |
| UI components | shadcn/ui (Radix + Tailwind v4) |
| Charts | `lightweight-charts` **5.2.0** (native panes) |
| Build | Vite via `@lovable.dev/vite-tanstack-config` |
| Tests | `@playwright/test` (visual + behavioural), plain-node unit tests |
| Deployment | Cloudflare Workers (`wrangler.jsonc`) |

### Source layout (abridged — full map in AGENTS.md)

```
src/
  lib/api/          ← typed client for the Spring backend (apiFetch unwraps { data } envelopes)
  lib/realtime/     ← §14 WebSocket hot path: socket / per-symbol stores / rAF coalescer
  lib/chart-theme.ts, chart-primitives/ ← canvas-facing token resolution + v5 pane/series primitives
  lib/event-calendar.ts, correlation.ts, pnl-distribution.ts ← pure feeds behind the §15 panels
  lib/api/copilot.ts, lib/api/sse.ts ← copilot SSE client + reusable frame parser
  components/terminal/ ← the design system: TerminalPanel, tabs, PanelState, controls/, table/
  components/copilot/  ← copilot surfaces: CodeBlock, BacktestCard, CopilotMarkdown
  components/metrics/  ← §15 analysis panels (strategy table, universe ranking, correlation, …)
  routes/           ← /, /data, /backtesting, /live, /metrics, /models, /copilot (+ dev/controls, DEV-only)
executor/           ← stdlib Python code executor mounted into the Jupyter container (copilot M0)
  routeTree.gen.ts  ← AUTO-GENERATED — never edit
```

### The five rules that keep this codebase coherent

1. **Semantic tokens only.** No hex/rgb literals and no `text-green-500`-style utilities in
   components. Canvas colors come from the chart theme registry (`lib/chart-theme.ts`), which
   resolves CSS custom properties once and re-resolves on theme change. The literal sweep is a
   grep, and it is expected to return nothing but the registry itself.
2. **SSR correctness is non-negotiable.** Anything read during first paint comes from a cookie via
   `readUiCookieServerFn` or from a route loader; client-only restoration happens behind a
   `mounted` gate that renders a geometry-identical skeleton. Never resolve a relative default
   (`new Date()`) inside `validateSearch` — it runs on the server and again during hydration.
   `tests/visual/hydration.spec.ts` fails the build if any route mismatches.
3. **State division.** URL = where you are; cookie = how the workspace is arranged; server = what
   the data is. If a shared link should land on it, it belongs in `validateSearch`.
4. **Query stays the cold path.** WebSocket data never enters the Query cache. It lands in
   per-symbol external stores read through `useSyncExternalStore`, coalesced to one flush per
   frame. The transport handler never calls `setState`.
5. **New tables are column presets, not components.** `TerminalTable` + a `ColumnPreset[]` in
   `components/terminal/table/presets/`. The memo boundary is the row and everything crossing it
   is a primitive — the moment a table needs its own `.tsx`, something has gone wrong.

### Chart architecture

`PriceChart` drives ONE `lightweight-charts` v5 instance with **native panes**: price (0), volume
(1), then RSI/MACD created and destroyed on toggle. Crosshair and range sync across panes are
native in v5 — the old `ChartSyncGroup` is gone. Trade markers use the `createSeriesMarkers`
plugin, attached lazily only while trades exist. Session bands and the price/replay pills are
custom pane/series primitives. See AGENTS.md for the v5.2.0 gotchas (pane 0's stretch factor is 2;
`logicalToCoordinate` returns 0 — not null — for fractional logicals; conflation is opt-in).

Client-side interval aggregation (`aggregatePriceBars`) buckets the API's raw 1-minute bars; the
backend always returns 1-minute data.

### Copilot

`/copilot` turns one prompt into a saved, backtested strategy, streamed as SSE. It **orchestrates**
Ananke rather than reimplementing it: generated Python executes in the **Jupyter** container (where
the SDK lives) via `executor/executor.py`, `k.export()` saves through the normal strategy endpoint,
the backtest runs through `BacktestEngineService`, and the AI analysis is stored on
`backtest_results.copilot_explanation` so it survives a reload.

Two constraints shape it, and both are load-bearing:
- The engine only re-runs `rsi_crossover` / `ema_crossover`, so the system prompt requires
  `params={'type': …}`. If the engine still refuses, the flow falls back to the run `k.export()`
  already persisted instead of discarding work that succeeded.
- The system prompt pins the real SDK contract — `get_data()` is positional (`from` is a Python
  keyword) and `k.run()` must precede `k.export()`. A generic LLM gets both wrong.

See AGENTS.md for the executor's chunked-body requirement, the Kimi `temperature` restriction, and
the `ObjectMapper`/`SseEmitter` traps.

### Timezones

Eastern, everywhere, derived from `Intl` — never a hardcoded −4/−5. Session state, the economic
calendar, distribution buckets, `/data`'s range inputs and its `time (ET)` column all agree. A
value converted through the *runtime's* local zone differs between the SSR process and the
browser, which is a hydration bug as well as a product one.

### Backend contract

Responses are wrapped as `{ data: [...], count: N }` or `{ content: [...] }`; `apiFetch` unwraps
them. Endpoints that do not exist yet (`/api/metrics/*`, `/api/orders`, `/api/deploy`, the price
socket) are built frontend-complete behind `PanelState kind="pending"`, which names the exact
endpoint it is waiting on. Nothing blocks on backend work; nothing renders a blank rectangle.

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8080` | Spring backend base URL |
| `VITE_WS_URL` | derived from base URL | Realtime price socket (§14) |
| `VITE_WS_ENABLED` | unset (off) | `1` enables the hot path; off = polling, unchanged |
| `VITE_JUPYTER_URL` | `http://localhost:8890` | JupyterLab URL for "Open in JupyterLab" |
| `VITE_FRED_API_KEY` | unset | Optional: live FRED release dates supersede the maintained calendar |

Backend-side (root `.env`, passed to `stock-tracker` by compose):

| Var | Default | Purpose |
|---|---|---|
| `KIMI_API_KEY` | unset | Copilot LLM. Unset = `/api/copilot/*` returns 503 and the tab explains why |
| `KIMI_BASE_URL` / `KIMI_MODEL` | Moonshot defaults | OpenAI-compatible endpoint + model id |
| `JUPYTER_EXECUTOR_URL` | `http://jupyter:5000` | Where Java reaches the Python executor |

### Adding a new route

1. Create `src/routes/your-route.tsx` with `export const Route = createFileRoute("/your-route")({...})`.
2. `routeTree.gen.ts` regenerates on the next `npm run dev` / build.
3. Add a nav entry in `src/components/AppSidebar.tsx`.
4. Mount the content inside a `TerminalPanel`, and give every empty/loading/error/pending branch a
   `PanelState`.
