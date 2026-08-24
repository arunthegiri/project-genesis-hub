import { useEffect, useRef } from "react";
import {
  LineSeries,
  LineStyle,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { EquityPoint } from "@/lib/api/strategies";
import { useChartBase, toTs } from "@/hooks/useChartBase";
import { useChartTheme } from "@/hooks/useChartTheme";
import { resolveChartTheme, withAlpha } from "@/lib/chart-theme";

interface Props {
  equityCurve: EquityPoint[];
  buyHoldCurve?: EquityPoint[];
  height?: number;
}

export function EquityChart({ equityCurve, buyHoldCurve, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { chartRef } = useChartBase(containerRef);
  const seriesRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const zeroRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const bahRef       = useRef<ISeriesApi<"Line"> | null>(null);
  // §13.4 reactive chart theme — drives the in-place re-theme effect below.
  const theme = useChartTheme();

  // Create series once on mount (chart created by useChartBase). The zero and
  // buy-&-hold lines derive from theme.text (alpha-stepped) — the old
  // white-ish rgba literals were invisible on the light themes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const initialTheme = resolveChartTheme();

    seriesRef.current = chart.addSeries(LineSeries, {
      color: initialTheme.accent,
      lineWidth: 2,
      priceLineVisible: false,
      title: "Strategy",
    });
    zeroRef.current = chart.addSeries(LineSeries, {
      color: withAlpha(initialTheme.text, 0.2),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    bahRef.current = chart.addSeries(LineSeries, {
      color: withAlpha(initialTheme.text, 0.65),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: "Buy & Hold",
    });

    return () => {
      seriesRef.current = null;
      zeroRef.current = null;
      bahRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // §13.4: re-theme the live series in place — no recreation, so the equity
  // data effects and the user's range are untouched.
  useEffect(() => {
    if (!theme) return;
    seriesRef.current?.applyOptions({ color: theme.accent });
    zeroRef.current?.applyOptions({ color: withAlpha(theme.text, 0.2) });
    bahRef.current?.applyOptions({ color: withAlpha(theme.text, 0.65) });
  }, [theme]);

  // Strategy equity curve
  useEffect(() => {
    const chart  = chartRef.current;
    const series = seriesRef.current;
    const zero   = zeroRef.current;
    if (!chart || !series || !zero) return;

    if (!equityCurve.length) {
      series.setData([]);
      zero.setData([]);
      return;
    }

    const data = toChartData(equityCurve);
    series.setData(data);
    zero.setData(data.map(d => ({ time: d.time, value: 0 })));
    chart.timeScale().fitContent();
  }, [equityCurve]);

  // Buy & hold overlay
  useEffect(() => {
    const bah = bahRef.current;
    if (!bah) return;
    if (!buyHoldCurve?.length) {
      bah.setData([]);
      return;
    }
    bah.setData(toChartData(buyHoldCurve));
  }, [buyHoldCurve]);

  const hasData = equityCurve.length > 0 || (buyHoldCurve?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center border-t border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        No equity curve data
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-3 px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Equity Curve — Cumulative PnL
        </span>
        <span className="flex items-center gap-1 text-[10px] text-accent-blue">
          <span className="inline-block h-0.5 w-4 bg-accent-blue" /> Strategy
        </span>
        {(buyHoldCurve?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" /> Buy &amp; Hold
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

function toChartData(curve: EquityPoint[]): { time: Time; value: number }[] {
  return curve
    .map(p => ({ time: toTs(p.time) as Time, value: p.cumulative_pnl }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}
