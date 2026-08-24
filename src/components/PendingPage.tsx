import { Construction } from "lucide-react";

interface Props {
  title: string;
  description: string;
  pendingEndpoints: string[];
}

export function PendingPage({ title, description, pendingEndpoints }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-xl rounded-lg border border-border bg-card p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-md bg-neutral/15 p-2">
            <Construction className="h-5 w-5 text-neutral" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pending backend endpoints
          </h3>
          <ul className="space-y-1.5">
            {pendingEndpoints.map((e) => (
              <li
                key={e}
                className="tabular rounded border border-dashed border-border bg-background px-3 py-2 text-xs text-foreground/80"
              >
                {e}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-[11px] text-muted-foreground">
          This page is a placeholder. Once these endpoints exist on your Spring backend,
          wire them into <code className="font-mono text-foreground">src/lib/api/</code> and
          implement the UI here.
        </p>
      </div>
    </div>
  );
}
