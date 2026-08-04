# ── Build stage: produce the production bundle (dist/client + dist/server) ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Baked into the bundle — the production worker cannot read the container's
# process env, so the compose-time JUPYTER_PROXY_TARGET never reaches it.
ENV VITE_JUPYTER_PROXY_TARGET=http://jupyter:8888
RUN npm run build

# ── Runtime stage: serve the BUILT bundle, not a dev server ────────────────
# Reliability: no on-demand module serving, no dependency re-optimization
# reloads, no stale-chunk crashes when the container restarts under an open
# tab — every asset is content-hashed and immutable. wrangler (workerd) runs
# the TanStack Start server bundle exactly as deployed.
# NOTE: glibc base (slim, not alpine) — workerd has no musl build.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
# wrangler ships via @cloudflare/vite-plugin (a production dependency), so
# --omit=dev keeps it while dropping the toolchain.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", "5173", "--ip", "0.0.0.0"]
