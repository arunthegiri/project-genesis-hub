You are a senior frontend architect specializing in professional trading and
financial terminal interfaces. You have full read access to this repository.
Your task is to produce a concrete, staged plan to transform the existing
Ananke React frontend into something visually indistinguishable in quality
from a production trading terminal, using Webull Desktop as the primary
reference. Use web search where you need current library information, and
cite sources.

## STEP 0 — READ THE REPO FIRST
Before proposing anything, inspect and report:
- The frontend framework, build tool, and styling approach currently in use
  (Tailwind? shadcn/ui? MUI? CSS modules? plain CSS?)
- The charting library, if any, and how it is currently themed
- All existing route/page components and what each one renders
- How UI state is currently encoded in the URL, and how TanStack Query is
  wired to it
- How WebSocket data enters React state today
- Every existing color value, hardcoded or otherwise, and where it lives
Produce a short "current state" section. Every later recommendation must be
expressed as a delta from what actually exists, not from a generic React app.

## ANANKE DOMAIN CONTEXT
A quant research platform. The user is a single researcher who is also the
platform's first customer. Pages:
- Backtesting: candlestick chart with a replay scrubber (pause on any bar,
  step forward/back), trade entry/exit markers, equity curve, metrics panel
- Live monitoring: positions, open orders, PnL, latency telemetry
- Strategy list: each strategy carries a source badge (Python SDK / ONNX
  model / C++ engine) and a mode badge (backtest / paper / live)
Hard constraints, both intentional and expensive to change:
- Full UI state must be restorable from the URL. Navigate away and back and
  the user lands on the exact same replay bar index and zoom level. The bar
  index is ABSOLUTE (position in the full dataset) so it survives zoom changes.
- Data layer is TanStack Query.
- Live data arrives over WebSocket at high frequency.
Data available is OHLCV BAR data only — no tick data, no Level 2, no order
book, no quote-level microstructure. Do not propose components that require
data the platform does not have.

## SECTION A — THE EXTRACTED REFERENCE DESIGN SYSTEM
The following was derived from direct analysis of Webull Desktop screenshots.
Treat this as the visual specification. Your job is to research how to
implement each item well and to fill in exact values, not to rediscover the
list. Learn the conventions; do not reproduce Webull's logo, brand marks, or
proprietary illustrations.

A1. SURFACE AND ELEVATION
There are at least four distinguishable background layers, all very dark
navy-black rather than neutral gray, and never pure black:
  L0 app shell / gutter (darkest)
  L1 panel body
  L2 panel header + active tab (lighter)
  L3 row hover / selected row (lightest)
Contrast between adjacent layers is very low — roughly 3-6% lightness steps.
Borders are 1px, cool blue-gray, and sit at very low contrast against L1.
Research: derive concrete hex values for a 4-layer dark scale that maintains
this feel while passing WCAG AA for text on every layer. Explain why the
blue-shifted dark reads as "financial" versus a neutral gray dark.

A2. PANEL / TAB CHROME — the single most identity-defining element
Every region of the UI is a panel. Every panel has:
  - a header strip carrying one or more TABS; the active tab is raised to L2
    with a subtle top-corner radius, inactive tabs sit flush at L1
  - tabs may be sibling views of the same panel ("Index Chart | Yield Curves |
    Net Inflow | Market Overview", "Orders | Positions", "Ladder | Trade |
    TurboTrader")
  - a hamburger/list options icon pinned to the far right of the header
  - left/right chevrons that appear when the tab strip overflows
There is a SECOND, different tab style used inside panel bodies: text-only
tabs with a 2px accent-blue underline and blue active text ("Top Gainers /
Top Losers", "Recently Viewed / All Stocks (34) / My Watchlist (14)"). Note
counts rendered in parentheses in the tab label.
Research: build both tab variants as reusable components. Specify exact
heights, padding, radius, and the overflow-chevron behavior.

A3. GLOBAL CHROME
- Left icon rail, ~64px, full height, monochrome outline icons, active item
  marked subtly, small red notification dots on icon corners
- Top bar: brand, icon actions with badge dots, centered search field, right-
  side account/status readouts
- Persistent bottom status bar: horizontally scrolling ticker tape of
  symbol + price + change, a refresh control, and local time with seconds
Research: the ticker tape specifically — how to scroll it smoothly without
causing React re-renders or layout thrash, and how to make it pausable on hover.

A4. TABLE DESIGN — study this closely, it carries most of the density
- Row height is tight (~40-44px at the density shown), single-line
- No vertical gridlines; column separation comes from alignment and a faint
  1px header underline only
- Horizontal row dividers at very low contrast
- All numerics right-aligned with tabular figures
- CRITICAL DETAIL: color is applied PER CELL based on that cell's own
  comparison, not per row. In the watchlist, "Prev Close" is neutral white
  while "Last", "Change", "% Change", "Open", "High", "Low" are each
  independently green or red. Two cells in the same row routinely differ.
- A drag handle (≡) appears in the leftmost gutter on row hover
- Selected row gets an L3 background; hovered row gets a lighter treatment
- Inline sparkline column: tiny line chart with a dotted horizontal baseline
  at the reference price, colored to match direction
- Small metadata chips beside the symbol (2px radius, ~10px text, colored
  fills) for per-row attributes
Research: virtualized table implementations that support all of the above,
plus per-cell conditional coloring without re-rendering the whole row on tick.

A5. FINANCIAL COLOR SEMANTICS
Up is a teal-leaning green, down is a pink-leaning red — notably NOT pure
#00FF00/#FF0000. Both remain legible on all four surface layers. A magenta/
pink is used for indicator overlay lines (MA), a purple for secondary
overlays, and a single accent blue for links, active tabs, and primary buttons.
Research and specify: exact values; a colorblind-safe alternative pair; the
Western green-up vs East Asian red-up convention as a user preference; and
how "neutral / unchanged" is rendered distinctly from both.

A6. CHART SURFACE
Observed features, all of which matter for the backtesting page:
- OHLC legend overlaid in the chart's top-left, per-value colored:
  "O 25.34  H 25.65  L 25.33  C 25.57  +0.23 (+0.91%)  Vol 1,319,803"
- Indicator legend on its own line below, with the indicator name in the
  indicator's own color ("MA  MA5 24.83")
- Volume subpane beneath the price pane, bars colored by candle direction,
  with a shared synchronized crosshair
- Current price rendered as a filled colored PILL on the right price axis,
  with a countdown pill directly beneath it showing time to bar close
- Session shading: vertical background bands distinguishing regular hours
  from extended/overnight, plus sun/moon glyphs on the time axis
- Bottom toolbar: "Range: 1D 5D 1M" and "Interval: 1m 5m 30m 1h D W M" as
  segmented text controls, plus Night/Ext./Auto toggles
- Top toolbar: icon buttons for chart type, drawing tools, indicators,
  layout grid, compare, playback, alerts
- Multiple charts can be tiled side by side, each with its own full header
Research: which of these the recommended charting library supports natively
versus what must be custom-drawn as an overlay. The price pill, countdown
pill, and session shading are the three most likely to need custom work.

A7. FORM CONTROLS
- Segmented binary toggle where the active side is filled with a semantic
  color and the inactive side stays neutral (the Buy/Sell control)
- Segmented multi-option control for enumerated choices (Limit/Market/Stop)
- Numeric input paired with a unit-mode toggle group (shares / % / $)
- Quick-fill preset buttons in a row beneath a numeric input (10/50/100/500)
- Two-column label/value metadata grids: muted label left, white or colored
  value right-aligned
Research: build these as a reusable primitive set. Specify sizing and states.

A8. EMPTY, LOADING, AND ERROR STATES
Every empty region carries a small line-art illustration, one short line of
muted text, and optionally a single accent-blue action link. This is a large
part of why the product reads as finished rather than half-built. Note the
paywall variant: illustration + explanation + inline upgrade link.
Research: a coherent illustration approach (icon set, custom SVG, or a
library) and specify empty/loading/error variants for every panel type below.

A9. DIALOGS AND NOTICES
Dark card, icon + title row, body text, an inline accent link, a "Don't remind
me again" checkbox, and a single primary blue button bottom-right.

## SECTION B — COMPONENT INVENTORY TO BUILD
Map each reference pattern to its Ananke equivalent. For each: specify props,
states, and which reference pattern it derives from.

B1. STRATEGY TABLE — derives from the watchlist table.
Columns: strategy name, source badge, mode badge, symbols, Sharpe, total
return, max drawdown, win rate, trade count, last run, equity sparkline.
Per-cell conditional coloring. Sortable, virtualized, row-selectable.

B2. UNIVERSE / SYMBOL RANKING TABLE — for the V2/V3 staircase.
Backtest one strategy across many symbols, rank by Sharpe, human picks
winners. Same table primitive, different columns. Needs multi-select so a
user can promote a subset to a deploy list.

B3. BACKTEST REPLAY CHART — the highest-value component.
Reference features that transfer directly: the OHLC legend overlay, indicator
legend, volume subpane, session shading, and the price pill. The bar-close
countdown pill becomes a REPLAY POSITION indicator instead.
Additions with no Webull equivalent: entry/exit trade markers on the price
pane, a scrubber/transport control (play, pause, step ±1 bar, speed), and an
equity curve pane synchronized to the same crosshair and x-axis.
Constraint: the scrubber position is an absolute bar index and must round-trip
through the URL. Explain exactly how you would encode chart viewport + replay
index + indicator config in the URL without producing an unusable URL.

B4. CORRELATION / PERFORMANCE HEATMAP — derives from the sector treemap.
For V2 universe testing: which symbols this strategy works on, and where
returns are correlated. Treemap or matrix; recommend which and why.

B5. EVENT CALENDAR PANEL — derives from the Earnings/Dividends/Economy tabs.
This is a genuine planned feature, not decoration: Themis needs to suppress
trading around Fed / CPI / NFP releases. Design the panel to be readable both
as a research view and as a source of blackout windows the risk manager
consumes. Research free/cheap sources for US economic release calendars.

B6. STRATEGY DEPLOY PANEL — derives from the order entry panel.
Segmented paper/live mode toggle with live visually distinct and requiring
confirmation. Symbol list input. Explicit confirm step. This is the one place
where a mis-click has real consequences — treat the visual weight accordingly.

B7. LIVE MONITORING — positions and orders tables, plus a latency breakdown
panel (bar arrival → signal → order → fill) rendered as a stacked horizontal
bar or waterfall. The persistent bottom ticker tape shows live positions.

B8. TRADE LOG — derives from Time&Sales. Timestamp, symbol, side, price,
size, colored by side, virtualized, auto-scrolling with a pause-on-scroll.

B9. PnL DISTRIBUTION PANEL — derives from the Vol Analysis price-level
histogram (price level + proportional horizontal bar + percentage). Reuse the
visual pattern for PnL-by-time-of-day, PnL-by-day-of-week, and trade outcome
distribution, all of which the vision doc lists under "measure everything."

EXPLICITLY OUT OF SCOPE: DOM/ladder, Order Book L1/L2, and any quote-level
microstructure panel. The platform has bar data only; these would render
empty or require fabricated data.

## SECTION C — RESEARCH QUESTIONS
C1. Charting library. Compare TradingView Lightweight Charts, ECharts, uPlot,
and Highcharts Stock on: candlestick quality, performance at 100k+ bars,
multi-pane with synchronized crosshair, custom markers, overlay legends,
runtime retheming, licensing, and — decisively — support for a replay/scrub
interaction. Recommend one, with the migration cost from whatever the repo
uses today.
C2. Dockable panel layout. Evaluate dockview, rc-dock, golden-layout, and
react-resizable-panels. Requirement: per-panel tab strips as described in A2,
and layout state that serializes alongside existing URL state. Explain how to
compose layout state with route state without breaking either.
C3. Theming mechanics. CSS custom properties vs Tailwind theme config vs
CSS-in-JS for runtime switching. Cover: no flash of wrong theme on load,
prefers-color-scheme, persistence, and propagating the active theme into the
charting library so charts retheme in sync with the DOM.
C4. Deliver complete token tables for four themes: the Webull-style dark
above, a light theme, a high-contrast/accessible theme, and one alternative.
Semantic token names only — no raw color names.
C5. Typography. Which typefaces professional terminals use. Cover
font-variant-numeric tabular figures, decimal alignment in price columns,
large-number formatting, and preventing width jitter as numbers tick.
Recommend specific free or affordably licensed fonts.
C6. Real-time performance. Patterns for high-frequency WebSocket updates in
React without render storms: update batching, rAF coalescing, separating hot
streaming state from cold TanStack Query state, and per-cell subscriptions so
only visible changed cells re-render. Include the flash-on-change effect
without re-rendering the row.

## OUTPUT FORMAT
1. Current state report from Step 0.
2. One-page executive summary: recommended stack, and the single highest-
   impact change.
3. Each section above with concrete code, token tables, and cited sources.
4. A prioritized roadmap ranked by visual impact per unit of effort,
   separating what is achievable in a week from what is a month of work.
5. An explicit list of anything that would require rewriting the TanStack
   Query layer or the URL-state architecture, with cost estimates. Those are
   intentional designs and should only be changed with a stated reason.'