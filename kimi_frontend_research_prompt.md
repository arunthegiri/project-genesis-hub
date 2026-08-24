# Deep Research Prompt — Frontend Techniques for a Trading Terminal

*Paste everything below into Kimi's deep research mode, with both audit documents attached.*

---

## Role and situation

You are researching frontend engineering techniques for **Ananke**, a self-hosted quant
research platform. Its web frontend is currently a competent charting/backtesting explorer
that needs to become a **terminal** — Webull/Bloomberg class in feel, not just in features.

Two independent code audits are attached. **Read them for context, then do not repeat them.**
They already tell you what is broken in this codebase. Your job is the opposite direction:
go find how the rest of the world solves these problems, and map those solutions back onto
the specific named defects.

**Do not re-audit the code. Do not restate the findings. Do not produce another list of
what's wrong.** Every section of your output should be about an external technique, pattern,
library behavior, or published practice that we could adopt — with the specific defect it
addresses named explicitly.

## The stack you must research within

- React 18/19 with **SSR**, TanStack Router (URL-as-state via `validateSearch`), TanStack Query
- **`lightweight-charts` v4.2.0 — hard-pinned. Do not research or recommend v5 migration,
  and be careful: a lot of published material assumes v5's native panes API, which we cannot
  use. Flag clearly whenever a technique you find is v5-only.**
- Already installed and currently unused: `cmdk`, `react-resizable-panels`, `sonner`,
  `@tanstack/react-virtual`
- Backend: Spring Boot (data only), TimescaleDB, Alpaca as the sole data feed
- Dark-only design system with oklch semantic tokens (`--bull`, `--bear`, `--neutral`,
  `--panel`), JetBrains Mono with tabular numerals

## Design values that should shape what you recommend

1. **The UI never forgets where you were.** Navigate away and back and the page is exactly as
   left — including the exact replay bar you were paused on. Full UI state restoration, not
   just data caching.
2. **The viewport belongs to the user.** Nothing may move, reset, or refit a chart the user
   has panned or zoomed.
3. **Measure everything.** A serious system instruments itself — latency, staleness, and
   data quality should be visible, not inferred.
4. **The frontend displays; it never decides.** No trading logic in the browser.

---

## Research questions

Weight your effort roughly in this order.

### A. Chart readout and interaction conventions (highest priority)

Our charts have no crosshair readout, no volume pane, no last-price line, and no scale modes.
Research what the actual conventions are, precisely enough to implement:

- **Crosshair OHLC legends**: where they sit, what they contain, how indicator values at cursor
  are presented and colored, what happens on mouse-out, how Bloomberg/Webull/TradingView/Thinkorswim
  differ. Include the `subscribeCrosshairMove` implementation pattern in lightweight-charts v4.
- **Volume panes**: pane height ratios, direction coloring conventions, volume MA overlays, and
  how to attach a histogram series to a price chart in v4 (scale margins, `priceScaleId: ''`).
- **Price scale modes**: log vs percent vs indexed-to-100, when each is expected, how a
  last-price line with a colored tag is conventionally rendered.
- **Session shading** for pre/regular/post market, and how terminals visually mark gaps,
  halts, and non-trading periods.
- **Time navigation**: terminals put an overview mini-chart / time navigator along the bottom.
  Find the standard interaction model and any v4-compatible implementations.

### B. Multi-chart synchronization and linked windows

- Crosshair and time-scale sync across independent `lightweight-charts` v4 instances —
  the re-entrancy guard patterns people actually use, and their failure modes.
- Bloomberg-style **colored link groups** (panels linked by symbol into named groups): what
  the interaction model is and how it's typically modeled in state.
- Layout presets and named workspace persistence, specifically with `react-resizable-panels`.

### C. Rendering high-frequency data in React without re-rendering the app

Our pan/zoom currently round-trips chart state through React parent state, re-rendering a
whole panel at drag frame rate.

- Patterns for keeping 60fps interaction data **out** of the React render cycle: refs plus
  imperative subscriptions, `useSyncExternalStore`, transient-update patterns (the Zustand
  subscribe-without-render approach), rAF throttling and coalescing.
- When it is correct to let an imperative library own a subtree entirely, and how to do that
  cleanly in React 18/19 with StrictMode double-invocation.
- How to throttle a live tick stream to frame rate without dropping the last value.

### D. Progressive and windowed time-series loading

- **Level-of-detail strategies**: LTTB and other downsampling algorithms, server-side vs
  client-side, and where visual fidelity actually breaks for candlesticks specifically
  (OHLC downsampling is not the same problem as line downsampling — cover this).
- Coarse-then-refine loading: render a low-resolution view immediately, refine in place.
  Find real implementations, not just the idea.
- **TanStack Query patterns for range queries**: query-key design for time ranges,
  `placeholderData: keepPreviousData` behavior during refetch, structural sharing, how to
  avoid cache explosion when every zoom creates a new key, and windowed/overlapping-range
  caching strategies.
- TimescaleDB `time_bucket` and continuous aggregates for OHLCV resampling — correct
  first/last/max/min/sum semantics, and hierarchical rollups.

### E. Realtime data in the browser

- WebSocket fan-out from a single upstream connection to many browser clients: subscription
  multiplexing, backpressure, and message batching.
- Reconnection with gap backfill — how to resume a bar stream without duplicates or holes,
  and the sequence-number/timestamp reconciliation patterns used in market data.
- Multi-tab strategies: SharedWorker or BroadcastChannel for one socket per browser rather
  than one per tab. Is this worth it, and what breaks?
- Binary encoding on the wire vs JSON, and whether it's justified at bar-level (not tick) rates.

### F. SSR hydration without a layout flash

Persisted layout currently renders defaults on the server, then snaps post-mount.

- Cookie-based state persistence for SSR-correct first paint, specifically with TanStack Router.
- The tradeoffs versus a mounted-skeleton gate, and what production apps with user-customizable
  layouts actually do.

### G. Keyboard-first interaction

- Command palette design beyond the basic `cmdk` demo: command registries, scoped/contextual
  commands, recent and fuzzy ranking, nested modes.
- Single-key and chord shortcuts on a chart surface, discoverability, and how terminals
  teach their own keyboard model.

### H. Trust and data-quality surfaces

- How professional tools display data coverage, gaps, backfill-in-progress, staleness, and
  connection state. Coverage timelines, hatched gap bands over charts, status bars.
- Conventions for staleness thresholds and how "this data is old" is signaled without alarm fatigue.

### I. Measuring jank properly

- Long Animation Frames API, INP, React Profiler, and Chrome performance tooling as applied to
  a chart-heavy app. What to measure, what budgets to hold, how to catch regressions in CI.

---

## Output format

Structure the report by the sections above. For **each technique** you recommend, give:

1. **Technique** — what it is, in enough detail to implement without re-reading the source.
2. **Which named defect it addresses** — cite the specific finding from the attached audits
   (e.g. "no crosshair readout," "pan/zoom re-renders whole panel," "hydration flash").
3. **Implementation sketch against our stack** — concrete, using our actual libraries and
   versions. Note explicitly if it requires backend work.
4. **Cost and risk** — effort, what it might break, what it locks us into.
5. **Source** — link, with the date. Flag anything older than ~2 years that may be stale, and
   anything that assumes `lightweight-charts` v5.

Close with a **ranked shortlist of the 10 highest impact-per-effort items**, and a separate
short list of **things you found that we should deliberately not do**, with reasons.

## Constraints on your recommendations

- **No new charting library.** Not TradingView's Charting Library (licensing), not Highcharts,
  not ECharts, not a canvas rewrite. Work within `lightweight-charts` v4.2.0.
- **No new state-management or data-fetching library** unless you can show the existing stack
  genuinely cannot do it. "Zustand is nicer" is not sufficient.
- **No generic React performance advice.** We do not need to be told about `React.memo`,
  `useCallback`, or key props. Only techniques specific to high-frequency financial UIs.
- **No rewrite proposals.** Every recommendation must be adoptable incrementally.
- **Prefer primary sources**: library docs and source, engineering blogs from trading and
  data-visualization teams, conference talks, published implementations. Avoid content-farm
  listicles and AI-generated tutorial spam.
- Where sources conflict or where a technique is contested, **say so** rather than picking
  a side silently.
