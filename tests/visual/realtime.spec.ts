import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * §14 M5 — ticker tape + WebSocket hot path.
 *
 * The visual half is one masked baseline; the interesting half is behavioural,
 * and it is all about what does NOT happen: no socket when the flag is off, no
 * row re-render when a price ticks, no main-thread animation for the tape.
 */

/** §14 verify: "flag off → polling path byte-identical to today." */
test("flag off: no WebSocket is ever constructed", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __wsAttempts: string[] };
    w.__wsAttempts = [];
    const Original = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = function (url: string, protocols?: string | string[]) {
      w.__wsAttempts.push(String(url));
      return new Original(url, protocols);
    };
  });

  await page.goto("/live");
  await waitForRailSettled(page);
  await page.waitForTimeout(1500);

  // Vite's own HMR socket connects to the page's origin; ours would connect to
  // the API host (VITE_WS_URL / :8080), so same-origin attempts are filtered.
  const attempts = await page.evaluate(() => {
    const w = window as unknown as { __wsAttempts: string[] };
    return w.__wsAttempts.filter((u) => !u.includes(window.location.host));
  });
  expect(
    attempts,
    "VITE_WS_ENABLED is unset, so startRealtime() must connect nothing",
  ).toEqual([]);
});

test("ticker: renders position symbols, pauses on hover, static under reduced motion", async ({
  page,
}) => {
  await page.goto("/live");
  await waitForRailSettled(page);

  const ticker = page.getByTestId("ticker");
  await expect(ticker).toBeVisible();
  // Two positions in the fixture × the duplicated track = four items.
  await expect(page.getByTestId("ticker-item")).toHaveCount(4);
  await expect(page.getByTestId("ticker-item").first()).toContainText(/NVDA|AAPL/);

  const track = ticker.locator(".ticker-track");
  // Duration is measured from the track, never hard-coded.
  const duration = await track.evaluate((el) => getComputedStyle(el).animationDuration);
  expect(duration).not.toBe("0s");

  await ticker.hover();
  await expect
    .poll(() => track.evaluate((el) => getComputedStyle(el).animationPlayState))
    .toBe("paused");

  // prefers-reduced-motion: no animation at all, and the strip scrolls instead.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await waitForRailSettled(page);
  await expect(page.getByTestId("ticker-item")).toHaveCount(2); // duplicate copy dropped
  const stripOverflow = await page
    .getByTestId("ticker")
    .evaluate((el) => getComputedStyle(el).overflowX);
  expect(stripOverflow).toBe("auto");
  await page.emulateMedia({ reducedMotion: null });
});

/**
 * The architectural assertion of §14 in one number.
 *
 * With the mock feed pushing ~20 msg/s, the positions table's Last column must
 * repaint while `__terminalRowRenders` stays at zero: the hot value never
 * travels through the row's props, so the memo boundary is never even asked.
 * If this count is non-zero, the stream has leaked into React state somewhere.
 */
test("mock feed: prices tick without a single row re-render", async ({ page }) => {
  await page.goto("/live?wsMock=1");
  await waitForRailSettled(page);

  const cell = page.getByTestId("live-cell").first();
  await expect(cell).toBeVisible();
  const before = (await cell.textContent())?.trim();

  await page.evaluate(() => {
    (window as unknown as { __terminalRowRenders: number }).__terminalRowRenders = 0;
  });

  // Wait for the value to actually move (the mock walks ±0.2% per message).
  await expect.poll(async () => (await cell.textContent())?.trim(), { timeout: 8000 }).not.toBe(
    before,
  );

  const rowRenders = await page.evaluate(
    () => (window as unknown as { __terminalRowRenders: number }).__terminalRowRenders,
  );
  expect(
    rowRenders,
    "a streamed price re-rendered a ROW — the hot value is leaking through row props",
  ).toBe(0);

  // Flash-on-change: the leaf carries one of the four alternating classes.
  await expect
    .poll(
      async () =>
        page
          .locator(
            "[data-testid='live-cell'].flash-up-a, [data-testid='live-cell'].flash-up-b, " +
              "[data-testid='live-cell'].flash-down-a, [data-testid='live-cell'].flash-down-b",
          )
          .count(),
      { timeout: 8000 },
    )
    .toBeGreaterThan(0);
});

test("status rail baseline with ticker", async ({ page }) => {
  await page.goto("/live");
  await waitForRailSettled(page);
  await expect(page.getByTestId("ticker-item").first()).toBeVisible();
  await expect(page.locator("footer")).toHaveScreenshot("rail-ticker.png", {
    mask: dynamicMasks(page),
  });
});
