import { ANANKE_API_BASE_URL } from "./_publicConfigs";

export interface PriceBar {
  time: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  tradeCount: number;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(`${ANANKE_API_BASE_URL}${path}`, options);
    if (!res.ok) {
      return { error: `HTTP error ${res.status}: ${await res.text()}` };
    }
    const json = await res.json();
    if (json && typeof json === "object") {
      if ("data" in json) return { data: json.data as T };
      if ("content" in json) return { data: json.content as T };
    }
    return { data: json as T };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { error: `Fetch failed: ${err.message}` };
    }
    return { error: "Unknown fetch error" };
  }
}

export const anankeApiClient = {
  listSymbols: () => fetchApi<any[]>("/api/symbols"),
  addSymbol: (symbol: string) =>
    fetchApi<any>("/api/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    }),
  deleteSymbol: (symbol: string) =>
    fetchApi<any>(`/api/symbols/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),
  getPriceRange: (symbol: string, from: string, to: string) =>
    fetchApi<PriceBar[]>(
      `/api/prices/${encodeURIComponent(symbol)}/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
};

export function summarizePriceData(bars: PriceBar[]) {
  if (!bars || bars.length === 0) return { error: "No data available" };
  const sorted = [...bars].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const dailyBars = new Map<string, any>();
  for (const bar of sorted) {
    const day = bar.time.substring(0, 10);
    if (!dailyBars.has(day)) {
      dailyBars.set(day, {
        date: day,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      const existing = dailyBars.get(day);
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  const dailyArray = Array.from(dailyBars.values());
  const step = Math.max(1, Math.floor(dailyArray.length / 60));
  const sampled = dailyArray.filter((_, i) => i % step === 0).slice(0, 60);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const avgVolume = sorted.reduce((sum, b) => sum + b.volume, 0) / sorted.length;
  const priceChangePct = ((last.close - first.open) / first.open) * 100;

  return {
    totalRawBars: bars.length,
    dateRange: {
      from: first.time,
      to: last.time,
    },
    summary: {
      open: first.open,
      close: last.close,
      high: Math.max(...sorted.map((b) => b.high)),
      low: Math.min(...sorted.map((b) => b.low)),
      averageVolume: avgVolume,
      priceChangePercent: priceChangePct,
    },
    sampledDailyData: sampled,
  };
}