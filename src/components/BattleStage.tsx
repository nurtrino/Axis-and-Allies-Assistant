"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { UNITS, UNITS_BY_KEY } from "@/lib/anniversary.config";
import UnitIcon from "./UnitIcon";
import { detectDomain, fireSoundFor, type SimUnit } from "@/lib/battlescene";
import { playSound } from "@/lib/sfx";
import {
  createBattle,
  peek,
  resolveRoll,
  chooseRetreat,
  submergeCurrent,
  summarize,
  type Stack,
  type BattleState,
  type BattleEvent,
} from "@/lib/battle";

// 3D battlefield — client-only (WebGL); driven by the engine state below.
const BattleSim = dynamic(() => import("./sim/BattleSim"), { ssr: false });

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── dice-box singleton (one physics world, survives StrictMode double-mount) ──
let boxSingleton: any = null;
let boxPromise: Promise<any> | null = null;
let diceCanvas: HTMLElement | null = null;
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
      scale: 10, // higher = bigger dice in this build; keep clearance from edges
      enableShadows: true,
      lightIntensity: 1.1,
    });
    await box.init();
    boxSingleton = box;
    diceCanvas = document.getElementById("battle-dice-canvas");
    return box;
  })();
  return boxPromise;
}

const ATTACKER_TINT = "#6ea0d6"; // blue — attacker
const DEFENDER_TINT = "#e0795f"; // red — defender

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

// A single unit token with a health bar; fades & drops when destroyed.
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
        <div className="flex flex-wrap gap-2 mt-2">
          {ev.rolls.map((r, i) => (
            <div
              key={i}
              className="flex flex-col items-center rounded-md px-2.5 pt-2 pb-1.5"
              style={{
                background: r.hit ? "color-mix(in srgb, var(--good) 16%, transparent)" : "var(--surface-2)",
                border: `1px solid ${r.hit ? "var(--good)" : "var(--border)"}`,
                minWidth: 72,
              }}
            >
              <span style={{ color: r.hit ? "var(--good)" : "var(--foreground)", lineHeight: 0 }}>
                <UnitIcon unitKey={r.key} size={30} />
              </span>
              <span className="text-[11px] mt-1 text-center leading-tight">
                {UNITS_BY_KEY[r.key]?.name ?? r.key}
              </span>
              <span
                className="stat leading-none mt-1"
                style={{ fontSize: 22, color: r.hit ? "var(--good)" : "var(--foreground)" }}
              >
                {r.value}
              </span>
              <span className="label mt-0.5" style={{ fontSize: 10 }}>
                needs {r.hitOn} or less
              </span>
              <span
                className="font-semibold mt-0.5"
                style={{ fontSize: 11, letterSpacing: 0.5, color: r.hit ? "var(--good)" : "var(--muted)" }}
              >
                {r.hit ? "HIT ✓" : "MISS ✗"}
              </span>
            </div>
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

const STATUS_COLOR: Record<string, string> = {
  attacker_captured: ATTACKER_TINT,
  attacker_cleared: ATTACKER_TINT,
  defender_won: DEFENDER_TINT,
  mutual: "var(--muted)",
  retreated: "var(--muted)",
};

/** Clear, country-named outcome line. */
function statusLine(status: string, atk: string, def: string, terr?: string): string {
  const where = terr && terr.trim() ? terr.trim() : "the territory";
  switch (status) {
    case "attacker_captured":
      return `${atk} takes ${where}`;
    case "attacker_cleared":
      return `${atk} wipes out ${def} — no land unit to hold ${where}`;
    case "defender_won":
      return `${def} holds ${where}`;
    case "mutual":
      return `Mutual annihilation — both forces destroyed`;
    case "retreated":
      return `${atk} retreats`;
    default:
      return status;
  }
}

export default function BattleStage({
  onLogResult,
  initialAttacker,
  initialAmphibious,
  seedKey,
  attackerName = "Attacker",
  defenderName = "Defender",
  territoryName,
}: {
  onLogResult?: (data: { attackerLosses: Stack; defenderLosses: Stack; summaryText: string; status: string }) => void;
  /** Pre-seed the attacker stack (e.g. from a declared combat-move order). */
  initialAttacker?: Stack;
  initialAmphibious?: boolean;
  /** Changing this re-applies the seed and returns to setup (new order loaded). */
  seedKey?: string;
  /** Country names for a clear outcome line. */
  attackerName?: string;
  defenderName?: string;
  territoryName?: string;
}) {
  const [mode, setMode] = useState<"setup" | "battle">("setup");
  const [attackerStack, setAttackerStack] = useState<Stack>(initialAttacker ?? {});
  const [defenderStack, setDefenderStack] = useState<Stack>({});
  const [amphibious, setAmphibious] = useState(initialAmphibious ?? false);
  const [state, setState] = useState<BattleState | null>(null);
  const [rolling, setRolling] = useState(false);
  const [diceReady, setDiceReady] = useState(false);
  const [hitFlash, setHitFlash] = useState<{ n: number; side: Side; key: number } | null>(null);
  const [padRoll, setPadRoll] = useState<{ rolls: { value: number; hit: boolean }[]; key: number } | null>(null);
  // 3D battlefield state (units keyed by engine uid).
  const [simUnits, setSimUnits] = useState<SimUnit[]>([]);
  const [firingIds, setFiringIds] = useState<string[]>([]);
  const [salvo, setSalvo] = useState(0);

  // Re-seed when a different order is loaded into the battle page.
  const seededRef = useRef<string | undefined>(seedKey);
  useEffect(() => {
    if (seedKey === undefined || seedKey === seededRef.current) return;
    seededRef.current = seedKey;
    setAttackerStack(initialAttacker ?? {});
    setDefenderStack({});
    setAmphibious(initialAmphibious ?? false);
    setState(null);
    setMode("setup");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const boxRef = useRef<any>(null);
  const flashKey = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Init once on mount. The dice stage div is mounted for the whole lifetime of
  // this component (see render), so the box's canvas never detaches between the
  // setup and battle screens.
  useEffect(() => {
    let cancelled = false;
    getDiceBox()
      .then((box) => {
        if (cancelled) return;
        boxRef.current = box;
        // A previous mount can leave the dice canvas attached to an old (removed)
        // container, which makes the dice "disappear". Re-home it here.
        const container = document.getElementById("battle-dice-stage");
        if (container && diceCanvas && diceCanvas.parentElement !== container) {
          container.appendChild(diceCanvas);
        }
        setDiceReady(true);
      })
      .catch(() => setDiceReady(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Dice-roll sound effect.
  useEffect(() => {
    const a = new Audio("/sounds/dice-roll.mp3");
    a.volume = 0.55;
    audioRef.current = a;
  }, []);

  const step = state ? peek(state) : null;
  const summary = state && !step ? summarize(state) : null;

  // Derive the 3D view from the engine: which units are gone, and the terrain.
  const simDestroyed = useMemo(() => {
    if (!state) return [];
    const alive = new Set<string>();
    for (const u of [...state.attacker, ...state.defender]) {
      if (u.hp > 0) alive.add(String(u.uid));
    }
    // Once the battle is over, the losing side's leftover (non-fighting)
    // units are removed too, so a winner never leaves enemy units standing.
    const over = !peek(state);
    const s = state.status;
    const loseDef = over && (s === "attacker_captured" || s === "attacker_cleared" || s === "mutual");
    const loseAtk = over && (s === "defender_won" || s === "mutual");
    return simUnits
      .filter((u) => {
        if (!alive.has(u.id)) return true;
        if (loseDef && u.side === "defender") return true;
        if (loseAtk && u.side === "attacker") return true;
        return false;
      })
      .map((u) => u.id);
  }, [state, simUnits]);
  const simDomain = useMemo(() => detectDomain(simUnits.map((u) => u.type)), [simUnits]);
  const simHealth = useMemo(() => {
    const m: Record<string, number> = {};
    if (state) {
      for (const u of [...state.attacker, ...state.defender]) {
        m[String(u.uid)] = Math.max(0, u.hp) / u.maxHp;
      }
    }
    return m;
  }, [state]);

  // When the battle resolves, automatically record each side's losses to the
  // chosen nations' round entries (once per battle).
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (mode !== "battle") {
      resolvedRef.current = false;
      return;
    }
    if (summary && onLogResult && !resolvedRef.current) {
      resolvedRef.current = true;
      onLogResult({
        attackerLosses: lossStack(attackerStack, summary.attackerSurvivors),
        defenderLosses: lossStack(defenderStack, summary.defenderSurvivors),
        summaryText: statusLine(summary.status, attackerName, defenderName, territoryName),
        status: summary.status,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, summary?.status, onLogResult]);

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
      const t = setTimeout(() => {
        // Dev autopilot: seed a sample battle (real users start empty).
        const a: Stack = { infantry: 3, artillery: 1, tank: 1 };
        const d: Stack = { infantry: 3 };
        setAttackerStack(a);
        setDefenderStack(d);
        const st = createBattle(a, d, { amphibious });
        setSimUnits(
          [...st.attacker, ...st.defender].map((u) => ({ id: String(u.uid), type: u.key, side: u.side })),
        );
        setFiringIds([]);
        setSalvo(0);
        setState(st);
        setMode("battle");
      }, 900);
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
    setPadRoll(null);
    setHitFlash(null);
    const st = createBattle(attackerStack, defenderStack, { amphibious });
    setSimUnits(
      [...st.attacker, ...st.defender].map((u) => ({
        id: String(u.uid),
        type: u.key,
        side: u.side,
      })),
    );
    setFiringIds([]);
    setSalvo(0);
    setState(st);
    setMode("battle");
  }

  async function rollStep() {
    if (!state || !step || rolling) return;
    if (step.decision === "retreat") return;
    setRolling(true);
    if (audioRef.current && step.dice.length > 0) {
      try {
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => {});
      } catch {
        /* ignore audio errors */
      }
    }
    try {
      let values: number[] = [];
      const box = boxRef.current;
      if (box && step.dice.length > 0) {
        box.clear();
        // Read the physical dice, but never let a stalled roll freeze the battle.
        const res = await Promise.race([
          box.roll([{ qty: step.dice.length, sides: 6, themeColor: step.color }]),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
        values = Array.isArray(res) ? res.map((r: any) => r.value as number) : [];
      }
      // Fallback if the dice engine is unavailable or stalled: software dice.
      if (values.length !== step.dice.length) {
        values = step.dice.map(() => 1 + Math.floor(Math.random() * 6));
      }
      const hits = step.dice.reduce((h, d, i) => h + ((values[i] ?? 9) <= d.hitOn ? 1 : 0), 0);
      if (step.dice.length > 0) {
        flashKey.current += 1;
        setHitFlash({ n: hits, side: step.side ?? "attacker", key: flashKey.current });
        setPadRoll({
          rolls: step.dice.map((d, i) => ({ value: values[i], hit: (values[i] ?? 9) <= d.hitOn })),
          key: flashKey.current,
        });
        window.setTimeout(() => setHitFlash(null), 1500);
      }
      // Only units that scored a hit fire a shot in the 3D view.
      const hitDice = step.dice.filter((d, i) => (values[i] ?? 9) <= d.hitOn);
      setFiringIds(hitDice.map((d) => String(d.uid)));
      setSalvo((s) => s + 1);
      // Fire SFX here (deterministic — plays even on the battle-ending hit).
      const sounds = new Set(hitDice.map((d) => fireSoundFor(d.key)));
      sounds.forEach((s) => playSound(s));
      setState(resolveRoll(state, values));
    } finally {
      setRolling(false);
    }
  }

  function retreat(decision: boolean) {
    if (!state) return;
    setState(chooseRetreat(state, decision));
  }

  function submerge() {
    if (!state) return;
    setPadRoll(null);
    setHitFlash(null);
    setState(submergeCurrent(state));
  }

  function reset() {
    setPadRoll(null);
    setHitFlash(null);
    setState(null);
    setSimUnits([]);
    setFiringIds([]);
    setSalvo(0);
    setMode("setup");
  }

  // ── Unified layout: the dice stage stays mounted across setup & battle. ──
  return (
    <div className="space-y-4">
      {/* Setup: force builders */}
      {mode === "setup" && (
        <div className="grid gap-4 md:grid-cols-2">
          <ForceBuilder side="attacker" stack={attackerStack} onChange={(k, d) => changeStack("attacker", k, d)} />
          <ForceBuilder side="defender" stack={defenderStack} onChange={(k, d) => changeStack("defender", k, d)} />
        </div>
      )}

      {/* Battle view: 3D battlefield + dice side by side so both stay visible. */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        {/* 3D battlefield (battle mode) — driven by the engine: only units that
            hit fire, casualties sink/burn, real units on real terrain. */}
        {mode === "battle" && simUnits.length > 0 && (
          <div
            className="rounded-lg overflow-hidden flex-1"
            style={{ minWidth: 0, height: "min(62vh, 540px)", border: "1px solid var(--border)" }}
          >
            <BattleSim
              units={simUnits}
              domain={simDomain}
              destroyedIds={simDestroyed}
              salvo={salvo}
              firingIds={firingIds}
              healthById={simHealth}
              playSounds={false}
            />
          </div>
        )}

        {/* Battle theater — the dice surface fills the box; the dice-box canvas
            is ALWAYS mounted so it never detaches. */}
        <div
          className="relative rounded-lg overflow-hidden mx-auto lg:mx-0 shrink-0"
          style={{
            width: "min(440px, 100%)",
            height: 400,
            background: "radial-gradient(120% 120% at 50% 0%, #344a34 0%, #1d2a1d 50%, #121a12 100%)",
            border: "1px solid var(--border)",
          }}
        >
        {/* dice canvas fills the battlefield */}
        <div id="battle-dice-stage" className="absolute inset-0" />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 70px rgba(0,0,0,0.5)" }} />

        {!diceReady && (
          <div className="absolute inset-0 flex items-center justify-center label">Loading 3D dice…</div>
        )}
        {mode === "setup" && diceReady && (
          <div className="absolute inset-0 flex items-center justify-center label pointer-events-none">
            Muster your forces, then begin the battle.
          </div>
        )}

        {hitFlash && (
          <div
            key={hitFlash.key}
            className="hit-flash absolute left-1/2 top-1/2 pointer-events-none font-extrabold"
            style={{
              color: hitFlash.n === 0
                ? "var(--muted)"
                : hitFlash.side === "defender" ? DEFENDER_TINT : ATTACKER_TINT,
              fontSize: hitFlash.n === 0 ? 26 : 34,
              letterSpacing: 1,
              textShadow: "0 2px 12px rgba(0,0,0,0.85)",
            }}
          >
            {hitFlash.n === 0 ? "NO HITS" : `${hitFlash.n} HIT${hitFlash.n === 1 ? "" : "S"}!`}
          </div>
        )}

        {/* Rolled-numbers readout on the green pad */}
        {mode === "battle" && padRoll && (
          <div className="absolute left-1/2 bottom-3 -translate-x-1/2 flex flex-wrap justify-center gap-1 max-w-[92%] pointer-events-none">
            {padRoll.rolls.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center justify-center stat text-xs"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: r.hit ? "color-mix(in srgb, var(--good) 32%, rgba(0,0,0,0.45))" : "rgba(0,0,0,0.5)",
                  color: r.hit ? "#eafff1" : "#c8d0c6",
                  border: `1px solid ${r.hit ? "var(--good)" : "rgba(255,255,255,0.28)"}`,
                }}
              >
                {r.value}
              </span>
            ))}
          </div>
        )}
        </div>
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
              <div className="flex gap-2 shrink-0">
                {step.canSubmerge && (
                  <button className="btn" onClick={submerge} disabled={rolling}>
                    Submerge ↓
                  </button>
                )}
                <button className="btn btn-primary" onClick={rollStep} disabled={rolling || !diceReady}>
                  🎲 {rolling
                    ? "Rolling…"
                    : step.canSubmerge
                      ? `Surprise Strike (${step.dice.length})`
                      : `Roll ${step.dice.length} dice`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Outcome */}
      {summary && (
        <div className="panel p-5">
          <div className="text-lg font-semibold" style={{ color: STATUS_COLOR[summary.status] }}>
            {statusLine(summary.status, attackerName, defenderName, territoryName)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div><div className="label">Rounds</div><div className="stat text-xl">{summary.rounds}</div></div>
            <div><div className="label">Attacker IPC value lost</div><div className="stat text-xl" style={{ color: ATTACKER_TINT }}>{summary.attackerIpcLost}</div></div>
            <div><div className="label">Defender IPC value lost</div><div className="stat text-xl" style={{ color: DEFENDER_TINT }}>{summary.defenderIpcLost}</div></div>
            <div><div className="label">Survivors</div><div className="stat text-xl">{totalUnits(summary.attackerSurvivors)} v {totalUnits(summary.defenderSurvivors)}</div></div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button className="btn btn-primary" onClick={reset}>New Battle</button>
            {onLogResult && (
              <span className="label" style={{ color: "var(--good)" }}>
                ✓ Losses recorded for the fighting nations
              </span>
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
