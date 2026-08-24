/**
 * §15.1 unit test — the correlation math behind the B4 heatmap.
 *
 * The panel is a canvas; the numbers are here. Run: npm run test:correlation
 */

import assert from "node:assert/strict";
import { alignedLogReturns, correlationMatrix, pearson } from "../src/lib/correlation.ts";

// ── pearson ─────────────────────────────────────────────────────────────────
assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1, "perfectly proportional → +1");
assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1, "perfectly inverse → −1");
assert.equal(pearson([1, 2, 3], [5, 5, 5]), null, "zero variance is undefined, not zero");
assert.equal(pearson([1], [1]), null, "one point is not a sample");
assert.ok(Math.abs(pearson([1, 2, 3, 4], [1, 3, 2, 4]) - 0.8) < 1e-9);

// ── alignment: series are matched on TIMESTAMPS, not bar index ──────────────
const a = [
  { time: "T1", close: 10 },
  { time: "T2", close: 11 },
  { time: "T3", close: 12 },
  { time: "T4", close: 13 },
];
const b = [
  { time: "T2", close: 20 },
  { time: "T3", close: 22 },
  { time: "T4", close: 24 },
  { time: "T5", close: 26 },
];
const aligned = alignedLogReturns([a, b]);
// Common grid is T2..T4 → 2 returns each, NOT 3 from naive index pairing.
assert.equal(aligned[0].length, 2);
assert.equal(aligned[1].length, 2);
assert.ok(Math.abs(aligned[1][0] - Math.log(22 / 20)) < 1e-12);

// Too little overlap → empty returns rather than a fabricated number.
const noOverlap = alignedLogReturns([
  [{ time: "X1", close: 1 }],
  [{ time: "Y1", close: 1 }],
]);
assert.deepEqual(noOverlap, [[], []]);

// ── matrix ──────────────────────────────────────────────────────────────────
// Built from explicit log steps, because that is what the function measures.
// (Two straight-line price ramps, one rising and one falling, are genuinely
// +1 correlated in log-return space — their returns both shrink monotonically.
// Using them as an "opposite" fixture tests the tester, not the code.)
const STEPS = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, -0.005, 0.012, -0.018];
const walk = (sign, drift = 0) => {
  let price = 100;
  const out = [{ time: "T00", close: price }];
  STEPS.forEach((step, i) => {
    price *= Math.exp(sign * step + drift);
    out.push({ time: `T${String(i + 1).padStart(2, "0")}`, close: price });
  });
  return out;
};

const up = walk(1);
const mirrored = walk(-1);
const m = correlationMatrix([up, mirrored]);
assert.equal(m.length, 2);
assert.equal(m[0][0], 1, "diagonal is 1");
assert.equal(m[1][1], 1);
assert.ok(Math.abs(m[0][1] + 1) < 1e-9, `mirrored returns should be −1, got ${m[0][1]}`);
assert.equal(m[0][1], m[1][0], "matrix is symmetric");

// A flat series correlates with nothing → NaN, which the renderer paints as
// "no data" instead of the lie that is 0.
const flat = up.map((bar) => ({ ...bar, close: 50 }));
const withFlat = correlationMatrix([up, flat]);
assert.ok(Number.isNaN(withFlat[0][1]), "undefined pair must be NaN");

// The reason correlation is computed on returns and not prices: give both
// series a strong shared uptrend and the opposite daily moves must still show
// through. On raw prices this pair would read ≈ +1.
const trendPair = correlationMatrix([walk(1, 0.05), walk(-1, 0.05)])[0][1];
assert.ok(trendPair < -0.9, `shared trend must not mask opposite returns (got ${trendPair})`);

console.log("correlation: OK");
