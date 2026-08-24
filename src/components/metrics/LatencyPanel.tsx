import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { metricsApi } from "@/lib/api/metrics";
import { buildUtcApiRange, getPresetRange } from "@/lib/date-range";
import { LatencyWaterfall } from "@/components/terminal/LatencyWaterfall";
import { PanelState } from "@/components/terminal/PanelState";
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";

/**
 * B7 latency panel (build doc §15.4). Backend-gated (D5): `/api/metrics/engine`
 * is one of the endpoints the boot probe expects to fail, so the panel's
 * normal state today is `pending` with the exact endpoint named — the
 * waterfall itself is finished and starts working the day the endpoint
 * answers.
 */

const RANGE_OPTIONS = [
  { value: "1D", label: "1D" },
  { value: "5D", label: "5D" },
  { value: "1M", label: "1M" },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

export function LatencyPanel() {
  const [range, setRange] = useState<RangeKey>("1D");

  const { from, to } = useMemo(() => {
    const preset = getPresetRange(range);
    return buildUtcApiRange(preset.startDate, preset.endDate);
  }, [range]);

  const latencyQ = useQuery({
    queryKey: ["metrics", "engine", from, to],
    queryFn: () => metricsApi.engine(from, to),
    retry: false,
  });

  if (latencyQ.isError) {
    return (
      <PanelState
        kind="pending"
        art="plug"
        message="Order-latency telemetry is not exposed by the backend yet."
        detail={["GET /api/metrics/engine?from=&to=  →  LatencySample[]"]}
      />
    );
  }

  if (!latencyQ.isFetched) {
    return <PanelState kind="loading" art="clock" message="Loading latency samples…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-2/40 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Window</span>
        <SegmentedControl
          ariaLabel="Latency window"
          options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={range}
          onValueChange={(v) => setRange(v as RangeKey)}
        />
      </div>
      <LatencyWaterfall samples={latencyQ.data ?? []} className="min-h-0 flex-1" />
    </div>
  );
}
