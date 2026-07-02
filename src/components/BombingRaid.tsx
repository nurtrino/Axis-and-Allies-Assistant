"use client";

import { useRef, useState } from "react";
import UnitIcon from "./UnitIcon";

interface Result {
  bombers: number;
  aaRolls: number[];
  bombersLost: number;
  survivors: number;
  damageRolls: number[];
  rawDamage: number;
  maxDamage: number;
  damage: number;
}

const ATTACK = "#e0795f";
const GOOD = "#5fbf8c";

function Chip({ value, hit, hitColor }: { value: number; hit: boolean; hitColor: string }) {
  return (
    <span
      className="inline-flex items-center justify-center stat text-xs"
      style={{
        width: 24,
        height: 24,
        borderRadius: 4,
        background: hit ? `color-mix(in srgb, ${hitColor} 28%, transparent)` : "var(--surface-2)",
        color: hit ? hitColor : "var(--foreground)",
        border: `1px solid ${hit ? hitColor : "var(--border)"}`,
      }}
    >
      {value}
    </span>
  );
}

export default function BombingRaid({
  onSave,
}: {
  onSave?: (data: { bombers: number; damage: number; bombersLost: number }) => void;
}) {
  const [bombers, setBombers] = useState(3);
  const [targetIpc, setTargetIpc] = useState(3);
  const [aaGun, setAaGun] = useState(true);
  const [heavy, setHeavy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const d6 = () => 1 + Math.floor(Math.random() * 6);

  function run() {
    if (!audioRef.current) {
      audioRef.current = new Audio("/sounds/dice-roll.mp3");
      audioRef.current.volume = 0.38;
    }
    try {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {});
    } catch {
      /* ignore */
    }

    // 1. Antiaircraft fire: one die per bomber, each 1 downs a bomber.
    let aaRolls: number[] = [];
    let lost = 0;
    if (aaGun) {
      aaRolls = Array.from({ length: bombers }, () => d6());
      lost = aaRolls.filter((v) => v <= 1).length;
    }
    const survivors = Math.max(0, bombers - lost);

    // 2. Surviving bombers roll for damage (heavy bombers roll two dice each).
    const diceCount = survivors * (heavy ? 2 : 1);
    const damageRolls = Array.from({ length: diceCount }, () => d6());
    const rawDamage = damageRolls.reduce((s, v) => s + v, 0);

    // 3. Cap damage at twice the territory's IPC value.
    const maxDamage = Math.max(0, targetIpc) * 2;
    const damage = Math.min(rawDamage, maxDamage);

    setSaved(false);
    setResult({ bombers, aaRolls, bombersLost: lost, survivors, damageRolls, rawDamage, maxDamage, damage });
  }

  const numField =
    "field stat text-right w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="panel p-4 space-y-3" style={{ maxWidth: 560 }}>
      <div className="flex items-center gap-2">
        <span style={{ color: ATTACK }}>
          <UnitIcon unitKey="bomber" size={26} />
        </span>
        <div>
          <div className="font-semibold">Strategic Bombing Raid</div>
          <div className="label">Economic strike on an enemy industrial complex.</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2">
          <span className="label">Bombers</span>
          <input className={numField} type="number" min={1} value={bombers}
            onChange={(e) => setBombers(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </label>
        <label className="flex items-center justify-between gap-2" title="Damage is capped at twice this value">
          <span className="label">Territory IPC value</span>
          <input className={numField} type="number" min={0} value={targetIpc}
            onChange={(e) => setTargetIpc(Math.max(0, parseInt(e.target.value, 10) || 0))} />
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none" title="Only one AA gun fires per territory, even if several are present.">
          <input type="checkbox" checked={aaGun} onChange={(e) => setAaGun(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          <span className="text-sm">AA gun defends</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none" title="R&D breakthrough: each bomber rolls two dice">
          <input type="checkbox" checked={heavy} onChange={(e) => setHeavy(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          <span className="text-sm">Heavy Bombers</span>
        </label>
      </div>

      <button className="btn btn-primary w-full" onClick={run}>
        ✈ Run Raid
      </button>

      {result && (
        <div className="space-y-3 pt-1">
          {result.aaRolls.length > 0 && (
            <div>
              <div className="label mb-1">Antiaircraft fire — each 1 downs a bomber</div>
              <div className="flex flex-wrap gap-1">
                {result.aaRolls.map((v, i) => (
                  <Chip key={i} value={v} hit={v <= 1} hitColor="var(--bad)" />
                ))}
              </div>
              <div className="label mt-1" style={{ color: result.bombersLost ? "var(--bad)" : undefined }}>
                {result.bombersLost} bomber{result.bombersLost === 1 ? "" : "s"} shot down · {result.survivors} reach the target
              </div>
            </div>
          )}

          {result.survivors > 0 ? (
            <div>
              <div className="label mb-1">
                Damage rolls — {heavy ? "two dice" : "one die"} per surviving bomber
              </div>
              <div className="flex flex-wrap gap-1">
                {result.damageRolls.map((v, i) => (
                  <Chip key={i} value={v} hit hitColor={GOOD} />
                ))}
              </div>
              <div className="label mt-1">
                Raw damage {result.rawDamage}
                {result.rawDamage > result.maxDamage && (
                  <span> · capped at twice IPC value ({result.maxDamage})</span>
                )}
              </div>
            </div>
          ) : (
            <div className="label">All bombers shot down — no damage inflicted.</div>
          )}

          <div className="panel p-3 flex items-center justify-between">
            <span className="label">Damage inflicted on the complex</span>
            <span className="stat text-2xl" style={{ color: GOOD }}>{result.damage} IPC</span>
          </div>
          <p className="label">
            Each point is a damage marker — one fewer unit that factory can build until repaired
            (1 IPC each). Complexes are never destroyed.
          </p>

          {onSave && (
            <button
              className="btn w-full"
              disabled={saved}
              onClick={() => {
                onSave({ bombers: result.bombers, damage: result.damage, bombersLost: result.bombersLost });
                setSaved(true);
              }}
              style={saved ? { color: "var(--good)" } : undefined}
            >
              {saved ? "✓ Saved to round" : "Save raid to round"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
