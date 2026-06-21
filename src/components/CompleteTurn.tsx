"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoundIncome } from "@/app/actions";

interface PowerIncome {
  key: string;
  name: string;
  color: string;
  income: number;
}
interface TerrRow {
  name: string;
  ipc: number;
}

function num(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function TerrList({
  title,
  tint,
  rows,
  setRows,
}: {
  title: string;
  tint: string;
  rows: TerrRow[];
  setRows: (fn: (r: TerrRow[]) => TerrRow[]) => void;
}) {
  const total = rows.reduce((s, r) => s + (r.ipc || 0), 0);
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="label" style={{ color: tint }}>{title}</span>
        <span className="stat text-sm" style={{ color: tint }}>{total} IPC</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="field text-sm flex-1"
              placeholder="Territory"
              value={r.name}
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className="field stat text-right w-16 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              type="number"
              min={0}
              value={r.ipc}
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ipc: num(e.target.value) } : x)))}
              aria-label="IPC value"
            />
            <button className="btn px-2 py-1" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
          </div>
        ))}
        <button className="btn w-full text-sm" onClick={() => setRows((rs) => [...rs, { name: "", ipc: 0 }])}>
          + Add territory
        </button>
      </div>
    </div>
  );
}

export default function CompleteTurn({
  campaignId,
  roundNumber,
  powers,
}: {
  campaignId: string;
  roundNumber: number;
  powers: PowerIncome[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [nation, setNation] = useState(powers[0]?.key ?? "");
  const [gained, setGained] = useState<TerrRow[]>([]);
  const [lost, setLost] = useState<TerrRow[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const current = powers.find((p) => p.key === nation)?.income ?? 0;
  const sum = (rows: TerrRow[]) => rows.reduce((s, r) => s + (r.ipc || 0), 0);
  const net = sum(gained) - sum(lost);
  const newIncome = Math.max(0, current + net);
  const nationName = powers.find((p) => p.key === nation)?.name ?? nation;

  function complete() {
    startTransition(async () => {
      await saveRoundIncome({ campaignId, number: roundNumber, entries: [{ nation, income: newIncome }] });
      setDone(`${nationName} income set to ${newIncome} IPC for Round ${roundNumber}.`);
      setGained([]);
      setLost([]);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          ✓ Complete Turn — record territory changes
        </button>
        {done && <span className="label ml-3" style={{ color: "var(--good)" }}>✓ {done}</span>}
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Complete Turn — territory changes</div>
          <div className="label">Record territories captured or lost; the nation&apos;s IPC income updates.</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="label">Nation</span>
          <select className="field" value={nation} onChange={(e) => setNation(e.target.value)}>
            {powers.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TerrList title="Territories gained (+)" tint="var(--good)" rows={gained} setRows={setGained} />
        <TerrList title="Territories lost (−)" tint="var(--bad)" rows={lost} setRows={setLost} />
      </div>

      <div className="panel p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 stat text-sm">
          <span className="label">Current {current} IPC</span>
          <span style={{ color: net >= 0 ? "var(--good)" : "var(--bad)" }}>
            {net >= 0 ? "+" : ""}{net} IPC
          </span>
          <span>→ New income <span className="text-lg" style={{ color: "var(--accent)" }}>{newIncome} IPC</span></span>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setOpen(false)}>Close</button>
          <button className="btn btn-primary" onClick={complete} disabled={pending}>
            {pending ? "Saving…" : "Apply to round"}
          </button>
        </div>
      </div>
      {done && <div className="label" style={{ color: "var(--good)" }}>✓ {done}</div>}
    </div>
  );
}
