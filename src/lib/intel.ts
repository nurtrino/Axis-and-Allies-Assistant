import { type Coalition } from "./anniversary.config";
import { opposite } from "./game";
import { type RoundMetrics } from "./analytics";

const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const sideName = (c: Coalition) => (c === "AXIS" ? "Axis" : "Allies");

export interface HorizonFactor {
  label: string;
  score: number; // -1..+1 (positive favors the player's side)
  detail: string;
}
export interface VictoryHorizon {
  favored: Coalition;
  favoredProb: number; // 0..100 win chance for the favored side
  playerProb: number; // 0..100 win chance for the player's side
  expectedVictoryRound: number | null;
  factors: HorizonFactor[];
  hasVC: boolean;
}

/**
 * Heuristic win forecast. NOT the proprietary TurnLedger model — a transparent
 * weighted blend of economy, attrition, battlefield power, and victory-city
 * pace, expressed from the player's perspective. Factor scores are signed so a
 * positive composite favors the player's coalition.
 */
export function victoryHorizon(
  metrics: RoundMetrics[],
  opts: { playerSide: Coalition; victoryCityGoal: number; currentRound: number },
): VictoryHorizon | null {
  if (metrics.length === 0) return null;
  const latest = metrics[metrics.length - 1];
  const hasVC = latest.vcFriendly != null && latest.vcEnemy != null;

  const incomeScore = clamp(Math.tanh(latest.cumIncomeAdv / 120));
  const attritionScore = clamp(Math.tanh(latest.cumAttritionAdv / 160));
  const apScore = clamp(Math.tanh(latest.apAdv / 50));
  const vcScore = hasVC
    ? clamp((latest.vcFriendly! - latest.vcEnemy!) / opts.victoryCityGoal)
    : 0;

  const factors: HorizonFactor[] = [
    { label: "War Economy", score: incomeScore, detail: `${signed(latest.cumIncomeAdv)} cumulative IPC` },
    { label: "Attrition", score: attritionScore, detail: `${signed(latest.cumAttritionAdv)} IPC kill differential` },
    { label: "Battlefield Power", score: apScore, detail: `${signed(latest.apAdv)} attack power` },
    {
      label: "Victory Cities",
      score: vcScore,
      detail: hasVC ? `${latest.vcFriendly} vs ${latest.vcEnemy} (goal ${opts.victoryCityGoal})` : "not tracked",
    },
  ];

  const weights = [0.22, 0.22, 0.2, 0.36];
  const composite =
    incomeScore * weights[0] +
    attritionScore * weights[1] +
    apScore * weights[2] +
    vcScore * weights[3];

  const playerProb = logistic(3.2 * composite);
  const favored: Coalition =
    composite >= 0 ? opts.playerSide : opposite(opts.playerSide);
  const favoredProb = favored === opts.playerSide ? playerProb : 1 - playerProb;

  // Victory-city pace projection for the favored side.
  let expectedVictoryRound: number | null = null;
  if (hasVC) {
    const favoredVCSeries = metrics
      .map((m) => (favored === opts.playerSide ? m.vcFriendly : m.vcEnemy))
      .filter((v): v is number => v != null);
    if (favoredVCSeries.length >= 2) {
      const recent = favoredVCSeries.slice(-3);
      const pace = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
      const currentVC = favoredVCSeries[favoredVCSeries.length - 1];
      if (pace > 0 && currentVC < opts.victoryCityGoal) {
        const roundsLeft = Math.ceil((opts.victoryCityGoal - currentVC) / pace);
        if (roundsLeft > 0 && roundsLeft <= 40) {
          expectedVictoryRound = opts.currentRound + roundsLeft;
        }
      }
    }
  }

  return {
    favored,
    favoredProb: Math.round(favoredProb * 100),
    playerProb: Math.round(playerProb * 100),
    expectedVictoryRound,
    factors,
    hasVC,
  };
}

export interface CommandBrief {
  headline: string;
  analysis: string[];
  orders: string[];
}

export function commandBrief(
  metrics: RoundMetrics[],
  opts: {
    playerSide: Coalition;
    playerName: string | null;
    victoryCityGoal: number;
    currentRound: number;
    horizon: VictoryHorizon | null;
  },
): CommandBrief {
  const who = opts.playerName ? `${opts.playerName}` : sideName(opts.playerSide);
  if (metrics.length === 0) {
    return {
      headline: `Awaiting first dispatch, ${who}.`,
      analysis: ["No rounds logged yet. Record a round to generate intelligence."],
      orders: ["Log the opening round to begin tracking the campaign."],
    };
  }
  const m = metrics[metrics.length - 1];
  const analysis: string[] = [];
  const orders: string[] = [];

  // Economy
  if (m.cumIncomeAdv > 15) {
    analysis.push(`Your war economy leads by ${m.cumIncomeAdv} cumulative IPC — production dominance is yours to press.`);
    orders.push("Convert your economic lead into board presence: buy aggressively and force unfavorable trades on the enemy.");
  } else if (m.cumIncomeAdv < -15) {
    analysis.push(`The enemy out-produces you by ${Math.abs(m.cumIncomeAdv)} cumulative IPC. Time is not on your side economically.`);
    orders.push("Contest enemy income — raid high-value territory or strategic-bomb factories to slow their production.");
  } else {
    analysis.push("Economic output is near parity; the campaign will be decided on the battlefield.");
  }

  // Attrition
  if (m.attritionAdv > 0) {
    analysis.push(`You won this round's trades (${signed(m.attritionAdv)} IPC). Momentum favors continued engagement.`);
    orders.push("Maintain pressure where you hold the kill ratio; avoid letting the enemy consolidate.");
  } else if (m.attritionAdv < 0) {
    analysis.push(`You lost ${Math.abs(m.attritionAdv)} IPC net in trades this round. Reassess where you are overextended.`);
    orders.push("Pull back from losing engagements and rebuild before committing to the next offensive.");
  }

  // Battlefield power
  if (m.apAdv < -10) {
    analysis.push("Enemy battlefield power exceeds yours; an enemy offensive is likely.");
    orders.push("Fortify your front line and stack defenders on contested victory cities.");
  } else if (m.apAdv > 10) {
    orders.push("You hold the stronger stack — pick a decisive front and break through this round.");
  }

  // Victory cities
  if (opts.horizon?.hasVC && m.vcFriendly != null) {
    const toGoal = opts.victoryCityGoal - m.vcFriendly;
    if (toGoal <= 2 && toGoal > 0) {
      analysis.push(`You are ${toGoal} victory cit${toGoal === 1 ? "y" : "ies"} from winning. The endgame is here.`);
      orders.push(`Secure ${toGoal} more victory cit${toGoal === 1 ? "y" : "ies"} while defending every one you hold.`);
    } else if (m.vcFriendly < (m.vcEnemy ?? 0)) {
      orders.push("You trail in victory cities — prioritize capturing contested cities over open territory.");
    }
  }

  const h = opts.horizon;
  const headline = h
    ? `${sideName(h.favored)} favored (${h.favoredProb}%)${h.expectedVictoryRound ? ` · victory projected by R${h.expectedVictoryRound}` : ""}`
    : `Round ${opts.currentRound} situation report`;

  if (orders.length === 0) orders.push("Hold position and consolidate; no decisive imbalance this round.");

  return { headline, analysis, orders };
}

export interface AfterAction {
  outcome: string;
  summary: string[];
  stats: { label: string; value: string }[];
  turningPoint: string | null;
}

export function afterAction(
  metrics: RoundMetrics[],
  opts: {
    playerSide: Coalition;
    campaignName: string;
    status: string;
    victoryCityGoal: number;
  },
): AfterAction {
  if (metrics.length === 0) {
    return {
      outcome: "No engagements recorded",
      summary: ["This campaign has no logged rounds."],
      stats: [],
      turningPoint: null,
    };
  }
  const last = metrics[metrics.length - 1];
  const rounds = metrics.length;

  const outcome =
    opts.status === "VICTORY"
      ? `${sideName(opts.playerSide)} Victory`
      : opts.status === "DEFEAT"
        ? `${sideName(opts.playerSide)} Defeat`
        : "Campaign In Progress";

  // Turning point: round with the largest net advantage swing in your favor.
  let bestRound = metrics[0];
  let bestSwing = -Infinity;
  for (const m of metrics) {
    if (m.netAdv > bestSwing) {
      bestSwing = m.netAdv;
      bestRound = m;
    }
  }
  const turningPoint =
    bestSwing > 0
      ? `Round ${bestRound.number} was the high-water mark — a ${signed(bestRound.netAdv)} IPC net swing${bestRound.notes ? ` (“${bestRound.notes}”)` : ""}.`
      : null;

  const summary: string[] = [];
  summary.push(
    `Over ${rounds} round${rounds === 1 ? "" : "s"}, ${sideName(opts.playerSide)} finished ${last.cumIncomeAdv >= 0 ? "ahead" : "behind"} economically (${signed(last.cumIncomeAdv)} cumulative IPC) and ${last.cumAttritionAdv >= 0 ? "won" : "lost"} the war of attrition (${signed(last.cumAttritionAdv)} IPC).`,
  );
  if (last.vcFriendly != null && last.vcEnemy != null) {
    summary.push(`Final victory-city count: ${last.vcFriendly} to ${last.vcEnemy} (goal ${opts.victoryCityGoal}).`);
  }

  const stats = [
    { label: "Rounds Played", value: String(rounds) },
    { label: "Final Income Adv", value: signed(last.cumIncomeAdv) },
    { label: "Final Attrition Adv", value: signed(last.cumAttritionAdv) },
    { label: "Final AP Adv", value: signed(last.apAdv) },
    {
      label: "Victory Cities",
      value: last.vcFriendly != null ? `${last.vcFriendly}–${last.vcEnemy}` : "—",
    },
  ];

  return { outcome, summary, stats, turningPoint };
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
