/**
 * Deterministic fixture generator for the W0 visual harness (build doc §2).
 *
 * The Spring backend is not required for visual tests, so the fixtures under
 * ./fixtures are synthesized here instead of captured from it. Everything is
 * seeded and anchored to FIXED dates — re-running this script must produce
 * byte-identical output, or every committed screenshot baseline breaks.
 *
 *   node tests/visual/generate-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ── Seeded PRNG (mulberry32) — same stream on every platform/Node version ────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// ── prices-range.json ─────────────────────────────────────────────────────────
// 500 deterministic 1-minute bars ending at a FIXED timestamp (never
// Date.now()): Friday 2026-07-31 16:00 ET close = 20:00Z. Matches the PriceBar
// shape in src/lib/api/types.ts exactly.
const BARS_END_MS = Date.UTC(2026, 6, 31, 20, 0, 0); // 2026-07-31T20:00:00Z
const BAR_COUNT = 500;

function generateBars() {
  const rand = mulberry32(42);
  const bars = [];
  let close = 227.5;
  for (let i = 0; i < BAR_COUNT; i++) {
    const t = BARS_END_MS - (BAR_COUNT - 1 - i) * 60_000;
    const open = close;
    // Random walk: ±0.35% per bar with a faint upward drift.
    const changePct = (rand() - 0.485) * 0.007;
    close = round(open * (1 + changePct), 2);
    const spread = Math.abs(round(open * (rand() - 0.5) * 0.004, 2));
    const high = round(Math.max(open, close) + spread * rand(), 2);
    const low = round(Math.min(open, close) - spread * rand(), 2);
    const volume = Math.round(45_000 + rand() * 110_000);
    const vwap = round((high + low + close) / 3, 4);
    const tradeCount = Math.round(180 + rand() * 640);
    bars.push({
      time: new Date(t).toISOString(),
      symbol: "AAPL",
      open: round(open, 2),
      high,
      low,
      close,
      volume,
      vwap,
      tradeCount,
    });
  }
  return bars;
}

// ── Static fixtures ───────────────────────────────────────────────────────────

const symbols = [{ symbol: "AAPL" }, { symbol: "NVDA" }, { symbol: "MSFT" }];

// Raw backend shape (ApiDto.CoverageBlock) — pricesApi.coverageBlocks maps it.
const coverageBlocks = [
  {
    fromTime: new Date(BARS_END_MS - (BAR_COUNT - 1) * 60_000).toISOString(),
    toTime: new Date(BARS_END_MS).toISOString(),
    barCount: BAR_COUNT,
  },
];

const liveAccount = {
  id: "9f4e2a71-3c56-4b1d-9e8a-2f6d1c5b7a90",
  accountNumber: "PA3W0VISUAL",
  status: "ACTIVE",
  currency: "USD",
  buyingPower: "412350.75",
  cash: "103087.69",
  portfolioValue: "254812.44",
  equity: "254812.44",
  lastEquity: "251940.10",
  longMarketValue: "151724.75",
  shortMarketValue: "0",
  daytradingBuyingPower: "824701.50",
  regtBuyingPower: "412350.75",
};

const livePositions = [
  {
    symbol: "AAPL",
    side: "long",
    qty: "120",
    marketValue: "27618.00",
    costBasis: "26142.00",
    unrealizedPl: "1476.00",
    unrealizedPlPct: "0.0565",
    currentPrice: "230.15",
    lastdayPrice: "227.90",
    changeToday: "0.0099",
  },
  {
    symbol: "NVDA",
    side: "long",
    qty: "40",
    marketValue: "51244.00",
    costBasis: "53310.00",
    unrealizedPl: "-2066.00",
    unrealizedPlPct: "-0.0388",
    currentPrice: "1281.10",
    lastdayPrice: "1269.40",
    changeToday: "0.0092",
  },
];

const strategies = [
  {
    id: 1,
    name: "rrc-momentum-v1",
    description: "Opening-range momentum on 5-minute bars, ATR stops.",
    createdAt: "2026-05-12T14:30:00.000Z",
  },
  {
    id: 2,
    name: "tech5-meanrev",
    description: "Mean-reversion over the tech5 feature set, EOD flat.",
    createdAt: "2026-06-02T09:15:00.000Z",
  },
];

const strategiesActive = [
  {
    id: 1,
    name: "rrc-momentum-v1",
    description: "Opening-range momentum on 5-minute bars, ATR stops.",
    status: "ACTIVE",
    deployMode: "PAPER",
    createdAt: "2026-05-12T14:30:00.000Z",
  },
  {
    id: 2,
    name: "tech5-meanrev",
    description: "Mean-reversion over the tech5 feature set, EOD flat.",
    status: "STANDBY",
    deployMode: null,
    createdAt: "2026-06-02T09:15:00.000Z",
  },
];

// ── Write ─────────────────────────────────────────────────────────────────────

const files = {
  "prices-range.json": generateBars(),
  "symbols.json": symbols,
  "coverage-blocks.json": coverageBlocks,
  "live-account.json": liveAccount,
  "live-positions.json": livePositions,
  "strategies.json": strategies,
  "strategies-active.json": strategiesActive,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote fixtures/${name}`);
}
