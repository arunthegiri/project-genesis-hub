import { expect, test } from "./fixtures";

/**
 * SSR hydration guard (working agreement §1.3: "SSR correctness is
 * non-negotiable").
 *
 * Every route is server-rendered and then hydrated; if the client's first
 * render disagrees with the streamed HTML, React throws away the subtree and
 * re-renders it — the render-then-snap this project has spent three build docs
 * eliminating. It is invisible in a screenshot (the second render usually
 * looks right), which is exactly why it needs its own test rather than an eye.
 *
 * The mismatch is reported on the console, so the test reads the console.
 */

const ROUTES = ["/", "/data", "/backtesting", "/live", "/metrics", "/models", "/copilot"];

for (const route of ROUTES) {
  test(`no hydration mismatch on ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/hydrat/i.test(text)) errors.push(text);
    });
    page.on("pageerror", (err) => {
      if (/hydrat/i.test(err.message)) errors.push(err.message);
    });

    await page.goto(route);
    // Hydration happens right after the HTML lands; give the route subtree
    // (which TanStack Start hydrates lazily) time to get there, plus a beat
    // for the first queries to settle underneath it.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    expect(errors, `hydration mismatch on ${route}:\n${errors.join("\n---\n")}`).toEqual([]);
  });
}
