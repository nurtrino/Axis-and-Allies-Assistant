import { UNITS_BY_KEY } from "./anniversary.config";

/**
 * Monte Carlo combat simulator for Axis & Allies: Anniversary Edition general
 * combat. Models: simultaneous attacker/defender fire each round, the
 * artillery→infantry attack boost (1→2), battleships absorbing two hits,
 * cheapest-first ("fodder first") casualty selection, fight-to-the-death, and
 * the rule that only a surviving land unit (not air, not AA) can capture.
 *
 * Simplifications (documented for the UI): submarine stealth/surprise-strike,
 * destroyer anti-sub interaction, AA-gun pre-combat salvo, transport
 * "chosen last", and attacker retreat are NOT modeled. It is a slugfest
 * estimator — excellent for land/standard battles, approximate for naval.
 */

export type Stack = Record<string, number>; // unit key → count

interface UnitInstance {
  key: string;
  cost: number;
  power: number; // effective attack or defense value used to hit
  hp: number;
  canCapture: boolean;
}

function expand(stack: Stack, role: "attack" | "defense"): UnitInstance[] {
  const units: UnitInstance[] = [];
  const infantry = stack["infantry"] ?? 0;
  const artillery = stack["artillery"] ?? 0;
  const boosted = role === "attack" ? Math.min(infantry, artillery) : 0;

  let infMade = 0;
  for (const [key, count] of Object.entries(stack)) {
    const profile = UNITS_BY_KEY[key];
    if (!profile || !count || count < 0) continue;
    // AA guns don't fight in general combat (their Defense 1 is anti-aircraft
    // fire only) and are never destroyed as a combat casualty — exclude them.
    // Industrial complexes never fight either.
    if (key === "aaGun" || profile.domain === "structure") continue;
    for (let i = 0; i < count; i++) {
      let power = role === "attack" ? profile.attack : profile.defense;
      if (key === "infantry" && role === "attack") {
        power = infMade < boosted ? 2 : 1;
        infMade++;
      }
      units.push({
        key,
        cost: profile.cost,
        power,
        hp: profile.hits,
        canCapture: profile.domain === "land" && key !== "aaGun",
      });
    }
  }
  return units;
}

const d6 = () => Math.floor(Math.random() * 6) + 1;

function rollHits(units: UnitInstance[]): number {
  let hits = 0;
  for (const u of units) {
    if (u.power > 0 && d6() <= u.power) hits++;
  }
  return hits;
}

/** Apply `hits` to a stack, removing cheapest units first (2-hp units last). */
function applyCasualties(units: UnitInstance[], hits: number) {
  const order = units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => a.u.cost - b.u.cost);
  let oi = 0;
  for (let h = 0; h < hits; h++) {
    while (oi < order.length && order[oi].u.hp <= 0) oi++;
    if (oi >= order.length) break;
    order[oi].u.hp -= 1;
    if (order[oi].u.hp <= 0) oi++;
  }
}

const stackCost = (units: UnitInstance[]) =>
  units.reduce((s, u) => (u.hp > 0 ? s + u.cost : s), 0);

interface BattleOutcome {
  attackerTook: boolean;
  attackerLost: number; // IPC
  defenderLost: number; // IPC
  attackerSurvivors: number;
  defenderSurvivors: number;
  rounds: number;
}

function simulateOnce(attacker: Stack, defender: Stack): BattleOutcome {
  const atk = expand(attacker, "attack");
  const def = expand(defender, "defense");
  const atkCost0 = stackCost(atk);
  const defCost0 = stackCost(def);

  let rounds = 0;
  const alive = (u: UnitInstance[]) => u.filter((x) => x.hp > 0);

  while (alive(atk).length > 0 && alive(def).length > 0 && rounds < 100) {
    rounds++;
    const aLive = alive(atk);
    const dLive = alive(def);
    const aHits = rollHits(aLive);
    const dHits = rollHits(dLive);
    applyCasualties(def, aHits);
    applyCasualties(atk, dHits);
  }

  const atkLive = alive(atk);
  const defLive = alive(def);
  const attackerTook =
    defLive.length === 0 && atkLive.some((u) => u.canCapture);

  return {
    attackerTook,
    attackerLost: atkCost0 - stackCost(atk),
    defenderLost: defCost0 - stackCost(def),
    attackerSurvivors: atkLive.length,
    defenderSurvivors: defLive.length,
    rounds,
  };
}

export interface PlannerResult {
  runs: number;
  attackerTakePct: number; // % of sims attacker captured the territory
  defenderHoldPct: number;
  avgAttackerLost: number; // IPC
  avgDefenderLost: number; // IPC
  avgAttackerSurvivors: number;
  avgDefenderSurvivors: number;
  avgRounds: number;
  /** Expected net IPC swing including territory value when captured. */
  netSwing: number;
  verdict: "FAVORABLE" | "MARGINAL" | "UNFAVORABLE" | "EMPTY";
}

export function runPlanner(
  attacker: Stack,
  defender: Stack,
  opts: { territoryValue?: number; runs?: number } = {},
): PlannerResult {
  const runs = opts.runs ?? 4000;
  const territoryValue = opts.territoryValue ?? 0;

  const totalAtk = Object.values(attacker).reduce((s, n) => s + (n || 0), 0);
  const totalDef = Object.values(defender).reduce((s, n) => s + (n || 0), 0);
  if (totalAtk === 0) {
    return {
      runs: 0, attackerTakePct: 0, defenderHoldPct: 0,
      avgAttackerLost: 0, avgDefenderLost: 0,
      avgAttackerSurvivors: 0, avgDefenderSurvivors: 0,
      avgRounds: 0, netSwing: 0, verdict: "EMPTY",
    };
  }

  let took = 0, aLost = 0, dLost = 0, aSurv = 0, dSurv = 0, rds = 0;
  for (let i = 0; i < runs; i++) {
    const o = simulateOnce(attacker, defender);
    if (o.attackerTook) took++;
    aLost += o.attackerLost;
    dLost += o.defenderLost;
    aSurv += o.attackerSurvivors;
    dSurv += o.defenderSurvivors;
    rds += o.rounds;
  }

  const takePct = (took / runs) * 100;
  const avgAttackerLost = aLost / runs;
  const avgDefenderLost = dLost / runs;
  const netSwing =
    avgDefenderLost - avgAttackerLost + (takePct / 100) * territoryValue;

  // Verdict: needs a reasonable chance to take AND a non-negative economic
  // return. Empty defender (totalDef 0) is a free walk-in.
  let verdict: PlannerResult["verdict"];
  if (totalDef === 0) {
    verdict = "FAVORABLE";
  } else if (takePct >= 65 && netSwing >= 0) {
    verdict = "FAVORABLE";
  } else if (takePct >= 45 || netSwing >= 0) {
    verdict = "MARGINAL";
  } else {
    verdict = "UNFAVORABLE";
  }

  return {
    runs,
    attackerTakePct: takePct,
    defenderHoldPct: 100 - takePct,
    avgAttackerLost,
    avgDefenderLost,
    avgAttackerSurvivors: aSurv / runs,
    avgDefenderSurvivors: dSurv / runs,
    avgRounds: rds / runs,
    netSwing,
    verdict,
  };
}

const stackTotalCost = (s: Stack) =>
  Object.entries(s).reduce(
    (sum, [k, n]) => sum + (UNITS_BY_KEY[k]?.cost ?? 0) * (n || 0),
    0,
  );

export interface ForceSuggestion {
  found: boolean;
  label: string;
  stack: Stack;
  cost: number;
  capturePct: number;
  targetPct: number;
}

// Standard cost-efficient assault compositions, scaled up until the target
// capture chance is met. Cheapest qualifying option wins.
const ASSAULT_TEMPLATES: { label: string; base: Stack }[] = [
  { label: "Infantry & Artillery", base: { infantry: 2, artillery: 1 } },
  { label: "Combined Arms", base: { infantry: 1, artillery: 1, tank: 1 } },
  { label: "Armored Spearhead", base: { tank: 1 } },
  { label: "Air-Backed Armor", base: { tank: 1, fighter: 1 } },
];

const scale = (base: Stack, k: number): Stack =>
  Object.fromEntries(Object.entries(base).map(([key, n]) => [key, n * k]));

/**
 * Suggest the cheapest force that captures the territory with at least
 * `target` probability. Binary-searches the multiplier for each template
 * (capture probability is monotonic in force size) and returns the lowest-cost
 * qualifying composition.
 */
export function suggestMinimumForce(
  defender: Stack,
  opts: { target?: number; runs?: number } = {},
): ForceSuggestion {
  const targetPct = (opts.target ?? 0.85) * 100;
  const runs = opts.runs ?? 1500;
  const KMAX = 60;

  const totalDef = Object.values(defender).reduce((s, n) => s + (n || 0), 0);
  if (totalDef === 0) {
    return { found: true, label: "Token Force", stack: { infantry: 1 }, cost: 3, capturePct: 100, targetPct };
  }

  const cap = (s: Stack) => runPlanner(s, defender, { runs }).attackerTakePct;

  let best: ForceSuggestion | null = null;
  for (const tmpl of ASSAULT_TEMPLATES) {
    if (cap(scale(tmpl.base, KMAX)) < targetPct) continue; // unreachable here
    let lo = 1, hi = KMAX, k = KMAX;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cap(scale(tmpl.base, mid)) >= targetPct) {
        k = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const stack = scale(tmpl.base, k);
    const cost = stackTotalCost(stack);
    const capturePct = cap(stack);
    if (!best || cost < best.cost) {
      best = { found: true, label: tmpl.label, stack, cost, capturePct, targetPct };
    }
  }

  return (
    best ?? {
      found: false,
      label: "No practical force",
      stack: {},
      cost: 0,
      capturePct: 0,
      targetPct,
    }
  );
}
