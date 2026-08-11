import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Row density (build doc §8.1): two fixed heights, never measured. The height
 * is a NUMBER on purpose — react-virtual's `estimateSize` must return the exact
 * row height for `measureElement` to stay unused (§8.1: "estimateSize: () => 42
 * constant, no measureElement"), and TerminalRow receives it as a primitive
 * prop so the memo boundary can compare it.
 */
export type Density = "compact" | "default";

export const DENSITY_HEIGHT: Record<Density, number> = {
  compact: 32,
  default: 42,
};

/** Header height tracks the row height one step down — headers never tower. */
export const DENSITY_HEADER_HEIGHT: Record<Density, number> = {
  compact: 28,
  default: 32,
};

interface DensityValue {
  density: Density;
  rowHeight: number;
  headerHeight: number;
}

const DensityContext = createContext<DensityValue>({
  density: "default",
  rowHeight: DENSITY_HEIGHT.default,
  headerHeight: DENSITY_HEADER_HEIGHT.default,
});

export function DensityProvider({
  density = "default",
  children,
}: {
  density?: Density;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      density,
      rowHeight: DENSITY_HEIGHT[density],
      headerHeight: DENSITY_HEADER_HEIGHT[density],
    }),
    [density],
  );
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

/**
 * Read the density. NOTE: cells must NOT call this — a context read inside a
 * memoized row subtree re-renders that subtree on every provider change and
 * quietly defeats the §8.1 memo contract. TerminalTable reads it once and
 * passes `height` down as a primitive.
 */
export function useDensity(): DensityValue {
  return useContext(DensityContext);
}
