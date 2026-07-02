"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { expandStack, detectDomain, type Domain, type SimUnit } from "@/lib/battlescene";

// Canvas needs the DOM — load the simulator client-side only.
const BattleSim = dynamic(() => import("@/components/sim/BattleSim"), { ssr: false });

const SEA_PRESET: Record<string, number> = { battleship: 1, carrier: 1, destroyer: 1, submarine: 1, fighter: 2 };
const LAND_PRESET: Record<string, number> = { infantry: 3, tank: 1, artillery: 1, fighter: 1 };

const HIT_CHANCE = 0.5;

export default function BattleSimDemo() {
  const [mode, setMode] = useState<Domain>("sea");
  const [salvo, setSalvo] = useState(0);
  const [destroyed, setDestroyed] = useState<string[]>([]);
  const [firingIds, setFiringIds] = useState<string[]>([]);

  const units: SimUnit[] = useMemo(() => {
    const preset = mode === "sea" ? SEA_PRESET : LAND_PRESET;
    return [
      ...expandStack(preset, "attacker"),
      ...expandStack(preset, "defender"),
    ];
  }, [mode]);

  const domain = useMemo(() => detectDomain(units.map((u) => u.type)), [units]);

  // One combat round: each living unit rolls to hit; only those that hit fire
  // (and play their sound), and each hit destroys one enemy.
  function fireVolley() {
    const dead = new Set(destroyed);
    const alive = units.filter((u) => !dead.has(u.id));
    const att = alive.filter((u) => u.side === "attacker");
    const def = alive.filter((u) => u.side === "defender");
    const firers: string[] = [];

    const resolve = (shooters: SimUnit[], enemies: SimUnit[]) => {
      for (const s of shooters) {
        if (Math.random() >= HIT_CHANCE) continue;
        firers.push(s.id);
        const targets = enemies.filter((e) => !dead.has(e.id));
        if (targets.length) dead.add(targets[Math.floor(Math.random() * targets.length)].id);
      }
    };
    resolve(att, def);
    resolve(def, att);

    setFiringIds(firers);
    setDestroyed([...dead]);
    setSalvo((s) => s + 1);
  }

  function reset() {
    setDestroyed([]);
    setFiringIds([]);
    setSalvo(0);
  }

  const remaining = units.length - destroyed.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 >Battle Simulator — Demo</h1>
        <p className="label mt-1">
          Standalone 3D scene (no database). Each volley, only units that score
          a hit fire — those shots destroy enemy units.
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
          <button className="btn btn-primary" onClick={fireVolley} disabled={remaining === 0}>
            🔥 Fire Volley
          </button>
          <button className="btn" onClick={reset}>
            ↺ Reset
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden" style={{ height: "72vh", padding: 0 }}>
        <BattleSim
          units={units}
          domain={domain}
          destroyedIds={destroyed}
          salvo={salvo}
          firingIds={firingIds}
        />
      </div>

      <p className="label">
        Drag to orbit · scroll to zoom · {remaining}/{units.length} units standing
      </p>
    </div>
  );
}
