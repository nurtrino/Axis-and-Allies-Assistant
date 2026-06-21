"use client";

import { useState, useTransition } from "react";
import { logBattleLosses, logBomberRaid, logTerritoryCapture } from "@/app/actions";
import BattleStage from "./BattleStage";
import BombingRaid from "./BombingRaid";
import type { Stack } from "@/lib/battle";

interface PowerOpt {
  key: string;
  name: string;
  color: string;
}

export default function CampaignBattle({
  campaignId,
  rounds,
  powers,
  defaultRound,
}: {
  campaignId: string;
  rounds: number[];
  powers: PowerOpt[];
  defaultRound: number;
}) {
  const [attackerNation, setAttackerNation] = useState(powers[0]?.key ?? "");
  const [defenderNation, setDefenderNation] = useState(powers[1]?.key ?? "");
  const [roundNumber, setRoundNumber] = useState(defaultRound);
  const [territory, setTerritory] = useState("");
  const [territoryIpc, setTerritoryIpc] = useState(0);
  const [logged, setLogged] = useState<string | null>(null);
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

      setLogged(
        `Recorded to Round ${roundNumber}: ${nameOf(attackerNation)} and ${nameOf(defenderNation)} losses added to the ledger.${captureNote}`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="panel p-3 flex flex-wrap items-end gap-4">
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
        <p className="label flex-1 min-w-[12rem]">
          If the attacker captures the territory, its IPC value is transferred between nations automatically.
        </p>
      </div>

      {logged && (
        <div className="panel p-2 text-sm" style={{ color: "var(--good)" }}>
          ✓ {logged}
        </div>
      )}
      {pending && <div className="label">Saving…</div>}

      <BattleStage onLogResult={handleLog} />

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
