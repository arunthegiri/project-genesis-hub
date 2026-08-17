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

// ── §12 M3: replay state in the URL ──────────────────────────────────────────
// The fixture window is 500 bars. Restart seeks to bar 0, three steps land on
// cursor=3; the replay window (-5 → 120 logical) is a NON-default view, so the
// round-trip exercises cursor AND view restore through the same copied URL —
// no synthetic wheel-zoom needed.
const LOADED = "/backtesting?symbol=AAPL&from=2026-07-31T07:30&to=2026-07-31T16:30&loaded=true";

test("M3: cursor + view round-trip through a copied URL", async ({ page }) => {
  await page.goto(LOADED);
  await waitForRailSettled(page);
  await expect(page.getByText("Bar 500 / 500")).toBeVisible();

  await page.getByRole("button", { name: "Restart replay" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Step forward" }).click();
  }
  await expect(page.getByText("Bar 4 / 500")).toBeVisible();
  await expect(page).toHaveURL(/cursor=3/);

  // Control screenshot of the source state (§12 verify: replay-restored vs control).
  const canvas = page.locator("canvas").first();
  await expect(canvas).toHaveScreenshot("replay-restored.png");

  // Let the 300ms view debounce flush, then copy the URL into a FRESH document
  // (page.goto is a full navigation — useState initializers re-run, so this
  // proves restore comes from the URL alone, not lingering SPA state).
  await page.waitForTimeout(500);
  const shared = page.url();
  expect(shared).toMatch(/view=-?[\d.]+/);

  await page.goto(shared);
  await waitForRailSettled(page);
  await expect(page.getByText("Bar 4 / 500")).toBeVisible();
  await expect(page).toHaveURL(/cursor=3/);
  await expect(page).toHaveURL(/view=-?[\d.]+/);
  await expect(page.locator("canvas").first()).toHaveScreenshot("replay-restored.png");
});

test("M3: out-of-range cursor clamps to the dataset end", async ({ page }) => {
  await page.goto(`${LOADED}&cursor=9999`);
  await waitForRailSettled(page);
  await expect(page.getByText("Bar 500 / 500")).toBeVisible();
  // The clamp writes back through setCursor → the URL self-corrects.
  await expect(page).toHaveURL(/cursor=499/);
});

test("M3: playback replaces history, never pushes", async ({ page }) => {
  await page.goto(`${LOADED}&speed=25`);
  await waitForRailSettled(page);
  await page.getByRole("button", { name: "Restart replay" }).click();
  await expect(page).toHaveURL(/cursor=0/);

  const depthBefore = await page.evaluate(() => window.history.length);
  await page.getByRole("button", { name: "Play replay" }).click();
  await page.waitForTimeout(1200); // ~30 bars at 25×
  await page.getByRole("button", { name: "Pause replay" }).click();
  const depthAfter = await page.evaluate(() => window.history.length);

  expect(depthAfter).toBe(depthBefore);
  await expect(page).toHaveURL(/cursor=\d+/);
});

test("M3: clean URL opens with defaults and zero replay params", async ({ page }) => {
  await page.goto("/backtesting");
  await waitForRailSettled(page);
  expect(page.url()).not.toMatch(/[?&](cursor|view)=/);
  await expect(page.getByText("Select a symbol and date range, then click Load.")).toBeVisible();
});
