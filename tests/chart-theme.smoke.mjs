/**
 * W1 §3.4 smoke test — chart theme registry.
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
  buildChartTheme,
  resolveChartTheme,
  invalidateChartTheme,
  withAlpha,
} from "../src/lib/chart-theme.ts";

const CANVAS_PARSEABLE = /^(#|rgb|color\()/;

// Mirror of the W1 token values in src/styles.css (:root). If a token is
// renamed there without updating chart-theme.ts, the "empty token" case
// below is the tripwire.
const TOKENS = {
  "--dir-up": "#35C77A",
  "--dir-down": "#F86177",
  "--dir-flat": "#8F98AA",
  "--accent-blue": "#4C9AFF",
  "--warning": "#E3B341",
  "--overlay-primary": "#F472B6",
  "--overlay-secondary": "#A78BFA",
  "--grid-line": "rgba(255,255,255,0.04)",
  "--text-secondary": "#A6AEBD",
};

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

// 1. Every value resolved from real token values is canvas-parseable.
const theme = buildChartTheme((n) => TOKENS[n] ?? "");
assertThemeParseable(theme, "buildChartTheme(tokens)");
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

console.log("chart-theme smoke test: all assertions passed");
