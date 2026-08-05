import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * /backtesting — replay, loaded state. ?loaded=true with the fixture window
 * loads all 500 bars paused at the last bar (cursor -1 → full window). The
 * trade log shows the designed inline notice: /api/trades/range is deliberately
 * 404-stubbed because the endpoint is unimplemented on the real backend too.
 */
test("backtesting page baseline", async ({ page }) => {
  await page.goto("/backtesting?symbol=AAPL&from=2026-07-31T07:30&to=2026-07-31T16:30&loaded=true");

  await expect(page.getByText("Bar 500 / 500")).toBeVisible();
  await expect(page.getByText(/Trade data unavailable/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForRailSettled(page);

  await expect(page).toHaveScreenshot("backtesting-baseline.png", { mask: dynamicMasks(page) });
});
