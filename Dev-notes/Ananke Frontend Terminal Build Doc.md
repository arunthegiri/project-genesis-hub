# Frontend Terminal Transformation — Build Doc

**Companion to:** `docs/frontend-transformation/Ananke Frontend Terminal Transformation Plan.md` (the *what* and *why*). This document is the *how*: execution order, exact specs, dependency decisions, and a **Verify** block per item. It follows the conventions of the previous build doc: §-numbered sections, the §13 state division ("URL = where you are; cookie = how the workspace is arranged; server = what the data is"), and per-section acceptance checks.

**Audience:** the engineer/agent executing the work. Every item is self-contained: read the plan section it references, then execute the steps here.

---

## §0. Decisions log — settled before any code

These resolve the open questions raised on plan review. Each is final unless a step below explicitly re-opens it.

| # | Question | Decision |
|---|---|---|
| D1 | `lightweight-charts` pin (AGENTS.md: "pinned at 4.2.0 — do not upgrade") vs. plan item M1 | **Pin lifted as of this doc.** Target `5.2.0` exactly (released 2026-04-24, stable for 3+ months). §10 performs the upgrade and **rewrites the AGENTS.md line** in the same commit. API claims in the plan were checked against the v5 docs, but the executor must still verify every call signature against the installed package's typings (`node_modules/lightweight-charts/typings.d.ts`) at implementation time — treat the plan's API sketches as direction, not gospel. |
| D2 | Token migration mapping (old `--background`/`--bull`/… → new `surface-*`/`dir-*`/…) | **Alias-first migration** (§3): define the new tokens, then redefine every old token as `var(--new-token)` so all existing call sites keep working while the sweep proceeds incrementally. Full mapping table in §3.2. |
| D3a | `@tanstack/react-table` | **Approved, pinned `8.21.3`.** Do **not** install 9.x: v9.0.0 was released 2026-08-04 — one day before this doc was written — with a reworked state/feature model (`useTable`, opt-in features, `table.Subscribe`). It will be the right call eventually; it is not the right call for a build executed against v8-shaped examples. Revisit after v9 has patch releases and the shadcn data-table docs track it. v8 is MIT, headless, ~15 kB core, and composes with the already-installed `@tanstack/react-virtual`. |
| D3b | Inter font — self-host vs CDN | **Self-host via `@fontsource-variable/inter`** (OFL-1.1), latin subset only, imported in `src/styles.css`. No CDN: the app already self-hosts everything, runs behind a Cloudflare Worker, and a CDN font is a render-blocking third-party dependency we don't need. Details + preload in §7. |
| D3c | ECharts for the heatmap (B4) | **Rejected. Hand-rolled canvas** (~150 lines, §15.1). A ~1 MB dependency for one static-per-run panel fails the cost/benefit test; the correlation matrix is computed once per backtest run, so canvas paint-once is trivially sufficient. |
| D3d | Playwright | **Approved as devDependency: `@playwright/test`, Chromium project only.** The visual harness is §2 and is the *first* work item — before any visual change lands (lesson from the blank-chart incident: screenshot from change #1, not after 18 sections). |
| D4 | Per-item acceptance tests | Every work item below ends in a **Verify** block: commands to run, named screenshots to capture/review, and manual checks. An item is not done until its Verify block passes. |
| D5 | Backend-gated items (M5 WebSocket, M6 strategy-list API, B6 deploy API) | Build frontend-complete behind the existing health-probe pending pattern; polling stays the live fallback. No item may block on backend work. |
| D6 | Plan figure assets | Already committed at `docs/frontend-transformation/*.png` alongside the plan. New figures go in the same folder. |
| D7 | dockview (M9) | Deferred indefinitely. Re-evaluate only after W2 panel chrome has shipped and real multi-panel usage says fixed splitters aren't enough. react-resizable-panels stays. |

## §1. Working agreements

1. **One branch per work item** (`feat/terminal-w1-tokens`, …), one PR each, Verify block pasted into the PR description with screenshots attached.
2. **No raw color literals in components.** Semantic tokens only — the existing `styles.css` rule, now enforced per-item in review. Canvas-facing values come from the chart theme registry (§3.4), never from new literals.
3. **SSR correctness is non-negotiable.** Anything read during first paint comes from cookies via the existing `readUiCookieServerFn` path; client-only restoration happens behind the existing `mounted` gate + `PanelSkeleton` pattern. No render-then-snap.
4. **Query stays the cold path.** No WebSocket data in the Query cache, no exceptions (§14).
5. **Perf budgets** (from the previous build doc's `?perf=1` Loaf instrumentation): no dropped-frame Loaf events during replay at 10× speed; table scroll ticks ≤ 8 ms React work; ticker animation must not register main-thread frames (compositor only).
6. **Repo docs stay in sync:** any item that changes architecture updates `AGENTS.md` in the same commit (the pin line, the component map, the route table).

---

## §2. W0 — Playwright visual harness (prerequisite for everything)

**Goal:** deterministic, backend-free screenshot testing that runs from the first visual change.

**Steps:**

1. `npm i -D @playwright/test` then `npx playwright install chromium` (Chromium only — desktop-first app; add Firefox/WebKit later only if a cross-browser bug actually appears).
2. `playwright.config.ts` at repo root:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1600, height: 900 },   // desktop-first terminal
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",                  // kills the #1 flake source
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

3. **Deterministic data without the backend.** Pages under test fetch `/api/*` from the Spring backend; tests must not depend on it running. Use `page.route()` fixtures:

```ts
// tests/visual/fixtures.ts
import { test as base, type Page } from "@playwright/test";
import pricesFixture from "./fixtures/prices-range.json";
import symbolsFixture from "./fixtures/symbols.json";

export async function stubApi(page: Page) {
  await page.route("**/api/symbols", (r) =>
    r.fulfill({ json: { data: symbolsFixture, count: symbolsFixture.length } }));
  await page.route("**/api/prices/*/range?**", (r) =>
    r.fulfill({ json: { data: pricesFixture, count: pricesFixture.length } }));
  // unmatched /api/** → 404 on purpose: surfaces unstubbed calls in test output
  await page.route("**/api/**", (r) => r.fulfill({ status: 404, json: { data: [] } }));
}
```

   Generate `prices-range.json` once from the real backend (or synthesize: 500 deterministic 1-minute bars, fixed seed — same bytes every run) and commit it.
4. **Mask anything that moves.** The StatusRail clock, staleness ages, countdowns, and (later) the ticker change every run:

```ts
const DYNAMIC = [
  page.locator("[data-testid='session-clock']"),
  page.locator("[data-testid='staleness']"),
];
await expect(page).toHaveScreenshot("charts-baseline.png", { mask: DYNAMIC });
```

   Add `data-testid` hooks as part of each work item below (listed in its Verify block).
5. Seed suite (`tests/visual/`): one spec per route — `charts.spec.ts`, `data.spec.ts`, `backtesting.spec.ts`, `live.spec.ts` — each capturing one full-viewport baseline of the **current** UI. These baselines exist to prove the harness is stable, and are **replaced** (deliberate `--update-snapshots`, diff reviewed in PR) as each work item lands.
6. npm scripts: `"test:visual": "playwright test"`, `"test:visual:update": "playwright test --update-snapshots"`.

**Verify:**
- [ ] `npm run test:visual` green on an unmodified tree (run twice — second run must be a pure compare, no baseline writes).
- [ ] Deliberately change a color in `styles.css`, re-run: the affected spec fails and `test-results/` shows expected/actual/diff images. Revert.
- [ ] No network call leaves the stub set (check the catch-all 404 never matches in passing output).

---

## §3. W1 — Token expansion, alias map, literal sweep

**Plan ref:** §3.1, §5.4. **Branch:** `feat/terminal-w1-tokens`. **Effort:** 1–2 days.

### §3.1 New tokens (add to `src/styles.css`)

Add to the `:root` block (values are WCAG-verified against all four layers — see plan §3.1; do not retune without re-running the contrast check):

```css
:root {
  /* ── Terminal surface ladder ─────────────────────────────── */
  --surface-0: #0C0F16;   /* app shell / gutters (darkest)    */
  --surface-1: #12161F;   /* panel body                       */
  --surface-2: #1A2029;   /* panel header + active tab        */
  --surface-3: #242C38;   /* row hover / selected (lightest)  */
  --border-subtle: #2B3342;

  /* ── Text ────────────────────────────────────────────────── */
  --text-primary:   #E9ECF2;  /* 11.9:1 min on any layer */
  --text-secondary: #A6AEBD;  /*  6.3:1 min             */
  --text-muted:     #8F98AA;  /*  4.85:1 min (AA floor) */

  /* ── Direction / financial semantics ─────────────────────── */
  --dir-up:    #35C77A;   /* teal-leaning green, 6.4:1 min  */
  --dir-down:  #F86177;   /* pink-leaning red, 4.67:1 min   */
  --dir-flat:  #8F98AA;   /* unchanged = de-emphasized gray */
  --warning:   #E3B341;   /* caution / session PRE-POST     */
  --dir-up-cb:   #3FBF97; /* colorblind pair (Okabe-Ito–    */
  --dir-down-cb: #F07B4D; /* derived), swapped by pref      */

  /* ── Accent & overlays ───────────────────────────────────── */
  --accent-blue: #4C9AFF;
  --overlay-primary:   #F472B6;  /* MA lines (magenta)  */
  --overlay-secondary: #A78BFA;  /* secondary overlays  */

  /* ── Control geometry ────────────────────────────────────── */
  --control-h-sm: 24px; --control-h-md: 32px; --control-h-lg: 40px;
  --row-h-compact: 32px; --row-h-default: 42px;
}
```

Register them in the `@theme` block (`--color-surface-0: var(--surface-0);` etc.) so Tailwind generates `bg-surface-1`, `text-dir-up`, … utilities.

### §3.2 Alias map — old tokens become pointers (step zero, exactly what review asked for)

Replace the old definitions with aliases **in the same commit**, so every existing call site keeps rendering while the sweep proceeds file-by-file:

| Old token | Becomes | Note |
|---|---|---|
| `--background` | `var(--surface-0)` | app shell |
| `--panel` | `var(--surface-1)` | panel body |
| `--panel-header` | `var(--surface-2)` | header strip |
| `--card` | `var(--surface-1)` | shadcn compat |
| `--popover` | `var(--surface-2)` | shadcn compat |
| `--muted` | `var(--surface-2)` | shadcn muted surface |
| `--accent` (hover surface) | `var(--surface-3)` | old accent was a surface, not a blue |
| `--foreground` | `var(--text-primary)` | |
| `--muted-foreground` | `var(--text-secondary)` | was oklch 0.62 — fails AA on L3; alias **upgrades** it |
| `--secondary-foreground` | `var(--text-primary)` | |
| `--border`, `--input` | `var(--border-subtle)` | |
| `--ring` | `var(--accent-blue)` | focus ring |
| `--primary` | `var(--accent-blue)` | shadcn primary = our accent |
| `--bull` | `var(--dir-up)` | |
| `--bear` | `var(--dir-down)` | |
| `--neutral` | **split** — see below | |
| `--chart-1` | `var(--accent-blue)` | chart-2…5 → overlay/extended palette |
| `--grid` | `rgba(255,255,255,0.04)` | keep as-is, renamed `--grid-line` |
| `--sidebar*` | map to `surface-0/2/3` + text tokens | sidebar is L0 chrome |

**`--neutral` split (semantic fork, the one non-mechanical step):** today `--neutral` (amber) means two things — "unchanged/flat PnL" and "caution / PRE/POST session". Alias `--neutral` to `var(--warning)` for compatibility, then sweep call sites: numeric "no change" cells (`pnlColor` zero case in `live.tsx`, comparison cells) get `text-dir-flat` (gray); session badges/countdowns keep `text-warning` (amber). ~10 call sites; grep `--neutral` / `text-neutral` / `bg-neutral`.

### §3.3 Literal sweep

Known offenders (from the Step 0 audit — re-grep, don't trust the list):

- `src/hooks/useChartBase.ts` — `#9ca3af`, white-alpha grid/borders → fed from chart theme registry (§3.4).
- `src/components/PriceChart.tsx` — `#94a3b8`, `#cbd5e1`, `#475569`, `#f59e0b`, `#a78bfa` → tokens / registry.
- `src/routes/backtesting.tsx` (`bg-red-*`), `src/components/BackfillPanel.tsx` (`emerald-*`), `src/components/backtesting/HermesModelPanel.tsx` (`emerald-*`), `src/routes/live.tsx` (`yellow-500`/`zinc-500`/`blue-500` badges) → semantic badge variants (`--warning`, `--text-muted`, `--accent-blue` at /20 alpha fills).
- `src/lib/perf/loaf.ts` — dev-only overlay; leave, add a comment exempting it.

Sweep rule: `grep -rnE "#[0-9a-fA-F]{3,8}|text-(green|red|emerald|rose|yellow|amber|blue|zinc)-" src --include=*.tsx --include=*.ts` returns only exempted files.

### §3.4 Chart theme registry (kills the chart-colors.ts dual-maintenance hazard)

Replace `lib/chart-colors.ts` with `lib/chart-theme.ts`:

```ts
// Tokens are the source of truth. Canvas can't read var(), so resolve once
// from computed style and cache; resolveChartTheme() re-runs on theme change
// (§13 M4) and every registered chart gets applyOptions().
let cache: ChartTheme | null = null;

export interface ChartTheme { /* up, down, flat, accent, overlays[6], grid, text, scaleBorder */ }

export function resolveChartTheme(): ChartTheme {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  cache = {
    up: v("--dir-up"), down: v("--dir-down"), flat: v("--dir-flat"),
    accent: v("--accent-blue"), warning: v("--warning"),
    overlays: [v("--overlay-primary"), v("--overlay-secondary"), "#34d399", "#f59e0b", "#fb923c", "#f472b6"],
    grid: "rgba(255,255,255,0.04)", text: v("--text-secondary"),
    scaleBorder: "rgba(255,255,255,0.06)",
  };
  return cache;
}
export function invalidateChartTheme() { cache = null; }
```

`getComputedStyle` returns resolved sRGB-family strings (canvas-parseable) for both hex and oklch token values in all supported browsers — this removes the original reason `chart-colors.ts` pinned rgb literals. Keep a unit smoke test asserting every resolved value matches `/^(#|rgb|color\()/`, failing loudly rather than painting black (the original bug).

### §3.5 Verify (W1)

- [ ] `npm run build && npm run lint` clean.
- [ ] Literal-sweep grep returns only `lib/perf/loaf.ts` and generated/registry files.
- [ ] Visual: `npm run test:visual:update` → review every diff; expected changes are *subtle* (border color, muted text lift). Any layout shift = bug.
- [ ] Manual: DevTools contrast spot-check — muted text on a selected (L3) row ≥ 4.5:1.
- [ ] `data-testid` hooks added: `session-clock`, `staleness` (StatusRail) for the mask list.

---

## §4. W2 — TerminalPanel + both tab variants (the identity change)

**Plan ref:** §3.2, §2.2. **Branch:** `feat/terminal-w2-panel-chrome`. **Effort:** 2–3 days. Highest visual impact per effort in the program.

### §4.1 Components

New files under `src/components/terminal/`:

```
terminal/
  TerminalPanel.tsx    ← shell: header strip + body; owns tab overflow + options menu
  PanelTabs.tsx        ← variant 1: structural raised tabs
  UnderlineTabs.tsx    ← variant 2: in-body filter tabs
  IconButton.tsx       ← 28×28 quiet icon button used across chrome
```

**TerminalPanel** (the shell every region mounts into):

```tsx
interface PanelTab { id: string; label: string; count?: number }
interface TerminalPanelProps {
  tabs: PanelTab[];                 // ≥1; single tab renders as a plain title strip
  activeTab: string;
  onTabChange: (id: string) => void;
  onOptions?: () => void;           // hamburger, far right; omitted = no icon
  actions?: React.ReactNode;        // optional extra header-right content
  children: React.ReactNode;        // panel body (surface-1)
  className?: string;
}
```

Geometry (exact): header strip **36px** high, `bg-surface-2`, 1px `border-subtle` bottom. Tabs: 36px high, `px-3`, 13px medium labels, `text-secondary`. **Active tab:** `bg-surface-1` (merges into body), `text-primary`, `rounded-t-md` (6px top corners), and a 1px bottom border *in the body color* so the tab visually opens into the panel. **Inactive:** transparent, flush, reserve the 1px border to prevent shift. Hamburger: `List` icon, 28×28, `text-secondary`, pinned far right. **Overflow:** `ResizeObserver` on the strip + scroll listener; when `scrollWidth > clientWidth`, fade in 24px chevron buttons at both ends; click scrolls by `0.75 × clientWidth` via `scrollBy({ behavior: "smooth" })`. Never read layout per frame — only in the observer/scroll callbacks.

**UnderlineTabs** (variant 2): 32px high, text-only, `px-2.5`, active = `text-accent-blue` + 2px `bg-accent-blue` underline (a layout-stable `border-b-2` with transparent border reserved on inactive). Counts in-label: `All Stocks (34)` with `tabular-nums` so the count doesn't jitter.

Build both on the existing Radix `Tabs` (`ui/tabs.tsx`) as styled wrappers — do not fork the primitive; keyboard/ARIA comes free.

### §4.2 Retrofit

| Route/region | Becomes |
|---|---|
| `/backtesting` Data/Strategies/Results/Models tab block | `TerminalPanel` + `PanelTabs` |
| `/backtesting` TradeLog All/Winning/Losing filter | `UnderlineTabs` with counts |
| `/` chart panels | each `ChartPanel` wrapped in `TerminalPanel` (single-tab title = symbol) |
| `/live` Positions / Orders | one `TerminalPanel`, two `PanelTabs` |
| `/data` coverage/backfill regions | `TerminalPanel` per region |

State: `activeTab` is URL state where the tab is *location-like* (`/backtesting` main tabs → add `tab` to `validateSearch`, default `"data"`); cookie state where it's *arrangement-like* (per-panel view choices). When in doubt: if a shared link should land on it, it's URL.

### §4.3 Verify (W2)

- [ ] Keyboard: Tab → arrow keys move across panel tabs; Enter activates; focus ring visible (`--ring` = accent).
- [ ] Overflow: shrink viewport until tabs clip → chevrons appear, scroll works, active tab stays reachable; restore size → chevrons fade out.
- [ ] Deep link: `/backtesting?tab=results` loads with Results active; switching tabs updates the URL via `replace` (no history spam).
- [ ] Visual: named screenshots `panel-tabs-active.png`, `panel-tabs-overflow.png` (forced narrow container), `underline-tabs.png` per spec route; diffs reviewed.
- [ ] No layout shift on tab activation (inactive tabs reserve their borders).

---

## §5. W3 — Icon rail + top bar

**Plan ref:** §3.3. **Branch:** `feat/terminal-w3-global-chrome`. **Effort:** 1 day.

1. **Collapse `AppSidebar` w-56 → 64px icon rail.** Keep the `Link` set and `useLocation` active detection untouched. Labels become 10px micro-labels under icons (or `Tooltip` on hover — pick tooltip; the rail stays 64px either way). Active item: 2px `accent-blue` left bar + `bg-surface-2`. Badge dot: 6px `dir-down` circle, `absolute` at icon top-right, rendered from a `notifications` prop map (static empty map for now; wired to health probe in W4).
2. **Brand block** compresses to the `TerminalSquare` glyph only, centered, 48px header cell.
3. **Top bar (new, 48px, `bg-surface-0`, 1px bottom border):** left = brand glyph (moved here from the sidebar if it reads better — decide in review, one home only); center = search field replica — a `button` styled like an input (`bg-surface-1`, muted placeholder "Search symbols…  ⌘K") that calls the existing `togglePalette()`; right = account/status readouts (account equity + day PnL from the existing polled `liveApi.account`, `text-dir-up/down`, skeleton while loading, hidden when the endpoint 404s — reuse the health-probe result).
4. `__root.tsx` layout becomes: top bar / (icon rail + main) / StatusRail. All heights fixed; main keeps `overflow-auto`.

**Verify (W3):**
- [ ] All six routes reachable from the rail; active state correct on each.
- [ ] ⌘K still opens the palette from both the hotkey and the search-field button; palette symbol jump still routes to the active chart panel (§17 registry untouched).
- [ ] SSR: no layout shift on first paint (heights are fixed; readouts skeleton).
- [ ] Visual: `chrome-rail.png`, `chrome-topbar.png`, updated full-route baselines.
- [ ] `data-testid`: `global-search`, `account-readout` (masked in screenshots).

---

## §6. W4 — PanelState (empty / loading / error / pending everywhere)

**Plan ref:** §3.8. **Branch:** `feat/terminal-w4-panel-states`. **Effort:** 2 days.

1. **`PanelState` component** (`components/terminal/PanelState.tsx`):

```tsx
interface PanelStateProps {
  kind: "empty" | "loading" | "error" | "pending" | "paywall";
  art: "chart" | "table" | "plug" | "warning" | "lock" | "clock";
  message: string;               // one line, text-muted
  action?: { label: string; href?: string; onClick?: () => void };  // single accent link
  detail?: string[];             // e.g. pending endpoint list (PendingPage pattern, panel-level)
}
```

2. **Art set:** 8 hand-drawn 96×96 SVGs in `components/terminal/art/`, 1.5px strokes in `currentColor` (parent sets `text-muted`), one `accent-blue` detail each. No stock illustration library (plan §3.8 — they fight the dark terminal). `loading` reuses `PanelSkeleton`, not art.
3. **Retrofit every panel region:** TradeLog empty, RunHistory empty, chart-no-symbol, coverage-empty, live-positions-empty, metrics/models pending (migrate `PendingPage` content into `PanelState kind="pending"` rendered *inside* a TerminalPanel), health-probe-driven degraded states (endpoint missing → `plug` art + endpoint names).
4. Wire StatusRail health dots → sidebar badge dots (W3's notification map): failing endpoint = red dot on the owning nav icon.

**Verify (W4):**
- [ ] With the backend down: every route renders intentional states, zero blank rectangles, zero console errors; pending panels list exact endpoints.
- [ ] With the backend stubbed (Playwright): empty states render for empty fixtures.
- [ ] Illustrations render at exactly 96×96, inherit muted color, single accent detail.
- [ ] Visual: `state-empty.png`, `state-pending.png`, `state-error.png` (forced via route stub rejecting).

---

## §7. W5 — Typography pass

**Plan ref:** §5.5. **Branch:** `feat/terminal-w5-typography`. **Effort:** 1 day.

1. **Install + import:** `npm i @fontsource-variable/inter`. In `src/styles.css`, before the Tailwind import:

```css
@import "@fontsource-variable/inter/wght.css";   /* latin subset default */
```

   Set `--font-sans: "Inter Variable", system-ui, sans-serif` in `@theme`. Keep `--font-mono: "JetBrains Mono", …` exactly as-is — mono stays for chart axes, TradeLog, code. **Self-host rationale (D3b):** no render-blocking third party; variable font = one file covering 100–900; latin subset only. Add `<link rel="preload">` for the woff2 in `__root.tsx` head links if waterfall shows it late — measure first, preload only if needed.

2. **Numeric discipline utilities** (`styles.css`):

```css
.num        { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "zero" 1; }
.num-fixed  { min-width: 12ch; text-align: right; }   /* hot cells: no neighbor shift */
```

   Apply `num` (Tailwind's `tabular-nums` utility is equivalent — use it) to every numeric cell, readout, legend value. Fixed precision per column type: prices 2dp (5dp for sub-$1 symbols later), % 2dp with explicit `+`, sizes grouped integers. `12ch` floor on WS-hot cells (§14) so `—` → number and sign flips don't push neighbors.

3. **One formatter** (`lib/format.ts`): `fmtPrice`, `fmtPct`, `fmtSize` (Intl grouping; compact `1.3M` only ≥ 1M), `fmtPnl` (sign + $). Replace the per-file `fmt*` helpers in `live.tsx`/`backtesting.tsx` — they diverge today.

4. **MetaGrid** (`components/terminal/MetaGrid.tsx`): two-col label/value, muted label left, right-aligned `tabular-nums` value (white or semantic), 20px row pitch. Restyle `BacktestStatsPanel` and the Live stat cards onto it.

**Verify (W5):**
- [ ] DevTools: computed `font-family` on a numeric cell = Inter Variable; `font-variant-numeric: tabular-nums` active.
- [ ] Jitter test: replay at 10× — watch the stats panel and legend; no horizontal movement of static neighbors (Loaf instrumentation on, `?perf=1`).
- [ ] No font FOUC on hard reload (throttle to Slow 3G once and watch).
- [ ] Visual: `typography-stats.png`, `typography-tradelog.png`; expect large diffs on all table-ish baselines — review deliberately.

---

## §8. W6 — TerminalTable (virtualized, per-cell colored, memoized)

**Plan ref:** §3.4. **Branch:** `feat/terminal-w6-terminal-table`. **Effort:** 3–4 days. **Dependency:** `@tanstack/react-table@8.21.3` pinned (D3a — **not 9.x**).

### §8.1 Structure

```
components/terminal/table/
  TerminalTable.tsx     ← generic: TanStack Table (sorting, selection) + react-virtual rows
  TerminalRow.tsx       ← memo boundary (React.memo, primitive props only)
  cells.tsx             ← NumCell, PctCell, DirCell, BadgeCell, SparklineCell, ChipsCell
  density.tsx           ← density context (compact 32 / default 42)
```

**Rendering contract** (from plan §3.4): no vertical gridlines; 1px `border-subtle` header underline + row dividers; numerics right-aligned `tabular-nums` fixed precision; **per-cell** semantic coloring computed inside the cell from its own comparison (`last` vs `prevClose`, `open` vs `prevClose`, …) — never row-level color; `≡` drag handle in the left gutter on row hover (`opacity-0 group-hover:opacity-100`, reserved gutter so no shift); selected row `bg-surface-3`, hover `bg-surface-2/60`; sparkline = inline SVG polyline + dotted baseline at reference price, stroke from terminal direction (no chart lib per cell); metadata chips 2px radius, 10px text.

**Performance contract (the part that makes it feel like a terminal):**

```tsx
// TerminalRow — the ONLY memo boundary. Everything in is a primitive.
export const TerminalRow = memo(function TerminalRow(props: {
  rowId: string;
  cells: CellRender[];        // pre-computed primitive values + cell type
  isSelected: boolean;        // selection passed IN as boolean — never
                              // row.getIsSelected() inside (defeats memo)
  height: number;
  start: number;              // virtual offset
}) { /* absolute-positioned row at translateY(start) */ });
```

- `estimateSize: () => 42` constant, no `measureElement` (fixed heights).
- Column defs via TanStack Table; sorting via `getSortedRowModel`; row selection state lifted to the table owner.
- Cells subscribe to hot data themselves (§14) — the row re-renders only when a *primitive prop* changed; tick-level updates below React's radar go through the cell's own `useSyncExternalStore` subscription.
- This recipe is the difference between ~29 ms and ~4 ms React work per scroll tick at 30 columns (plan §3.4 citation) — it is not optional polish.

### §8.2 First adopters

1. **Live positions table** (replaces the hand-rolled table in `live.tsx`) — columns: symbol, side badge, qty, avg entry, last, market value, unrealized PnL ($, %, per-cell dir colors), change today.
2. **TradeLog chrome** (already virtualized — port onto TerminalRow + cells, keep behavior incl. auto-scroll/pause-on-scroll).
3. Column presets defined as data so B1 (strategy table) and B2 (ranking table) are configuration, not new code (M6).

> **§8.2 item 2 amendment** (settled 2026-08-10, shipped with the port). The item assumed a
> table-shaped trade log; the actual log lives in a ~260px side rail as a 3-line card
> (side+P&L, In line, Out line) that columns cannot hold. Settled as: **single-line rows**
> (side badge · `HH:mm→HH:mm` · P&L) via a `presets/trades.ts` column preset, and the rail
> widens 260→280px to fit them. Entry/exit **prices are dropped from the log** — they stay
> visible as chart markers. The "auto-scroll/pause-on-scroll" behavior the item says to keep
> does not exist in the current implementation (no code ever scrolled the log), so there was
> nothing to preserve. Both `TradeLog` (live `Trade`) and `StrategyTradeLog` (`BacktestTrade`)
> normalize onto one `TradeLogRow` shape; headers are deliberately unsortable (newest-first
> is the behavior), rows render at compact density.

### §8.3 Verify (W6)

- [ ] Sort by every column; selection survives sort; multi-select (B2 path) with shift-click range.
- [ ] 5,000-row stress fixture: scroll at speed — Loaf shows ≤ 8 ms React work per tick, no long tasks > 50 ms.
- [ ] Per-cell color audit: a row where `last` is up but `open` is down vs prev-close shows **green last, red open** (this is the reference behavior — do not "fix" it).
- [ ] Memo audit: React DevTools profiler — ticking one cell re-renders exactly one row.
- [ ] Visual: `table-positions.png`, `table-dense.png` (compact density), `table-selected.png`.

---

## §9. W7 — Form primitives

**Plan ref:** §3.7. **Branch:** `feat/terminal-w7-form-primitives`. **Effort:** 2 days.

All under `components/terminal/controls/`, all on existing Radix primitives, heights from the geometry tokens:

| Primitive | Radix base | Spec |
|---|---|---|
| `SemanticToggle` | `ToggleGroup` | Two segments, `--control-h-md`. Active = semantic fill at 20% alpha over `surface-2` + 1px semantic border + semantic text; inactive = `surface-1` neutral. Asymmetry is the feature (Buy/Sell analog; Ananke: paper/LIVE, long/short). |
| `SegmentedControl` | `ToggleGroup` | Multi-option enumerated (order type, replay speed, chart type, interval). Active = accent. 32px. |
| `UnitInput` | `Input` + inline `ToggleGroup` | Numeric, right-aligned `tabular-nums`, trailing shares/%/$ unit group. |
| `QuickFillRow` | — | Preset chips row (`10/50/100/500`), 24px, `surface-2`, 8px gap, writes into sibling input. |
| `MetaGrid` | — | Already built in W5; lives here conceptually. |

States for every control: default / hover (`surface-3` wash) / focus-visible (2px `--ring`) / disabled (40% opacity) / error (`dir-down` border + inline message). Retrofit: backtesting replay speed → `SegmentedControl`; capital input → `UnitInput` + `QuickFillRow`.

**Verify (W7):**
- [ ] Keyboard-only pass across every control (arrow keys within groups, tab between).
- [ ] Storyboard-style screenshot spec: each control × each state (a hidden `/dev/controls` route is fine — gate it behind `import.meta.env.DEV`).
- [ ] Retrofit routes behave identically (replay speeds, capital clamping 100–10M).

---

## §10. M1 — lightweight-charts 4.2.0 → 5.2.0 (pin lift)

**Plan ref:** §5.1. **Branch:** `feat/terminal-m1-lwc5`. **Effort:** 3–5 days. **This item owns the AGENTS.md pin rewrite.**

### §10.1 Pre-flight (half day, do not skip)

1. `npm i lightweight-charts@5.2.0` (exact).
2. Read `node_modules/lightweight-charts/typings.d.ts` and the bundled `MIGRATION` notes. **Verify every API this doc references against the typings** — where they differ, the typings win (review decision D1).
3. Expected deltas from v4 (verify each): unified `chart.addSeries(CandlestickSeries, options, paneIndex?)` replacing `addCandlestickSeries`; markers extracted to the `createSeriesMarkers(series, markers)` plugin; **native panes** (`chart.addPane()`, per-series `paneIndex`); ES2020-only output. v5.1+ adds automatic data conflation at high bar counts — leave it enabled (that's the 100k+ bar story).

### §10.2 Migration steps

1. `useChartBase.ts`: `addSeries` calls; move `CHART_OPTIONS` colors to the chart theme registry (§3.4) while here.
2. **Volume becomes a real pane:** delete the `scaleMargins { top: 0.7 }` overlay hack in `PriceChart`/`ChartPanel`; volume = `addSeries(HistogramSeries, { … }, 1)` on the same chart instance. Price pane margins return to normal.
3. **RSI/MACD sub-panes become real panes** on the main chart instance. Crosshair + visible-range sync within one chart is native in v5 → **delete `ChartSyncGroup` usage for intra-panel panes** (keep the class only if cross-*chart* sync between independent panels is wanted — evaluate; likely delete entirely and note in AGENTS.md).
4. Markers (trade entry/exit, compare) → `createSeriesMarkers` plugin.
5. AGENTS.md, same commit: replace "`lightweight-charts` is pinned at 4.2.0 — do not upgrade" with "`lightweight-charts` at 5.2.x (build doc §10) — minor upgrades require re-running chart visual baselines"; update the Chart architecture section (panes now native; sync group removed).

### §10.3 Watch-list (v5 gotchas to probe)

- Auto-scale margins per pane after the volume move — verify last-price line isn't clipped.
- `timeScale` options renamed in v5 (check typings) — the repo sets `timeVisible`, `secondsVisible`.
- Conflation thresholds: at >2 px-worth of bars per pixel, confirm candle coloring still matches direction at the *merged* level.
- SSR: chart creation stays behind the `mounted` gate — unchanged, but re-verify no `window` access crept into module scope.

**Verify (M1):**
- [ ] Every chart route renders identically-or-better: full Playwright chart baselines re-captured and **pixel-reviewed** (candle colors, wick colors, grid, legend, crosshair, price line, volume direction colors).
- [ ] Volume is a separate pane (drag the price pane's bottom edge region — no overlap; crosshair spans both panes natively).
- [ ] RSI/MACD enable/disable still create/destroy cleanly (StrictMode double-mount check).
- [ ] 100k-bar fixture (`?perf=1`): pan/zoom without long tasks > 50 ms; conflation active.
- [ ] Bundle diff: note the delta (v5 core is ~16% smaller; +markers plugin) in the PR.

---

## §11. M2 — Chart surface completion

**Plan ref:** §3.6. **Branch:** `feat/terminal-m2-chart-surface`. **Effort:** 4–6 days. Requires M1.

In dependency order:

1. **Two-line legend** (DOM overlay, existing pattern): line 1 OHLC per-value colored + change + volume (`O 25.34  H 25.65  L 25.33  C 25.57  +0.23 (+0.91%)  Vol 1,319,803`); line 2 indicators, each name in its overlay color. Values through the existing rAF-coalesced DOM writes — no React state at mousemove rate.
2. **Session shading primitive** (custom pane primitive, `zOrder: "bottom"`): vertical bands for regular vs extended hours from `lib/market-calendar.ts` session logic; fill = `surface-2` at 35% alpha for extended. Sun/moon glyphs on the time axis via `tickMarkFormatter`.
3. **Price pill** (custom series primitive drawing into the price-axis gutter): filled rounded rect in `dir-up`/`dir-down` (vs prev close), value inside; below it the **replay position pill** in backtest mode (`Bar 14,832 / 21,000`), countdown-to-close in live mode later (§14).
4. **Bottom toolbar:** `SegmentedControl` Range (1D 5D 1M…) + Interval (1m 5m 15m H D W M) — wired to the existing interval policy/hotkeys (1/5/15/H/D already bound in `useHotkeys`; toolbar and hotkeys must share one state path).
5. **Top icon toolbar row:** chart type, indicators, compare, (playback lives in backtesting), alerts placeholder — `IconButton`s; indicator toggles write to the same indicator state the legend reads.

> **§11.4/§11.5 supersede the legacy control bar** (settled 2026-08-08, shipped as M2a). As
> written, items 4 and 5 add surfaces without saying what happens to the pre-terminal
> shadcn control bar at the top of `ChartPanel` — so M2 shipped with both live, five control
> groups duplicated (range, interval, chart type, compare, indicator toggles) across two
> surfaces writing one state path. The toolbars **replace** that bar; it is deleted.
> `DateRangePicker` was the only control it owned outright and moves into the bottom toolbar
> beside Range. There is deliberately **no `Custom` range segment**: editing a date sets
> `rangePreset` to `CUSTOM`, which deselects every Range segment — that is the reachable path,
> and a segment for it would be a third way to say the same thing. Removing the bar also
> finishes the §3.3 literal sweep on `/`, which was the last route still rendering
> pre-terminal `Button`/`Select` chrome.

**Verify (M2):**
- [ ] Legend values colored per-value and update live during replay; no re-render of the chart component on crosshair move (profiler check).
- [ ] Session bands align with actual 09:30/16:00 ET boundaries on a 1m chart; glyphs render at day boundaries.
- [ ] Price pill flips color across prev-close; replay pill shows absolute index and tracks the scrubber.
- [ ] Toolbar and hotkeys never disagree (press `5`, toolbar shows 5m active).
- [ ] Visual: `chart-legend.png`, `chart-sessions.png`, `chart-pills.png`, `chart-toolbar.png`.

---

## §12. M3 — Replay state in the URL

**Plan ref:** §4.3, §7 R1. **Branch:** `feat/terminal-m3-replay-url`. **Effort:** 2 days. Independent of M1/M2 — schedule early.

Extend `/backtesting` `validateSearch` (additive; all optional, all omitted when default):

| Param | Format | Written when | Write discipline |
|---|---|---|---|
| `cursor` | integer, absolute bar index | run loaded + cursor moved | rAF-aligned during playback; `replace: true` |
| `view` | `from.to` floats, logical bar indices | user panned/zoomed away from fit-content | debounced 300 ms, `replace: true` |
| `ind` | CSV `key:period` (`sma:20,sma:50,vol`) | differs from default set | on change |

Restore order on load: parse → load run (existing `loaded=true` path) → apply `view` via `setVisibleLogicalRange` after data lands → apply `cursor` → apply `ind`. **Absolute bar indices everywhere** (never timestamps) so state survives zoom and interval changes — the existing `getVisibleLogicalRange` API already speaks these coordinates. Guard: cursor/view beyond dataset length after a data change clamp to the nearest valid index. The cookie keeps the *last run config* (unchanged); URL always wins when present (existing precedence rule).

**Verify (M3):**
- [ ] Load a run, seek to bar N, zoom, copy URL, open in a new tab: same bar, same zoom, same indicators.
- [ ] Navigate to `/live` and back via sidebar: identical state restored from the URL alone (clear cookies to prove it).
- [ ] Play 60s at 25×: history stack unchanged (`replace`), router never drops frames.
- [ ] Clean URL (`/backtesting`) still opens with defaults and zero params.
- [ ] Visual: `replay-restored.png` vs a control screenshot of the source state.

> **Amendment (built):** the `ind` row is deferred — the backtesting chart has no
> indicator overlays (indicators live on the charts page's ChartPanel, whose state
> is cookie/workspace-scoped, not URL), so there was nothing for `ind` to bind to.
> It lands when/if BacktestingChart gains indicator toggles. `view` uses the doc's
> literal `from.to` format — two logical-index floats fixed to 2dp, dot-joined
> ("-5.00.120.00"); logical `from` may be negative (left whitespace is valid).
> Scope is the Data-tab run (the `loaded=true` flow); Strategies-tab pans stay
> local. The ChartScrollbar mounts WITH the chart rather than on the first range
> event — a late mount resizes the pane and clobbers a just-restored view
> (autoSize keeps the right edge, so the restored `from` collapses).

---

## §13. M4 — Theme system (dark default + light + high-contrast + graphite)

**Plan ref:** §5.3, §5.4. **Branch:** `feat/terminal-m4-themes`. **Effort:** 3–4 days. Requires W1 (tokens) and M1 (chart registry in use).

1. **Mechanics:** `data-theme` attribute on `<html>`; token blocks become `[data-theme="terminal-dark"] :root {…}` etc. for the four themes (values in plan §5.4 — already WCAG-verified; copy exactly).
2. **No flash:** `__root.tsx` `shellComponent` renders `<html data-theme={...}>` resolved **server-side** from the `ui.theme` cookie (existing SSR cookie reader), plus a tiny inline `<script>` fallback reading the cookie client-side before hydration. Default when no cookie: `prefers-color-scheme` → dark on tie. Persist choice via the existing `writeUiCookie` — **no localStorage** (SSR consistency, §13 division).
3. **Preferences:** theme picker in a new settings popover (top bar, `UnderlineTabs` for the four themes); two independent toggles persisted the same way — `marketConvention: western|east-asian` (swaps `dir-up`/`dir-down` values — why tokens, not literals) and `colorblind: on|off` (swaps to the Okabe-Ito–derived pair). Implement both as additional attribute axes (`data-convention`, `data-cb`) with the token pairs defined per combination — 4 themes × 2 conventions × cb on/off is too many blocks; instead define direction tokens in *small separate blocks* so they compose.
4. **Chart sync:** `invalidateChartTheme()` + every registered chart `applyOptions(resolveChartTheme())` on attribute change (a `ChartThemeRegistry` with `register(chart)`/`applyAll()`, notified by a `MutationObserver` on `document.documentElement` attributes). No chart recreation, no state loss.

**Verify (M4):**
- [ ] Hard reload on each theme: zero flash of wrong theme (film it at Slow 3G).
- [ ] Charts retheme in sync with DOM on switch (screenshot each theme × `/` route).
- [ ] East-Asian convention: green/red swap everywhere including charts, tables, badges, sparklines.
- [ ] Contrast: spot-check AA on light + high-contrast themes (DevTools) for text on every layer.
- [ ] Cookie absent → respects `prefers-color-scheme`; explicit choice → media query ignored.

---

## §14. M5 — Ticker tape + WebSocket hot path (feature-flagged)

**Plan ref:** §3.3, §5.6. **Branch:** `feat/terminal-m5-realtime`. **Effort:** 3–4 days. Backend-gated (D5): everything ships behind flags with polling fallback.

1. **Ticker tape** (works today, no WS needed — feed it the polled last-bar registry): middle of StatusRail. Track content duplicated 2× inside a wrapper animated `translateX(0 → -50%)` — compositor-only transform animation, `will-change: transform`; `animation-duration` computed once from measured track width (speed ≈ 60 px/s); `.ticker:hover .ticker-track { animation-play-state: paused }`; `prefers-reduced-motion` → static, horizontally scrollable strip. Items render symbol + last + change (`dir-*` colors, `tabular-nums`).
2. **Hot/cold architecture (flag `VITE_WS_ENABLED=1`):** `lib/realtime/` —

```
lib/realtime/
  socket.ts        ← connect VITE_WS_URL, auto-reconnect w/ backoff, message router
  symbol-stores.ts ← Map<symbol, CellStore>; getSnapshot/subscribe per cell
  coalesce.ts      ← reuse useRafCoalescer semantics: latest-value-wins, one flush/frame
```

   Rules (working agreement §1.4): the socket handler never calls `setState` and never touches the Query cache; cells subscribe via `useSyncExternalStore` to their own symbol cell; React sees ≤ 1 commit per frame; background tabs self-throttle via rAF. Snapshot-then-delta per symbol: initial REST snapshot seeds the store, stream updates it (this is the only place Query and the stream meet — at seed time).
3. **Flash-on-change:** store keeps `prev`; leaf cell sets `flash-up`/`flash-down` class (CSS transition from 12% alpha `dir-*` wash to transparent) inside the cell that was already re-rendering — the row never re-renders for a flash. Ticker items flash via direct `classList` writes (ref path, zero React).
4. **Fallback:** flag off → current `refetchInterval` polling untouched. Positions/orders tables read from the store when hot, from Query when cold — same row components.

**Verify (M5):**
- [ ] Ticker: DevTools Performance — animation runs on compositor (no main-thread frames); hover pauses; reduced-motion static.
- [ ] Mock WS (a dev-only `?wsMock=1` generator pushing 20 msg/s across 10 symbols): profiler shows frame-rate React commits; only changed cells re-render; flashes visible.
- [ ] Disconnect → backoff reconnect → data resumes without duplication; flag off → polling path byte-identical to today.
- [ ] `data-testid`: `ticker` (masked in baselines).

> **Amendment (built 2026-08-19).** Four notes from the implementation.
>
> 1. **Tape source.** §14.1 says feed the ticker from the polled last-bar registry; plan §3.3 says
>    the tape shows live positions. Both shipped, in that order of precedence: positions first,
>    then the symbols currently on charts (`useTickerItems`). Flat with one chart open still gives
>    a tape; a funded account gets its book. The registry entry grew `close` + `prevClose` to
>    carry a price and a change reference (`trailingPrevClose` resolves one ET midnight and walks
>    back numerically, so it costs integer compares, not an Intl call per bar).
> 2. **Staleness moved to reporting by exception.** The tape needed the flexible middle of the
>    rail, which the per-symbol staleness strip owned. Fresh symbols now say nothing; only aging
>    and stale ones render, keeping their tier colour and the `staleness` testid.
> 3. **Flash is an effect, not a render-time class.** The obvious implementation — compare against
>    a ref mutated during render — is not idempotent, so React's dev double-render sets the ref on
>    pass 1 and finds no change on pass 2, and the flash silently never appears. `useFlashOnChange`
>    writes the class in an effect instead. The `-a`/`-b` alternation is load-bearing for a
>    different reason: an element whose computed `animation-name` does not change *continues* its
>    running animation rather than restarting, so one class flashes once and then goes quiet under
>    a fast feed.
> 4. **"Only changed cells re-render" is asserted, not eyeballed.** `tests/visual/realtime.spec.ts`
>    runs the mock feed and fails if `__terminalRowRenders` moves at all while prices tick — the
>    hot value never travels through row props, so the number is zero, not "small". The flag-off
>    case is asserted too: no WebSocket is constructed at all.

---

## §15. M6–M8 — Data panels (strategy/ranking tables, heatmap, calendar, latency, PnL)

**Plan ref:** §4.1–4.9. One branch each; M6 is backend-gated on a strategy-list endpoint (D5 — ship behind pending state).

### §15.1 B4 heatmap — hand-rolled canvas (D3c)

`components/terminal/CorrelationMatrix.tsx`: canvas, symbol×symbol grid, diverging scale `dir-down → surface-1 → dir-up` mapped over correlation −1…+1; row/column labels in DOM (crisp text, not canvas); hover crosshair via absolutely-positioned highlight divs; click a cell → drill into the pair. Data computed once per run → `useMemo` matrix → single paint. ~150 lines, zero dependency. Single-column variant answers "which symbols does this strategy work on" (metric per symbol).

### §15.2 M6 tables

B1 strategy table and B2 ranking table are **column presets on TerminalTable** (§8) — strategy name + source/mode badge chips (Python SDK / ONNX / C++; backtest / paper / live), Sharpe, return, max DD, win rate, trades, last run, equity sparkline. B2 adds the checkbox column + sticky promote footer ("Promote N symbols →"). Per-cell rules: Sharpe/return/win-rate vs 0 (or threshold), max DD always `dir-down` beyond tolerance, sparkline by terminal direction.

### §15.3 B5 event calendar

`TerminalPanel` + `UnderlineTabs` (Fed / CPI / NFP / All), agenda rows (date, ET time, impact dot, event chip). Data: FRED `releases/dates` (free API key; include future dates) + FOMC dates as a maintained JSON checked into `lib/` (8/yr, published years ahead — an API is overkill). Output beyond the panel: a typed `BlackoutWindow[]` (release ± configurable margin) exported from `lib/event-calendar.ts` for the risk manager — the panel is a view *on that feed*, not the source of it.

### §15.4 B7 latency waterfall / B9 PnL distributions

Latency: horizontal stacked bar per order event (arrival → signal → order → fill), cool→warm segment scale, p50/p95/p99 chips in the header; collapses to aggregate waterfall when sparse. PnL distributions: label + proportional horizontal bar from a shared center axis + right-aligned % — pure divs with transform widths, three data bindings (time-of-day, day-of-week, outcome). Both are token-native DOM, no chart lib.

**Verify (M6–M8):**
- [ ] Heatmap: −1 and +1 cells render full `dir-down`/`dir-up`; 0 renders `surface-1`; hover highlights symmetric cells.
- [ ] Strategy table sorts by Sharpe; promote footer counts selection correctly; pending state when the endpoint 404s.
- [ ] Calendar: blackout windows serialize to the exact shape the risk manager consumes (unit-test the pure function).
- [ ] Visual baselines per panel.

> **Amendment (built 2026-08-19).** §15 specifies the panels but never says where they live, and
> three data questions only have answers once you build them.
>
> **Placement.** `/metrics` — until now a single `pending` card whose copy read "Sharpe, drawdown,
> hit-rate, latency percentiles, fill quality" — becomes the analysis workspace holding exactly
> that list: PanelTabs over Strategies (B1) · Universe (B2) · Correlation (B4) · Distributions
> (B9) · Latency (B7), with `?tab=` and `?strategy=` as URL state. **B5 the event calendar goes on
> `/live` instead**, because its output is a trading constraint: "do not be in the market at 08:30
> on CPI day" is a decision made next to the positions it applies to, not in an analytics tab.
>
> **B1's data gap.** `GET /api/strategies` returns `{id, name, description, createdAt}` — no
> metrics at all. Rather than invent summary fields, the panel fans out to
> `GET /api/strategies/{name}` for `latestResults`. It is an N+1 over single-digit N, cached under
> the same `["strategy", name]` key `/backtesting` already uses. When the list endpoint grows
> metrics, one `useQueries` block deletes. Source badge is inferred from the strategy definition
> (there is no `source` field); mode is only paper/live when there is a real `deployMode`, since a
> STANDBY strategy with none has been loaded, not deployed.
>
> **B2 ranks by running.** "Which symbols does this strategy work on" is answered with
> `POST /api/strategies/{name}/run` per symbol, through a rolling window of 4 in flight so the
> table fills in progressively instead of landing a hundred backtests on the backend at once. The
> plan's sector chip has no data behind it (`Symbol` is `{ symbol }` and nothing else), so that
> column carries run status — queued/running/failed — which the ranking flow actually produces.
> Promotion names `POST /api/deploy`; B6, the panel that would own that endpoint, is not scheduled
> anywhere in this doc.
>
> **B4 correlates returns, not prices.** Log returns aligned on common timestamps, not bar index:
> two trending symbols correlate at ≈ +1 on price levels no matter what they do day to day, and
> two series with different histories would otherwise be compared Tuesday against Thursday. An
> undefined pair is `NaN` and paints as background — a fabricated 0 would read as "uncorrelated",
> which is a claim. The scale midpoint is `--surface-1`, read the way the §11 M2 primitives read
> tokens (the ChartTheme registry covers series colours, not surfaces).
>
> **B5 has no folklore fallback.** The maintained schedule (`lib/data/economic-releases.ts`, FOMC
> from the Fed's calendar, CPI/NFP from the BLS schedule) carries a `VERIFIED_THROUGH_DATE` the UI
> warns past, and FRED supersedes it when a key is configured. The tempting third tier — "payrolls
> are the first Friday" — is deliberately absent: 2026 alone broke that rule three times, and a
> blackout window derived from folklore is worse than none because it will be trusted. The doc
> asks for "a maintained JSON checked into lib/"; it is a typed `.ts` module instead, so the shape
> is compile-checked and `npm run test:calendar` can import it in plain node.
>
> **Unit tests.** The §15 verify block asks for one (blackout windows). Three shipped — calendar,
> correlation, distribution bucketing — all in plain node against the TS sources, all wired into
> `npm run test:unit`. Every one of them is really a timezone test.

---

## §16. M9 — dockview (deferred; D7)

No work scheduled. If adopted later: serializer (`toJSON`/`fromJSON` via `onDidLayoutChange`) writes into the existing cookie `LayoutStorage` path; panel content state stays in the URL under the positional convention (panel *i* in canonical tree traversal ↔ position *i* in `?symbols=`); traversal order derives from the serialized tree, never DOM order. Full analysis in plan §5.2.

---

## §17. Global performance checklist (run at every milestone)

| Check | Budget | Tool |
|---|---|---|
| Replay at 10× | no Loaf events, no long task > 50 ms | `?perf=1` + Performance panel |
| Table scroll (5k rows) | ≤ 8 ms React work per tick | React Profiler |
| Ticker | compositor-only animation | Performance → Rendering |
| WS hot path (mock 20 msg/s) | ≤ 1 React commit/frame, only changed cells | Profiler |
| Theme switch | no chart recreation, no state loss | manual + baselines |
| Bundle | flag any dep > 100 kB before adding | `npm run build` output |
| Fonts | Inter Variable latin only; no CDN fonts | Network panel |

## §17b. Build status (2026-08-19)

Everything scheduled in this doc is built. Items are marked here rather than in each section so
the sections stay readable as specifications.

| § | Item | State |
|---|---|---|
| §2 | W0 Playwright harness | done — 43 tests, `npm run test:visual` |
| §3 | W1 tokens + alias map + literal sweep | done — sweep returns only the registry |
| §4 | W2 TerminalPanel + both tab variants | done |
| §5 | W3 icon rail + top bar | done |
| §6 | W4 PanelState everywhere | done — `PendingPage` deleted as superseded |
| §7 | W5 typography | done — `fmtRatio` added in M6 (Sharpe through `fmtSize` printed 1.84 as "2") |
| §8 | W6 TerminalTable | done + §8.2 amendment; `live` and `check` cell variants added by M5/M6 |
| §9 | W7 form primitives | done |
| §10 | M1 lightweight-charts 5.2.0 | done — pin line rewritten in AGENTS.md |
| §11 | M2 chart surface | done, incl. M2a retiring the legacy control bar |
| §12 | M3 replay state in the URL | done — `ind` deferred (nothing to bind to; see its amendment) |
| §13 | M4 theme system | done — 4 themes × convention × colorblind |
| §14 | M5 ticker + WS hot path | done, flag-gated (`VITE_WS_ENABLED`), polling untouched |
| §15 | M6–M8 data panels | done — see the §15 amendment for placement and data decisions |
| §16 | M9 dockview | **not built, by decision D7** — re-evaluate only if fixed splitters prove insufficient |

Two things outside this doc's scope surfaced while building it and are worth naming:

- **Plan §4.6 B6 (strategy deploy panel)** is the one Section-B component this doc never
  schedules. It is the highest-stakes panel in the product and it needs `POST /api/deploy`. B2's
  promote action is currently its only entry point, and it says so.
- **A latent SSR bug, now fixed.** `/data` resolved its relative date defaults inside
  `validateSearch` and converted them through the runtime's local timezone. Both halves differ
  between the SSR process and the browser, and the result reached the rendered Python snippet, so
  every load of `/data` hydrated with a mismatch and React silently re-rendered the subtree.
  Defaults moved to the route loader, `datetime.ts` interprets wall clocks in ET, and
  `tests/visual/hydration.spec.ts` now loads all six routes and fails on any mismatch. §1.3 called
  this non-negotiable; it needed a test, not a rule.

## §18. Execution order (summary)

```
W0 harness → W1 tokens → W2 panel chrome → W3 chrome → W4 states → W5 type → W6 table → W7 controls
  → M1 LWC5 → M2 chart surface → M4 themes
  ∥ M3 replay URL (independent — slot anywhere after W1)
  → M5 realtime (flagged) → M6 tables → M7/M8 panels (calendar, heatmap, latency, PnL)
```

W1 is the keystone; M1/M2 is the largest value block and can run in parallel with W3–W7 on a separate branch if rebasing discipline holds (both touch `PriceChart`/`ChartPanel` — if parallel is uncomfortable, M1 first).

---

*Sources for decisions made after the plan: npm registry (lightweight-charts 5.2.0 released 2026-04-24; @tanstack/react-table 9.0.0 released 2026-08-04, v8 line ends at 8.21.3), TanStack Table v9 announcement (opt-in features, new state model), Fontsource Inter docs (self-hosting, OFL-1.1), Playwright visual-comparison docs (`toHaveScreenshot`, masking, `animations: "disabled"`). All other specifications derive from the transformation plan and the repo audit of 2026-08-05.*
