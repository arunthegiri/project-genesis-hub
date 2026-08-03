// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Same-origin tunnel to the local Jupyter server (see src/lib/jupyter-export.ts).
// changeOrigin rewrites Host but not Origin — and jupyter_server 404s writes
// whose Origin doesn't match Host ("Blocking Cross Origin API request"), so we
// rewrite Origin to the target authority as well. Dev-only: the
// Open-in-JupyterLab feature targets the local docker stack anyway.
// Inside the frontend container the Jupyter container is reached by service
// name (JUPYTER_PROXY_TARGET, set in docker-compose.yml); on host dev it's the
// host-mapped port.
const JUPYTER_TARGET = process.env.JUPYTER_PROXY_TARGET ?? "http://localhost:8890";

export default defineConfig({
  vite: {
    server: {
      proxy: {
        "/jupyter-api": {
          target: JUPYTER_TARGET,
          changeOrigin: true,
          headers: { Origin: new URL(JUPYTER_TARGET).origin },
          rewrite: (path: string) => path.replace(/^\/jupyter-api/, ""),
        },
      },
    },
  },
});
