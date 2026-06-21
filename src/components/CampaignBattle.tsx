"use client";

import { useState, useTransition } from "react";
import { logBattleLosses } from "@/app/actions";
import BattleStage from "./BattleStage";
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
  const [logged, setLogged] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (k: string) => powers.find((p) => p.key === k)?.name ?? k;

  function handleLog(data: { attackerLosses: Stack; defenderLosses: Stack; summaryText: string }) {
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
      setLogged(
        `Recorded to Round ${roundNumber}: ${nameOf(attackerNation)} and ${nameOf(defenderNation)} losses added to the ledger.`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="panel p-3 flex flex-wrap items-end gap-4">
        <div>
          <label className="label block mb-1">Attacking nation</label>
          <select className="field" value={attackerNation} onChange={(e) => setAttackerNation(e.target.value)}>
            {powers.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label block mb-1">Defending nation</label>
          <select className="field" value={defenderNation} onChange={(e) => setDefenderNation(e.target.value)}>
            {powers.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label block mb-1">Log to round</label>
          <select className="field" value={roundNumber} onChange={(e) => setRoundNumber(Number(e.target.value))}>
            {rounds.map((n) => (
              <option key={n} value={n}>Round {n}</option>
            ))}
          </select>
        </div>
        <p className="label flex-1 min-w-[12rem]">
          When a battle resolves, use <span className="stat">Log losses to round</span> to add each
          side&apos;s casualties to the chosen nations&apos; ledger entries.
        </p>
      </div>

      {logged && (
        <div className="panel p-2 text-sm" style={{ color: "var(--good)" }}>
          ✓ {logged}
        </div>
      )}
      {pending && <div className="label">Saving…</div>}

      <BattleStage onLogResult={handleLog} />
    </div>
  );
}
