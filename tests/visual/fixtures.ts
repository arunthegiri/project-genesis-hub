import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Locator, type Page } from "@playwright/test";

import type { CoverageBlockResponse, PriceBar, Symbol } from "../../src/lib/api/types";
import type { AccountData, ActiveStrategy, PositionData } from "../../src/lib/api/live";
import type { StrategyListItem } from "../../src/lib/api/strategies";

// JSON fixtures are read from disk instead of imported: @playwright/test 1.49
// (pinned for macOS 13) rejects bare JSON module imports.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;

const pricesFixture = readFixture<PriceBar[]>("prices-range.json");
const symbolsFixture = readFixture<Symbol[]>("symbols.json");
const coverageFixture = readFixture<CoverageBlockResponse[]>("coverage-blocks.json");
const accountFixture = readFixture<AccountData>("live-account.json");
const positionsFixture = readFixture<PositionData[]>("live-positions.json");
const strategiesFixture = readFixture<StrategyListItem[]>("strategies.json");
const activeStrategiesFixture = readFixture<ActiveStrategy[]>("strategies-active.json");

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
