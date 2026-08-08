import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_PREFS,
  getThemePrefs,
  subscribeThemePrefs,
  type ThemePrefs,
} from "@/lib/theme";

/**
 * React binding for the §13 theme store. `serverSnapshot` must be the value
 * the server rendered with (the root loader's cookie read) so the hydration
 * render is byte-identical to the SSR HTML; post-mount the client store
 * (backed by the same cookie) takes over and drives re-renders on change.
 */
export function useThemePrefs(serverSnapshot: ThemePrefs = DEFAULT_THEME_PREFS): ThemePrefs {
  return useSyncExternalStore(subscribeThemePrefs, getThemePrefs, () => serverSnapshot);
}
