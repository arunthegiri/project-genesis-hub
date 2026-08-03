/**
 * Open-in-JupyterLab export: materializes the generated Python snippet as a
 * real .ipynb in the local Jupyter server's `strategies/` directory (the
 * compose volume `Test Trading Strategies` → /home/jovyan/strategies) and
 * opens it in JupyterLab in a new tab.
 *
 * The server runs authless for local dev (docker-compose `jupyter` service).
 * XSRF is still enforced, so we warm the `_xsrf` cookie first — cookies are
 * domain-scoped (localhost), shared across ports, and not HttpOnly, so the
 * frontend can read it and echo it back as X-XSRFToken. API calls go through
 * the vite dev-server proxy `/jupyter-api` (see vite.config.ts), which keeps
 * everything same-origin; only the final window.open points at the real
 * Jupyter URL (VITE_JUPYTER_URL, default http://localhost:8890).
 */

const JUPYTER_URL: string =
  (import.meta.env.VITE_JUPYTER_URL as string | undefined) ?? "http://localhost:8890";

/**
 * Same-origin API base (vite dev-server proxy → Jupyter), so no CORS dance is
 * needed regardless of which port the frontend runs on.
 */
const API = "/jupyter-api";

function readXsrf(): string {
  return (
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("_xsrf="))
      ?.slice("_xsrf=".length) ?? ""
  );
}

function toNotebook(code: string, title: string) {
  const lines = code.split("\n").map((l, i, arr) => (i < arr.length - 1 ? `${l}\n` : l));
  return {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [`# ${title}\n`, "\n", "Generated from the Ananke chart view (Export to Jupyter)."],
      },
      { cell_type: "code", metadata: {}, source: lines, outputs: [], execution_count: null },
    ],
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export async function openInJupyterLab(code: string, baseName: string): Promise<void> {
  const safeBase = baseName.replace(/\.py$/, "").replace(/[^A-Za-z0-9_-]+/g, "_");
  const name = `${safeBase}.ipynb`;

  // 1. Warm the _xsrf cookie (any GET that renders a page sets it).
  let warm: Response;
  try {
    warm = await fetch(`${API}/lab`, { credentials: "include" });
  } catch {
    throw new Error(`Jupyter is not reachable — is the container up?`);
  }
  if (!warm.ok) throw new Error(`Jupyter responded ${warm.status}`);

  const xsrf = readXsrf();

  // 2. Create (or overwrite) the notebook via the contents API.
  const res = await fetch(`${API}/api/contents/strategies/${encodeURIComponent(name)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-XSRFToken": xsrf },
    body: JSON.stringify({
      type: "notebook",
      format: "json",
      content: toNotebook(code, safeBase),
    }),
  });
  if (!res.ok) {
    throw new Error(`Jupyter refused the notebook (${res.status} ${res.statusText})`);
  }

  // 3. Open it in JupyterLab.
  window.open(`${JUPYTER_URL}/lab/tree/strategies/${encodeURIComponent(name)}`, "_blank", "noopener");
}
