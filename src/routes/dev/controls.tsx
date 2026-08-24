import { useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";
import { SemanticToggle } from "@/components/terminal/controls/SemanticToggle";
import { UnitInput } from "@/components/terminal/controls/UnitInput";
import { QuickFillRow } from "@/components/terminal/controls/QuickFillRow";

/**
 * /dev/controls — W7 storyboard (build doc §9 verify). Every form primitive ×
 * every state, on one page, so the screenshot spec can capture them
 * deterministically. DEV ONLY: the route renders a redirect in production
 * bundles — it is a review surface, not a feature.
 */
export const Route = createFileRoute("/dev/controls")({
  head: () => ({ meta: [{ title: "Controls — dev" }] }),
  component: DevControlsPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-8">{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function DevControlsPage() {
  if (!import.meta.env.DEV) return <Navigate to="/" />;

  return <Storyboard />;
}

function Storyboard() {
  const [seg, setSeg] = useState("5m");
  const [sem, setSem] = useState("paper");
  const [dir, setDir] = useState("long");
  const [amount, setAmount] = useState("10,000");
  const [unit, setUnit] = useState("shares");

  return (
    <div
      className="flex h-full flex-col gap-8 overflow-y-auto bg-surface-0 p-6"
      data-testid="dev-controls"
    >
      <h1 className="text-sm font-semibold text-text-primary">W7 form primitives</h1>

      <Section title="SegmentedControl">
        <Cell label="default">
          <SegmentedControl
            ariaLabel="Interval"
            value={seg}
            onValueChange={setSeg}
            options={[
              { value: "1m", label: "1m" },
              { value: "5m", label: "5m" },
              { value: "15m", label: "15m" },
              { value: "1H", label: "1H" },
              { value: "1D", label: "1D" },
            ]}
          />
        </Cell>
        <Cell label="disabled">
          <span className="inline-flex opacity-40">
            <SegmentedControl
              ariaLabel="Interval disabled"
              value="5m"
              onValueChange={() => {}}
              options={[
                { value: "1m", label: "1m" },
                { value: "5m", label: "5m" },
                { value: "15m", label: "15m" },
              ]}
            />
          </span>
        </Cell>
      </Section>

      <Section title="SemanticToggle">
        <Cell label="paper / live">
          <SemanticToggle
            ariaLabel="Deployment mode"
            value={sem}
            onValueChange={setSem}
            options={[
              { value: "paper", label: "Paper", tone: "neutral" },
              { value: "live", label: "Live", tone: "warn" },
            ]}
          />
        </Cell>
        <Cell label="long / short">
          <SemanticToggle
            ariaLabel="Direction"
            value={dir}
            onValueChange={setDir}
            options={[
              { value: "long", label: "Long", tone: "up" },
              { value: "short", label: "Short", tone: "down" },
            ]}
          />
        </Cell>
        <Cell label="disabled">
          <SemanticToggle
            ariaLabel="Direction disabled"
            value="long"
            onValueChange={() => {}}
            disabled
            options={[
              { value: "long", label: "Long", tone: "up" },
              { value: "short", label: "Short", tone: "down" },
            ]}
          />
        </Cell>
      </Section>

      <Section title="UnitInput">
        <Cell label="prefix $">
          <UnitInput
            ariaLabel="Capital"
            prefix="$"
            value={amount}
            onChange={setAmount}
            inputClassName="w-32"
          />
        </Cell>
        <Cell label="units">
          <UnitInput
            ariaLabel="Quantity"
            value="100"
            onChange={() => {}}
            units={[
              { value: "shares", label: "Shares" },
              { value: "pct", label: "%" },
              { value: "usd", label: "$" },
            ]}
            unit={unit}
            onUnitChange={setUnit}
            inputClassName="w-24"
          />
        </Cell>
        <Cell label="error">
          <UnitInput
            ariaLabel="Capital error"
            prefix="$"
            value="50"
            onChange={() => {}}
            error="Outside the 100 – 10,000,000 range."
            inputClassName="w-32"
          />
        </Cell>
        <Cell label="disabled">
          <UnitInput
            ariaLabel="Capital disabled"
            prefix="$"
            value="10,000"
            onChange={() => {}}
            disabled
            inputClassName="w-32"
          />
        </Cell>
      </Section>

      <Section title="QuickFillRow">
        <Cell label="default">
          <QuickFillRow
            ariaLabel="Quick fill"
            presets={[
              { label: "10", value: 10 },
              { label: "50", value: 50 },
              { label: "100", value: 100 },
              { label: "500", value: 500 },
            ]}
            onFill={() => {}}
          />
        </Cell>
        <Cell label="disabled">
          <QuickFillRow
            ariaLabel="Quick fill disabled"
            disabled
            presets={[
              { label: "1k", value: 1_000 },
              { label: "10k", value: 10_000 },
            ]}
            onFill={() => {}}
          />
        </Cell>
      </Section>
    </div>
  );
}
