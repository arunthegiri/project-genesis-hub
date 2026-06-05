"""
Reusable helper: run a list of source strings in a live Jupyter kernel
(the notebook's `conda-base` interpreter), stopping on the first error.
Used to (a) build/cache upstream state and (b) run Batch 4 code against it.
"""
import queue
from jupyter_client.manager import start_new_kernel

class Kernel:
    def __init__(self, kernel_name="python3"):
        # conda-base kernelspec points at the same interpreter; use the python
        # that is running THIS script by launching via its own ipykernel.
        self.km, self.kc = start_new_kernel(kernel_name=kernel_name)

    def run(self, code, label="", timeout=86400, quiet=False):
        """Execute code; return (ok, stdout_text). Prints stream output live."""
        msg_id = self.kc.execute(code)
        out = []
        error = None
        while True:
            try:
                msg = self.kc.get_iopub_msg(timeout=timeout)
            except queue.Empty:
                error = f"TIMEOUT after {timeout}s"
                break
            if msg["parent_header"].get("msg_id") != msg_id:
                continue
            t = msg["msg_type"]
            c = msg["content"]
            if t == "stream":
                txt = c["text"]; out.append(txt)
                if not quiet:
                    print(txt, end="", flush=True)
            elif t in ("execute_result", "display_data"):
                data = c.get("data", {}).get("text/plain", "")
                if data:
                    out.append(data + "\n")
                    if not quiet:
                        print(data, flush=True)
            elif t == "error":
                error = "\n".join(c.get("traceback", []))
                out.append(error)
            elif t == "status" and c.get("execution_state") == "idle":
                break
        if error and "TIMEOUT" not in str(error):
            print(f"\n[ERROR in {label}]\n{error}", flush=True)
            return False, "".join(out)
        if error:
            print(f"\n[{error} in {label}]", flush=True)
            return False, "".join(out)
        return True, "".join(out)

    def shutdown(self):
        try:
            self.kc.stop_channels(); self.km.shutdown_kernel(now=True)
        except Exception:
            pass
