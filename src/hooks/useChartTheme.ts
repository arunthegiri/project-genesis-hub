import { useEffect, useState } from "react";
import { resolveChartTheme, subscribeChartTheme, type ChartTheme } from "@/lib/chart-theme";

/**
 * Reactive §3.4 chart theme (build doc §13.4). Resolves synchronously on the
 * client — the series lifecycle effects need the theme in the mount commit
 * (resolving later was the blank-chart bug) — then re-resolves whenever the
 * ChartThemeRegistry fires (data-theme / data-convention / data-cb attribute
 * change), so every theme-colored series effect re-runs. Null on the server:
 * canvas charts mount client-only.
 */
export function useChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(() =>
    typeof window === "undefined" ? null : resolveChartTheme(),
  );
  useEffect(() => subscribeChartTheme(() => setTheme(resolveChartTheme())), []);
  return theme;
}
