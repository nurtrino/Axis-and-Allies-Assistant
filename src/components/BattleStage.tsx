"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UNITS, UNITS_BY_KEY } from "@/lib/anniversary.config";
import UnitIcon from "./UnitIcon";
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
  type BattleUnit,
} from "@/lib/battle";

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

// A single unit token with a health bar; fades & drops when destroyed.
function UnitToken({ unit, side }: { unit: BattleUnit; side: Side }) {
  const tint = side === "attacker" ? ATTACKER_TINT : DEFENDER_TINT;
  const dead = unit.hp <= 0;
  return (
    <div
      className={`flex flex-col items-center ${dead ? "unit-dead" : ""}`}
      style={{
        width: 30,
        transition: "opacity 0.5s ease, filter 0.5s ease",
        opacity: dead ? 0.28 : 1,
        filter: dead ? "grayscale(1)" : "none",
      }}
      title={`${UNITS_BY_KEY[unit.key]?.name}${dead ? " (destroyed)" : ""}`}
    >
      <span style={{ color: tint, lineHeight: 0 }}>
        <UnitIcon unitKey={unit.key} size={26} />
      </span>
      <div className="flex gap-px mt-0.5" aria-hidden>
        {Array.from({ length: unit.maxHp }).map((_, i) => (
          <span
            key={i}
            style={{
              width: unit.maxHp > 1 ? 11 : 18,
              height: 3,
              borderRadius: 1,
              background: i < unit.hp ? "var(--good)" : "rgba(255,255,255,0.16)",
              transition: "background 0.5s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// One side's battle line — all units (survivors and wrecks) lined up.
function BattleLine({ side, units }: { side: Side; units: BattleUnit[] }) {
  const tint = side === "attacker" ? ATTACKER_TINT : DEFENDER_TINT;
  const living = units.filter((u) => u.hp > 0).length;
  return (
    <div className="panel p-2">
      <div className="flex items-center justify-center gap-2 mb-1.5">
        <span className="uppercase tracking-wider text-[11px] font-semibold" style={{ color: tint }}>
          {side === "attacker" ? "⚔ Attacker" : "🛡 Defender"}
        </span>
        <span className="label text-[11px]">{living} standing</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {units.map((u) => (
          <UnitToken key={u.uid} unit={u} side={side} />
        ))}
      </div>
    </div>
  );
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

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  attacker_captured: { label: "Attacker captures the territory", color: ATTACKER_TINT },
  attacker_cleared: { label: "Attacker clears the zone (no land unit to hold)", color: ATTACKER_TINT },
  defender_won: { label: "Defender holds!", color: DEFENDER_TINT },
  mutual: { label: "Mutual annihilation", color: "var(--muted)" },
  retreated: { label: "Attacker retreated", color: "var(--muted)" },
};

export default function BattleStage({
  onLogResult,
  initialAttacker,
  initialAmphibious,
  seedKey,
}: {
  onLogResult?: (data: { attackerLosses: Stack; defenderLosses: Stack; summaryText: string; status: string }) => void;
  /** Pre-seed the attacker stack (e.g. from a declared combat-move order). */
  initialAttacker?: Stack;
  initialAmphibious?: boolean;
  /** Changing this re-applies the seed and returns to setup (new order loaded). */
  seedKey?: string;
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
        summaryText: STATUS_TEXT[summary.status]?.label ?? summary.status,
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
        setState(createBattle(a, d, { amphibious }));
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
    setState(createBattle(attackerStack, defenderStack, { amphibious }));
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

      {/* Attacker line (battle mode) */}
      {mode === "battle" && state && <BattleLine side="attacker" units={state.attacker} />}

      {/* Battle theater — the dice surface fills the whole box (no inner frame),
          and the dice-box canvas is ALWAYS mounted so it never detaches. */}
      <div
        className="relative rounded-lg overflow-hidden mx-auto"
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

      {/* Defender line (battle mode) */}
      {mode === "battle" && state && <BattleLine side="defender" units={state.defender} />}

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
          <div className="text-lg font-semibold" style={{ color: STATUS_TEXT[summary.status]?.color }}>
            {STATUS_TEXT[summary.status]?.label ?? summary.status}
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
