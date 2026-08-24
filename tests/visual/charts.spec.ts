import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * / — Charts page (build doc §2 step 5). One panel pinned to AAPL 1Min via the
 * URL so the chart renders the 500-bar fixture; the baseline captures the
 * current UI (SymbolPicker + ChartPanel + StatusRail).
 */
test("charts page baseline", async ({ page }) => {
  await page.goto("/?symbols=AAPL&intervals=1Min");

  // ChartPanel header shows "N bars · <range>" once price data has landed;
  // the canvas exists only after the chart instance mounted post-skeleton.
  await expect(page.getByText(/500 bars ·/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForRailSettled(page);

  // The prices stub's built-in 1s delay (fixtures.ts) means the first
  // fitContent already ran at settled geometry; this short pause absorbs any
  // residual canvas repaint before the shot. (An earlier Shift+R viewport-reset
  // attempt was removed: with viewportIntent already 'fit', the reset is a
  // React state no-op and fixes nothing.)
  await page.waitForTimeout(500);

  await expect(page).toHaveScreenshot("charts-baseline.png", { mask: dynamicMasks(page) });
});
