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
interface IncomeState {
  income: number;
  objectiveBonus: number;
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
}: {
  campaignId: string;
  roundNumber: number;
  powers: EditorPower[];
  initial: Record<string, IncomeState>;
  startIncome: Record<string, number>;
  scenarioLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<Record<string, IncomeState>>(initial);

  function patch(key: string, p: Partial<IncomeState>) {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
    setSaved(false);
  }

  function loadStartingIncomes() {
    setState(
      Object.fromEntries(
        powers.map((p) => [p.key, { income: startIncome[p.key] ?? 0, objectiveBonus: 0 }]),
      ),
    );
    setSaved(false);
  }

  // Live marker positions (income includes the National Objective bonus).
  const boardPowers = powers.map((p) => ({
    ...p,
    income: (state[p.key]?.income ?? 0) + (state[p.key]?.objectiveBonus ?? 0),
  }));

  const totalOf = (c: Coalition) =>
    powers
      .filter((p) => p.coalition === c)
      .reduce((s, p) => s + (state[p.key]?.income ?? 0) + (state[p.key]?.objectiveBonus ?? 0), 0);
  const axisTotal = totalOf("AXIS");
  const alliesTotal = totalOf("ALLIES");

  function save() {
    startTransition(async () => {
      await saveRoundIncome({
        campaignId,
        number: roundNumber,
        entries: powers.map((p) => ({
          nation: p.key,
          income: state[p.key]?.income ?? 0,
          objectiveBonus: state[p.key]?.objectiveBonus ?? 0,
        })),
      });
      setSaved(true);
      router.refresh();
    });
  }

  const numField =
    "field stat text-right w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="space-y-4">
      <ProductionBoard powers={boardPowers} />

      {/* Live coalition totals */}
      <div className="panel p-3 flex items-center justify-between stat text-sm">
        <span style={{ color: "var(--axis)" }}>AXIS {axisTotal} IPC</span>
        <span className="label">Round {roundNumber} production</span>
        <span style={{ color: "var(--allies)" }}>{alliesTotal} IPC ALLIES</span>
      </div>

      {/* Editable income per nation */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="label">Set Income — Round {roundNumber}</span>
          <div className="flex items-center gap-3">
            {saved && <span className="label" style={{ color: "var(--good)" }}>✓ Saved</span>}
            <button className="btn" onClick={loadStartingIncomes} disabled={pending} title={`Fill with ${scenarioLabel} scenario starting incomes`}>
              Load {scenarioLabel} start
            </button>
            <button className="btn btn-primary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save Production"}
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {powers.map((p) => (
            <div key={p.key} className="flex items-center gap-2 panel p-2">
              <Image src={p.flag} alt="" width={22} height={15} className="rounded-sm border border-border shrink-0" />
              <span className="font-semibold text-sm truncate flex-1" style={{ color: p.color }}>
                {p.name}
              </span>
              <label className="flex items-center gap-1">
                <span className="label">IPC</span>
                <input
                  className={numField}
                  type="number"
                  min={0}
                  value={state[p.key]?.income ?? 0}
                  onChange={(e) => patch(p.key, { income: num(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1" title="National Objective bonus">
                <span className="label">+NO</span>
                <input
                  className={numField + " w-12"}
                  type="number"
                  min={0}
                  value={state[p.key]?.objectiveBonus ?? 0}
                  onChange={(e) => patch(p.key, { objectiveBonus: num(e.target.value) })}
                />
              </label>
            </div>
          ))}
        </div>
        <p className="label mt-3">
          Enter each nation&apos;s territory income; <span className="stat">+NO</span> is the
          National Objective bonus. Markers move as you type — click Save Production to record it.
        </p>
      </div>
    </div>
  );
}
