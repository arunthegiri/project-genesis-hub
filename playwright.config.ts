import { defineConfig } from "@playwright/test";

/**
 * W0 visual harness (build doc §2). Runs against the vite dev server with all
 * /api/* calls stubbed via page.route() — the Spring backend is never needed.
 *
 * Port 3201 is fixed: 3000/3100 are occupied on this machine, and the
 * vite + Cloudflare (workerd) dev server gets a generous boot timeout.
 */
export default defineConfig({
  testDir: "./tests/visual",
  // Doc §2 says 30s/5s-defaults; on this machine the FIRST spec on a cold
  // server pays ~15-20s of per-route vite compilation, so both are raised.
  // Warm runs finish each test in 3-8s regardless.
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Serial workers: one dev server, and no cross-test timing variance in
  // screenshots.
  workers: 1,
  use: {
    baseURL: "http://localhost:3201",
    viewport: { width: 1600, height: 900 }, // desktop-first terminal
    screenshot: "only-on-failure",
    // Pin locale/timezone so toLocaleString / datetime formatting in
    // screenshots is stable across machines, not just across runs.
    locale: "en-US",
    timezoneId: "America/New_York",
  },
  expect: {
    // Generous anchor timeout: the first visit to each route on a cold
    // workerd+vite dev server pays per-route module compilation (6-9s
    // observed on this machine); warm runs settle in ~2s.
    timeout: 20_000,
    toHaveScreenshot: {
      animations: "disabled", // kills the #1 flake source
      maxDiffPixelRatio: 0.01,
      // DEVIATION from doc §2 (which says 0.2): pixelmatch's threshold is a
      // YIQ metric — at 0.2 a full --card token swap (oklch 0.19 → 0.35)
      // does NOT register as a diff (verified empirically). 0.05 catches
      // single-token color changes while staying above AA noise on this
      // dark theme. W1 token work depends on this sensitivity.
      threshold: 0.05,
    },
  },
  webServer: {
    command: "npm run dev -- --port 3201",
    url: "http://localhost:3201",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
