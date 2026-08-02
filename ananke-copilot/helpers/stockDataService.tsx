import { db } from "./db";
import { alpacaClient } from "./alpacaClient";
import type { Selectable } from "kysely";
import type { StockPrices, TrackedSymbols, SymbolCoverage } from "./schema";

export const stockDataService = {
  /**
   * Returns all tracked symbols from tracked_symbols table.
   */
  async listSymbols(): Promise<Selectable<TrackedSymbols>[]> {
    return await db.selectFrom("trackedSymbols").selectAll().execute();
  },

  /**
   * Adds a symbol (uppercased). If it exists and is disabled, it re-enables it.
   */
  async addSymbol(symbol: string): Promise<Selectable<TrackedSymbols>> {
    const upper = symbol.toUpperCase();
    
    const existing = await db
      .selectFrom("trackedSymbols")
      .selectAll()
      .where("symbol", "=", upper)
      .executeTakeFirst();

    if (existing) {
      if (!existing.enabled) {
        return await db
          .updateTable("trackedSymbols")
          .set({ enabled: true })
          .where("id", "=", existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      return existing;
    }

    return await db
      .insertInto("trackedSymbols")
      .values({ symbol: upper, enabled: true })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  /**
   * Soft-deletes a tracked symbol by setting enabled=false.
   */
  async removeSymbol(symbol: string): Promise<void> {
    await db
      .updateTable("trackedSymbols")
      .set({ enabled: false })
      .where("symbol", "=", symbol.toUpperCase())
      .execute();
  },

  /**
   * Returns an array of enabled symbol names.
   */
  async getEnabledSymbols(): Promise<string[]> {
    const rows = await db
      .selectFrom("trackedSymbols")
      .select("symbol")
      .where("enabled", "=", true)
      .execute();
    return rows.map((r) => r.symbol);
  },

  /**
   * Returns stock_prices rows for the requested range, ordered by time asc.
   */
  async getPriceRange(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<Selectable<StockPrices>[]> {
    return await db
      .selectFrom("stockPrices")
      .selectAll()
      .where("symbol", "=", symbol.toUpperCase())
      .where("time", ">=", from)
      .where("time", "<=", to)
      .orderBy("time", "asc")
      .execute();
  },

  /**
   * Pure read of stored bars without invoking auto-fetch mechanisms.
   */
  async getRawPrices(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<Selectable<StockPrices>[]> {
    return await this.getPriceRange(symbol, from, to);
  },

  /**
   * Returns recent bars spanning the last N hours.
   */
  async getLatestPrices(symbol: string, hours: number): Promise<Selectable<StockPrices>[]> {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    return await db
      .selectFrom("stockPrices")
      .selectAll()
      .where("symbol", "=", symbol.toUpperCase())
      .where("time", ">=", from)
      .orderBy("time", "asc")
      .execute();
  },

  /**
   * Batch insert for price bars avoiding conflicts using ON CONFLICT DO NOTHING.
   * Chunks large inserts to prevent PostgreSQL parameter limits.
   */
  async savePriceBars(
    bars: {
      time: Date;
      symbol: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      vwap: number;
      tradeCount: number;
    }[]
  ): Promise<void> {
    if (bars.length === 0) return;

    const chunkSize = 1000;
    for (let i = 0; i < bars.length; i += chunkSize) {
      const chunk = bars.slice(i, i + chunkSize);
      await db
        .insertInto("stockPrices")
        .values(
          chunk.map((b) => ({
            time: b.time,
            symbol: b.symbol,
            open: b.open.toString(),
            high: b.high.toString(),
            low: b.low.toString(),
            close: b.close.toString(),
            volume: b.volume,
            vwap: b.vwap.toString(),
            tradeCount: b.tradeCount,
          }))
        )
        .onConflict((oc) => oc.columns(["time", "symbol"]).doNothing())
        .execute();
    }
  },

  /**
   * Returns symbol_coverage record determining currently cached timeline borders.
   */
  async getCoverage(symbol: string): Promise<Selectable<SymbolCoverage> | undefined> {
    return await db
      .selectFrom("symbolCoverage")
      .selectAll()
      .where("symbol", "=", symbol.toUpperCase())
      .executeTakeFirst();
  },

  /**
   * Upserts the coverage bounds, automatically spanning outward if the new limits supersede existing ones.
   */
  async updateCoverage(symbol: string, from: Date, to: Date): Promise<void> {
    const upper = symbol.toUpperCase();
    const existing = await this.getCoverage(upper);

    if (!existing) {
      await db
        .insertInto("symbolCoverage")
        .values({ symbol: upper, fromTime: from, toTime: to })
        .execute();
    } else {
      const newFrom = from < existing.fromTime ? from : existing.fromTime;
      const newTo = to > existing.toTime ? to : existing.toTime;

      await db
        .updateTable("symbolCoverage")
        .set({ fromTime: newFrom, toTime: newTo })
        .where("symbol", "=", upper)
        .execute();
    }
  },

  /**
   * Directly fetches explicit missing gaps from Alpaca API, stores them physically,
   * updates symbol coverage ranges, and returns the successful bar chunk length.
   */
  async fetchAndStorePrices(symbol: string, from: Date, to: Date): Promise<number> {
    const upper = symbol.toUpperCase();
    const alpacaBars = await alpacaClient.fetchHistoricalBars(upper, from, to);

    if (alpacaBars.length === 0) return 0;

    const mappedBars = alpacaBars.map((b) => ({
      time: new Date(b.time),
      symbol: upper,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      vwap: b.vwap,
      tradeCount: b.tradeCount,
    }));

    await this.savePriceBars(mappedBars);
    await this.updateCoverage(upper, from, to);

    return mappedBars.length;
  },

  /**
   * Smart fetch mechanism. Reconciles bounds, dynamically requesting any 
   * isolated left or right missing gaps, sequentially validating data state consistency.
   */
  async ensureDataAvailable(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<Selectable<StockPrices>[]> {
    const upper = symbol.toUpperCase();
    const coverage = await this.getCoverage(upper);

    if (!coverage) {
      await this.fetchAndStorePrices(upper, from, to);
    } else {
      if (from < coverage.fromTime) {
        await this.fetchAndStorePrices(upper, from, coverage.fromTime);
      }
      if (to > coverage.toTime) {
        await this.fetchAndStorePrices(upper, coverage.toTime, to);
      }
    }

    return await this.getPriceRange(upper, from, to);
  },
};