"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { type Coalition } from "@/lib/anniversary.config";
import { saveRoundIncome } from "@/app/actions";
import ProductionBoard from "./ProductionBoard";

export interface EditorPower {
  key: string;
  name: string;
  color: string;
  flag: string;
  coalition: Coalition;
}

function num(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default function ProductionEditor({
  campaignId,
  roundNumber,
  powers,
  initial,
  startIncome,
  scenarioLabel,
  includeResearch = true,
}: {
  campaignId: string;
  roundNumber: number;
  powers: EditorPower[];
  /** Current per-power income for this round (auto-seeded with scenario start). */
  initial: Record<string, number>;
  /** Scenario starting income per power, shown as a reference. */
  startIncome: Record<string, number>;
  scenarioLabel: string;
  includeResearch?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [income, setIncome] = useState<Record<string, number>>(initial);

  function patch(key: string, value: number) {
    setIncome((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  const boardPowers = powers.map((p) => ({ ...p, income: income[p.key] ?? 0 }));

  const totalOf = (c: Coalition) =>
    powers
      .filter((p) => p.coalition === c)
      .reduce((s, p) => s + (income[p.key] ?? 0), 0);
  const axisTotal = totalOf("AXIS");
  const alliesTotal = totalOf("ALLIES");

  function save() {
    startTransition(async () => {
      await saveRoundIncome({
        campaignId,
        number: roundNumber,
        entries: powers.map((p) => ({ nation: p.key, income: income[p.key] ?? 0 })),
      });
      setSaved(true);
      router.refresh();
    });
  }

  const numField =
    "field stat text-right w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="space-y-4">
      <ProductionBoard powers={boardPowers} includeResearch={includeResearch} />

      {/* Live coalition totals */}
      <div className="panel p-3 flex items-center justify-between stat text-sm">
        <span style={{ color: "var(--axis)" }}>AXIS {axisTotal} IPC</span>
        <span className="label">Round {roundNumber} production</span>
        <span style={{ color: "var(--allies)" }}>{alliesTotal} IPC ALLIES</span>
      </div>

      {/* Editable income per nation */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="label">Income — Round {roundNumber}</span>
          <div className="flex items-center gap-3">
            {saved && <span className="label" style={{ color: "var(--good)" }}>✓ Saved</span>}
            <button className="btn btn-primary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save Production"}
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {powers.map((p) => {
            const start = startIncome[p.key] ?? 0;
            return (
              <div key={p.key} className="flex items-center gap-2 panel p-2">
                <Image src={p.flag} alt="" width={22} height={15} className="rounded-sm border border-border shrink-0" />
                <span className="font-semibold text-sm truncate flex-1" style={{ color: p.color }}>
                  {p.name}
                </span>
                <span className="label whitespace-nowrap" title={`${scenarioLabel} scenario starting income`}>
                  start {start}
                </span>
                <label className="flex items-center gap-1">
                  <span className="label">IPC</span>
                  <input
                    className={numField}
                    type="number"
                    min={0}
                    value={income[p.key] ?? 0}
                    onChange={(e) => patch(p.key, num(e.target.value))}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <p className="label mt-3">
          Round 1 is pre-filled with the {scenarioLabel} scenario starting income.
          Edit each nation&apos;s income — markers move as you type; click Save Production to record it.
        </p>
      </div>
    </div>
  );
}
