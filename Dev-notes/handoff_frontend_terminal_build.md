# Handoff — Frontend Terminal Build (session of 2026-08-04)

For the next session/agent picking up `Ananke Frontend Terminal Build Doc.md`.

## State of the world
- `main` on GitHub is current: all 18 sections of the previous build doc (terminal-grade upgrades), the blank-chart fixes, Jupyter export, SDK progress bar, and the production-container reliability overhaul are merged and pushed.
- Docker stack: `docker compose --profile full up -d --build`. Frontend on :3000 is a **production wrangler/workerd build** — no HMR in the container; rebuild the image to see frontend changes. Host `npm run dev` for iteration.
- Docker Jupyter is on host port **8890** (a stray host-local `jupyter-lab` owns 8888). Authless for local dev; dark theme default; `ananke-sdk` editable-installed.
- `/jupyter-api` is an app-level server route (`src/routes/jupyter-api.$.ts`), works in dev and prod.

## Lessons that must not be relearned the hard way
- **Verify visually from change #1.** The blank-chart incident shipped 18 sections on typechecks alone; root cause (`oklch` in canvas colors — lightweight-charts 4.2.0 throws `Cannot parse color`) was only found via a real browser. The new build doc's W0 Playwright harness exists because of this — build it first, use it always.
- This machine is macOS 13: latest Playwright doesn't support it — pin `playwright@1.49.1`-era (as in `/tmp/pwtest`) until W0 lands `@playwright/test` in-repo; verify browser download compatibility before assuming.
- workerd has no musl build — the frontend runtime image is `node:22-slim` (glibc) on purpose.
- Repo lint is NOT prettier-clean (1k+ pre-existing errors); match file-local style, don't mass-format.
- Commit discipline that worked: one section per commit, build green before commit, never let a background `git add -A` sweep up the next section's in-flight files.

## Useful artifacts
- `/tmp/pwtest/` — throwaway Playwright scripts (repro, canvas pixel probe, kernel driver). Ephemeral; W0 replaces them properly.
- `Dev-notes/copilot_architecture.md` — how the copilot works (direct DB writer, five tools, Kimi backend).
- `rsi_strategy.ipynb` was re-executed 2026-08-04 to re-export `rsi_mean_reversion` in the new params format (dashboard re-runs work again). `nvda_pairs_zscore` still non-rerunnable.
