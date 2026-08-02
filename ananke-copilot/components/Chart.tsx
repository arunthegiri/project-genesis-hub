import React from "react";
import { ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";
import styles from "./Chart.module.css";

/**
 * Minimal shadcn-compatible recharts wrapper — the three exports the copilot
 * page imports. Series colors come from base.css (`--chart-color-1..5`) so the
 * chart follows the light/dark palette without any per-chart color choices.
 */

export interface ChartConfig {
  [key: string]: {
    label?: string;
    /** Any CSS color. Defaults to the palette slot for this series' position. */
    color?: string;
  };
}

const PALETTE = [
  "var(--chart-color-1)",
  "var(--chart-color-2)",
  "var(--chart-color-3)",
  "var(--chart-color-4)",
  "var(--chart-color-5)",
];

const ChartConfigContext = React.createContext<ChartConfig>({});

export function useChartConfig() {
  return React.useContext(ChartConfigContext);
}

/** Resolves a series key to its configured color, else its palette slot. */
export function chartColor(config: ChartConfig, key: string): string {
  const configured = config[key]?.color;
  if (configured) return configured;
  const index = Object.keys(config).indexOf(key);
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length];
}

export interface ChartContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  config?: ChartConfig;
  /** Fixed pixel height for the responsive wrapper. */
  height?: number;
  children: React.ReactElement;
}

export function ChartContainer({
  config = {},
  height = 240,
  className,
  children,
  ...props
}: ChartContainerProps) {
  return (
    <ChartConfigContext.Provider value={config}>
      <div
        className={[styles.container, className].filter(Boolean).join(" ")}
        style={{ height }}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartConfigContext.Provider>
  );
}

/** Passthrough to recharts' Tooltip, defaulting to the styled content below. */
export function ChartTooltip(props: TooltipProps<number, string>) {
  return <Tooltip content={<ChartTooltipContent />} {...props} />;
}

export interface ChartTooltipContentProps extends TooltipProps<number, string> {
  hideLabel?: boolean;
  /** Formats each value; defaults to a locale number with up to 2 decimals. */
  formatter?: (value: number, name: string) => React.ReactNode;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  formatter,
}: ChartTooltipContentProps) {
  const config = useChartConfig();

  if (!active || !payload?.length) return null;

  const format = (value: number, name: string) =>
    formatter
      ? formatter(value, name)
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className={styles.tooltip}>
      {!hideLabel && label != null && (
        <div className={styles.tooltipLabel}>{String(label)}</div>
      )}
      {payload.map((entry, i) => {
        const key = String(entry.dataKey ?? entry.name ?? i);
        const color = entry.color ?? chartColor(config, key);
        return (
          <div key={key} className={styles.tooltipRow}>
            <span
              className={styles.tooltipSwatch}
              style={{ backgroundColor: color }}
            />
            <span className={styles.tooltipName}>
              {config[key]?.label ?? entry.name ?? key}
            </span>
            <span className={styles.tooltipValue}>
              {format(Number(entry.value ?? 0), key)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
