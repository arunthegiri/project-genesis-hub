import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * /live — paper trading page against the account/positions/active-strategies
 * fixtures (no backend required). Baseline covers the three sections:
 * Portfolio stat cards, Open Positions, Active Strategies.
 */
test("live page baseline", async ({ page }) => {
  await page.goto("/live");

  // Portfolio value from the account fixture proves the query chain rendered.
  await expect(page.getByText("$254,812.44").first()).toBeVisible();
  await waitForRailSettled(page);

  await expect(page).toHaveScreenshot("live-baseline.png", { mask: dynamicMasks(page) });
});
