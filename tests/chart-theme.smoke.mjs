/**
 * W1 §3.4 smoke test — chart theme registry (extended in M4 §13: all four
 * themes' token tables + the registerChartTheme/applyAllChartThemes path).
 *
 * Asserts every resolved ChartTheme value is canvas-parseable
 * (/^(#|rgb|color\()/) so a bad/missing token fails loudly HERE instead of
 * silently painting charts black (the original chart-colors.ts production
 * bug). Runs in plain node: buildChartTheme takes an injectable token reader
 * because getComputedStyle doesn't exist outside a browser; the cached
 * resolveChartTheme() path is exercised against a minimal document mock.
 *
 * Run: npm run test:theme
 */

import assert from "node:assert/strict";
import {
  applyAllChartThemes,
  buildChartTheme,
  registerChartTheme,
  resolveChartTheme,
  invalidateChartTheme,
  withAlpha,
} from "../src/lib/chart-theme.ts";

const CANVAS_PARSEABLE = /^(#|rgb|color\()/;

// Mirror of the token values in src/styles.css, per §13 theme block (western
// direction pair — the data-convention/data-cb composition happens in CSS).
// If a token is renamed there without updating chart-theme.ts, the "empty
// token" case below is the tripwire.
const THEME_TOKENS = {
  "terminal-dark": {
    "--dir-up": "#35C77A",
    "--dir-down": "#F86177",
    "--dir-flat": "#8F98AA",
    "--accent-blue": "#4C9AFF",
    "--warning": "#E3B341",
    "--overlay-primary": "#F472B6",
    "--overlay-secondary": "#A78BFA",
    "--grid-line": "rgba(255,255,255,0.04)",
    "--text-secondary": "#A6AEBD",
  },
  "paper-light": {
    "--dir-up": "#0B6E4F",
    "--dir-down": "#B42318",
    "--dir-flat": "#5B6675",
    "--accent-blue": "#175CD3",
    "--warning": "#B54708",
    "--overlay-primary": "#DB2777",
    "--overlay-secondary": "#7C3AED",
    "--grid-line": "rgba(26,35,48,0.06)",
    "--text-secondary": "#4A5568",
  },
  "high-contrast": {
    "--dir-up": "#00E08A",
    "--dir-down": "#FF5C7A",
    "--dir-flat": "#B8B8B8",
    "--accent-blue": "#66B3FF",
    "--warning": "#E3B341",
    "--overlay-primary": "#FF7AC8",
    "--overlay-secondary": "#B9A0FF",
    "--grid-line": "rgba(255,255,255,0.06)",
    "--text-secondary": "#D9D9D9",
  },
  "graphite-neutral": {
    "--dir-up": "#35C77A",
    "--dir-down": "#F86177",
    "--dir-flat": "#9298A0",
    "--accent-blue": "#4C9AFF",
    "--warning": "#E3B341",
    "--overlay-primary": "#F472B6",
    "--overlay-secondary": "#A78BFA",
    "--grid-line": "rgba(255,255,255,0.04)",
    "--text-secondary": "#ACB0B6",
  },
};
const TOKENS = THEME_TOKENS["terminal-dark"];

function assertThemeParseable(theme, label) {
  for (const [key, value] of Object.entries(theme)) {
    const values = Array.isArray(value) ? value : [value];
    assert.ok(values.length > 0, `${label}: "${key}" must not be empty`);
    for (const v of values) {
      assert.match(
        v,
        CANVAS_PARSEABLE,
        `${label}: "${key}" resolved to ${JSON.stringify(v)} — not canvas-parseable (bad token?)`,
      );
    }
  }
}

// 1. Every value resolved from real token values is canvas-parseable — for
//    ALL FOUR §13 themes (the builder is injectable, so each theme's token
//    table gets the same tripwire).
for (const [themeId, tokens] of Object.entries(THEME_TOKENS)) {
  const t = buildChartTheme((n) => tokens[n] ?? "");
  assertThemeParseable(t, `buildChartTheme(${themeId})`);
  assert.equal(t.up, tokens["--dir-up"], `${themeId}: up must come from --dir-up`);
  assert.equal(t.down, tokens["--dir-down"], `${themeId}: down must come from --dir-down`);
}
const theme = buildChartTheme((n) => TOKENS[n] ?? "");
assert.equal(theme.overlays.length, 6, "overlays must have 6 entries (doc §3.4)");

// 2. Missing tokens must NOT slip through as empty strings — the assert above
//    has to fire (this is the loud failure that prevents black charts).
const broken = buildChartTheme(() => "");
assert.throws(() => assertThemeParseable(broken, "buildChartTheme(empty)"));

// 3. resolveChartTheme() path with a minimal document/getComputedStyle mock:
//    caches, and invalidateChartTheme() forces a re-resolve.
let reads = 0;
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({
  getPropertyValue: (n) => {
    reads++;
    return `  ${TOKENS[n] ?? ""}  `; // padded — resolver must trim
  },
});
try {
  invalidateChartTheme();
  const a = resolveChartTheme();
  assertThemeParseable(a, "resolveChartTheme(mock)");
  const readsAfterFirst = reads;
  const b = resolveChartTheme();
  assert.equal(b, a, "second call must return the cached object");
  assert.equal(reads, readsAfterFirst, "cached call must not re-read computed style");
  invalidateChartTheme();
  const c = resolveChartTheme();
  assert.notEqual(c, a, "invalidateChartTheme() must force a re-resolve");
  assert.ok(reads > readsAfterFirst, "re-resolve must re-read computed style");
} finally {
  delete globalThis.document;
  delete globalThis.getComputedStyle;
}

// 4. withAlpha conversions (hex + rgb inputs; unknown formats pass through).
assert.equal(withAlpha("#35C77A", 0.55), "rgba(53,199,122,0.55)");
assert.equal(withAlpha("#fff", 0.13), "rgba(255,255,255,0.13)");
assert.equal(withAlpha("rgb(76, 154, 255)", 0.25), "rgba(76,154,255,0.25)");
assert.equal(withAlpha("rgba(76,154,255,0.9)", 0), "rgba(76,154,255,0)");
assert.equal(withAlpha("color(display-p3 1 0 0)", 0.5), "color(display-p3 1 0 0)");

// 5. §13.4 registry: applyAllChartThemes() invalidates the cache and pushes
//    the freshly resolved theme into every registered applier; the returned
//    unregister detaches. (MutationObserver doesn't exist in node —
//    startChartThemeSync no-ops here, so applyAll is invoked directly.)
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({
  getPropertyValue: (n) => THEME_TOKENS["paper-light"][n] ?? "",
});
try {
  const seen = [];
  const unregister = registerChartTheme((t) => seen.push(t));
  applyAllChartThemes();
  assert.equal(seen.length, 1, "applier must fire exactly once per applyAll");
  assert.equal(
    seen[0].up,
    THEME_TOKENS["paper-light"]["--dir-up"],
    "applier must receive the re-resolved (light) theme",
  );
  unregister();
  applyAllChartThemes();
  assert.equal(seen.length, 1, "unregistered applier must not fire again");
} finally {
  invalidateChartTheme();
  delete globalThis.document;
  delete globalThis.getComputedStyle;
}

console.log("chart-theme smoke test: all assertions passed");
