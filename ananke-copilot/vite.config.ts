import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Floot's hosted runtime serves `endpoints/<path>/<name>_<METHOD>.ts` at
 * `/_api/<path>/<name>`. Nothing in the export implements that, so this plugin
 * reproduces the convention locally: it maps the request URL + method back to a
 * source file, loads it through Vite's SSR pipeline (so edits hot-reload), and
 * calls its exported `handle(Request): Response`.
 */
function flootApiPlugin(): Plugin {
  return {
    name: "floot-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/_api/")) return next();

        const method = (req.method ?? "GET").toUpperCase();
        const [pathname] = url.slice("/_api/".length).split("?");
        const segments = pathname.split("/").filter(Boolean);
        if (segments.length === 0) return next();

        const name = segments.pop()!;
        const modulePath = `/endpoints/${[...segments, `${name}_${method}`].join("/")}.ts`;

        try {
          const mod = await server.ssrLoadModule(modulePath);
          if (typeof mod.handle !== "function") {
            throw new Error(`${modulePath} does not export handle()`);
          }

          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
          const request = new Request(`http://localhost${url}`, {
            method,
            headers: req.headers as Record<string, string>,
            body,
          });

          const response: Response = await mod.handle(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));

          if (!response.body) return res.end();

          // Stream through rather than buffering — the chat endpoint returns a
          // token stream and the UI renders it incrementally.
          const reader = response.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
            // @ts-expect-error - present when compression middleware is absent
            res.flush?.();
          }
          res.end();
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error(`[floot-api] ${method} ${url} failed:`, err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Internal error",
            }),
          );
        }
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default defineConfig(({ mode }) => {
  // The endpoint modules read process.env at import time (helpers/db.tsx opens a
  // pool on load), so .env must be applied before any ssrLoadModule call.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react(), flootApiPlugin()],
    server: { port: 5199, strictPort: false },
  };
});
