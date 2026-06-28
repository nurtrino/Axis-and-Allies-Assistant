"use client";

import { useMemo, useState, useTransition } from "react";
import { PHASES, isPhaseEnabled, type Phase } from "@/lib/turn";
import {
  purchaseUnits,
  clearPendingPurchases,
  collectIncome,
  advancePhase,
  goToPhase,
} from "@/app/actions";
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
export interface TurnPortalProps {
  campaignId: string;
  roundNumber: number;
  activePhase: number;
  includeResearch: boolean;
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
  const [pending, start] = useTransition();

  return (
    <div className="space-y-5">
      <PhaseStepper
        campaignId={props.campaignId}
        activePhase={props.activePhase}
        includeResearch={props.includeResearch}
        busy={pending}
        onJump={(n) => {
          const fd = new FormData();
          fd.set("campaignId", props.campaignId);
          fd.set("phase", String(n));
          start(() => goToPhase(fd));
        }}
      />

      {/* Active phase panel */}
      {phase.key === "purchase" && <PurchasePanel {...props} />}
      {phase.key === "combat" && <ConductCombatPanel {...props} />}
      {phase.key === "income" && <IncomePanel {...props} />}
      {!["purchase", "combat", "income"].includes(phase.key) && (
        <Placeholder phase={phase} />
      )}

      {/* Advance control */}
      <form
        action={advancePhase}
        className="flex items-center justify-between panel p-4"
      >
        <input type="hidden" name="campaignId" value={props.campaignId} />
        <div className="label">
          {props.activePhase < 7
            ? `Finish ${phase.name} →`
            : `End ${props.power.name}'s turn →`}
        </div>
        <button className="btn btn-primary" type="submit">
          {props.activePhase < 7 ? "Next Phase ▸" : "End Turn ▸"}
        </button>
      </form>
    </div>
  );
}

function PhaseStepper({
  campaignId,
  activePhase,
  includeResearch,
  busy,
  onJump,
}: {
  campaignId: string;
  activePhase: number;
  includeResearch: boolean;
  busy: boolean;
  onJump: (n: number) => void;
}) {
  void campaignId;
  return (
    <div className="flex flex-wrap gap-1.5">
      {PHASES.map((p) => {
        const enabled = isPhaseEnabled(p, includeResearch);
        const active = p.n === activePhase;
        const done = enabled && p.n < activePhase;
        return (
          <button
            key={p.n}
            type="button"
            disabled={!enabled || busy}
            onClick={() => enabled && onJump(p.n)}
            title={enabled ? p.name : `${p.name} (disabled)`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-colors"
            style={{
              opacity: enabled ? 1 : 0.35,
              cursor: enabled ? "pointer" : "not-allowed",
              border: active
                ? "1px solid var(--accent)"
                : "1px solid var(--border)",
              color: active
                ? "var(--accent)"
                : done
                  ? "var(--good)"
                  : "var(--muted)",
              background: active ? "var(--surface-2)" : "transparent",
            }}
          >
            <span style={{ opacity: 0.7 }}>{p.n}</span>
            {p.short}
            {!p.implemented && enabled && (
              <span className="label" style={{ fontSize: 9 }}>
                soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PurchasePanel(props: TurnPortalProps) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const orderCost = useMemo(
    () =>
      props.units.reduce((s, u) => s + u.cost * (qty[u.key] || 0), 0),
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
        await purchaseUnits({
          campaignId: props.campaignId,
          nation: props.power.key,
          units,
        });
        setQty({});
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Purchase failed.");
      }
    });
  }

  function clearAll() {
    start(() =>
      clearPendingPurchases({ campaignId: props.campaignId, nation: props.power.key }),
    );
  }

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Phase 2 — Purchase Units</h2>
        <div className="stat">
          Treasury:{" "}
          <span style={{ color: "var(--accent)" }}>{fmtIpc(props.treasury)}</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.units.map((u) => {
          const q = qty[u.key] || 0;
          return (
            <div
              key={u.key}
              className="flex items-center gap-2 rounded border border-border p-2"
            >
              <UnitIcon unitKey={u.key} size={28} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{u.name}</div>
                <div className="label">{fmtIpc(u.cost)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn px-2 py-0.5"
                  onClick={() => setQty((s) => ({ ...s, [u.key]: Math.max(0, q - 1) }))}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={q}
                  onChange={(e) =>
                    setQty((s) => ({ ...s, [u.key]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="w-12 text-center bg-surface-2 rounded border border-border py-0.5 stat"
                />
                <button
                  type="button"
                  className="btn px-2 py-0.5"
                  onClick={() => setQty((s) => ({ ...s, [u.key]: q + 1 }))}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="stat">
          Order cost:{" "}
          <span style={{ color: overspend ? "var(--bad)" : "var(--foreground)" }}>
            {fmtIpc(orderCost)}
          </span>
          <span className="label">
            {" "}
            · remaining {fmtIpc(props.treasury - orderCost)}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasOrder || overspend || pending}
          onClick={submit}
        >
          {pending ? "Buying…" : "Buy Units"}
        </button>
      </div>
      {(err || overspend) && (
        <div className="text-sm" style={{ color: "var(--bad)" }}>
          {err ?? "Order exceeds available IPC."}
        </div>
      )}

      {/* Pending placement */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="label">Purchased this turn</span>
          {props.pending.length > 0 && (
            <button
              type="button"
              className="label hover:text-foreground"
              onClick={clearAll}
              disabled={pending}
            >
              ✕ clear & refund {fmtIpc(pendingTotal)}
            </button>
          )}
        </div>
        {props.pending.length === 0 ? (
          <div className="label">Nothing purchased yet this turn.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {props.pending.map((p) => {
              const u = props.units.find((x) => x.key === p.unitType);
              return (
                <span
                  key={p.unitType}
                  className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm"
                >
                  <UnitIcon unitKey={p.unitType} size={20} />
                  {u?.name ?? p.unitType} ×{p.quantity}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ConductCombatPanel(props: TurnPortalProps) {
  const resolved = props.combatOrders.filter((o) => o.status === "RESOLVED");

  return (
    <div className="panel p-5 space-y-4">
      <h2 className="text-lg font-semibold">Phase 4 — Conduct Combat</h2>
      <p className="label">
        Fight {props.power.name}&apos;s battles in the 3D Battle Simulator —
        everyone watches the dice. Losses and territory IPC are recorded
        automatically when each battle finishes.
      </p>

      <a href={`/campaigns/${props.campaignId}/battle`} className="btn btn-primary">
        ⚔ Open Battle Simulator ▸
      </a>

      {resolved.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="label mb-1">Resolved this campaign</div>
          {resolved.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm py-1">
              <span style={{ color: "var(--good)" }}>✓</span>
              → {props.powers.find((p) => p.key === o.defenderNation)?.name ?? o.defenderNation}
              {o.territory ? ` · ${o.territory}` : ""}
              <span className="label">{prettyStatus(o.resultStatus)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IncomePanel(props: TurnPortalProps) {
  const [amount, setAmount] = useState(props.defaultIncome);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  function collect() {
    start(async () => {
      await collectIncome({
        campaignId: props.campaignId,
        nation: props.power.key,
        roundNumber: props.roundNumber,
        amount,
      });
      setDone(true);
    });
  }

  return (
    <div className="panel p-5 space-y-4">
      <h2 className="text-lg font-semibold">Phase 7 — Collect Income</h2>
      <p className="label">
        Add this turn&apos;s territory income to {props.power.name}&apos;s
        treasury. Defaults to the production-chart figure — adjust if territories
        changed hands this round.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="label mb-1">Income to collect</div>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            className="w-28 bg-surface-2 rounded border border-border px-2 py-1.5 stat text-lg"
          />
        </div>
        <div>
          <div className="label mb-1">Treasury after</div>
          <div className="stat text-lg" style={{ color: "var(--accent)" }}>
            {fmtIpc(props.treasury + amount)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={collect}
          disabled={pending}
        >
          {pending ? "Collecting…" : done ? "Collected ✓ — re-apply" : "Collect Income"}
        </button>
      </div>
      <div className="label">
        Current treasury: {fmtIpc(props.treasury)}
      </div>
    </div>
  );
}

function Placeholder({ phase }: { phase: Phase }) {
  return (
    <div className="panel p-8 text-center space-y-2">
      <h2 className="text-lg font-semibold">
        Phase {phase.n} — {phase.name}
      </h2>
      <p className="label">
        {phase.key === "research"
          ? "Research & Development is an optional rule — coming in a later update."
          : "This phase's guided entry is coming soon. For now, play it on the board and advance when done."}
      </p>
    </div>
  );
}
