import { TickMarkType } from "lightweight-charts";

import { dynamicMasks, expect, stubMultidayPrices, test, waitForRailSettled } from "./fixtures";

/**
 * §11 M2 chart-surface verify block. The page baselines in charts.spec.ts prove
 * the surface as a whole; these are the four dedicated shots the section calls
 * for, plus the two behavioural checks that a screenshot cannot make:
 *
 *   · session bands land on real 09:30/16:00 ET boundaries (canvas probe)
 *   · the toolbar and the §17 hotkeys never disagree
 *
 * DEVIATION from §11's file list: the doc names four PNGs but describes five
 * surfaces — item 4 is the bottom Range/Interval toolbar and item 5 the top
 * icon row, and they sit on opposite sides of the plot, so no single clip holds
 * both. `chart-toolbar.png` is §11.4's bottom toolbar; the top row gets
 * `chart-icon-toolbar.png`.
 */

const CHARTS_URL = "/?symbols=AAPL&intervals=1Min";

/** Charts page with the 500-bar fixture, settled and ready to shoot. */
async function gotoCharts(page: import("@playwright/test").Page) {
  await page.goto(CHARTS_URL);
  await expect(page.getByText(/500 bars ·/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForRailSettled(page);
  await page.waitForTimeout(500);
}

// ── §11.1 Two-line legend ────────────────────────────────────────────────────

test("chart legend — two lines, per-value coloring", async ({ page }) => {
  await gotoCharts(page);

  const surface = page.getByTestId("chart-surface");
  const legend = page.getByTestId("chart-legend");
  await expect(legend).toBeVisible();

  // Park the crosshair on a fixed bar so the values are deterministic rather
  // than whatever the seed-from-last-bar write left behind. 35% across the
  // plot, vertically centred — always over the series, never over the pills.
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.waitForTimeout(200);

  // Line 1 = OHLC + change + volume, line 2 = the active indicator overlays.
  await expect(legend).toContainText(/O \d+\.\d{2}\s+H \d+\.\d{2}\s+L \d+\.\d{2}\s+C \d+\.\d{2}/);
  await expect(legend).toContainText(/Vol /);
  await expect(legend).toContainText(/SMA 20/);
  await expect(legend).toContainText(/SMA 50/);

  // Per-value coloring is inline style written by the imperative handle; assert
  // it is actually set (and not the inherited muted token) on an OHLC value.
  const closeColor = await legend.locator("span").nth(3).evaluate((el) => el.style.color);
  expect(closeColor).not.toBe("");

  await expect(legend).toHaveScreenshot("chart-legend.png");
});

// ── §11.2 Session shading ────────────────────────────────────────────────────

test("chart sessions — bands and day glyphs on real ET boundaries", async ({ page }) => {
  await stubMultidayPrices(page);
  await page.goto(CHARTS_URL);
  await expect(page.getByText(/1,922 bars ·|1922 bars ·/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await waitForRailSettled(page);
  await page.waitForTimeout(800);

  const surface = page.getByTestId("chart-surface");

  // Probe the painted canvas rather than trusting the segment math: sample a
  // row inside the pane's top margin (above the price action after fitContent,
  // so candles cannot pollute the scan) and read back the shaded runs.
  const runs = await surface.evaluate((host) => {
    const canvases = Array.from(host.querySelectorAll("canvas"));
    // The price pane's canvas is the widest one that is also the tallest —
    // the axis canvases are narrow/short by construction.
    const main = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const ctx = main.getContext("2d")!;
    const dpr = main.width / main.getBoundingClientRect().width;
    const y = Math.round(6 * dpr);
    const row = ctx.getImageData(0, y, main.width, 1).data;

    const key = (x: number) => `${row[x * 4]},${row[x * 4 + 1]},${row[x * 4 + 2]},${row[x * 4 + 3]}`;
    // Collapse the row into colour runs, then drop anything thin enough to be
    // a vertical grid line rather than a session band.
    const raw: { color: string; from: number; to: number }[] = [];
    for (let x = 0; x < main.width; x++) {
      const c = key(x);
      const last = raw[raw.length - 1];
      if (last && last.color === c) last.to = x;
      else raw.push({ color: c, from: x, to: x });
    }
    // Vertical grid lines chop every band into same-coloured fragments, so
    // drop the thin runs and then re-join neighbours that share a colour —
    // otherwise one band reads as one run per grid column.
    const thick = raw.filter((r) => r.to - r.from >= 8 * dpr);
    const merged: typeof thick = [];
    for (const r of thick) {
      const last = merged[merged.length - 1];
      if (last && last.color === r.color) last.to = r.to;
      else merged.push({ ...r });
    }
    // Clear = the colour covering the middle of day 1's regular session.
    const at = (frac: number) =>
      merged.find((r) => r.from <= frac * main.width && r.to >= frac * main.width)?.color;
    const clear = at(0.27);
    return {
      width: main.width,
      clear,
      band: at(0.08),
      shaded: merged
        .filter((r) => r.color !== clear)
        .map((r) => ({ from: r.from / main.width, to: r.to / main.width })),
    };
  });

  // The band colour must actually differ from the unshaded session.
  expect(runs.band, "no distinct fill inside day-1 pre-market").toBeTruthy();
  expect(runs.band).not.toBe(runs.clear);

  // Expected fractions come straight from the bar layout (1922 1-minute bars,
  // 961 per day, 04:00 ET at index 0): pre-market 0–329, after-hours 720–959,
  // then the same pair shifted by 961.
  //
  // THREE runs, not four: day 1's after-hours run ends at 19:59 ET and day 2's
  // pre-market starts at 04:00 ET the next morning, separated by the single
  // 20:00 ET bar. At 1922 bars across ~1180px that gap is sub-pixel, so the two
  // bands paint as one continuous stretch — which is also what it means:
  // the market is not in regular session for any of it.
  const expected = [
    [0 / 1922, 330 / 1922], // 07-23 pre-market
    [720 / 1922, 1291 / 1922], // 07-23 after-hours → 07-24 pre-market
    [1681 / 1922, 1921 / 1922], // 07-24 after-hours
  ];
  expect(runs.shaded.length, `expected 3 extended-hours bands, got ${runs.shaded.length}`).toBe(3);
  runs.shaded.forEach((run, i) => {
    expect(run.from, `band ${i} left edge`).toBeCloseTo(expected[i][0], 1);
    expect(run.to, `band ${i} right edge`).toBeCloseTo(expected[i][1], 1);
  });

  // Day-boundary glyphs. The time axis is canvas, not DOM, so there is no text
  // to read back — the committed chart-sessions.png below is what proves they
  // reach the axis. What IS assertable here is the formatter's decision at the
  // exact two boundaries this fixture was built to produce, imported live off
  // the dev server so the test binds to the shipping module, not a copy.
  const glyphs = await page.evaluate(
    async ([dayOfMonth, sunTs, moonTs]) => {
      const mod = await import("/src/lib/chart-primitives/session-shading.ts");
      return {
        sun: mod.sessionTickMarkFormatter(sunTs, dayOfMonth),
        moon: mod.sessionTickMarkFormatter(moonTs, dayOfMonth),
      };
    },
    [
      TickMarkType.DayOfMonth,
      Date.UTC(2026, 6, 24, 0, 0, 0) / 1000, // Thu 07-23 20:00 ET → Friday ahead
      Date.UTC(2026, 6, 25, 0, 0, 0) / 1000, // Fri 07-24 20:00 ET → weekend ahead
    ] as const,
  );
  expect(glyphs.sun).toBe("☀ 24");
  expect(glyphs.moon).toBe("☾ 25");

  await expect(surface).toHaveScreenshot("chart-sessions.png");
});

// ── §11.3 Price + replay pills ───────────────────────────────────────────────

test("chart pills — price pill and replay pill in the axis gutter", async ({ page }) => {
  // Both pills only coexist in replay mode, so this one shoots /backtesting.
  await page.goto("/backtesting?symbol=AAPL&loaded=true");
  await expect(page.getByText(/Bar 500 \/ 500/)).toBeVisible();
  await waitForRailSettled(page);
  await page.waitForTimeout(500);

  const surface = page.locator("canvas").first();
  const box = (await surface.boundingBox())!;
  // Clip the price-axis gutter: the pills stack against the right edge.
  await expect(page).toHaveScreenshot("chart-pills.png", {
    clip: {
      x: box.x + box.width - 200,
      y: box.y,
      width: 200 + 120,
      height: box.height,
    },
    mask: dynamicMasks(page),
  });
});

// ── §11.4 / §11.5 Toolbars ───────────────────────────────────────────────────

test("chart toolbars — bottom Range/Interval and top icon row", async ({ page }) => {
  await gotoCharts(page);

  await expect(page.getByTestId("chart-bottom-toolbar")).toHaveScreenshot("chart-toolbar.png");
  await expect(page.getByTestId("chart-toolbar")).toHaveScreenshot("chart-icon-toolbar.png");
});

// ── §11.4 Toolbar ↔ hotkey agreement ─────────────────────────────────────────

test("toolbar and hotkeys never disagree", async ({ page }) => {
  await gotoCharts(page);

  const interval = page.locator('[aria-label="Chart interval"]');
  const segment = (label: string) => interval.getByRole("radio", { name: label, exact: true });

  // The URL pins 1Min, so the toolbar must already show 1m — not AUTO.
  await expect(segment("1m")).toHaveAttribute("data-state", "on");
  await expect(segment("AUTO")).toHaveAttribute("data-state", "off");

  // §17 single-key hotkeys are scoped to the focused chart surface.
  await page.getByTestId("chart-surface").click();
  await page.keyboard.press("5");

  await expect(segment("5m")).toHaveAttribute("data-state", "on");
  await expect(segment("AUTO")).toHaveAttribute("data-state", "off");
  // The controls-strip select is the same state path — it must have moved too.
  await expect(page.getByText(/5 minute/).first()).toBeVisible();

  // …and back: the toolbar drives the same handler the hotkey does.
  await segment("15m").click();
  await expect(segment("15m")).toHaveAttribute("data-state", "on");
  await expect(segment("5m")).toHaveAttribute("data-state", "off");
});
