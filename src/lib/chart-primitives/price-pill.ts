/**
 * Price pill series primitive (build doc §11 M2, plan §3.6): the current-price
 * label in the price-axis gutter as a filled, direction-colored pill —
 * dir-up/dir-down vs the previous close, value inside — plus a second pill
 * directly below it carrying the replay position (`Bar 14,832 / 21,000`) in
 * backtest mode.
 *
 * Implemented with v5 series-primitive `priceAxisViews`: the library renders
 * the rounded, filled gutter label itself, so the pill gets the native label
 * geometry (font, radius, DPR handling) with custom text and colors. The
 * chart's own last-value label is disabled where this pill is attached
 * (`lastValueVisible: false`). NOTE: that does NOT hide the series price
 * line's axis label (v5 has no separate switch — verified empirically), so
 * both chart hosts also set `priceLineVisible: false` and re-add the dotted
 * line as an explicit `createPriceLine({ axisLabelVisible: false })`.
 *
 * Both pills use `fixedCoordinate` so they pin to the exact price (and 24px
 * below it) instead of the auto-anti-overlap shuffle, and draw above unfixed
 * labels. State comes in via `update()` (cheap field writes + the library's
 * own requestUpdate) — no data copies, no per-frame work beyond the library's
 * label layout.
 */

import type {
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { ChartTheme } from "@/lib/chart-theme";
import { readCssToken } from "@/lib/chart-primitives/chart-tokens";

export interface PricePillColors {
  /** dir-up fill (chart theme up). */
  up: string;
  /** dir-down fill (chart theme down). */
  down: string;
  /** Text on the up/down fill (contrasting background token). */
  onDirection: string;
  /** Replay pill fill (surface-2 token). */
  surface: string;
  /** Replay pill text (chart theme axis text). */
  text: string;
}

export interface PricePillState {
  /** Last price; null hides both pills. */
  price: number | null;
  /** close >= prev close. */
  up: boolean;
  /** Formatted price text. */
  text: string;
  /** Replay position text; null hides the replay pill. */
  replayText: string | null;
}

/** Vertical offset (px) of the replay pill below the price pill. MUST not
    exceed the axis-label height (~21px at the default 12px label font): a
    larger gap lets the underlying price-tick label peek between the two
    pills as a glitchy text sliver (ticks are painted under labels, and only
    the pills' backgrounds cover them). */
const REPLAY_OFFSET = 21;

class PricePillAxisView implements ISeriesPrimitiveAxisView {
  constructor(private readonly source: PricePillPrimitive) {}

  coordinate(): number {
    // Fixed-coordinate labels must return a large negative here so the
    // anti-overlap pass doesn't reserve a slot for them.
    return -10_000;
  }

  fixedCoordinate(): number | undefined {
    return this.source.priceCoordinate() ?? undefined;
  }

  text(): string {
    return this.source.state.text;
  }

  textColor(): string {
    return this.source.colors.onDirection;
  }

  backColor(): string {
    return this.source.state.up ? this.source.colors.up : this.source.colors.down;
  }

  visible(): boolean {
    return this.source.priceCoordinate() !== null;
  }

  tickVisible(): boolean {
    return false;
  }
}

class ReplayPillAxisView implements ISeriesPrimitiveAxisView {
  constructor(private readonly source: PricePillPrimitive) {}

  coordinate(): number {
    return -10_000;
  }

  fixedCoordinate(): number | undefined {
    const c = this.source.priceCoordinate();
    return c === null ? undefined : c + REPLAY_OFFSET;
  }

  text(): string {
    return this.source.state.replayText ?? "";
  }

  textColor(): string {
    return this.source.colors.text;
  }

  backColor(): string {
    return this.source.colors.surface;
  }

  visible(): boolean {
    return this.source.state.replayText !== null && this.source.priceCoordinate() !== null;
  }

  tickVisible(): boolean {
    return false;
  }
}

export class PricePillPrimitive implements ISeriesPrimitive<Time> {
  colors: PricePillColors;
  state: PricePillState = { price: null, up: true, text: "", replayText: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private series: ISeriesApi<any, Time> | null = null;
  private requestUpdate: () => void = () => undefined;
  private readonly views: readonly ISeriesPrimitiveAxisView[];

  constructor(colors: PricePillColors) {
    this.colors = colors;
    this.views = [new PricePillAxisView(this), new ReplayPillAxisView(this)];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = () => undefined;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.views; // stable reference — the library caches views by identity
  }

  /** priceToCoordinate is a cheap scale lookup, called a handful of times per
      label layout — not a layout read. */
  priceCoordinate(): number | null {
    if (!this.series || this.state.price === null) return null;
    const c = this.series.priceToCoordinate(this.state.price);
    return c === null ? null : (c as number);
  }

  update(state: Partial<PricePillState>): void {
    this.state = { ...this.state, ...state };
    this.requestUpdate();
  }

  setColors(colors: PricePillColors): void {
    this.colors = colors;
    this.requestUpdate();
  }
}

/**
 * Token-fed pill colors (§11 M2): direction fills from the §3.4 chart theme;
 * the text-on-direction and replay-pill surface come from the token layer via
 * readCssToken. Call from effects / theme-change paths only — never at module
 * scope (SSR) and never per frame (getComputedStyle is a layout-adjacent read).
 */
export function pricePillColors(theme: ChartTheme): PricePillColors {
  return {
    up: theme.up,
    down: theme.down,
    onDirection: readCssToken("--background"),
    surface: readCssToken("--surface-2"),
    text: theme.text,
  };
}
