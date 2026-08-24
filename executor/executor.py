#!/usr/bin/env python3
"""Lightweight HTTP code executor running inside the Jupyter container.

Accepts POST /execute with {"code": "..."}, runs it via subprocess, and returns
{"stdout": "...", "stderr": "...", "returncode": N}.

This exists because the Ananke SDK (`ananke`) is installed in the Jupyter
container, not in the Java container. The copilot orchestrator in Spring Boot
POSTs generated Python here so `k.export()` runs in the environment that owns
the SDK. Stdlib only — no Flask/FastAPI — so the Jupyter image gains no
dependencies (copilot build doc M0).
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import json
import os
import subprocess
import sys
import tempfile

PORT = int(os.environ.get("EXECUTOR_PORT", "5000"))
TIMEOUT_SECONDS = int(os.environ.get("EXECUTOR_TIMEOUT", "120"))
WORKDIR = os.environ.get("EXECUTOR_WORKDIR", "/home/jovyan")


class ExecutorHandler(BaseHTTPRequestHandler):
    # Spring's RestClient streams the body with Transfer-Encoding: chunked,
    # which is an HTTP/1.1 feature — advertising 1.0 makes it misparse.
    protocol_version = "HTTP/1.1"

    # Docker captures stdout; the default per-request logging is just noise.
    def log_message(self, fmt, *args):
        pass

    def _read_body(self):
        """Read the request body via Content-Length or chunked encoding.

        Java clients (Spring RestClient) send chunked rather than a length
        header, and a Content-Length-only reader sees an empty body.
        """
        encoding = self.headers.get("Transfer-Encoding", "")
        if "chunked" in encoding.lower():
            chunks = []
            while True:
                line = self.rfile.readline().strip()
                if not line:
                    continue
                size = int(line.split(b";")[0], 16)
                if size == 0:
                    # Consume trailers up to the terminating blank line.
                    while True:
                        trailer = self.rfile.readline()
                        if trailer in (b"\r\n", b"\n", b""):
                            break
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)  # trailing CRLF
            return b"".join(chunks)

        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _send_json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # HTTP/1.1 needs an explicit length or the client waits for a body.
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        # Compose/readiness probe.
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "port": PORT})
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/execute":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            body = json.loads(self._read_body())
        except (ValueError, json.JSONDecodeError) as e:
            self._send_json(400, {"error": f"Malformed request body: {e}"})
            return

        code = body.get("code", "")
        if not code:
            self._send_json(400, {"error": "Missing 'code' field"})
            return

        timeout = int(body.get("timeout", TIMEOUT_SECONDS))

        tmp = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, dir=WORKDIR
            ) as f:
                f.write(code)
                tmp = f.name

            env = os.environ.copy()
            # The SDK is pip install -e'd, but make the source tree importable
            # regardless of how the container was started.
            env["PYTHONPATH"] = f"{WORKDIR}:{WORKDIR}/ananke-sdk"
            env["PYTHONUNBUFFERED"] = "1"

            result = subprocess.run(
                [sys.executable, tmp],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=WORKDIR,
                env=env,
            )
            self._send_json(200, {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
            })
        except subprocess.TimeoutExpired:
            self._send_json(504, {"error": f"Execution timed out after {timeout}s"})
        except Exception as e:  # noqa: BLE001 — surface anything to the caller
            self._send_json(500, {"error": str(e)})
        finally:
            # Must live here, not inside the inner try: a TimeoutExpired raised
            # by subprocess.run would otherwise skip cleanup and leak the file.
            if tmp is not None:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """One thread per request so a long backtest can't block /health."""
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), ExecutorHandler)
    print(f"[executor] listening on :{PORT} (timeout {TIMEOUT_SECONDS}s)", flush=True)
    server.serve_forever()
