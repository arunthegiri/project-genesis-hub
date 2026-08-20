# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

**Node 24 (`.nvmrc`); minimum 22.12 (`engines`).** vite 7 requires ≥20.19/≥22.12 and Node 18 is
EOL, so an 18.x shell cannot build this repo at all — `npm run build` dies in the vite config load
with an `ERR_REQUIRE_ESM` stack trace that looks like a dependency bug rather than a version
problem. `nvm use` before anything. This bites the Playwright harness hardest: `playwright.config
.ts` has a `webServer` block, so on a stale shell the suite spawns its own dev server, fails at
startup, and reads as a broken harness.

```bash
nvm use              # Node 24, per .nvmrc — do this first in a new shell
npm run dev          # start Vite dev server (defaults to port 3000 or 5173)
npm run build        # production build
npm run build:dev    # development build
npm run lint         # ESLint
npm run format       # Prettier (write)

npm run test:visual        # Playwright visual + behavioural suite (build doc §2 harness)
npm run test:visual:update # …re-record baselines (review every diff in the PR)
npm run test:unit          # plain-node unit tests: chart theme, calendar, correlation, distributions
```

The visual harness stubs every `/api/*` call (`tests/visual/fixtures.ts`) and fails a test if any
request escapes the stub set, so the suite never needs the Spring backend running. Beyond
screenshots it asserts the contracts that a screenshot cannot see: the §8.3 scroll/memo budgets,
the §14 "a streamed price re-renders zero rows" rule, and `hydration.spec.ts`, which loads every
route and fails on any React hydration mismatch (§1.3).

To run against the Spring Boot backend:
```bash
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

### Docker

The full stack (TimescaleDB, Spring backend, Jupyter, frontend) runs via the root `docker-compose.yml`. **The frontend container is behind the `full` profile**:

```bash
docker compose up -d                          # db + backend + jupyter only (daily dev; run frontend on host)
docker compose --profile full up -d --build   # entire stack containerized
docker compose --profile full down            # stop everything (keeps db volume)
```

Notes:
- Builds use BuildKit cache mounts (npm + Maven) and a slim `.dockerignore` context — don't remove the `RUN --mount=type=cache` lines from the Dockerfiles.
- The frontend container serves the **production build** via `wrangler dev` (workerd runs the TanStack Start bundle from `dist/`, glibc `node:22-slim` runtime — workerd has no musl build). It is NOT a vite dev server: assets are content-hashed and immutable, so stale-chunk/dep-reoptimization reload failures can't happen. For frontend work, prefer host `npm run dev` over rebuilding the frontend image.
- Explicitly targeting a service (`docker compose up -d --build frontend`) works without the profile flag.

## Architecture

This is a **desktop-first dark trading terminal** — a TanStack Start SSR app (NOT a plain SPA) that visualises and explores OHLCV market data stored in a Spring Boot + TimescaleDB backend (the `stock-tracker` repo).

### Stack

| Layer | Library |
|---|---|
| Router | TanStack Router (file-based, `src/routes/`) |
| Data fetching | TanStack Query (React Query) |
| UI components | shadcn/ui (Radix UI primitives + Tailwind v4) |
| Charts | `lightweight-charts` v5 (TradingView) |
| Build | Vite via `@lovable.dev/vite-tanstack-config` |
| Deployment | Cloudflare Workers (via `wrangler.jsonc`) |

### Key source layout

```
src/
  lib/api/          ← typed HTTP client for the Spring backend
    client.ts       ← apiFetch(), unwraps Spring { data: ... } envelopes
    config.ts       ← VITE_API_BASE_URL / VITE_WS_URL / VITE_WS_ENABLED
    metrics.ts      ← §15.4 B7 latency contract (NOT implemented backend-side — the panel renders `pending`)
    types.ts        ← PriceBar, Trade, Interval — must stay in sync with backend DTOs
    prices.ts       ← pricesApi.range()
    symbols.ts      ← symbolsApi CRUD
  lib/indicators.ts ← pure-JS SMA, EMA, RSI, MACD, Bollinger (no deps, NaN warmup)
  lib/price-bars.ts ← client-side OHLCV aggregation by Interval bucket
  lib/date-range.ts ← preset ranges (1D/5D/1M…), UTC conversion for API params
  lib/datetime.ts   ← datetime-local input → ISO UTC, interpreted in ET (NOT the runtime's zone — see SSR notes)
  lib/correlation.ts ← §15.1 pure correlation math (log returns, timestamp alignment, Pearson matrix)
  lib/pnl-distribution.ts ← §15.4 B9 bindings: PnL by ET hour / ET weekday / outcome bucket
  lib/event-calendar.ts ← §15.3 B5 event feed + `blackoutWindows()` (the machine-readable half the risk manager consumes)
  lib/data/economic-releases.ts ← maintained FOMC/CPI/NFP schedule (ET dates + times, `VERIFIED_THROUGH_DATE`)
  lib/realtime/     ← §14 M5 hot path: socket.ts (flagged transport + backoff + ?wsMock=1), symbol-stores.ts (per-symbol useSyncExternalStore cells), coalesce.ts (module-scope rAF flusher)
  lib/python-export.ts ← generates pandas + SQLAlchemy snippets mirroring the UI query
  lib/chart-primitives/ ← §11 M2 canvas-facing primitives: session-shading.ts (extended-hours bands pane primitive + sun/moon tickMarkFormatter + etDayKey/prevSessionClose), price-pill.ts (direction-colored last-price gutter pill + replay pill), chart-tokens.ts (readCssToken — lazy computed-style reads, never module scope/draw path)
  lib/command-registry.ts ← §17 command registry (registerCommands on mount/cleanup, stable IDs, recents in localStorage) + palette open state + hotkey scope stack
  lib/active-chart-panel.ts ← §17 active-panel signal: palette symbol jumps apply to the last-interacted ChartPanel; off "/", a pending symbol is stashed and consumed by the charts page
  lib/theme.ts        ← §13 theme prefs store (theme/convention/colorblind in the ui.theme cookie), no-flash script source; no localStorage
  components/
    PriceChart.tsx  ← lightweight-charts wrapper; one chart instance with native panes (volume, RSI, MACD) + §11 M2 primitives (session bands, price pill); focusable chart surface with §17 hotkeys
    ChartPanel.tsx  ← chart panel + data panel (react-resizable-panels v4 Group/Panel/Separator; split layout cookie-persisted via useDefaultLayout + §13 cookie storage); ALL chart controls live on the §11 M2 toolbars — top icon row (type, indicators, compare, alerts) and bottom row (Range + Dates + Interval), one state path shared with the §17 hotkeys. The pre-terminal shadcn control bar they replaced is gone (M2a); no `Custom` range segment by design — editing a date sets rangePreset=CUSTOM and deselects every segment. Registers its own palette commands
    CommandPalette.tsx ← §17 ⌘K palette on cmdk (local commands + debounced symbol jump)
    ThemeSettings.tsx ← §13.3 settings popover (4-theme picker + market-convention + colorblind toggles); mounted in TopBar's left slot
    BacktestingChart.tsx ← candlestick chart for backtesting replay; §11 M2 price pill carries the replay position (`Bar X / N`)
    EquityChart.tsx ← equity curve chart
    SymbolPicker.tsx
    DateRangePicker.tsx
    PythonExport.tsx
    metrics/        ← §15 M6–M8 analysis panels (data-fetching hosts for the renderers below): StrategiesPanel (B1), UniversePanel (B2 + promote footer), CorrelationPanel (B4), DistributionsPanel (B9), LatencyPanel (B7)
    terminal/       ← §4/§6 terminal chrome: TerminalPanel, PanelTabs, UnderlineTabs, IconButton, MetaGrid, PanelState, TickerTape (§14.1), CorrelationMatrix (§15.1 canvas), PnlDistribution (§15.4), LatencyWaterfall (§15.4), EventCalendar (§15.3) (+ art/ — 96×96 hand-drawn state SVGs), controls/ (§9 W7 form primitives: SegmentedControl, SemanticToggle, UnitInput, QuickFillRow — Radix ToggleGroup items are role="radio", arrows move focus only, Enter/Space selects), table/ (§8 W6: TerminalTable + TerminalRow memo boundary + cells.tsx + density.tsx + presets/ — new tables are preset arrays, never new components)
    backtesting/    ← backtesting sub-components (TradeLog on §8 TerminalTable via presets/trades.ts — single-line rows, no prices; RunHistory)
    ui/             ← shadcn/ui components (don't edit manually — use shadcn CLI)
  hooks/
    useChartBase.ts ← shared chart lifecycle: chartOptions(), toTs, chart create/destroy; registers each chart with the §13.4 ChartThemeRegistry
    useChartTheme.ts ← reactive §3.4 chart theme for components (re-resolves on theme/convention/cb attribute change)
    useThemePrefs.ts ← useSyncExternalStore binding for the §13 theme store (server snapshot = root loader value)
    useTickerItems.ts ← §14.1 tape source: live positions first, charted symbols after; seeds the realtime stores from the cold snapshot
    useFlashOnChange.ts ← §14.3 flash: classList write in an effect (a ref mutated during render is not idempotent — dev double-render silently swallowed the flash)
    useHotkeys.ts   ← §17 scoped chart single-keys (1/5/15/H/D interval pin, R reset, V volume, / indicators, bare letter → symbol jump)
  routes/
    __root.tsx      ← layout shell: QueryClientProvider + AppSidebarWithHealth (§6.4: health-probe failures dot the owning nav icons) + <Outlet> + global ⌘K handler & CommandPalette; root loader reads ui.theme server-side and the shell stamps data-theme/data-convention/data-cb (+ inline no-flash script)
    index.tsx       → /            Charts page (live)
    data.tsx        → /data        Raw data explorer with virtualised table (live)
    backtesting.tsx → /backtesting Backtesting replay + strategy runner (live; §9 W7: replay speed is a SegmentedControl, starting capital a UnitInput + QuickFillRow presets — both write straight to URL search params; §12 M3: `cursor` + `view` replay params — cursor writes in the rAF flush, view debounced 300ms, both replace-only; view restores via BacktestingChart's initialRange prop, never through visibleRange state)
    live.tsx        → /live        Live portfolio + positions + §15.3 economic calendar (blackout windows next to the book that they constrain)
    metrics.tsx     → /metrics     §15 analysis workspace — PanelTabs over Strategies (B1) / Universe (B2) / Correlation (B4) / Distributions (B9) / Latency (B7); `?tab=` and `?strategy=` are URL state (replace-only)
    models.tsx      → /models      Model registry (live)
    dev/controls.tsx → /dev/controls §9 W7 storyboard: every form primitive × state, DEV-only (production renders a redirect to /); baseline for tests/visual/controls.spec.ts
  routeTree.gen.ts  ← AUTO-GENERATED by TanStack Router plugin — never edit manually
```

### SSR notes
- This is TanStack Start SSR — client-only state is handled two ways (build doc §13: "URL = where you are; cookie = how the workspace is arranged; server = what the data is"): workspace arrangement (panel set, chart height) lives in `ui.*` cookies (`src/lib/cookie-state.ts`) and is read server-side by the `/` route loader via `readUiCookieServerFn` (createServerFn + getCookie), so first paint is SSR-correct; per-panel internals restore post-mount behind ChartPanel's `mounted` gate, which renders the geometry-identical `PanelSkeleton` (sizing co-located in `src/components/PanelSkeleton.tsx`) until then. No render-then-snap, no `skipPersist`.
- Location-like view state belongs in `validateSearch` (see `/backtesting`, `/data`). **Relative defaults resolve in the route LOADER, never inside `validateSearch`** — validateSearch runs once on the server and again during hydration, so a `new Date()` in there returns two different answers and any rendered text derived from it (the /data Python snippet did exactly this) is a permanent hydration mismatch. Loader data is computed once server-side and dehydrated, so both renders read the same value.
- For the same reason `lib/datetime.ts` interprets `datetime-local` values in **ET**, not the runtime's local zone: `new Date(y, m, d, h, min)` reads the runtime's timezone, which differs between the SSR process and the browser. ET is also the right product answer — every other timestamp in this app is ET. `tests/visual/hydration.spec.ts` guards every route against regressions here.
- Theme prefs (`ui.theme` cookie) are read by the ROOT route loader via the same `readUiCookieServerFn` path; the shell stamps `data-theme`/`data-convention`/`data-cb` on `<html>` server-side, with an inline pre-paint script (`NOFLASH_SCRIPT` from `lib/theme.ts`) as the fallback that also resolves `prefers-color-scheme`. `<html>` carries `suppressHydrationWarning` for the no-cookie media-default case (next-themes pattern); post-hydration the `useThemePrefs` store re-stamps attributes declaratively.
- `lightweight-charts` at 5.2.x (build doc §10) — minor upgrades require re-running chart visual baselines
- Unused shadcn scaffold deps (`embla-carousel-react`, `vaul`, `input-otp`) are accepted scaffold — leave installed; removing them risks shadcn regen churn for zero runtime win

### Theme system (M4, build doc §13)

Four themes — `terminal-dark` (default), `paper-light`, `high-contrast`, `graphite-neutral` — selected by `data-theme` on `<html>`; token values live in per-theme blocks in `src/styles.css` (plan §5.4, WCAG-verified — don't retune). Two more independent axes compose via small CSS blocks: `data-convention="east-asian"` swaps `--dir-up`/`--dir-down` (red up), `data-cb="on"` swaps in the Okabe-Ito pair; precedence is by specificity (`[data-cb][data-convention]` (0,3,0) > single-axis (0,2,0) > base :root) so **colorblind always wins over convention**, source-order independent. Theme blocks store the raw pairs in `--_dir-*` privates (a swapped `--dir-up: var(--dir-down)` self-map would be a var() cycle). Components only consume tokens — nothing component-side changes per theme.

- Prefs persist in ONE `ui.theme` JSON cookie (`{ theme, convention, cb }`); the `theme` key is omitted until explicitly picked — an unset key is what keeps the `prefers-color-scheme` default + its change listener alive (listener detached on first explicit pick; re-clicking the active tab also counts as a pick).
- `.dark` class is kept on the three dark themes only (shadcn `dark:` variants, e.g. `ui/alert`, gate on it; sonner's `Toaster` theme follows the same `isDarkTheme()`).
- Charts: `chart-theme.ts`'s ChartThemeRegistry — `useChartBase` registers each chart's chart-level `applyOptions(chartOptions(theme))`; a `MutationObserver` on the three `<html>` attributes calls `applyAllChartThemes()` (invalidate → resolve once → apply to all + notify). Series-level colors re-apply via `useChartTheme()` (PriceChart re-runs its theme-dep effects; BacktestingChart/EquityChart `applyOptions` in place). No chart recreation, no state loss, no localStorage.

### Realtime hot path (M5, build doc §14)

Feature-flagged and backend-gated: with `VITE_WS_ENABLED` unset, `startRealtime()` (called once from `__root.tsx`) connects nothing and every table/ticker renders its polled TanStack Query value. The socket is an addition to the cold path, never a replacement for it.

- **Four-channel rule extended.** The transport handler never calls `setState` and never touches the Query cache. It writes into `lib/realtime/symbol-stores.ts` — one store per symbol — and `coalesce.ts` flushes at most one notification round per frame (module-scope rAF, so N symbols cost one callback). Query and the stream meet in exactly one place: `seedQuote()`, the REST snapshot that precedes the deltas.
- **Per-symbol, per-cell subscriptions.** A store per symbol (not one store with a map) is what keeps a NVDA tick from waking every mounted cell to conclude nothing of theirs changed. Cells subscribe through `useSyncExternalStore`; the `live` CellRender variant (`table/cells.tsx`) renders the streamed value when present and the polled `fallback` when not, so hot and cold share one row component and one preset.
- **The row is never involved.** The hot value does not travel through row props, so a tick re-renders exactly one leaf — asserted, not assumed: `tests/visual/realtime.spec.ts` drives the `?wsMock=1` feed at 20 msg/s and fails if `__terminalRowRenders` moves at all.
- **Ticker tape** (`TickerTape.tsx`, middle of the status rail): content duplicated twice inside a wrapper animated `translateX(0 → -50%)` — compositor-only, no JS per frame; duration written once from a ResizeObserver measurement (~60px/s, content-independent); hover pauses via one CSS rule; `prefers-reduced-motion` drops the animation and the duplicate copy and leaves a scrollable strip. Source is positions first, charted symbols after (`useTickerItems`).
- **Flash-on-change** is a classList write in an effect (`useFlashOnChange`), alternating `-a`/`-b` variants bound to *different* keyframe names — an element whose computed `animation-name` is unchanged continues its running animation instead of restarting, and the usual remove/read-`offsetWidth`/re-add fix forces a synchronous layout on the hot path.
- The five-state connection model in `lib/connection-state.ts` finally has its `ws-open`/`ws-close` producer; the status rail consumes it unchanged, as that module predicted.

### Analysis workspace (M6–M8, build doc §15)

`/metrics` is the home of the five data panels. Renderers live in `components/terminal/`, data-fetching hosts in `components/metrics/`, and every table is a **column preset**, not a new component (§8.2 item 3).

- **B1 strategy table** — `GET /api/strategies` carries no metrics, so Sharpe/return/drawdown come from `GET /api/strategies/{name}`'s `latestResults` (an N+1 over single-digit N, cached under the same `["strategy", name]` key `/backtesting` uses). Source badge is inferred from the strategy definition; mode comes from a real `deployMode` only.
- **B2 universe ranking** — ranks by actually running the strategy per symbol (`POST /api/strategies/{name}/run`), through a rolling window of 4 in flight so a large universe fills in progressively instead of hammering the backend. Checkbox column + sticky promote footer; promotion names `POST /api/deploy` (the B6 deploy panel is not scheduled in the build doc).
- **B4 correlation** — hand-rolled canvas (decision D3c), DOM labels, DOM hover crosshair, one paint per data/theme change. Correlation is computed on **log returns aligned by timestamp** (`lib/correlation.ts`); price-level correlation would read ≈ +1 for any two trending symbols. Undefined pairs are `NaN` and paint as background, never as a fabricated 0.
- **B5 event calendar** — `lib/event-calendar.ts` emits `BlackoutWindow[]` (release ± margin, half-open, sorted); the panel on `/live` is a view on that feed. Dates come from a maintained schedule with a `VERIFIED_THROUGH_DATE` horizon the UI warns past; FRED supersedes it when `VITE_FRED_API_KEY` is configured. There is deliberately no "first Friday" fallback — 2026 broke that rule three times.
- **B7 latency / B9 distributions** — token-native DOM, no chart library. B7's endpoint does not exist, so `pending` with the exact contract is its normal state today.
- Pure halves are unit-tested in plain node (`npm run test:unit`): calendar windows, correlation math, distribution bucketing (all ET-anchored).

### Chart architecture

`PriceChart` manages ONE `lightweight-charts` v5 instance via `useChartBase` with **native panes** (build doc §10):
1. **Price pane (pane 0)** — candlestick + overlay series (SMA, EMA, Bollinger). Chart created once via `useChartBase`; series recreated only on type/compare-mode change; data updates via `setData()`. Series are created with the unified v5 API: `chart.addSeries(CandlestickSeries, opts)` / `LineSeries` / `AreaSeries` / `BarSeries` / `HistogramSeries` (the v4 `addCandlestickSeries`-style methods are gone).
2. **Volume pane (pane 1)** — real pane holding a volume histogram (the v4 blank-`priceScaleId` overlay + `scaleMargins { top: 0.7 }` hack is deleted; the price scale keeps default margins). The series rides a custom overlay scale id (`priceScaleId: "volume"`) so it draws no axis — do NOT hide a pane's price scale with `visible: false`: in 5.2.0 that crashes the layout pass (`adjustSizeImpl` → "Value is null") whenever another pane's scale on the same side is visible.
3. **RSI / MACD panes** — real panes on the same instance, created/destroyed on indicator toggle (`chart.addPane()` + `pane.moveTo()` keep a canonical volume→RSI→MACD order; cleanup is `chart.removePane(pane.paneIndex())`, StrictMode-safe). Crosshair and visible-range sync across panes are native in v5 — the v4 `ChartSyncGroup` (`src/lib/chart-sync.ts`) and the separate sub-chart divs/instances are removed entirely.
4. **Markers** — trade entry/exit markers (PriceChart, BacktestingChart) use the v5 `createSeriesMarkers` plugin, attached LAZILY only while trades exist: in 5.2.0 the plugin's pane view calls `series.data()` on every update cycle (an O(bars) copy per pan/zoom frame even with zero markers), so an idle plugin measurably hurts at high bar counts.
5. **§11 M2 surface primitives** — `SessionBandsPrimitive` (pane primitive on pane 0, `zOrder: "bottom"`, extended-hours bands from ET wall-clock math, intraday-only guard) and `PricePillPrimitive` (series primitive `priceAxisViews`: direction-colored last-price pill vs the previous session's close, plus a replay-position pill stacked flush below it in BacktestingChart — the offset must not exceed the axis-label height or tick-label slivers peek through the gap). Where the pill attaches, the native `lastValueVisible` AND the built-in price line go off — v5.2.0 has no price-line-label switch, so the dotted last-price line is an explicit `createPriceLine({ axisLabelVisible: false })` fed by the pill state effect. Sun/moon day-boundary glyphs ride `timeScale.tickMarkFormatter` in `useChartBase.chartOptions()`. State flows in via `update()`/`setSegments()` field writes + the library's own `requestUpdate`; colors re-resolve on §13.4 theme change.
6. **v5.2.0 gotchas (verified against typings + runtime):** pane 0's default stretch factor is **2**, not 1 (size sub-pane `setStretchFactor` calls against that); `timeScale.enableConflation` defaults to **false** despite the "automatic at high bar counts" docs impression — `useChartBase` opts in explicitly (the 100k+-bar story); `timeVisible`/`secondsVisible` were NOT renamed; `logicalToCoordinate` returns **0, not null, for fractional logical indices** — convert with integer logicals and derive half-bar offsets from the run's average spacing (session-shading renderer).

Client-side interval aggregation (`aggregatePriceBars`) runs on raw 1-minute bars from the API and buckets them into the selected interval. The API always returns 1-minute data; resampling happens entirely in the browser.

### Backend contract

The Spring Boot backend wraps responses as `{ data: [...], count: N }` or `{ content: [...] }`. `apiFetch` in `client.ts` unwraps these envelopes automatically so callers see raw arrays/objects.

Backend endpoints currently implemented:
- `GET /api/symbols`
- `POST /api/symbols`
- `DELETE /api/symbols/{symbol}`
- `GET /api/prices/{symbol}/range?from=&to=`
- `GET /api/strategies`, `GET /api/strategies/{name}`, `POST /api/strategies/{name}/run`
- `GET /api/strategies/active`, `GET /api/account`, `GET /api/positions`, `GET /api/models`

Waiting on the backend (each renders a §6 `PanelState kind="pending"` naming the exact endpoint, never a blank panel — decision D5):
- `GET /api/metrics/engine?from=&to=` → `LatencySample[]` (§15.4 B7; shape proposed in `lib/api/metrics.ts`)
- `GET /api/metrics/strategy?name=&from=&to=`
- `GET /api/orders` (Live → Orders tab)
- `GET /api/trades/range` (probed, flagged)
- `POST /api/deploy` (B2's promote action; the B6 deploy panel itself is not scheduled in the build doc)
- A price WebSocket at `VITE_WS_URL` (§14 — the client is complete and flag-gated)

Two of these (`/api/trades/range`, `/api/metrics/engine`) are stubbed as deliberate 404s in the visual harness so the baselines show the real degraded state.

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8080` | Spring backend base URL |
| `VITE_WS_URL` | derived from base URL | Realtime price socket (§14; only dialled when the flag below is on) |
| `VITE_WS_ENABLED` | unset (off) | `1` turns on the §14 hot path. Off = polling exactly as before; the socket is an addition, never a replacement |
| `VITE_JUPYTER_URL` | `http://localhost:8890` | JupyterLab URL for "Open in JupyterLab" (see below) |

### Open in JupyterLab

The chart/data export panel (`PythonExport.tsx`) has an "Open in JupyterLab" button: `lib/jupyter-export.ts` writes the generated snippet as an `.ipynb` into the Jupyter contents API (`strategies/` → the `Test Trading Strategies` volume) and opens it in JupyterLab. Mechanics:

- Jupyter runs authless for local dev but enforces XSRF — the client warms the `_xsrf` cookie and echoes it as `X-XSRFToken`.
- API calls go through the app-level server route `src/routes/jupyter-api.$.ts`, which rewrites both Host and Origin (jupyter_server 404s writes whose Origin ≠ Host). Works identically under `vite dev` and the production worker. Target: `VITE_JUPYTER_PROXY_TARGET` baked at image build (`http://jupyter:8888` in the container); host dev default `http://localhost:8890`.
- The docker Jupyter is on host port **8890**, not 8888 — a host-local `jupyter-lab` process squats on 8888.
- Feature is local-dev only (the proxy exists in vite dev; there is no production Jupyter).

### Adding a new route

1. Create `src/routes/your-route.tsx` with `export const Route = createFileRoute("/your-route")({...})`.
2. The TanStack Router plugin auto-regenerates `src/routeTree.gen.ts` on the next `npm run dev` / build.
3. Add a nav entry in `src/components/AppSidebar.tsx`.

### Python export

`lib/python-export.ts` generates a self-contained pandas + SQLAlchemy script that reproduces the exact query visible in the UI. It targets the `stock_prices` TimescaleDB hypertable with columns `time, symbol, open, high, low, close, volume, vwap, trade_count`. The generated interval resampling mirrors `aggregatePriceBars` logic.
