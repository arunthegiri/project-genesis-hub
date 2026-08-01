import { apiFetch } from "./client";

/** One row in the models registry / one entry of a versions list. */
export interface ModelSummary {
  id: number;
  name: string;          // base model name, e.g. "rf"
  version: string;       // "v1"
  strategyName: string;  // full underlying strategy name, e.g. "rf_v1"
  status: string;        // EXPORTED | ACTIVE | STANDBY | STOPPED | ARCHIVED
  deployMode: string | null;
  featureCount: number | null;
  sharpeRatio: string | null;
  winRate: string | null;
  totalPnlPct: string | null;
  profitFactor: string | null;
  maxDrawdown: string | null;
  totalTrades: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Contract summary distilled from the strategy definition. All fields nullable. */
export interface ContractSummary {
  features: string[] | null;
  featureCount: number | null;
  outputClasses: unknown[] | null;
  buyThreshold: number | null;
  sellThreshold: number | null;
  symbols: unknown[] | null;
  deployMode: string | null;
}

/** Backtest / validation metrics for a model version. */
export interface PerformanceMetrics {
  symbol: string | null;
  fromTs: string | null;
  toTs: string | null;
  totalTrades: number | null;
  winningTrades: number | null;
  losingTrades: number | null;
  winRate: string | null;
  totalPnl: string | null;
  totalPnlPct: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  largestWin: string | null;
  largestLoss: string | null;
  profitFactor: string | null;
  maxDrawdown: string | null;
  sharpeRatio: string | null;
  createdAt: string | null;
}

/** Full detail for a single model version. */
export interface ModelDetail {
  id: number;
  name: string;
  version: string;
  strategyName: string;
  description: string | null;
  status: string;
  deployMode: string | null;
  createdAt: string;
  updatedAt: string;
  featureCount: number | null;
  contract: ContractSummary | null;
  performance: PerformanceMetrics | null;
}

export type DeployMode = "paper" | "live";

export const modelsApi = {
  /** List registered models (excludes archived). Returns [] when none exist. */
  list: () => apiFetch<ModelSummary[]>("/api/models"),

  /** All versions of a given model name. */
  versions: (name: string) =>
    apiFetch<ModelSummary[]>(`/api/models/${encodeURIComponent(name)}/versions`),

  /** Detail incl. metrics, feature count, contract summary. */
  detail: (name: string, version: string) =>
    apiFetch<ModelDetail>(
      `/api/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    ),

  /** Backtest/validation metrics; null (204) when no backtest exists yet. */
  performance: (name: string, version: string) =>
    apiFetch<PerformanceMetrics | null>(
      `/api/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}/performance`,
    ),

  /** Deploy a specific version (paper/live) — flips the underlying strategy ACTIVE. */
  deploy: (name: string, version: string, mode: DeployMode) =>
    apiFetch<ModelDetail>(
      `/api/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}/deploy`,
      { method: "POST", body: { mode } },
    ),

  /** Archive (soft-delete) a version — flips the underlying strategy ARCHIVED. */
  archive: (name: string, version: string) =>
    apiFetch<ModelDetail>(
      `/api/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { method: "DELETE" },
    ),
};
