import {
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
} from "lightweight-charts";

/**
 * ChartSyncGroup (build doc §10b) — two-way sync between independent
 * lightweight-charts v4 instances (main chart + RSI/MACD sub-panes):
 *   - visible logical range moves in lockstep (0.5-bar epsilon guard against
 *     rounding echo);
 *   - crosshair draws a vertical line at the same time on every member.
 *
 * A single re-entrancy `lock` kills feedback loops: time sync holds it until
 * the next animation frame (range events fire asynchronously), crosshair sync
 * releases it synchronously. The lock always clears in `finally` so a throw
 * can't wedge the group.
 *
 * Registration order matters: the FIRST registered chart is the reference
 * (main chart). Later registrations are pushed the reference's current range
 * once, so panes never mount half-synced. `register` is idempotent per chart
 * (re-registering only swaps the anchor series), which keeps it StrictMode-safe.
 */

interface SyncEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  series: ISeriesApi<any>;
  onRange: (range: LogicalRange | null) => void;
  onCrosshair: (param: MouseEventParams) => void;
}

export class ChartSyncGroup {
  private charts = new Map<IChartApi, SyncEntry>();
  private lock = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(chart: IChartApi, mainSeries: ISeriesApi<any>) {
    const existing = this.charts.get(chart);
    if (existing) {
      existing.series = mainSeries;
      return;
    }

    // Half-synced-mount fix: adopt the reference chart's current range BEFORE
    // subscribing, so the programmatic set can't echo back through the group.
    const reference = this.charts.keys().next().value as IChartApi | undefined;
    if (reference) {
      const range = reference.timeScale().getVisibleLogicalRange();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    }

    const entry: SyncEntry = {
      series: mainSeries,
      onRange: (r) => this.syncTime(chart, r),
      onCrosshair: (p) => this.syncCrosshair(chart, p),
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(entry.onRange);
    chart.subscribeCrosshairMove(entry.onCrosshair);
    this.charts.set(chart, entry);
  }

  unregister(chart: IChartApi) {
    const entry = this.charts.get(chart);
    if (!entry) return;
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(entry.onRange);
    chart.unsubscribeCrosshairMove(entry.onCrosshair);
    this.charts.delete(chart);
  }

  private syncTime(from: IChartApi, range: LogicalRange | null) {
    if (this.lock || !range) return;
    this.lock = true;
    try {
      for (const chart of this.charts.keys()) {
        if (chart === from) continue;
        const cur = chart.timeScale().getVisibleLogicalRange();
        if (!cur || Math.abs(cur.from - range.from) > 0.5 || Math.abs(cur.to - range.to) > 0.5) {
          chart.timeScale().setVisibleLogicalRange(range); // epsilon guard vs rounding echo
        }
      }
    } finally {
      // Range events fan out asynchronously — hold the lock until next frame.
      requestAnimationFrame(() => {
        this.lock = false;
      });
    }
  }

  private syncCrosshair(from: IChartApi, p: MouseEventParams) {
    if (this.lock) return;
    this.lock = true;
    try {
      for (const [chart, entry] of this.charts) {
        if (chart === from) continue;
        if (p.time !== undefined) {
          // The price arg only positions the horizontal line on the TARGET
          // pane — 0 is the standard v4 usage for time-only sync.
          chart.setCrosshairPosition(0, p.time, entry.series);
        } else {
          chart.clearCrosshairPosition();
        }
      }
    } finally {
      this.lock = false;
    }
  }
}
