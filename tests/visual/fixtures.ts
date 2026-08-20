import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Locator, type Page } from "@playwright/test";

import type { CoverageBlockResponse, PriceBar, Symbol } from "../../src/lib/api/types";
import type { AccountData, ActiveStrategy, PositionData } from "../../src/lib/api/live";
import type { StrategyDetail, StrategyListItem } from "../../src/lib/api/strategies";
import type { LatencySample } from "../../src/lib/api/metrics";
import type { ModelSummary } from "../../src/lib/api/models";

// JSON fixtures are read from disk instead of imported: @playwright/test 1.49
// (pinned for macOS 13) rejects bare JSON module imports.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;

const pricesFixture = readFixture<PriceBar[]>("prices-range.json");
const multidayPricesFixture = readFixture<PriceBar[]>("prices-range-multiday.json");
const symbolsFixture = readFixture<Symbol[]>("symbols.json");
const coverageFixture = readFixture<CoverageBlockResponse[]>("coverage-blocks.json");
const accountFixture = readFixture<AccountData>("live-account.json");
const positionsFixture = readFixture<PositionData[]>("live-positions.json");
const strategiesFixture = readFixture<StrategyListItem[]>("strategies.json");
const activeStrategiesFixture = readFixture<ActiveStrategy[]>("strategies-active.json");
const strategyDetailFixture = readFixture<Record<string, StrategyDetail>>("strategy-details.json");
const latencyFixture = readFixture<LatencySample[]>("latency-samples.json");
const modelsFixture = readFixture<ModelSummary[]>("models.json");

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Stub every /api/* call the app makes. The Spring backend is never required.
 *
 * Order matters: Playwright gives precedence to the route registered LAST, so
 * the 404 catch-all tripwire goes first and specific stubs override it (the
 * sketch in build doc §2 step 3 has this backwards). Any /api call without a
 * stub lands on the tripwire, is recorded, and fails the test in teardown.
 *
 * Deliberate 404 stubs: /api/trades/range and /api/metrics/engine are not
 * implemented on the real backend either — the UI is designed to render their
 * absence (inline notice, probe "flagged" state), and the baseline should
 * show that current behavior. They are explicit stubs so the tripwire stays
 * meaningful.
 */
export async function stubApi(page: Page): Promise<{ unmatched: string[] }> {
  const unmatched: string[] = [];

  // ── Tripwire (registered first = lowest precedence) ─────────────────────────
  // Host-anchored: the path must START at /api/. A bare /\/api\// would also
  // catch vite dev module URLs (/src/lib/api/*.ts) and 404 the client bundle.
  await page.route(/\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    unmatched.push(url);
    console.warn(`[stubApi] UNSTUBBED API CALL → 404: ${route.request().method()} ${url}`);
    return route.fulfill(json({ data: [] }, 404));
  });

  // ── Symbols ─────────────────────────────────────────────────────────────────
  await page.route(/\/api\/symbols(\?|$)/, (route) =>
    route.fulfill(json({ data: symbolsFixture, count: symbolsFixture.length })),
  );
  await page.route(/\/api\/symbols\/search/, (route) =>
    route.fulfill(json({ data: [], count: 0 })),
  );

  // ── Prices ──────────────────────────────────────────────────────────────────
  // Bars carry the requested symbol so the fixture stays honest for any symbol.
  // The 1s delay is deliberate: it lets the page layout fully settle before
  // data arrives, so lightweight-charts' fitContent runs at final geometry —
  // an immediate response races autoSize and phase-shifts the time scale.
  await page.route(/\/api\/prices\/([^/]+)\/range/, async (route) => {
    const symbol = decodeURIComponent(
      route
        .request()
        .url()
        .match(/\/api\/prices\/([^/]+)\/range/)![1],
    );
    const bars = pricesFixture.map((b) => ({ ...b, symbol }));
    await new Promise((r) => setTimeout(r, 1000));
    return route.fulfill(json({ data: bars, count: bars.length }));
  });
  await page.route(/\/api\/prices\/[^/]+\/coverage-blocks/, (route) =>
    route.fulfill(json({ data: coverageFixture, count: coverageFixture.length })),
  );
  await page.route(/\/api\/prices\/jobs/, (route) => route.fulfill(json({ data: [], count: 0 })));

  // ── Deliberate 404s (unimplemented on the real backend — see note above) ────
  await page.route(/\/api\/trades\/range/, (route) => route.fulfill(json({ data: [] }, 404)));
  await page.route(/\/api\/metrics\/engine/, (route) => route.fulfill(json({ data: [] }, 404)));

  // ── Strategies ──────────────────────────────────────────────────────────────
  await page.route(/\/api\/strategies(\?|$)/, (route) =>
    route.fulfill(json({ data: strategiesFixture, count: strategiesFixture.length })),
  );
  await page.route(/\/api\/strategies\/active(\?|$)/, (route) =>
    route.fulfill(json({ data: activeStrategiesFixture, count: activeStrategiesFixture.length })),
  );
  // §15.2 B1 reads metrics from the per-strategy detail (the list endpoint has
  // none). A POST to /run is the B2 ranking path — it answers with the same
  // stored results, which is enough for the table to fill in.
  // Negative lookahead: this route is registered AFTER /active and Playwright
  // gives the last match precedence, so without it the detail stub would
  // swallow the active-strategies call and B1's mode badges would all read
  // BACKTEST.
  await page.route(/\/api\/strategies\/(?!active)([^/?]+)(\/run)?(\?|$)/, (route) => {
    const match = route.request().url().match(/\/api\/strategies\/([^/?]+)/);
    const name = decodeURIComponent(match?.[1] ?? "");
    const detail = strategyDetailFixture[name];
    if (!detail) return route.fulfill(json({ data: null }, 404));
    if (route.request().url().includes("/run")) {
      return route.fulfill(json({ data: detail.latestResults }));
    }
    return route.fulfill(json({ data: detail }));
  });

  // ── Models registry ─────────────────────────────────────────────────────────
  await page.route(/\/api\/models(\?|$)/, (route) =>
    route.fulfill(json({ data: modelsFixture, count: modelsFixture.length })),
  );

  // ── Live (paper trading) ────────────────────────────────────────────────────
  await page.route(/\/api\/account(\?|$)/, (route) =>
    route.fulfill(json({ data: accountFixture })),
  );
  await page.route(/\/api\/positions(\?|$)/, (route) =>
    route.fulfill(json({ data: positionsFixture, count: positionsFixture.length })),
  );

  return { unmatched };
}

/**
 * Swap the price stub to the two-day extended-hours fixture (build doc §11 M2
 * verify: session bands need a window that actually crosses 09:30/16:00 ET).
 * Re-registering the same pattern is how the override lands — Playwright gives
 * precedence to the route registered LAST, so this wins over the auto-installed
 * stub without disturbing the rest of the set or the 404 tripwire.
 *
 * Call BEFORE page.goto(). No artificial delay here: unlike the 500-bar case,
 * this fixture is large enough that parse+layout alone outlasts the race the
 * 1s delay exists to avoid.
 */
export async function stubMultidayPrices(page: Page): Promise<void> {
  await page.route(/\/api\/prices\/([^/]+)\/range/, (route) => {
    const symbol = decodeURIComponent(
      route
        .request()
        .url()
        .match(/\/api\/prices\/([^/]+)\/range/)![1],
    );
    const bars = multidayPricesFixture.map((b) => ({ ...b, symbol }));
    return route.fulfill(json({ data: bars, count: bars.length }));
  });
}

/**
 * Serve §15.4's latency samples instead of the deliberate 404. The panel's
 * DEFAULT state is the pending one (the backend really does not implement
 * /api/metrics/engine), so the loaded waterfall needs an explicit opt-in —
 * and both states get a baseline.
 *
 * Call BEFORE page.goto().
 */
export async function stubLatency(page: Page): Promise<void> {
  await page.route(/\/api\/metrics\/engine/, (route) =>
    route.fulfill(json({ data: latencyFixture, count: latencyFixture.length })),
  );
}

/**
 * Per-symbol price series for the §15.1 correlation baseline.
 *
 * The default price stub answers every symbol with the SAME bars, which is
 * right for chart tests and useless here: every pair correlates at exactly
 * +1.00 and the diverging scale is never exercised. This serves three
 * deliberately different return streams — a base walk, its mirror, and an
 * unrelated one — so the matrix has a red cell, a green cell and something in
 * between. Deterministic (fixed LCG seed), so the baseline is stable.
 *
 * Call BEFORE page.goto().
 */
export async function stubCorrelationPrices(page: Page): Promise<void> {
  const steps = (seed: number, n: number) => {
    let state = seed;
    return Array.from({ length: n }, () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return (state / 2147483648 - 0.5) * 0.04;
    });
  };
  const base = steps(7, 120);
  const noise = steps(991, 120);

  await page.route(/\/api\/prices\/([^/]+)\/range/, (route) => {
    const symbol = decodeURIComponent(
      route
        .request()
        .url()
        .match(/\/api\/prices\/([^/]+)\/range/)![1],
    );
    const walk = symbol === "AAPL" ? base : symbol === "NVDA" ? base.map((s) => -s) : noise;
    let price = 100;
    const bars = walk.map((step, i) => {
      price *= Math.exp(step);
      const time = new Date(Date.UTC(2026, 4, 1 + i, 20, 0, 0)).toISOString();
      return {
        time,
        symbol,
        open: price,
        high: price,
        low: price,
        close: Number(price.toFixed(2)),
        volume: 1_000_000,
      };
    });
    return route.fulfill(json({ data: bars, count: bars.length }));
  });
}

const stressPositionsFixture = readFixture<PositionData[]>("live-positions-stress.json");

/**
 * Swap the positions stub to the 5,000-row stress fixture (build doc §8.3).
 * Re-registering the same pattern wins over the auto-installed stub, as with
 * stubMultidayPrices. Call BEFORE page.goto().
 *
 * With `mutateOneAfterFirst`, every response after the first changes exactly
 * ONE row's price (and the P&L that follows from it) and leaves the other 4,999
 * byte-identical. Positions poll on a 15s interval, so the second response
 * arrives by itself — that is the §8.3 memo audit's "tick one cell". Returns
 * the mutated symbol for the assertion message.
 */
export async function stubStressPositions(
  page: Page,
  opts?: { mutateOneAfterFirst?: boolean; maxRows?: number },
): Promise<string> {
  // The audit requires the mutated row to be RENDERED — an unmounted virtual
  // row cannot re-render, and with every other row memo-rejected the tally
  // would read 0 forever (the original fixture-index-3 choice failed exactly
  // this way). The positions table's initial sort is market value DESC, so
  // the fixture's largest position is the top row at scrollTop 0; the bump
  // only grows its market value, keeping it there.
  const mutatedIndex = stressPositionsFixture.reduce(
    (top, r, i) =>
      parseFloat(r.marketValue ?? "0") > parseFloat(stressPositionsFixture[top].marketValue ?? "0")
        ? i
        : top,
    0,
  );
  const mutated = stressPositionsFixture[mutatedIndex];
  // maxRows trims the dataset for tests that need every row MOUNTED — at 5,000
  // rows a re-sort can virtualize a selected row out of the DOM entirely,
  // which is correct table behaviour but makes its aria-selected unreachable.
  // (12 rows × 42px fits inside the visible window + overscan.)
  const source = opts?.maxRows
    ? stressPositionsFixture.slice(0, opts.maxRows)
    : stressPositionsFixture;
  let served = 0;

  await page.route(/\/api\/positions(\?|$)/, (route) => {
    served += 1;
    if (!opts?.mutateOneAfterFirst || served === 1) {
      return route.fulfill(json({ data: source, count: source.length }));
    }
    // Structural sharing everywhere except one row: same array, one new object.
    const rows = source.slice();
    const price = parseFloat(mutated.currentPrice) + 0.37 * served;
    const qty = parseFloat(mutated.qty);
    const basis = parseFloat(mutated.costBasis);
    rows[mutatedIndex] = {
      ...mutated,
      currentPrice: price.toFixed(2),
      marketValue: (price * qty).toFixed(2),
      unrealizedPl: (price * qty - basis).toFixed(2),
    };
    return route.fulfill(json({ data: rows, count: rows.length }));
  });

  return mutated.symbol;
}

/**
 * Elements that legitimately change every run (build doc §2 step 4). The
 * session clock/countdown and per-symbol staleness ages live in StatusRail
 * behind the data-testid hooks added in W0; panel-date-range is the ChartPanel
 * header's "startDate – endDate" display, which anchors to the real current
 * date via the 5D preset and would otherwise break baselines every day.
 *
 * NOTE: page.clock freezing was tried and rejected — with timers paused,
 * TanStack Start route-component hydration stalls on / and /backtesting
 * (queries never fire; root effects run fine). Masks alone it is.
 */
export function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator("[data-testid='session-clock']"),
    page.locator("[data-testid='staleness']"),
    page.locator("[data-testid='panel-date-range']"),
    // §14 ticker: prices, membership AND scroll offset all move between runs.
    page.locator("[data-testid='ticker']"),
  ];
}

/**
 * Wait until the boot-time health probe has settled into its final,
 * deterministic state (trades + metrics flagged by the deliberate 404 stubs,
 * prices + symbols ok). Without this the status rail's API/flagged text could
 * be caught mid-transition.
 */
export async function waitForRailSettled(page: Page): Promise<void> {
  await expect(page.getByText("flagged: trades, metrics")).toBeVisible();
}

/**
 * Test base with the visual harness pre-installed: API stubs before the page
 * navigates anywhere, and a teardown assertion that no request escaped the
 * stub set (so no test ever reaches the real backend).
 */
export const test = base.extend<{ stubbedApi: string[] }>({
  stubbedApi: [
    async ({ page }, use) => {
      const { unmatched } = await stubApi(page);
      await use(unmatched);
      expect(
        unmatched,
        `unstubbed /api calls hit the 404 tripwire — add a fixture stub in tests/visual/fixtures.ts:\n${unmatched.join("\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
