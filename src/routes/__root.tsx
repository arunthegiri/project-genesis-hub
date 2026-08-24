import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import type { RouterContext } from "../router";
import { AppSidebar } from "@/components/AppSidebar";
import { StatusRail } from "@/components/StatusRail";
import { CommandPalette } from "@/components/CommandPalette";
import { runHealthProbe } from "@/lib/api/health-probe";
import { togglePalette } from "@/lib/command-registry";
import { startLoafInstrumentation } from "@/lib/perf/loaf";

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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Quant Trading Platform" },
      { name: "description", content: "Professional quant trading dashboard, data exploration, and backtesting." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
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
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        <StatusRail />
      </div>
      <CommandPalette />
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
