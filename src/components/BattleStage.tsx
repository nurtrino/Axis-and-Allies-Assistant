"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UNITS, UNITS_BY_KEY } from "@/lib/anniversary.config";
import UnitIcon from "./UnitIcon";
import {
  createBattle,
  peek,
  resolveRoll,
  chooseRetreat,
  summarize,
  type Stack,
  type BattleState,
  type BattleEvent,
} from "@/lib/battle";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── dice-box singleton (one physics world, survives StrictMode double-mount) ──
let boxSingleton: any = null;
let boxPromise: Promise<any> | null = null;
async function getDiceBox(): Promise<any> {
  if (boxSingleton) return boxSingleton;
  if (boxPromise) return boxPromise;
  boxPromise = (async () => {
    const DiceBox = (await import("@3d-dice/dice-box")).default;
    const box = new DiceBox({
      id: "battle-dice-canvas",
      container: "#battle-dice-stage",
      assetPath: "/assets/dice-box/",
      theme: "default",
      scale: 8,
    });
    await box.init();
    boxSingleton = box;
    return box;
  })();
  return boxPromise;
}

const ATTACKER_TINT = "#e0795f";
const DEFENDER_TINT = "#5fbf8c";

// Units selectable when building a force (everything that can be in a battle;
// the industrial complex never fights, so it's excluded).
const SELECTABLE = UNITS.filter((u) => u.key !== "factory");

type Side = "attacker" | "defender";

function totalUnits(stack: Stack) {
  return Object.values(stack).reduce((s, n) => s + (n || 0), 0);
}
function ipcValue(stack: Stack) {
  return Object.entries(stack).reduce(
    (s, [k, n]) => s + (UNITS_BY_KEY[k]?.cost ?? 0) * (n || 0),
    0,
  );
}

function ForceBuilder({
  side,
  stack,
  onChange,
}: {
  side: Side;
  stack: Stack;
  onChange: (k: string, delta: number) => void;
}) {
  const tint = side === "attacker" ? ATTACKER_TINT : DEFENDER_TINT;
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold uppercase tracking-wider text-sm" style={{ color: tint }}>
          {side === "attacker" ? "⚔ Attacker" : "🛡 Defender"}
        </span>
        <span className="label">
          {totalUnits(stack)} units · {ipcValue(stack)} IPC
        </span>
      </div>
      <div className="grid gap-1.5">
        {SELECTABLE.map((u) => {
          const n = stack[u.key] ?? 0;
          return (
            <div
              key={u.key}
              className="flex items-center gap-2 rounded px-2 py-1"
              style={{ background: n > 0 ? "color-mix(in srgb, " + tint + " 12%, transparent)" : undefined }}
            >
              <span style={{ color: n > 0 ? tint : "var(--muted)" }} className="shrink-0">
                <UnitIcon unitKey={u.key} size={26} title={u.name} />
              </span>
              <span className="text-sm flex-1 truncate">{u.name}</span>
              <span className="label hidden sm:inline">
                {side === "attacker" ? `A${u.attack}` : `D${u.defense}`}
              </span>
              <div className="flex items-center gap-1">
                <button className="btn px-2 py-0.5" onClick={() => onChange(u.key, -1)} disabled={n === 0} aria-label={`Remove ${u.name}`}>−</button>
                <span className="stat w-6 text-center">{n}</span>
                <button className="btn px-2 py-0.5" onClick={() => onChange(u.key, 1)} aria-label={`Add ${u.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Roster({ side, units }: { side: Side; units: { key: string; count: number }[] }) {
  const tint = side === "attacker" ? ATTACKER_TINT : DEFENDER_TINT;
  const total = units.reduce((s, u) => s + u.count, 0);
  return (
    <div className="panel p-3 flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold uppercase tracking-wider text-xs" style={{ color: tint }}>
          {side === "attacker" ? "Attacker" : "Defender"}
        </span>
        <span className="label">{total} left</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {total === 0 && <span className="label">— wiped out —</span>}
        {units.map((u) => (
          <div
            key={u.key}
            className="flex items-center gap-1 rounded px-1.5 py-1"
            style={{ background: "color-mix(in srgb, " + tint + " 14%, transparent)", color: tint }}
            title={UNITS_BY_KEY[u.key]?.name}
          >
            <UnitIcon unitKey={u.key} size={22} />
            <span className="stat text-xs">×{u.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function survivorList(stack: Stack): { key: string; count: number }[] {
  return SELECTABLE.filter((u) => (stack[u.key] ?? 0) > 0).map((u) => ({ key: u.key, count: stack[u.key] }));
}

function EventRow({ ev }: { ev: BattleEvent }) {
  return (
    <div className="border-t border-border py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{ev.title}</span>
        {ev.hits > 0 && (
          <span className="label" style={{ color: "var(--accent)" }}>{ev.hits} hit{ev.hits === 1 ? "" : "s"}</span>
        )}
      </div>
      {ev.rolls.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ev.rolls.map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-xs stat"
              style={{
                background: r.hit ? "color-mix(in srgb, var(--good) 22%, transparent)" : "var(--surface-2)",
                color: r.hit ? "var(--good)" : "var(--muted)",
                border: r.hit ? "1px solid var(--good)" : "1px solid var(--border)",
              }}
              title={`${UNITS_BY_KEY[r.key]?.name ?? r.key} rolled ${r.value} (hits on ${r.hitOn})`}
            >
              {r.value}
            </span>
          ))}
        </div>
      )}
      <div className="label mt-1">{ev.text}</div>
      {ev.casualties.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ev.casualties.map((c, i) => (
            <span key={i} style={{ color: c.side === "attacker" ? ATTACKER_TINT : DEFENDER_TINT, opacity: 0.85 }}>
              <UnitIcon unitKey={c.key} size={16} title={`${c.side} ${c.key} lost`} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  attacker_captured: { label: "Attacker captures the territory", color: ATTACKER_TINT },
  attacker_cleared: { label: "Attacker clears the zone (no land unit to hold)", color: ATTACKER_TINT },
  defender_won: { label: "Defender holds!", color: DEFENDER_TINT },
  mutual: { label: "Mutual annihilation", color: "var(--muted)" },
  retreated: { label: "Attacker retreated", color: "var(--muted)" },
};

export default function BattleStage({
  onLogResult,
}: {
  onLogResult?: (data: { attackerLosses: Stack; defenderLosses: Stack; summaryText: string }) => void;
}) {
  const [mode, setMode] = useState<"setup" | "battle">("setup");
  const [attackerStack, setAttackerStack] = useState<Stack>({ infantry: 3, artillery: 1, tank: 1 });
  const [defenderStack, setDefenderStack] = useState<Stack>({ infantry: 3, aaGun: 0 });
  const [amphibious, setAmphibious] = useState(false);
  const [state, setState] = useState<BattleState | null>(null);
  const [rolling, setRolling] = useState(false);
  const [diceReady, setDiceReady] = useState(false);

  const boxRef = useRef<any>(null);

  // Init once on mount. The dice stage div is mounted for the whole lifetime of
  // this component (see render), so the box's canvas never detaches between the
  // setup and battle screens.
  useEffect(() => {
    let cancelled = false;
    getDiceBox()
      .then((box) => {
        if (cancelled) return;
        boxRef.current = box;
        setDiceReady(true);
      })
      .catch(() => setDiceReady(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const step = state ? peek(state) : null;
  const summary = state && !step ? summarize(state) : null;

  // Dev auto-pilot (gated on ?auto=1) so the battle can be verified without clicks.
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("auto") === "1") {
      setAuto(true);
    }
  }, []);
  useEffect(() => {
    if (!auto) return;
    if (mode === "setup") {
      const t = setTimeout(() => begin(), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (!state) return;
      const s = peek(state);
      if (!s) {
        setTimeout(() => reset(), 3500);
        return;
      }
      if (s.decision === "retreat") retreat(false);
      else if (!rolling && diceReady) rollStep();
    }, 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, mode, state, rolling, diceReady]);

  function changeStack(side: Side, key: string, delta: number) {
    const setter = side === "attacker" ? setAttackerStack : setDefenderStack;
    setter((prev) => {
      const next = { ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) };
      if (next[key] === 0) delete next[key];
      return next;
    });
  }

  function begin() {
    if (totalUnits(attackerStack) === 0) return;
    setState(createBattle(attackerStack, defenderStack, { amphibious }));
    setMode("battle");
  }

  async function rollStep() {
    if (!state || !step || rolling) return;
    if (step.decision === "retreat") return;
    setRolling(true);
    try {
      let values: number[] = [];
      const box = boxRef.current;
      if (box && step.dice.length > 0) {
        box.clear();
        const res = await box.roll([{ qty: step.dice.length, sides: 6, themeColor: step.color }]);
        values = Array.isArray(res) ? res.map((r: any) => r.value as number) : [];
      }
      // Fallback if dice engine unavailable: software dice.
      if (values.length !== step.dice.length) {
        values = step.dice.map(() => 1 + Math.floor(Math.random() * 6));
      }
      setState(resolveRoll(state, values));
    } finally {
      setRolling(false);
    }
  }

  function retreat(decision: boolean) {
    if (!state) return;
    setState(chooseRetreat(state, decision));
  }

  function reset() {
    setState(null);
    setMode("setup");
  }

  // ── Unified layout: the dice stage stays mounted across setup & battle. ──
  const atkSurvivors = state ? survivorList(summarize(state).attackerSurvivors) : [];
  const defSurvivors = state ? survivorList(summarize(state).defenderSurvivors) : [];

  return (
    <div className="space-y-4">
      {/* Top: force builders (setup) or live rosters (battle) */}
      {mode === "setup" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ForceBuilder side="attacker" stack={attackerStack} onChange={(k, d) => changeStack("attacker", k, d)} />
          <ForceBuilder side="defender" stack={defenderStack} onChange={(k, d) => changeStack("defender", k, d)} />
        </div>
      ) : (
        <div className="flex gap-3">
          <Roster side="attacker" units={atkSurvivors} />
          <Roster side="defender" units={defSurvivors} />
        </div>
      )}

      {/* Dice theater — ALWAYS mounted so the dice-box canvas never detaches */}
      <div className="relative">
        <div
          id="battle-dice-stage"
          style={{
            position: "relative",
            width: "100%",
            height: 320,
            background: "radial-gradient(120% 100% at 50% 0%, #2b3a2a 0%, #1b2420 45%, #11160f 100%)",
          }}
          className="rounded-lg overflow-hidden"
        />
        <div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ boxShadow: "inset 0 0 80px rgba(0,0,0,0.55)", border: "1px solid var(--border)" }}
        />
        {!diceReady && (
          <div className="absolute inset-0 flex items-center justify-center label">Loading 3D dice…</div>
        )}
        {mode === "setup" && diceReady && (
          <div className="absolute inset-0 flex items-center justify-center label pointer-events-none">
            Muster your forces, then begin the battle.
          </div>
        )}
      </div>

      {/* Setup controls */}
      {mode === "setup" && (
        <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={amphibious} onChange={(e) => setAmphibious(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            <span className="text-sm">Amphibious assault</span>
            <span className="label">— attacking battleships &amp; cruisers bombard first</span>
          </label>
          <button className="btn btn-primary" onClick={begin} disabled={totalUnits(attackerStack) === 0}>
            ⚔ Begin Battle
          </button>
        </div>
      )}

      {/* Current step / controls */}
      {mode === "battle" && step && (
        <div className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold" style={{ color: step.side === "defender" ? DEFENDER_TINT : ATTACKER_TINT }}>
                {step.title}
              </div>
              <p className="label mt-1 max-w-xl">{step.explanation}</p>
            </div>
            {step.decision === "retreat" ? (
              <div className="flex gap-2 shrink-0">
                <button className="btn" onClick={() => retreat(true)}>Retreat</button>
                <button className="btn btn-primary" onClick={() => retreat(false)}>Press the Attack →</button>
              </div>
            ) : (
              <button className="btn btn-primary shrink-0" onClick={rollStep} disabled={rolling || !diceReady}>
                🎲 {rolling ? "Rolling…" : `Roll ${step.dice.length} dice`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Outcome */}
      {summary && (
        <div className="panel p-5">
          <div className="text-lg font-semibold" style={{ color: STATUS_TEXT[summary.status]?.color }}>
            {STATUS_TEXT[summary.status]?.label ?? summary.status}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div><div className="label">Rounds</div><div className="stat text-xl">{summary.rounds}</div></div>
            <div><div className="label">Attacker IPC lost</div><div className="stat text-xl" style={{ color: ATTACKER_TINT }}>{summary.attackerIpcLost}</div></div>
            <div><div className="label">Defender IPC lost</div><div className="stat text-xl" style={{ color: DEFENDER_TINT }}>{summary.defenderIpcLost}</div></div>
            <div><div className="label">Survivors</div><div className="stat text-xl">{totalUnits(summary.attackerSurvivors)} v {totalUnits(summary.defenderSurvivors)}</div></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary" onClick={reset}>New Battle</button>
            {onLogResult && (
              <button
                className="btn"
                onClick={() =>
                  onLogResult({
                    attackerLosses: lossStack(attackerStack, summary.attackerSurvivors),
                    defenderLosses: lossStack(defenderStack, summary.defenderSurvivors),
                    summaryText: STATUS_TEXT[summary.status]?.label ?? summary.status,
                  })
                }
              >
                Log losses to round
              </button>
            )}
          </div>
        </div>
      )}

      {/* Battle log */}
      {state && state.log.length > 0 && (
        <div className="panel p-4">
          <div className="label mb-1">Battle Log</div>
          <div className="max-h-80 overflow-y-auto">
            {[...state.log].reverse().map((ev, i) => (
              <EventRow key={state.log.length - i} ev={ev} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function lossStack(initial: Stack, survivors: Stack): Stack {
  const out: Stack = {};
  for (const [k, n] of Object.entries(initial)) {
    const lost = (n || 0) - (survivors[k] ?? 0);
    if (lost > 0) out[k] = lost;
  }
  return out;
}
