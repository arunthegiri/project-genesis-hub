import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import type { RouterContext } from "../router";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";
import { StatusRail } from "@/components/StatusRail";
import { CommandPalette } from "@/components/CommandPalette";
import { runHealthProbe } from "@/lib/api/health-probe";
import { togglePalette } from "@/lib/command-registry";
import { startLoafInstrumentation } from "@/lib/perf/loaf";
import { readUiCookieServerFn, THEME_UI_COOKIE } from "@/lib/cookie-state";
import {
  DEFAULT_THEME_PREFS,
  NOFLASH_SCRIPT,
  isDarkTheme,
  normalizeThemePrefs,
  type ThemePrefs,
} from "@/lib/theme";
import { useThemePrefs } from "@/hooks/useThemePrefs";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // §13 M4: the ui.theme cookie is read inside the SSR request context so the
  // shell stamps data-theme/data-convention/data-cb on <html> server-side —
  // first paint is already the right theme (no flash). With no cookie the
  // server emits the dark default; the inline NOFLASH_SCRIPT below then
  // resolves prefers-color-scheme client-side before paint.
  loader: async (): Promise<ThemePrefs> => {
    const raw = await readUiCookieServerFn({ data: THEME_UI_COOKIE });
    if (!raw) return DEFAULT_THEME_PREFS;
    try {
      return normalizeThemePrefs(JSON.parse(raw));
    } catch {
      return DEFAULT_THEME_PREFS;
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Quant Trading Platform" },
      {
        name: "description",
        content: "Professional quant trading dashboard, data exploration, and backtesting.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // SSR/hydration render from the loader's cookie read (byte-identical);
  // post-mount the client store (same cookie) takes over, so the settings
  // popover re-stamps these attributes declaratively — no imperative DOM
  // writes that a later shell re-render could clobber with stale loader data.
  // suppressHydrationWarning: with no cookie the NOFLASH_SCRIPT may stamp a
  // prefers-color-scheme theme the server couldn't know; the post-mount store
  // sync converges on the same value with no visual change.
  const loaderPrefs = Route.useLoaderData();
  const prefs = useThemePrefs(loaderPrefs);
  return (
    <html
      lang="en"
      // shadcn `dark:` variants (ui/alert) gate on .dark — kept for the dark
      // themes only; paper-light must not match them.
      className={isDarkTheme(prefs.theme) ? "dark" : undefined}
      data-theme={prefs.theme}
      data-convention={prefs.convention}
      data-cb={prefs.cb ? "on" : "off"}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        {/* §13.2 no-flash fallback: synchronous, so the attributes land before
            first paint even when the SSR HTML couldn't know the cookie (and
            resolves prefers-color-scheme when no explicit choice exists). */}
        <script dangerouslySetInnerHTML={{ __html: NOFLASH_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const loaderPrefs = Route.useLoaderData();
  const prefs = useThemePrefs(loaderPrefs);

  // Boot-time endpoint health probe (client-only; results feed inline
  // "endpoint missing" notices and, later, the status rail — never toasts).
  useEffect(() => {
    runHealthProbe();
  }, []);

  // Dev-only jank instrumentation (?perf=1) — the ruler for the build doc's
  // perf budgets; no-ops in production and unsupported browsers.
  useEffect(() => startLoafInstrumentation(), []);

  // Global ⌘K / Ctrl+K toggles the command palette (§17). Client-only effect;
  // preventDefault beats the browser's own search/shortcut bindings.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        <StatusRail />
      </div>
      <CommandPalette />
      <Toaster theme={isDarkTheme(prefs.theme) ? "dark" : "light"} position="bottom-right" />
    </QueryClientProvider>
  );
}
