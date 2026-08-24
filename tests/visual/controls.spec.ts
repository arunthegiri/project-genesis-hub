import { expect, test, waitForRailSettled } from "./fixtures";

/**
 * §9 W7 verify block. The storyboard route (/dev/controls) mounts every form
 * primitive × every state on one DEV-only page; the screenshot is taken of the
 * storyboard element itself so the sidebar/rail stay out of the baseline.
 *
 * The non-screenshot items:
 *   · keyboard pass — Radix ToggleGroup gives roving tabindex: Tab enters the
 *     group once, arrows move focus, Enter/Space activates (radio semantics —
 *     arrows alone must NOT change the selection);
 *   · the backtesting retrofit — the speed SegmentedControl and the capital
 *     UnitInput + QuickFillRow write through to the URL search params, which
 *     is the page's single state path (§4.2).
 */

const STORYBOARD = "/dev/controls";

test("storyboard: every primitive × state renders", async ({ page }) => {
  await page.goto(STORYBOARD);
  await expect(page.getByTestId("dev-controls")).toBeVisible();
  await waitForRailSettled(page);
  await expect(page.getByTestId("dev-controls")).toHaveScreenshot("controls-storyboard.png");
});

test("keyboard: arrows move focus, Enter selects (radio semantics)", async ({ page }) => {
  await page.goto(STORYBOARD);
  // Hydration gate: TanStack Start route components don't hydrate until the
  // shell's queries settle (the rail's probe text is the observable signal).
  // Clicking pre-hydration hits inert SSR DOM and the interaction is lost.
  await waitForRailSettled(page);
  const group = page.getByRole("group", { name: "Interval", exact: true });
  // Radix ToggleGroup type="single" renders items as role="radio"
  // (aria-checked, roving tabindex) — not plain buttons.
  const item = (label: string) => group.getByRole("radio", { name: label, exact: true });

  // 5m starts active; clicking focuses it.
  await expect(item("5m")).toHaveAttribute("aria-checked", "true");
  await item("5m").click();

  // Arrow moves FOCUS only — the selection must stay on 5m until activation.
  await page.keyboard.press("ArrowRight");
  await expect(item("15m")).toBeFocused();
  await expect(item("5m")).toHaveAttribute("aria-checked", "true");
  await expect(item("15m")).toHaveAttribute("aria-checked", "false");

  await page.keyboard.press("Enter");
  await expect(item("15m")).toHaveAttribute("aria-checked", "true");
  await expect(item("5m")).toHaveAttribute("aria-checked", "false");

  // Roving tabindex: exactly one tab stop in the group, on the active item.
  await expect(item("15m")).toHaveAttribute("tabindex", "0");
  await expect(item("5m")).toHaveAttribute("tabindex", "-1");

  // Focus-ring evidence for the W7 focus-visible state.
  await expect(group).toHaveScreenshot("controls-keyboard-focus.png");
});

test("backtesting retrofit: speed segments + capital quick-fill write the URL", async ({
  page,
}) => {
  await page.goto("/backtesting?tab=strategies");
  await waitForRailSettled(page);

  // Speed is a SegmentedControl now — one click, straight into the URL.
  const speed = page.getByRole("group", { name: "Replay speed" });
  await speed.getByRole("radio", { name: "25×", exact: true }).click();
  await expect(page).toHaveURL(/speed=25/);

  // QuickFillRow chip → startingCapital param, and the UnitInput re-syncs its
  // formatted display from the URL value (the startingCapital effect).
  await page.getByRole("group", { name: "Capital presets" }).getByRole("button", { name: "100k" }).click();
  await expect(page).toHaveURL(/startingCapital=100000/);
  await expect(page.getByLabel("Starting capital")).toHaveValue("100,000");

  // Typing a valid value writes through; the $ prefix is an adornment, not
  // part of the value.
  await page.getByLabel("Starting capital").fill("250000");
  await expect(page).toHaveURL(/startingCapital=250000/);
});
