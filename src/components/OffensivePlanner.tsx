"use client";

import { useMemo, useState } from "react";
import { UNITS, UNITS_BY_KEY } from "@/lib/anniversary.config";
import {
  runPlanner,
  suggestMinimumForce,
  type Stack,
  type ForceSuggestion,
} from "@/lib/combat";

// Units that take part in general combat. Excludes the industrial complex and
// AA guns — an AA gun's Defense 1 is anti-aircraft fire only (it doesn't roll
// in general combat and is never destroyed as a combat casualty).
const COMBAT_UNITS = UNITS.filter(
  (u) => u.domain !== "structure" && u.key !== "aaGun",
);

const VERDICT_COLOR: Record<string, string> = {
  FAVORABLE: "var(--good)",
  MARGINAL: "var(--accent)",
  UNFAVORABLE: "var(--bad)",
  EMPTY: "var(--muted)",
};

function fmt(n: number, dp = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}
function signed(n: number) {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

export default function OffensivePlanner() {
  const [attacker, setAttacker] = useState<Stack>({});
  const [defender, setDefender] = useState<Stack>({});
  const [territoryValue, setTerritoryValue] = useState(0);
  const [target, setTarget] = useState(0.85);
  const [suggestion, setSuggestion] = useState<ForceSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const result = useMemo(
    () => runPlanner(attacker, defender, { territoryValue, runs: 4000 }),
    [attacker, defender, territoryValue],
  );

  function set(side: "a" | "d", key: string, v: number) {
    const val = Math.max(0, v || 0);
    if (side === "a") setAttacker((p) => ({ ...p, [key]: val }));
    else setDefender((p) => ({ ...p, [key]: val }));
  }
  function reset() {
    setAttacker({});
    setDefender({});
    setTerritoryValue(0);
    setSuggestion(null);
  }
  function suggest() {
    setSuggesting(true);
    // Defer so the button shows its pending state before the synchronous search.
    setTimeout(() => {
      setSuggestion(suggestMinimumForce(defender, { target }));
      setSuggesting(false);
    }, 0);
  }
  function describeStack(s: Stack): string {
    return Object.entries(s)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n}× ${UNITS_BY_KEY[k]?.name ?? k}`)
      .join(", ");
  }

  const numField =
    "field stat text-right w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="space-y-5">
      {/* Verdict banner */}
      <div
        className="panel p-5"
        style={{ borderColor: VERDICT_COLOR[result.verdict] }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Should You Attack?</div>
            <div
              className="text-3xl font-semibold mt-1"
              style={{ color: VERDICT_COLOR[result.verdict] }}
            >
              {result.verdict === "EMPTY" ? "ADD ATTACKERS" : result.verdict}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Capture Probability</div>
            <div className="stat text-4xl">
              {fmt(result.attackerTakePct, 1)}%
            </div>
          </div>
          <div className="text-right">
            <div className="label">Expected Net IPC Swing</div>
            <div
              className="stat text-3xl"
              style={{ color: result.netSwing >= 0 ? "var(--good)" : "var(--bad)" }}
            >
              {signed(result.netSwing)}
            </div>
          </div>
        </div>
        {result.verdict !== "EMPTY" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <Stat label="Avg Attacker Loss" value={`−${fmt(result.avgAttackerLost)} IPC`} color="var(--bad)" />
            <Stat label="Avg Defender Loss" value={`−${fmt(result.avgDefenderLost)} IPC`} color="var(--good)" />
            <Stat label="Avg Attacker Survivors" value={fmt(result.avgAttackerSurvivors, 1)} />
            <Stat label="Avg Combat Rounds" value={fmt(result.avgRounds, 1)} />
          </div>
        )}
      </div>

      {/* Stack editors */}
      <div className="grid md:grid-cols-2 gap-4">
        <StackEditor
          title="Your Attacking Force"
          accent="var(--axis)"
          stack={attacker}
          onChange={(k, v) => set("a", k, v)}
          numField={numField}
        />
        <StackEditor
          title="Enemy Defenders"
          accent="var(--allies)"
          stack={defender}
          onChange={(k, v) => set("d", k, v)}
          numField={numField}
        />
      </div>

      {/* Minimum-force suggester */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Minimum Force to Win</div>
            <p className="label mt-1 max-w-md">
              Cheapest force that captures these defenders at your target
              confidence.
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">Target capture</span>
            <select
              className="field w-28"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              <option value={0.75}>75%</option>
              <option value={0.85}>85%</option>
              <option value={0.95}>95%</option>
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={suggest} disabled={suggesting}>
            {suggesting ? "Searching…" : "Suggest Force"}
          </button>
        </div>

        {suggestion && (
          <div className="mt-4 border-t border-border pt-4">
            {suggestion.found ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="label">{suggestion.label}</div>
                  <div className="text-lg font-semibold mt-0.5">
                    {describeStack(suggestion.stack)}
                  </div>
                  <div className="label mt-1">
                    Cost <span className="stat">{suggestion.cost} IPC</span> ·
                    captures{" "}
                    <span className="stat" style={{ color: "var(--good)" }}>
                      {fmt(suggestion.capturePct, 1)}%
                    </span>{" "}
                    (target {Math.round(suggestion.targetPct)}%)
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAttacker({ ...suggestion.stack })}
                >
                  Apply to attacker
                </button>
              </div>
            ) : (
              <p className="label">
                No standard force reached the target within practical size — add
                attackers manually or lower the target.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Territory value + controls */}
      <div className="panel p-4 flex flex-wrap items-end justify-between gap-4">
        <label className="flex flex-col gap-1">
          <span className="label">Territory IPC Value (income if captured)</span>
          <input
            className={numField + " w-28"}
            type="number"
            min={0}
            value={territoryValue}
            onChange={(e) => setTerritoryValue(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <div className="label max-w-md">
          ROI counts the territory&apos;s income value (weighted by capture
          chance) against expected unit losses. {fmt(result.runs)} simulations.
        </div>
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
      </div>

      <p className="label">
        Models simultaneous fire, artillery→infantry boost, battleship 2-hit, and
        cheapest-first casualties. Submarine/destroyer/AA-gun special rules and
        retreat are not simulated.
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="stat text-lg" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

function StackEditor({
  title,
  accent,
  stack,
  onChange,
  numField,
}: {
  title: string;
  accent: string;
  stack: Stack;
  onChange: (key: string, v: number) => void;
  numField: string;
}) {
  return (
    <div className="panel p-4">
      <div className="font-semibold mb-3" style={{ color: accent }}>
        {title}
      </div>
      <div className="space-y-1.5">
        {COMBAT_UNITS.map((u) => {
          const v = stack[u.key] ?? 0;
          return (
            <div key={u.key} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {u.name}
                <span className="label ml-2">
                  {u.cost} · {u.attack}/{u.defense}
                  {u.hits > 1 ? ` · ${u.hits}hp` : ""}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="btn px-2 py-1" onClick={() => onChange(u.key, v - 1)} aria-label={`decrease ${u.name}`}>
                  −
                </button>
                <input
                  className={numField}
                  type="number"
                  min={0}
                  value={v}
                  onChange={(e) => onChange(u.key, Number(e.target.value))}
                />
                <button type="button" className="btn px-2 py-1" onClick={() => onChange(u.key, v + 1)} aria-label={`increase ${u.name}`}>
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
