import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  code: string;
  filename?: string;
}

export function PythonExport({ code, filename = "query.py" }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Export to Jupyter (pandas + SQLAlchemy)
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              const blob = new Blob([code], { type: "text/x-python" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-3 w-3" /> .py
          </Button>
        </div>
      </div>
      <pre className="tabular max-h-64 overflow-auto p-3 text-[11px] leading-relaxed text-foreground/90">
        {code}
      </pre>
    </div>
  );
}
