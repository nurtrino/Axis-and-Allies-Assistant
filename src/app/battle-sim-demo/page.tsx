"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { expandStack, detectDomain, type Domain, type SimUnit } from "@/lib/battlescene";

// Canvas needs the DOM — load the simulator client-side only.
const BattleSim = dynamic(() => import("@/components/sim/BattleSim"), { ssr: false });

const SEA_PRESET: Record<string, number> = { battleship: 1, cruiser: 2, destroyer: 3, carrier: 1, submarine: 2 };
const LAND_PRESET: Record<string, number> = { infantry: 6, artillery: 2, tank: 3, fighter: 2 };

export default function BattleSimDemo() {
  const [mode, setMode] = useState<Domain>("sea");
  const [salvo, setSalvo] = useState(0);
  const [destroyed, setDestroyed] = useState<string[]>([]);

  const units: SimUnit[] = useMemo(() => {
    const preset = mode === "sea" ? SEA_PRESET : LAND_PRESET;
    return [
      ...expandStack(preset, "attacker"),
      ...expandStack(preset, "defender"),
    ];
  }, [mode]);

  const domain = useMemo(() => detectDomain(units.map((u) => u.type)), [units]);

  function destroyRandom() {
    const alive = units.filter((u) => !destroyed.includes(u.id));
    if (!alive.length) return;
    const pick = alive[Math.floor(Math.random() * alive.length)];
    setDestroyed((d) => [...d, pick.id]);
  }

  function reset() {
    setDestroyed([]);
    setSalvo(0);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Battle Simulator — Demo</h1>
        <p className="label mt-1">
          Standalone 3D scene harness (no database). Placeholder models wired to
          the firing / destruction loop — real glTF units drop in next.
        </p>
      </div>

      <div className="panel p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <button
            className="btn"
            style={mode === "sea" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => { setMode("sea"); reset(); }}
          >
            🌊 Sea Battle
          </button>
          <button
            className="btn"
            style={mode === "land" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => { setMode("land"); reset(); }}
          >
            🪖 Land Battle
          </button>
        </div>
        <div className="flex gap-1 ml-auto">
          <button className="btn btn-primary" onClick={() => setSalvo((s) => s + 1)}>
            🔥 Fire Volley
          </button>
          <button className="btn" onClick={destroyRandom}>
            💥 Destroy a unit
          </button>
          <button className="btn" onClick={reset}>
            ↺ Reset
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden" style={{ height: "70vh", padding: 0 }}>
        <BattleSim units={units} domain={domain} destroyedIds={destroyed} salvo={salvo} />
      </div>

      <p className="label">
        Drag to orbit · scroll to zoom · {units.length} units ·{" "}
        {destroyed.length} destroyed
      </p>
    </div>
  );
}
