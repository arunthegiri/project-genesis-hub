import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * /data — raw data explorer. Explicit symbol/from/to in the URL (location
 * state, §13) so the datetime inputs and query are byte-identical every run;
 * the fixture window (07:30–16:30 ET) brackets all 500 bars. CoverageTimeline
 * renders from the coverage fixture.
 */
test("data page baseline", async ({ page }) => {
  await page.goto("/data?symbol=AAPL&from=2026-07-31T07:30&to=2026-07-31T16:30&interval=1Min");

  await expect(page.getByText("500 rows for AAPL")).toBeVisible();
  await waitForRailSettled(page);

  await expect(page).toHaveScreenshot("data-baseline.png", { mask: dynamicMasks(page) });
});
