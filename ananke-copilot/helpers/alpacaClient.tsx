import { ALPACA_BASE_URL } from "./_publicConfigs";

export type AlpacaBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  tradeCount: number;
};

function getHeaders() {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    throw new Error("Missing Alpaca API credentials in environment (ALPACA_API_KEY, ALPACA_API_SECRET)");
  }
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET,
  };
}

function mapBar(raw: any): AlpacaBar {
  return {
    time: raw.t,
    open: raw.o,
    high: raw.h,
    low: raw.l,
    close: raw.c,
    volume: raw.v,
    vwap: raw.vw,
    tradeCount: raw.n,
  };
}

export const alpacaClient = {
  /**
   * Fetches latest minute bars for multiple symbols.
   * Calls GET /v2/stocks/bars.
   */
  async fetchLatestBars(symbols: string[]): Promise<Map<string, AlpacaBar[]>> {
    if (symbols.length === 0) return new Map();

    const params = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: "1Min",
      start: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      limit: "10",
      feed: "iex",
      sort: "desc",
    });

    const url = `${ALPACA_BASE_URL}/v2/stocks/bars?${params.toString()}`;
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(`Alpaca error fetching latest bars: ${res.statusText}`);
    }

    const data = await res.json();
    const map = new Map<string, AlpacaBar[]>();

    if (data.bars) {
      for (const [sym, bars] of Object.entries(data.bars)) {
        map.set(sym, (bars as any[]).map(mapBar));
      }
    }

    return map;
  },

  /**
   * Fetches all historical minute bars for a single symbol, handling pagination automatically.
   * Calls GET /v2/stocks/{symbol}/bars.
   */
  async fetchHistoricalBars(symbol: string, from: Date, to: Date): Promise<AlpacaBar[]> {
    const allBars: AlpacaBar[] = [];
    let pageToken: string | null = null;

    do {
      const params = new URLSearchParams({
        timeframe: "1Min",
        start: from.toISOString(),
        end: to.toISOString(),
        limit: "10000",
        feed: "iex",
        sort: "asc",
      });

      if (pageToken) {
        params.set("page_token", pageToken);
      }

      const url = `${ALPACA_BASE_URL}/v2/stocks/${symbol}/bars?${params.toString()}`;
      const res = await fetch(url, { headers: getHeaders() });

      if (!res.ok) {
        throw new Error(`Alpaca error fetching historical bars for ${symbol}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.bars) {
        allBars.push(...data.bars.map(mapBar));
      }

      pageToken = data.next_page_token || null;
    } while (pageToken);

    return allBars;
  },

  /**
   * Searches tradable US equities from the active asset list.
   * Calls GET /v2/assets from the paper API endpoint.
   */
  async searchAssets(query: string): Promise<{ symbol: string; name: string }[]> {
    const PAPER_API_URL = "https://paper-api.alpaca.markets";
    const url = `${PAPER_API_URL}/v2/assets?status=active&asset_class=us_equity`;
    
    const res = await fetch(url, { headers: getHeaders() });
    
    if (!res.ok) {
      throw new Error(`Alpaca error searching assets: ${res.statusText}`);
    }

    const data = (await res.json()) as any[];
    const q = query.toLowerCase();

    // Filter by tradable and match query (startsWith for symbol, includes for name)
    const tradable = data.filter((a) => a.tradable);
    const matched = tradable.filter(
      (a) =>
        a.symbol.toLowerCase().startsWith(q) ||
        a.name.toLowerCase().includes(q)
    );

    // Sort to put exact symbol matches first
    matched.sort((a, b) => {
      const aExact = a.symbol.toLowerCase() === q;
      const bExact = b.symbol.toLowerCase() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return 0;
    });

    return matched.slice(0, 10).map((a) => ({
      symbol: a.symbol,
      name: a.name,
    }));
  },
};