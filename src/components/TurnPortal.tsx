"use client";

import { useMemo, useState, useTransition } from "react";
import { PHASES, isPhaseEnabled } from "@/lib/turn";
import {
  purchaseUnits,
  clearPendingPurchases,
  collectIncome,
  advancePhase,
  goToPhase,
  mobilizeUnits,
  rollResearchDice,
  rollBreakthrough,
  removeBreakthrough,
} from "@/app/actions";
import {
  RESEARCH_DIE_COST,
  RESEARCH_TECHS,
  TECHS_BY_KEY,
  CHART_NAMES,
} from "@/lib/research";
import UnitIcon from "@/components/UnitIcon";

export interface PortalUnit {
  key: string;
  name: string;
  cost: number;
  domain: string;
}
export interface PortalPower {
  key: string;
  name: string;
  color: string;
  flag: string;
  coalition: "AXIS" | "ALLIES";
}
export interface CombatOrder {
  id: string;
  defenderNation: string;
  territory: string | null;
  territoryIpc: number;
  units: Record<string, number>;
  amphibious: boolean;
  status: string;
  resultStatus: string | null;
}
export interface MovementEntry {
  id: string;
  fromTerritory: string | null;
  toTerritory: string | null;
  units: Record<string, number>;
}
export interface BreakthroughEntry {
  nation: string;
  techKey: string;
  roundNumber: number;
}
export interface TurnPortalProps {
  campaignId: string;
  roundNumber: number;
  activePhase: number;
  includeResearch: boolean;
  combatResolution: string;
  power: PortalPower;
  controller: string | null;
  treasury: number;
  pending: { unitType: string; quantity: number }[];
  inventory: { unitType: string; quantity: number }[];
  defaultIncome: number;
  units: PortalUnit[];
  powers: PortalPower[];
  combatOrders: CombatOrder[];
  movements: MovementEntry[];
  breakthroughs: BreakthroughEntry[];
}

const fmtIpc = (n: number) => `${n} IPC`;

// Human-readable battle outcome for the resolved-orders list.
const STATUS_LABELS: Record<string, string> = {
  attacker_captured: "Captured",
  attacker_cleared: "Cleared (not held)",
  defender_won: "Defender held",
  mutual: "Mutual losses",
  retreated: "Retreated",
  ongoing: "Ongoing",
};
const prettyStatus = (s: string | null) =>
  s ? (STATUS_LABELS[s] ?? s.replace(/_/g, " ")) : "Done";

export default function TurnPortal(props: TurnPortalProps) {
  const phase = PHASES.find((p) => p.n === props.activePhase) ?? PHASES[1];
  const [busy, start] = useTransition();

  return (
    <div className="space-y-5">
      {/* Phase progress track */}
      <div className="panel px-4 py-4">
        <div className="phase-track">
          {PHASES.map((p) => {
            const enabled = isPhaseEnabled(p, props.includeResearch);
            const active = p.n === props.activePhase;
            const done = enabled && p.n < props.activePhase;
            return (
              <button
                key={p.n}
                type="button"
                className="phase-node"
                data-active={active}
                data-done={done}
                disabled={!enabled || busy}
                title={enabled ? p.name : `${p.name} — not used in this game`}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("campaignId", props.campaignId);
                  fd.set("phase", String(p.n));
                  start(() => goToPhase(fd));
                }}
              >
                <span className="phase-dot">{done ? "✓" : p.n}</span>
                <span className="phase-name">{p.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active phase document */}
      {phase.key === "research" && <ResearchPanel {...props} />}
      {phase.key === "purchase" && <PurchasePanel {...props} />}
      {phase.key === "combatmove" && <CombatMovePanel {...props} />}
      {phase.key === "combat" && <ConductCombatPanel {...props} />}
      {phase.key === "noncombat" && <NoncombatPanel {...props} />}
      {phase.key === "mobilize" && <MobilizePanel {...props} />}
      {phase.key === "income" && <IncomePanel {...props} />}
    </div>
  );
}

/* ── Shared phase-card chrome ─────────────────────────────────────────────── */

function PhaseCard({
  n,
  title,
  lede,
  children,
  footerNote,
  campaignId,
  lastPhase = false,
  powerName,
}: {
  n: number;
  title: string;
  lede: string;
  children?: React.ReactNode;
  footerNote?: string;
  campaignId: string;
  lastPhase?: boolean;
  powerName: string;
}) {
  return (
    <section className="panel doc-corners">
      <div className="panel-header">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="doc-no shrink-0">Phase {n} of 7</span>
          <h2 className="display text-xl truncate">{title}</h2>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <p className="prose-quiet max-w-3xl">{lede}</p>
        {children}
      </div>
      <form
        action={advancePhase}
        className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5"
        style={{ background: "color-mix(in srgb, var(--surface-2) 55%, transparent)" }}
      >
        <input type="hidden" name="campaignId" value={campaignId} />
        <span className="prose-quiet">
          {footerNote ??
            (lastPhase
              ? `Done? This ends ${powerName}'s turn and hands off to the next power.`
              : `When ${title.toLowerCase()} is finished, move on.`)}
        </span>
        <button className="btn btn-primary" type="submit">
          {lastPhase ? "End Turn" : "Next Phase"} ▸
        </button>
      </form>
    </section>
  );
}

/* ── Phase 1 · Research & Development ─────────────────────────────────────── */

function ResearchPanel(props: TurnPortalProps) {
  const [diceCount, setDiceCount] = useState(1);
  const [rolls, setRolls] = useState<number[] | null>(null);
  const [pendingHits, setPendingHits] = useState(0);
  const [won, setWon] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const maxDice = Math.min(12, Math.floor(props.treasury / RESEARCH_DIE_COST));
  const mine = props.breakthroughs.filter((b) => b.nation === props.power.key);
  const mineKeys = new Set(mine.map((b) => b.techKey));

  function buyAndRoll() {
    setErr(null);
    start(async () => {
      try {
        const res = await rollResearchDice({
          campaignId: props.campaignId,
          nation: props.power.key,
          dice: diceCount,
        });
        setRolls(res.rolls);
        setPendingHits(res.successes);
        setWon([]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Roll failed.");
      }
    });
  }

  function cashIn(chart: 1 | 2) {
    setErr(null);
    start(async () => {
      try {
        const res = await rollBreakthrough({
          campaignId: props.campaignId,
          nation: props.power.key,
          roundNumber: props.roundNumber,
          chart,
        });
        if (res.techKey) setWon((w) => [...w, res.techKey!]);
        setPendingHits((h) => Math.max(0, h - 1));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Breakthrough roll failed.");
      }
    });
  }

  return (
    <PhaseCard
      n={1}
      title="Research & Development"
      lede={`Spend IPC on research dice (${RESEARCH_DIE_COST} IPC each) for a shot at a breakthrough — every 6 earns one. Or skip and bank the IPC for units. Unlocked techs are tracked here so nobody has to remember chart state.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      footerNote="Rolled (or skipping)? Move on to purchasing."
    >
      {/* Buy + roll */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="label mb-1.5">Research dice</div>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn px-2.5 py-1" disabled={diceCount <= 1 || busy} onClick={() => setDiceCount((d) => d - 1)}>−</button>
            <span className="stat w-8 text-center text-lg">{diceCount}</span>
            <button type="button" className="btn px-2.5 py-1" disabled={diceCount >= maxDice || busy} onClick={() => setDiceCount((d) => d + 1)}>+</button>
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Cost</div>
          <div className="stat text-lg">{fmtIpc(diceCount * RESEARCH_DIE_COST)}</div>
        </div>
        <div>
          <div className="label mb-1.5">Treasury</div>
          <div className="stat text-lg" style={{ color: "var(--accent)" }}>{fmtIpc(props.treasury)}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || maxDice < 1 || diceCount > maxDice}
          onClick={buyAndRoll}
        >
          {busy ? "Rolling…" : "Buy & Roll"}
        </button>
        {maxDice < 1 && (
          <span className="prose-quiet">Treasury is below {RESEARCH_DIE_COST} IPC — skip R&D this turn.</span>
        )}
      </div>

      {err && <div className="text-sm" style={{ color: "var(--bad)" }}>{err}</div>}

      {/* Roll results */}
      {rolls && (
        <div className="space-y-3 rounded border border-border p-3.5" style={{ background: "var(--surface-2)" }}>
          <div className="flex flex-wrap items-center gap-1.5">
            {rolls.map((r, i) => (
              <span
                key={i}
                className="die-face"
                style={
                  r === 6
                    ? { background: "linear-gradient(180deg, var(--accent-bright), var(--accent))", color: "var(--accent-ink)", boxShadow: "0 0 10px rgba(201,162,39,0.5)" }
                    : { background: "var(--surface-3)", color: "var(--muted)", border: "1px solid var(--border)" }
                }
              >
                {r}
              </span>
            ))}
            <span className="prose-quiet ml-2">
              {pendingHits + won.length > 0
                ? `${pendingHits + won.length} breakthrough${pendingHits + won.length > 1 ? "s" : ""}!`
                : "No sixes — the labs come up empty this turn."}
            </span>
          </div>

          {pendingHits > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Cash in breakthrough — pick a chart:</span>
              <button type="button" className="btn" disabled={busy} onClick={() => cashIn(1)}>
                {CHART_NAMES[1]}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => cashIn(2)}>
                {CHART_NAMES[2]}
              </button>
              <span className="label">{pendingHits} remaining</span>
            </div>
          )}

          {won.map((k) => (
            <div
              key={k}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--accent-dim)", background: "rgba(201,162,39,0.08)" }}
            >
              <span style={{ color: "var(--accent)" }} className="font-semibold">
                Breakthrough — {TECHS_BY_KEY[k]?.name}
              </span>
              <span className="prose-quiet"> · {TECHS_BY_KEY[k]?.effect}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tech ledger */}
      <div className="grid gap-4 md:grid-cols-2">
        {([1, 2] as const).map((chart) => (
          <div key={chart}>
            <div className="label mb-2">Chart {chart} — {CHART_NAMES[chart]}</div>
            <div className="space-y-1">
              {RESEARCH_TECHS.filter((t) => t.chart === chart).map((t) => {
                const ownedByMe = mineKeys.has(t.key);
                const others = props.breakthroughs.filter((b) => b.techKey === t.key && b.nation !== props.power.key);
                return (
                  <div
                    key={t.key}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                    style={ownedByMe ? { background: "rgba(201,162,39,0.09)", border: "1px solid var(--accent-dim)" } : { border: "1px solid transparent" }}
                    title={t.effect}
                  >
                    <span className="stat w-4 text-center" style={{ color: "var(--faint)" }}>{t.face}</span>
                    <span className={ownedByMe ? "font-medium" : ""} style={ownedByMe ? { color: "var(--accent)" } : { color: "var(--muted)" }}>
                      {t.name}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {others.map((o) => {
                        const p = props.powers.find((x) => x.key === o.nation);
                        return (
                          <span key={o.nation} className="label" style={{ color: p?.color }}>
                            {p?.name.split(" ")[0] ?? o.nation}
                          </span>
                        );
                      })}
                      {ownedByMe && (
                        <button
                          type="button"
                          className="label hover:text-foreground"
                          title="Remove (mis-recorded)"
                          onClick={() =>
                            start(() =>
                              removeBreakthrough({ campaignId: props.campaignId, nation: props.power.key, techKey: t.key }),
                            )
                          }
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </PhaseCard>
  );
}

/* ── Phase 2 · Purchase Units ─────────────────────────────────────────────── */

function PurchasePanel(props: TurnPortalProps) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const orderCost = useMemo(
    () => props.units.reduce((s, u) => s + u.cost * (qty[u.key] || 0), 0),
    [qty, props.units],
  );
  const overspend = orderCost > props.treasury;
  const hasOrder = orderCost > 0;

  const pendingTotal = props.pending.reduce(
    (s, p) => s + (props.units.find((u) => u.key === p.unitType)?.cost ?? 0) * p.quantity,
    0,
  );

  function submit() {
    setErr(null);
    const units = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([unitType, quantity]) => ({ unitType, quantity }));
    start(async () => {
      try {
        await purchaseUnits({ campaignId: props.campaignId, nation: props.power.key, units });
        setQty({});
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Purchase failed.");
      }
    });
  }

  return (
    <PhaseCard
      n={2}
      title="Purchase Units"
      lede={`Spend ${props.power.name}'s treasury on new units. Purchases go to the mobilization zone — set the pieces aside; they deploy in Phase 6.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
    >
      <div className="flex items-center justify-between">
        <span className="label">Unit orders</span>
        <span className="stat">
          Treasury <span style={{ color: "var(--accent)" }}>{fmtIpc(props.treasury)}</span>
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.units.map((u) => {
          const q = qty[u.key] || 0;
          return (
            <div
              key={u.key}
              className="flex items-center gap-2 rounded border p-2"
              style={{
                borderColor: q > 0 ? "var(--accent-dim)" : "var(--border)",
                background: q > 0 ? "rgba(201,162,39,0.06)" : "transparent",
              }}
            >
              <UnitIcon unitKey={u.key} size={28} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{u.name}</div>
                <div className="label">{fmtIpc(u.cost)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn px-2 py-0.5" onClick={() => setQty((s) => ({ ...s, [u.key]: Math.max(0, q - 1) }))}>−</button>
                <input
                  type="number"
                  min={0}
                  value={q}
                  onChange={(e) => setQty((s) => ({ ...s, [u.key]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-12 text-center bg-surface-2 rounded border border-border py-0.5 stat"
                />
                <button type="button" className="btn px-2 py-0.5" onClick={() => setQty((s) => ({ ...s, [u.key]: q + 1 }))}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="stat">
          Order cost{" "}
          <span style={{ color: overspend ? "var(--bad)" : "var(--foreground)" }}>{fmtIpc(orderCost)}</span>
          <span className="prose-quiet"> · remaining {fmtIpc(props.treasury - orderCost)}</span>
        </div>
        <button type="button" className="btn btn-primary" disabled={!hasOrder || overspend || busy} onClick={submit}>
          {busy ? "Buying…" : "Buy Units"}
        </button>
      </div>
      {(err || overspend) && (
        <div className="text-sm" style={{ color: "var(--bad)" }}>{err ?? "Order exceeds available IPC."}</div>
      )}

      {/* Mobilization zone */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="label">Mobilization zone — deploys in Phase 6</span>
          {props.pending.length > 0 && (
            <button type="button" className="label hover:text-foreground" disabled={busy}
              onClick={() => start(() => clearPendingPurchases({ campaignId: props.campaignId, nation: props.power.key }))}>
              ✕ clear &amp; refund {fmtIpc(pendingTotal)}
            </button>
          )}
        </div>
        {props.pending.length === 0 ? (
          <div className="prose-quiet">Nothing purchased yet this turn.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {props.pending.map((p) => {
              const u = props.units.find((x) => x.key === p.unitType);
              return (
                <span key={p.unitType} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm" style={{ background: "var(--surface-2)" }}>
                  <UnitIcon unitKey={p.unitType} size={20} />
                  {u?.name ?? p.unitType} ×{p.quantity}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </PhaseCard>
  );
}

/* ── Phase 3 · Combat Move ────────────────────────────────────────────────── */

function CombatMovePanel(props: TurnPortalProps) {
  const declareThenFight = props.combatResolution !== "FIGHT_EACH";
  return (
    <PhaseCard
      n={3}
      title="Combat Move"
      lede={`Move ${props.power.name}'s attacking units into the territories you intend to contest — including amphibious assaults and the aircraft flying in support.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      footerNote="Attackers in position? On to the battles."
    >
      <div
        className="text-sm rounded border px-3.5 py-2.5"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
      >
        {declareThenFight ? (
          <>This game <span className="font-semibold">declares all combat moves first</span>, then fights every battle together in the next phase.</>
        ) : (
          <>This game <span className="font-semibold">fights each battle as it&apos;s declared</span> — set up a move, resolve it in the simulator, then come back for the next.</>
        )}
      </div>
      {!declareThenFight && (
        <a href={`/campaigns/${props.campaignId}/battle`} className="btn btn-primary">
          Open Battle Simulator ▸
        </a>
      )}
    </PhaseCard>
  );
}

/* ── Phase 4 · Conduct Combat ─────────────────────────────────────────────── */

function ConductCombatPanel(props: TurnPortalProps) {
  const resolved = props.combatOrders.filter((o) => o.status === "RESOLVED");
  return (
    <PhaseCard
      n={4}
      title="Conduct Combat"
      lede={`Fight ${props.power.name}'s battles in the simulator — everyone watches the dice. Losses and captured-territory IPC are recorded automatically as each battle ends.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      footerNote="All battles resolved? Continue."
    >
      <a href={`/campaigns/${props.campaignId}/battle`} className="btn btn-primary">
        ⚔ Open Battle Simulator ▸
      </a>

      {resolved.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="label mb-1.5">Battle record</div>
          {resolved.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm py-1">
              <span style={{ color: "var(--good)" }}>✓</span>
              vs {props.powers.find((p) => p.key === o.defenderNation)?.name ?? o.defenderNation}
              {o.territory ? <span className="prose-quiet">· {o.territory}</span> : null}
              <span className="label">{prettyStatus(o.resultStatus)}</span>
            </div>
          ))}
        </div>
      )}
    </PhaseCard>
  );
}

/* ── Phase 5 · Noncombat Move ─────────────────────────────────────────────── */

function NoncombatPanel(props: TurnPortalProps) {
  const [show, setShow] = useState(false);
  return (
    <PhaseCard
      n={5}
      title="Noncombat Move"
      lede={`Reposition units that didn't fight: reinforce the front, shift fleets, and land every aircraft that flew this turn.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      footerNote="Repositioned and aircraft landed? Continue."
    >
      <button type="button" className="btn" onClick={() => setShow((s) => !s)}>
        {show ? "Hide" : "What counts as a noncombat move?"}
      </button>
      {show && (
        <div className="text-sm rounded border border-border px-3.5 py-3 space-y-1.5" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
          <p>· Move any unit that was <span style={{ color: "var(--foreground)" }}>not in combat</span> this turn, up to its full move.</p>
          <p>· Every aircraft that flew <span style={{ color: "var(--foreground)" }}>must land now</span> — within range, on friendly territory or a carrier.</p>
          <p>· You may not enter enemy-held territory in this phase — that would be a combat move.</p>
          <p>· Use it to consolidate lines and bring reinforcements forward.</p>
        </div>
      )}
    </PhaseCard>
  );
}

/* ── Phase 6 · Mobilize New Units ─────────────────────────────────────────── */

function MobilizePanel(props: TurnPortalProps) {
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  const hasPending = props.pending.length > 0;

  return (
    <PhaseCard
      n={6}
      title="Mobilize New Units"
      lede={`Place this turn's purchases on the board at ${props.power.name}'s industrial complexes (a complex can host as many units as its territory's IPC value), then confirm to log them into the force pool.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      footerNote="Units on the board? One step left."
    >
      {hasPending ? (
        <div className="flex flex-wrap gap-2">
          {props.pending.map((p) => {
            const u = props.units.find((x) => x.key === p.unitType);
            return (
              <span key={p.unitType} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm" style={{ background: "var(--surface-2)" }}>
                <UnitIcon unitKey={p.unitType} size={20} />
                {u?.name ?? p.unitType} ×{p.quantity}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="prose-quiet">
          {done ? "Units placed — the mobilization zone is clear ✓" : "The mobilization zone is empty this turn."}
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!hasPending || busy}
        onClick={() =>
          start(async () => {
            await mobilizeUnits({ campaignId: props.campaignId, nation: props.power.key });
            setDone(true);
          })
        }
      >
        {busy ? "Placing…" : "Place Units on the Board ▸"}
      </button>
    </PhaseCard>
  );
}

/* ── Phase 7 · Collect Income ─────────────────────────────────────────────── */

function IncomePanel(props: TurnPortalProps) {
  const [amount, setAmount] = useState(props.defaultIncome);
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <PhaseCard
      n={7}
      title="Collect Income"
      lede={`Add this turn's territory income to ${props.power.name}'s treasury. The default comes from the production chart — adjust it if territories changed hands this round.`}
      campaignId={props.campaignId}
      powerName={props.power.name}
      lastPhase
    >
      <div className="flex flex-wrap items-end gap-5">
        <div>
          <div className="label mb-1.5">Income to collect</div>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className="w-28 bg-surface-2 rounded border border-border px-2 py-1.5 stat text-lg"
          />
        </div>
        <div>
          <div className="label mb-1.5">Treasury after</div>
          <div className="stat text-lg" style={{ color: "var(--accent)" }}>{fmtIpc(props.treasury + amount)}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            start(async () => {
              await collectIncome({
                campaignId: props.campaignId,
                nation: props.power.key,
                roundNumber: props.roundNumber,
                amount,
              });
              setDone(true);
            })
          }
        >
          {busy ? "Collecting…" : done ? "Collected ✓ — re-apply" : "Collect Income"}
        </button>
      </div>
      <div className="prose-quiet">Current treasury: {fmtIpc(props.treasury)}</div>
    </PhaseCard>
  );
}
