import {
  dynamicMasks,
  expect,
  stubCorrelationPrices,
  stubLatency,
  test,
  waitForRailSettled,
} from "./fixtures";

/**
 * §15 M6–M8 — the /metrics analysis workspace: strategy table, universe
 * ranking, correlation heatmap, PnL distributions, latency waterfall.
 *
 * The route used to be a single pending card, so these are new baselines
 * rather than updated ones.
 */

test("strategies tab: B1 table, metrics from the per-strategy detail", async ({ page }) => {
  await page.goto("/metrics");
  await waitForRailSettled(page);

  const rows = page.getByTestId("terminal-row");
  await expect(rows).toHaveCount(2);
  // Sharpe DESC is the default sort, so the 1.84 strategy leads.
  await expect(rows.first()).toContainText("rrc-momentum-v1");
  await expect(rows.first()).toContainText("1.84");
  // Source + mode badges: ONNX is inferred from the definition, PAPER from the
  // active-strategies endpoint.
  await expect(rows.nth(1)).toContainText("ONNX");
  await expect(rows.first()).toContainText("PAPER");

  await expect(page).toHaveScreenshot("metrics-strategies.png", { mask: dynamicMasks(page) });
});

test("selecting a strategy is URL state and reaches the distributions tab", async ({ page }) => {
  await page.goto("/metrics");
  await waitForRailSettled(page);

  await page.getByTestId("terminal-row").first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get("strategy")).toBe(
    "rrc-momentum-v1",
  );

  await page.getByRole("tab", { name: "Distributions" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("distributions");
  await expect(page.getByTestId("pnl-distribution")).toBeVisible();
  await expect(page.getByText("rrc-momentum-v1 · 18 trades")).toBeVisible();

  // Three bindings over one renderer (§15.4).
  await page.getByRole("tab", { name: "Day of week" }).click();
  await expect(page.getByTestId("pnl-distribution")).toContainText("Wed");
  await page.getByRole("tab", { name: "Outcome" }).click();
  await expect(page.getByTestId("pnl-distribution")).toContainText("%");

  await expect(page).toHaveScreenshot("metrics-distributions.png", { mask: dynamicMasks(page) });
});

test("universe tab: ranking runs fill in and promote appears with a selection", async ({
  page,
}) => {
  await page.goto("/metrics?tab=universe&strategy=rrc-momentum-v1");
  await waitForRailSettled(page);

  await page.getByTestId("rank-universe").click();
  // Every symbol in the fixture resolves through the stubbed /run.
  await expect(page.getByTestId("rank-progress")).toContainText("3 / 3 complete");

  // The checkbox column toggles one row without replacing the selection.
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();
  await expect(page.getByTestId("promote-footer")).toContainText("2 symbols selected");

  await expect(page).toHaveScreenshot("metrics-universe.png", { mask: dynamicMasks(page) });
});

test("correlation tab: canvas paints and a cell drills through to the charts page", async ({
  page,
}) => {
  // AAPL and NVDA get mirrored return streams, MSFT an unrelated one, so the
  // scale shows a red cell, a green diagonal and something in between.
  await stubCorrelationPrices(page);
  await page.goto("/metrics?tab=correlation");
  await waitForRailSettled(page);

  const canvas = page.getByTestId("correlation-canvas");
  await expect(canvas).toBeVisible();

  // Hover reports the pair and its coefficient. Columns follow the symbols
  // endpoint's order (AAPL, NVDA, MSFT), so row 0 / column 1 is the mirrored
  // AAPL–NVDA pair.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.15);
  await expect(page.getByTestId("correlation-readout")).toContainText("AAPL · NVDA");
  await expect(page.getByTestId("correlation-readout")).toContainText("ρ = -1.00");
  // §15 verify: the transposed cell is highlighted too — same coefficient,
  // confirmed at a glance rather than by counting rows.
  await expect(page.getByTestId("correlation-mirror")).toBeVisible();

  await expect(page).toHaveScreenshot("metrics-correlation.png", { mask: dynamicMasks(page) });

  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.15);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect.poll(() => new URL(page.url()).searchParams.get("symbols")).toMatch(/,/);
});

test("latency tab: pending without the endpoint, waterfall with it", async ({ page }) => {
  // Default fixture set 404s /api/metrics/engine, exactly like the real backend.
  await page.goto("/metrics?tab=latency");
  await waitForRailSettled(page);
  await expect(page.getByText("GET /api/metrics/engine?from=&to=  →  LatencySample[]")).toBeVisible();
  await expect(page).toHaveScreenshot("metrics-latency-pending.png", { mask: dynamicMasks(page) });

  // With the endpoint answering, the boot probe stops flagging `metrics`, so
  // the rail settles on different text — wait for the panel itself instead.
  await stubLatency(page);
  await page.reload();
  await expect(page.getByTestId("latency-waterfall")).toBeVisible();
  await expect(page.getByText("p95")).toBeVisible();
  await expect(page).toHaveScreenshot("metrics-latency.png", { mask: dynamicMasks(page) });
});
