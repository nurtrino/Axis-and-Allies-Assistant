"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  logBattleLosses,
  logBomberRaid,
  logTerritoryCapture,
  markCombatResolved,
} from "@/app/actions";
import BattleStage from "./BattleStage";
import BombingRaid from "./BombingRaid";
import type { Stack } from "@/lib/battle";

interface PowerOpt {
  key: string;
  name: string;
  color: string;
}

export interface InitialOrder {
  id: string;
  attackerNation: string;
  defenderNation: string;
  territory: string;
  territoryIpc: number;
  units: Stack;
  amphibious: boolean;
  roundNumber: number;
}

export default function CampaignBattle({
  campaignId,
  rounds,
  powers,
  defaultRound,
  initialOrder,
  returnToTurn,
}: {
  campaignId: string;
  rounds: number[];
  powers: PowerOpt[];
  defaultRound: number;
  initialOrder?: InitialOrder;
  returnToTurn?: boolean;
}) {
  const router = useRouter();
  const [attackerNation, setAttackerNation] = useState(
    initialOrder?.attackerNation ?? powers[0]?.key ?? "",
  );
  const [defenderNation, setDefenderNation] = useState(
    initialOrder?.defenderNation ?? powers[1]?.key ?? "",
  );
  const [roundNumber, setRoundNumber] = useState(
    initialOrder?.roundNumber ?? defaultRound,
  );
  const [territory, setTerritory] = useState(initialOrder?.territory ?? "");
  const [territoryIpc, setTerritoryIpc] = useState(initialOrder?.territoryIpc ?? 0);
  const [logged, setLogged] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [pending, startTransition] = useTransition();

  const nameOf = (k: string) => powers.find((p) => p.key === k)?.name ?? k;

  function handleLog(data: { attackerLosses: Stack; defenderLosses: Stack; summaryText: string; status: string }) {
    setLogged(null);
    startTransition(async () => {
      await logBattleLosses({
        campaignId,
        roundNumber,
        attackerNation,
        defenderNation,
        attackerLosses: data.attackerLosses,
        defenderLosses: data.defenderLosses,
      });

      let captureNote = "";
      if (data.status === "attacker_captured" && territoryIpc > 0) {
        await logTerritoryCapture({
          campaignId,
          roundNumber,
          attackerNation,
          defenderNation,
          ipcValue: territoryIpc,
        });
        captureNote = ` · ${nameOf(attackerNation)} gains ${territoryIpc} IPC${territory ? ` (${territory})` : ""}, ${nameOf(defenderNation)} loses ${territoryIpc} IPC`;
      }

      let orderNote = "";
      if (initialOrder) {
        await markCombatResolved({
          campaignId,
          orderId: initialOrder.id,
          resultStatus: data.status,
        });
        orderNote = " · combat order marked resolved";
      }

      setLogged(
        `Recorded to Round ${roundNumber}: ${nameOf(attackerNation)} and ${nameOf(defenderNation)} losses added to the ledger.${captureNote}${orderNote}`,
      );
      setResolved(true);
    });
  }

  function backToCombatMove() {
    router.push(`/campaigns/${campaignId}/turn`);
  }

  return (
    <div className="space-y-4">
      {returnToTurn && resolved && (
        <div
          className="panel p-4 flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: "var(--accent)" }}
        >
          <div className="text-sm">
            <span style={{ color: "var(--good)" }}>✓ Battle resolved.</span>{" "}
            Head back to declare the next attack.
          </div>
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={backToCombatMove}
          >
            ◂ Back to Combat Move
          </button>
        </div>
      )}

      <div className="panel doc-corners">
        <div className="panel-header">
          <span className="doc-no">Operation orders</span>
          <span className="display text-lg">
            <span style={{ color: powers.find((p) => p.key === attackerNation)?.color }}>
              {nameOf(attackerNation)}
            </span>
            <span className="mx-2" style={{ color: "var(--faint)" }}>vs</span>
            <span style={{ color: powers.find((p) => p.key === defenderNation)?.color }}>
              {nameOf(defenderNation)}
            </span>
            {territory ? <span className="prose-quiet text-sm"> · {territory}</span> : null}
          </span>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="label block mb-1">Attacking country</label>
            <select className="field" value={attackerNation} onChange={(e) => setAttackerNation(e.target.value)}>
              {powers.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Defending country</label>
            <select className="field" value={defenderNation} onChange={(e) => setDefenderNation(e.target.value)}>
              {powers.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Round</label>
            <select className="field" value={roundNumber} onChange={(e) => setRoundNumber(Number(e.target.value))}>
              {rounds.map((n) => (
                <option key={n} value={n}>Round {n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Territory (optional)</label>
            <input
              className="field"
              type="text"
              placeholder="e.g. Kwangtung"
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
          <div>
            <label className="label block mb-1">Territory IPC</label>
            <input
              className="field stat text-right"
              type="number"
              min={0}
              value={territoryIpc}
              onChange={(e) => setTerritoryIpc(Math.max(0, parseInt(e.target.value, 10) || 0))}
              style={{ width: 72 }}
            />
          </div>
          <p className="prose-quiet flex-1 min-w-[12rem]">
            If the attacker captures the territory, its IPC value transfers between nations automatically.
          </p>
        </div>
      </div>

      {logged && (
        <div className="panel p-2 text-sm" style={{ color: "var(--good)" }}>
          ✓ {logged}
        </div>
      )}
      {pending && <div className="label">Saving…</div>}

      {initialOrder && (
        <div className="panel p-2 text-sm flex flex-wrap items-center justify-between gap-2" style={{ color: "var(--accent)" }}>
          <span>
            ▸ Resolving declared attack: {nameOf(initialOrder.attackerNation)} →{" "}
            {nameOf(initialOrder.defenderNation)}
            {initialOrder.territory ? ` (${initialOrder.territory})` : ""}. The
            attacker stack is pre-loaded — add the defender&apos;s units, then begin.
          </span>
          {returnToTurn && !resolved && (
            <button
              type="button"
              className="label hover:text-foreground"
              onClick={backToCombatMove}
            >
              ◂ back to Combat Move
            </button>
          )}
        </div>
      )}

      <BattleStage
        onLogResult={handleLog}
        initialAttacker={initialOrder?.units}
        initialAmphibious={initialOrder?.amphibious}
        seedKey={initialOrder?.id}
        attackerName={nameOf(attackerNation)}
        defenderName={nameOf(defenderNation)}
        territoryName={territory}
      />

      <BombingRaid
        onSave={(data) =>
          startTransition(async () => {
            await logBomberRaid({
              campaignId,
              roundNumber,
              nation: attackerNation,
              bombers: data.bombers,
              damage: data.damage,
              bombersLost: data.bombersLost,
            });
            setLogged(
              `Bombing raid recorded to Round ${roundNumber} for ${nameOf(attackerNation)}: ${data.damage} IPC damage, ${data.bombersLost} bomber(s) lost.`,
            );
          })
        }
      />
    </div>
  );
}
