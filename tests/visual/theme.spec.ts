import { dynamicMasks, expect, test, waitForRailSettled } from "./fixtures";

/**
 * §13 M4 theme system — the Verify block that never got automated.
 *
 * M4 shipped four themes plus two independent axes and was checked by eye. The
 * two claims worth holding onto mechanically are the ones a screenshot cannot
 * make on its own: that switching a theme re-themes the CHARTS without
 * recreating them (state loss is the failure mode, and it is invisible in a
 * still image), and that the market-convention axis really does reach every
 * direction-coloured surface rather than just the DOM ones.
 */

async function pickTheme(page: import("@playwright/test").Page, id: string) {
  await page.getByTestId("theme-settings-trigger").click();
  await page.getByTestId(`theme-option-${id}`).click();
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe(id);
  await page.keyboard.press("Escape");
}

for (const theme of ["paper-light", "high-contrast", "graphite-neutral"]) {
  test(`${theme}: the analysis workspace renders in every theme`, async ({ page }) => {
    await page.goto("/metrics");
    await waitForRailSettled(page);
    await pickTheme(page, theme);

    // Tokens actually moved: the app background is not the dark default.
    const background = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe("rgb(12, 15, 22)"); // --surface-0 in terminal-dark

    await expect(page).toHaveScreenshot(`theme-${theme}.png`, { mask: dynamicMasks(page) });
  });
}

test("charts re-theme in place — no recreation, no state loss", async ({ page }) => {
  // Pin a symbol so the chart actually mounts (the panel renders its skeleton
  // until data lands — same setup as charts.spec.ts).
  await page.goto("/?symbols=AAPL&intervals=1Min");
  await expect(page.getByText(/500 bars ·/)).toBeVisible();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  // Tag the live canvas node so identity survives the switch check.
  await page.evaluate(() => {
    const el = document.querySelector("canvas");
    if (el) (el as HTMLCanvasElement).dataset.themeProbe = "1";
  });

  await pickTheme(page, "paper-light");

  // Same node = applyOptions on the existing chart, not a rebuilt instance.
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("canvas")?.dataset.themeProbe ?? "gone"),
    )
    .toBe("1");
});

test("market convention swaps direction colours, DOM and canvas alike", async ({ page }) => {
  await page.goto("/live");
  await waitForRailSettled(page);

  // AAPL's P&L is positive in the fixture, so it is green under the western
  // convention and must become red under the east-asian one.
  const pnlCell = page.getByText("+$1,476.00");
  await expect(pnlCell).toBeVisible();
  const western = await pnlCell.evaluate((el) => getComputedStyle(el).color);

  await page.getByTestId("theme-settings-trigger").click();
  await page.getByTestId("convention-east-asian").click();
  await expect.poll(() => page.locator("html").getAttribute("data-convention")).toBe("east-asian");
  await page.keyboard.press("Escape");

  const eastAsian = await pnlCell.evaluate((el) => getComputedStyle(el).color);
  expect(eastAsian, "a profitable position must change colour with the convention").not.toBe(
    western,
  );
});

test("ticker animates transform only — nothing that can force layout", async ({ page }) => {
  await page.goto("/live");
  await waitForRailSettled(page);
  await expect(page.getByTestId("ticker-item").first()).toBeVisible();

  // §17 budget: "ticker — compositor-only animation". The honest mechanical
  // proxy is the keyframe property set: transform composites, width/left do not.
  const properties = await page.getByTestId("ticker").locator(".ticker-track").evaluate((el) => {
    const animations = el.getAnimations();
    const keys = new Set<string>();
    for (const animation of animations) {
      for (const frame of (animation.effect as KeyframeEffect).getKeyframes()) {
        for (const key of Object.keys(frame)) {
          if (!["offset", "composite", "computedOffset", "easing"].includes(key)) keys.add(key);
        }
      }
    }
    return [...keys];
  });
  expect(properties).toEqual(["transform"]);
});
