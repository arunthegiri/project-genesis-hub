import { useEffect } from "react";
import { createRouter, useRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";

/**
 * A code-split route chunk failed to load. Happens when the dev server restarts
 * (in-flight module requests are dropped, and Vite answers 504 for `?v=` URLs
 * from the previous optimize pass), or in production when a deploy replaces the
 * hashed chunks a long-lived tab is still pointing at. Each browser words it
 * differently, so match on all of them.
 */
function isModuleLoadError(error: Error): boolean {
  const msg = error?.message ?? "";
  return (
    /Failed to fetch dynamically imported module/i.test(msg) || // Chrome/Edge
    /Importing a module script failed/i.test(msg) || // Safari
    /error loading dynamically imported module/i.test(msg) || // Firefox
    /Unable to preload CSS/i.test(msg)
  );
}

/**
 * Reloading pulls a fresh module graph, which fixes it — but only once. If the
 * reload hits the same error the server is genuinely down, so fall through to
 * the error screen instead of looping.
 */
const RELOAD_KEY = "module-reload-attempt";
const RELOAD_WINDOW_MS = 15_000;

function useReloadOnStaleChunk(error: Error) {
  useEffect(() => {
    if (!isModuleLoadError(error)) return;

    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    } catch {
      return; // storage blocked — don't risk a reload loop
    }

    if (Date.now() - last < RELOAD_WINDOW_MS) return;

    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);
}

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useReloadOnStaleChunk(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export interface RouterContext {
  queryClient: QueryClient;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
