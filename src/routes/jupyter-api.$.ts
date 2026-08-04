import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin tunnel to the local Jupyter server (see
 * src/lib/jupyter-export.ts). jupyter_server 404s writes whose Origin header
 * doesn't match the Host ("Blocking Cross Origin API request"), so the proxy
 * rewrites BOTH to the target authority. Implemented as an app-level server
 * route so it works identically under `vite dev` and the production worker
 * (no vite-only proxy config). Local-dev feature only.
 *
 * Target: VITE_JUPYTER_PROXY_TARGET baked at build time (the Dockerfile sets
 * it to http://jupyter:8888 for the container — worker env vars do NOT come
 * from the container's process env), then process.env (vite dev), then the
 * host-mapped default port.
 */

const JUPYTER_TARGET =
  (import.meta.env.VITE_JUPYTER_PROXY_TARGET as string | undefined) ??
  process.env.JUPYTER_PROXY_TARGET ??
  "http://localhost:8890";
const TARGET_ORIGIN = new URL(JUPYTER_TARGET).origin;

async function proxyToJupyter(request: Request, splat: string): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("host", new URL(TARGET_ORIGIN).host);
  headers.set("origin", TARGET_ORIGIN);

  const upstream = await fetch(`${TARGET_ORIGIN}/${splat}${url.search}`, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });

  // Pass status + headers (incl. Set-Cookie for the _xsrf flow) straight back.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export const Route = createFileRoute("/jupyter-api/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      HEAD: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      POST: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      PUT: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      PATCH: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      DELETE: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
      OPTIONS: ({ request, params }) => proxyToJupyter(request, params._splat ?? ""),
    },
  },
});
