"use client";

import type { GateDecision } from "@/lib/engine/gates";
import { CheckCircle, Circle } from "@phosphor-icons/react";

const GATE_ORDER = ["drawdown", "ivRank", "premFloor"] as const;
const GATE_FALLBACK_LABELS: Record<(typeof GATE_ORDER)[number], string> = {
  drawdown: "Price has pulled back",
  ivRank: "Insurance is expensive",
  premFloor: "Premium worth the risk",
};

export function GateChecklist({ decision }: { decision: GateDecision }) {
  const byId = new Map(decision.checks.map((c) => [c.id, c]));
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {GATE_ORDER.map((id) => {
        const check = byId.get(id);
        const pass = check?.pass ?? false;
        const evaluated = check !== undefined;
        return (
          <li
            key={id}
            className={`rounded-lg border p-4 transition-colors ${
              pass ? "border-accent-dim bg-surface" : "border-line bg-surface"
            }`}
          >
            <div className="flex items-center gap-2">
              {pass ? (
                <CheckCircle size={18} weight="fill" className="shrink-0 text-accent" />
              ) : (
                <Circle size={18} className="shrink-0 text-faint" />
              )}
              <span className={`text-sm font-medium ${pass ? "text-foreground" : "text-muted"}`}>
                {check?.label ?? GATE_FALLBACK_LABELS[id]}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {evaluated ? check.detail : "Checked only after the first two gates pass."}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
