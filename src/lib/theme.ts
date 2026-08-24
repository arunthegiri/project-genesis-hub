// Build doc §13 (M4) — theme preference store.
//
// Three independent axes, all persisted in ONE `ui.theme` JSON cookie (the
// §13 cookie jar — never localStorage, SSR consistency):
//   theme       "terminal-dark" (default) | "paper-light" | "high-contrast" | "graphite-neutral"
//   convention  "western" (green up) | "east-asian" (red up)
//   cb          colorblind-safe direction pair (Okabe-Ito–derived)
//
// The axes land on <html> as data-theme / data-convention / data-cb,
// stamped three ways from the SAME cookie:
//   1. server-side by the root shell (loader reads the cookie in the SSR
//      request context) — first paint is correct;
//   2. pre-paint by NOFLASH_SCRIPT (inline in <head>) as the fallback that
//      also resolves prefers-color-scheme, which the server cannot know;
//   3. declaratively post-hydration, when this store re-renders the shell.
//
// Explicit-choice rule (§13.2): while the cookie has no `theme` key, the
// theme follows prefers-color-scheme and a change listener stays attached;
// the first explicit pick writes the key and detaches the listener. The
// convention/cb axes are plain persisted values with fixed defaults.

import { readUiCookieJson, writeUiCookie, THEME_UI_COOKIE } from "@/lib/cookie-state";

export type ThemeId = "terminal-dark" | "paper-light" | "high-contrast" | "graphite-neutral";
export type MarketConvention = "western" | "east-asian";

export interface ThemePrefs {
  theme: ThemeId;
  convention: MarketConvention;
  cb: boolean;
}

export const THEMES: ReadonlyArray<{ id: ThemeId; label: string; hint: string }> = [
  { id: "terminal-dark", label: "Dark", hint: "Terminal dark (default)" },
  { id: "paper-light", label: "Light", hint: "Paper light" },
  { id: "high-contrast", label: "Contrast", hint: "High contrast — AAA text" },
  { id: "graphite-neutral", label: "Graphite", hint: "Graphite neutral" },
];

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  theme: "terminal-dark",
  convention: "western",
  cb: false,
};

/** Dark themes keep the `.dark` class (shadcn `dark:` variants, e.g. ui/alert)
    and sonner's dark theme; paper-light must not match either. */
export const isDarkTheme = (id: ThemeId): boolean => id !== "paper-light";

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && THEME_IDS.has(v);

/** Validates a parsed cookie value into concrete prefs (defaults fill gaps). */
export function normalizeThemePrefs(raw: unknown): ThemePrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: isThemeId(p.theme) ? p.theme : DEFAULT_THEME_PREFS.theme,
    convention: p.convention === "east-asian" ? "east-asian" : "western",
    cb: p.cb === true,
  };
}

// ── Client store ──────────────────────────────────────────────────────────
// `themeLocked` mirrors whether the cookie carries an explicit theme choice.
// While unlocked the theme follows prefers-color-scheme (change listener
// attached, nothing persisted); the first explicit pick locks it.

interface ClientState {
  prefs: ThemePrefs;
  themeLocked: boolean;
}

const LIGHT_MEDIA = "(prefers-color-scheme: light)";

let client: ClientState | null = null;
let mediaQuery: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function mediaDefaultTheme(): ThemeId {
  // Dark on tie / unknown (§13.2).
  return typeof window !== "undefined" && window.matchMedia?.(LIGHT_MEDIA).matches
    ? "paper-light"
    : "terminal-dark";
}

function onMediaChange(e: MediaQueryListEvent): void {
  if (!client || client.themeLocked) return;
  client = {
    prefs: { ...client.prefs, theme: e.matches ? "paper-light" : "terminal-dark" },
    themeLocked: false,
  };
  emit();
}

function ensureClient(): ClientState {
  if (client) return client;
  const raw = readUiCookieJson<Record<string, unknown>>(THEME_UI_COOKIE);
  const themeLocked = isThemeId(raw?.theme);
  const prefs = normalizeThemePrefs(raw);
  if (!themeLocked) prefs.theme = mediaDefaultTheme();
  client = { prefs, themeLocked };
  if (!themeLocked && typeof window !== "undefined" && window.matchMedia) {
    mediaQuery = window.matchMedia(LIGHT_MEDIA);
    mediaQuery.addEventListener("change", onMediaChange);
  }
  return client;
}

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Client store snapshot (stable reference between notifications). On the
 * server there is no store — SSR/hydration renders get their prefs from the
 * root loader via useThemePrefs(serverSnapshot), so this falls back to the
 * defaults if reached server-side.
 */
export function getThemePrefs(): ThemePrefs {
  if (typeof document === "undefined") return DEFAULT_THEME_PREFS;
  return ensureClient().prefs;
}

export function subscribeThemePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merges a patch, persists the cookie, and notifies subscribers (the root
    shell re-renders and re-stamps the <html> attributes declaratively). */
export function setThemePrefs(patch: Partial<ThemePrefs>): void {
  const state = ensureClient();
  const prefs: ThemePrefs = { ...state.prefs, ...patch };
  let themeLocked = state.themeLocked;
  if (patch.theme !== undefined && !themeLocked) {
    themeLocked = true;
    mediaQuery?.removeEventListener("change", onMediaChange);
    mediaQuery = null;
  }
  client = { prefs, themeLocked };
  const stored: Record<string, unknown> = { convention: prefs.convention, cb: prefs.cb };
  if (themeLocked) stored.theme = prefs.theme;
  writeUiCookie(THEME_UI_COOKIE, JSON.stringify(stored));
  emit();
}

// ── No-flash inline script (§13.2) ────────────────────────────────────────
// Rendered verbatim into <head> by the root shell; synchronous, so the
// attributes are stamped before first paint. Reads the SAME cookie and
// stamps the SAME attributes as the shell — keep the logic in lockstep with
// normalizeThemePrefs / mediaDefaultTheme / RootShell.
export const NOFLASH_SCRIPT = `(function(){try{var d=document.documentElement;var m=document.cookie.match(/(?:^|;\\s*)${THEME_UI_COOKIE.replace(".", "\\.")}=([^;]*)/);var p=m?JSON.parse(decodeURIComponent(m[1])):{};var t=p.theme;if(t!=="terminal-dark"&&t!=="paper-light"&&t!=="high-contrast"&&t!=="graphite-neutral"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"paper-light":"terminal-dark";}d.setAttribute("data-theme",t);d.setAttribute("data-convention",p.convention==="east-asian"?"east-asian":"western");d.setAttribute("data-cb",p.cb===true?"on":"off");if(t!=="paper-light"){d.classList.add("dark");}else{d.classList.remove("dark");}}catch(e){}})();`;
