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

// ── prices-range-multiday.json ────────────────────────────────────────────────
// Session-shading proof fixture (build doc §11 M2 verify). The 500-bar fixture
// above spans ONE partial session, so it can never show a regular→extended
// transition on both sides, nor a day-boundary tick. This one runs full
// extended hours (04:00–20:00 ET inclusive) across Thu 2026-07-23 and Fri
// 2026-07-24, which is the minimum window that exercises every case:
//
//   · pre-market band  04:00–09:30 ET, twice
//   · after-hours band 16:00–20:00 ET, twice
//   · ☀ day tick at Thu 20:00 ET (= Fri 00:00Z — the ET day opening next is
//     Friday, a trading day)
//   · ☾ day tick at Fri 20:00 ET (= Sat 00:00Z — the day ahead is a weekend)
//
// The week is deliberate, not arbitrary: a Fri→Sat rollover is the only way an
// equities feed ever produces a ☾ tick (bars exist only on trading days, so the
// glyph needs a bar landing on 00:00Z Saturday), and the 23rd/24th avoid a
// month end — on 07-31 the Aug 1 boundary renders as a MONTH tick, which
// outranks DayOfMonth and swallows the glyph entirely.
const MULTIDAY_DAYS = ["2026-07-23", "2026-07-24"];
const MULTIDAY_MINUTES = 16 * 60 + 1; // 04:00 → 20:00 inclusive

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function etOffsetMs(ms) {
  const p = {};
  for (const part of ET_FMT.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ms;
}

/** Instant (epoch ms) of an ET wall time on an ET calendar date. */
function etWallToUtcMs(date, hh, mm) {
  const naive = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const next = naive - etOffsetMs(guess);
    if (next === guess) return next;
    guess = next;
  }
  return guess;
}

function generateMultidayBars() {
  const rand = mulberry32(1337);
  const bars = [];
  let close = 218.0;
  for (const date of MULTIDAY_DAYS) {
    const dayStart = etWallToUtcMs(date, 4, 0);
    for (let i = 0; i < MULTIDAY_MINUTES; i++) {
      const t = dayStart + i * 60_000;
      const open = close;
      const changePct = (rand() - 0.492) * 0.006;
      close = round(open * (1 + changePct), 2);
      const spread = Math.abs(round(open * (rand() - 0.5) * 0.004, 2));
      const high = round(Math.max(open, close) + spread * rand(), 2);
      const low = round(Math.min(open, close) - spread * rand(), 2);
      // Extended hours trade thin — the volume profile makes the shaded bands
      // legible in the volume pane too, not just behind the candles.
      const etHour = (i + 4 * 60) / 60;
      const regular = etHour >= 9.5 && etHour < 16;
      const volume = Math.round((regular ? 40_000 : 4_000) + rand() * (regular ? 90_000 : 9_000));
      bars.push({
        time: new Date(t).toISOString(),
        symbol: "AAPL",
        open: round(open, 2),
        high,
        low,
        close,
        volume,
        vwap: round((high + low + close) / 3, 4),
        tradeCount: Math.round((regular ? 180 : 20) + rand() * (regular ? 640 : 70)),
      });
    }
  }
  return bars;
}

// ── live-positions-stress.json ────────────────────────────────────────────────
// 5,000-row stress fixture for the §8.3 W6 scroll budget (≤8ms React work per
// tick). Built BEFORE the TerminalTable adopters on purpose: a memo contract
// validated on the 2-row happy-path fixture and merely hoped for at 5,000 is
// exactly the kind of thing that passes review and then stutters in the app.
//
// Shapes matter as much as the count. The distribution deliberately produces
// rows where per-cell coloring DISAGREES within the row — last up on the day
// while unrealized PnL is red, and vice versa — which is the §8.3 reference
// behavior the audit must show rather than "fix".
const STRESS_ROWS = 5000;

function generateStressPositions() {
  const rand = mulberry32(90210);
  const rows = [];
  for (let i = 0; i < STRESS_ROWS; i++) {
    // Synthetic but plausible tickers, unique per row (they are the row ids).
    const a = String.fromCharCode(65 + Math.floor(rand() * 26));
    const b = String.fromCharCode(65 + Math.floor(rand() * 26));
    const c = String.fromCharCode(65 + Math.floor(rand() * 26));
    const symbol = `${a}${b}${c}${String(i).padStart(4, "0")}`;

    const side = rand() < 0.82 ? "long" : "short";
    const qty = Math.round(5 + rand() * 2000);
    const lastdayPrice = round(8 + rand() * 900, 2);
    // Day move and holding-period move are drawn INDEPENDENTLY so the two
    // colored columns disagree on roughly half the rows.
    const dayPct = (rand() - 0.5) * 0.09;
    const currentPrice = round(lastdayPrice * (1 + dayPct), 2);
    const entryPrice = round(currentPrice * (1 + (rand() - 0.5) * 0.4), 2);

    const costBasis = round(entryPrice * qty, 2);
    const marketValue = round(currentPrice * qty, 2);
    const dir = side === "long" ? 1 : -1;
    const unrealizedPl = round((marketValue - costBasis) * dir, 2);
    const unrealizedPlPct = costBasis === 0 ? 0 : round(unrealizedPl / costBasis, 6);

    rows.push({
      symbol,
      side,
      qty: String(qty),
      marketValue: marketValue.toFixed(2),
      costBasis: costBasis.toFixed(2),
      unrealizedPl: unrealizedPl.toFixed(2),
      unrealizedPlPct: String(unrealizedPlPct),
      currentPrice: currentPrice.toFixed(2),
      lastdayPrice: lastdayPrice.toFixed(2),
      changeToday: String(round(dayPct, 6)),
    });
  }
  return rows;
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
  "prices-range-multiday.json": generateMultidayBars(),
  "symbols.json": symbols,
  "coverage-blocks.json": coverageBlocks,
  "live-account.json": liveAccount,
  "live-positions.json": livePositions,
  "live-positions-stress.json": generateStressPositions(),
  "strategies.json": strategies,
  "strategies-active.json": strategiesActive,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote fixtures/${name}`);
}
