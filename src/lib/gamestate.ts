import { POWERS, POWERS_BY_KEY, type Coalition } from "./anniversary.config";
import { computeRounds, type RoundRow } from "./analytics";
import { resolvePlayers } from "./players";
import { victoryHorizon } from "./intel";

interface RawPlayer {
  id: string;
  name: string;
  sortOrder: number;
  assignments: { powerKey: string }[];
}
interface CampaignForContext {
  name: string;
  scenario: string;
  trackingMode: string;
  victoryCityGoal: number;
  status: string;
  side: string;
  players: RawPlayer[];
  rounds: RoundRow[];
}

const sideName = (c: Coalition) => (c === "AXIS" ? "Axis" : "Allies");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Build a compact, readable snapshot of the live game for Claude's context, so
 * questions can be answered relative to the situation actually on the board.
 * Written from the selected player's perspective when one is given.
 */
export function buildGameStateContext(
  campaign: CampaignForContext,
  selectedPlayerId?: string,
): string {
  const players = resolvePlayers(campaign.players);
  const selected =
    players.find((p) => p.id === selectedPlayerId) ?? players[0] ?? null;
  const side: Coalition = selected?.coalition ?? (campaign.side as Coalition);

  const metrics = computeRounds(campaign.rounds, side);
  const latest = metrics[metrics.length - 1];
  const currentRound =
    campaign.rounds.length > 0
      ? Math.max(...campaign.rounds.map((r) => r.number))
      : 1;
  const currentRoundRow = campaign.rounds.find((r) => r.number === currentRound);

  const L: string[] = [];
  L.push(`# Current Game State`);
  L.push(
    `Edition: Axis & Allies Anniversary Edition (50th). Scenario: ${campaign.scenario === "Y1941" ? "1941 (Barbarossa)" : "1942 (high-water mark)"}. Victory goal: ${campaign.victoryCityGoal} victory cities. Status: ${campaign.status}.`,
  );
  L.push(`Campaign: "${campaign.name}". Currently in Round ${currentRound}.`);

  if (players.length > 0) {
    L.push(``);
    L.push(`## Players`);
    for (const p of players) {
      const powerNames = p.powerKeys
        .map((k) => POWERS_BY_KEY[k]?.name ?? k)
        .join(", ");
      const marker = p.id === selected?.id ? " (asking this question)" : "";
      L.push(`- ${p.name}${marker}: ${sideName(p.coalition)} — controls ${powerNames}`);
    }
  }

  if (selected) {
    L.push(``);
    L.push(
      `The question is asked from ${selected.name}'s perspective — the ${sideName(side)} coalition.`,
    );
  }

  // Per-nation snapshot for the current round.
  if (currentRoundRow) {
    L.push(``);
    L.push(`## Round ${currentRound} — per-power figures`);
    for (const p of POWERS) {
      const e = currentRoundRow.entries.find((x) => x.nation === p.key);
      if (!e) continue;
      const income = e.income + e.objectiveBonus;
      L.push(
        `- ${p.name} (${p.coalition}): income ${income} IPC, attack power ${e.attackPower}, IPC banked ${e.ipcRemaining}, purchases ${e.purchases}.`,
      );
    }
    if (currentRoundRow.vcAxis != null || currentRoundRow.vcAllies != null) {
      L.push(
        `Victory cities — Axis ${currentRoundRow.vcAxis ?? "?"}, Allies ${currentRoundRow.vcAllies ?? "?"}.`,
      );
    }
  }

  // Coalition advantages (your-side perspective).
  if (latest) {
    L.push(``);
    L.push(`## Coalition advantages (from ${sideName(side)}'s perspective, this round)`);
    L.push(`- Income advantage: ${signed(latest.incomeAdv)} IPC (cumulative ${signed(latest.cumIncomeAdv)})`);
    L.push(`- Attrition advantage: ${signed(latest.attritionAdv)} IPC (cumulative ${signed(latest.cumAttritionAdv)})`);
    L.push(`- Attack-power advantage: ${signed(latest.apAdv)}`);
    L.push(`- Net advantage: ${signed(latest.netAdv)} IPC`);

    const horizon = victoryHorizon(metrics, {
      playerSide: side,
      victoryCityGoal: campaign.victoryCityGoal,
      currentRound,
    });
    if (horizon) {
      L.push(
        `- Victory Horizon forecast: ${sideName(horizon.favored)} favored (${horizon.favoredProb}%)${horizon.expectedVictoryRound ? `, victory projected by Round ${horizon.expectedVictoryRound}` : ""}.`,
      );
    }
  } else {
    L.push(``);
    L.push(`No round data has been logged yet.`);
  }

  return L.join("\n");
}
