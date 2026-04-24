/**
 * Backend-aligned types. Mirrors the Spring Boot DTOs.
 * Do NOT change shapes without coordinating with the backend.
 */

export interface Symbol {
  symbol: string;
}

/** OHLCV bar from /api/prices/* */
export interface PriceBar {
  time: string;        // ISO-8601 UTC
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number | null;
  tradeCount?: number | null;
}

/**
 * Future shape — trades from the C++ engine. Not yet served by any endpoint.
 * Defined here so UI components can be typed against it.
 */
export interface Trade {
  symbol: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  side: "LONG" | "SHORT";
  strategyName: string;
  modelVersion: string;
}

export type Interval = "1Min" | "5Min" | "15Min" | "30Min" | "1Hour" | "1Day";

export const INTERVALS: { value: Interval; label: string }[] = [
  { value: "1Min", label: "1 minute" },
  { value: "5Min", label: "5 minutes" },
  { value: "15Min", label: "15 minutes" },
  { value: "30Min", label: "30 minutes" },
  { value: "1Hour", label: "1 hour" },
  { value: "1Day", label: "1 day" },
];
