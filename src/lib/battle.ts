/**
 * Axis & Allies: Anniversary Edition — interactive, step-by-step general-combat
 * engine. Unlike combat.ts (a Monte-Carlo estimator), this drives a single
 * battle one dice-roll at a time so the UI can animate it and explain every
 * outcome. It follows the Conduct Combat sequence with the special rules:
 *
 *   1. Antiaircraft fire        (defender AA at attacking aircraft, round 1 only)
 *   2. Submarine surprise strike (a side's subs fire first if the OTHER side has
 *                                 no destroyer; those casualties don't fire back)
 *   3. Offshore bombardment      (amphibious only, round 1: attacking battleships
 *                                 & cruisers fire at defenders before land combat)
 *   4. General combat rounds     (attacker & defender fire simultaneously)
 *        - artillery boosts infantry attack 1 → 2, one-for-one
 *        - battleships absorb two hits
 *        - cheapest-first ("fodder") casualties
 *        - attacker may retreat between rounds
 *   5. Conclude (only a surviving non-AA LAND unit can capture a territory)
 *
 * Documented simplifications: AA is capped at 3 shots per gun; a submarine's
 * hits are taken from sea units (it cannot hit aircraft); the "destroyer lets
 * aircraft hit subs" nuance is not separately modelled (fodder order handles it).
 */

import { UNITS_BY_KEY } from "./anniversary.config";

export type Stack = Record<string, number>;
export type Side = "attacker" | "defender";

export interface BattleUnit {
  uid: number;
  key: string;
  side: Side;
  hp: number;
  maxHp: number;
  /** Submarine that ducked out of this battle — survives, but no longer fights. */
  submerged?: boolean;
}

export interface BattleContext {
  amphibious: boolean;
  territoryValue: number;
}

export type StepKind =
  | "aa_fire"
  | "attacker_sub_strike"
  | "defender_sub_strike"
  | "bombardment"
  | "attacker_fire"
  | "defender_fire"
  | "retreat"
  | "done";

export type BattleStatus =
  | "ongoing"
  | "attacker_captured"
  | "attacker_cleared" // wiped the defender but has no land unit to hold
  | "defender_won"
  | "mutual"
  | "retreated";

/** One die to be rolled, tied to the unit firing it. Hits when roll <= hitOn. */
export interface DieSpec {
  uid: number;
  key: string;
  hitOn: number;
}

export interface PendingStep {
  kind: StepKind;
  side?: Side;
  round: number;
  title: string;
  explanation: string;
  /** Dice to roll for this step (empty for a decision step like retreat). */
  dice: DieSpec[];
  /** dice-box theme color for this group. */
  color: string;
  decision?: "retreat";
  /** Submarines may submerge (duck out) instead of making this strike. */
  canSubmerge?: boolean;
}

export interface RollDetail {
  key: string;
  value: number;
  hitOn: number;
  hit: boolean;
}

export interface BattleEvent {
  round: number;
  kind: StepKind;
  side?: Side;
  title: string;
  text: string;
  rolls: RollDetail[];
  hits: number;
  casualties: { key: string; side: Side }[];
}

export interface BattleState {
  attacker: BattleUnit[];
  defender: BattleUnit[];
  round: number;
  ctx: BattleContext;
  log: BattleEvent[];
  status: BattleStatus;
  /** Step kinds queued for the current round, and our position in them. */
  steps: StepKind[];
  stepIndex: number;
  /** Hits scored this round, applied simultaneously once both sides have fired. */
  pendingAttackerHits: number; // hits the attacker scored on the defender
  pendingDefenderHits: number; // hits the defender scored on the attacker
  startCost: { attacker: number; defender: number };
}

const ATTACKER_COLOR = "#b23b2e"; // warm red
const DEFENDER_COLOR = "#2f6f4f"; // green
const NEUTRAL_COLOR = "#8a6d2f"; // gold (AA / bombardment)

let UID = 1;

function buildUnits(stack: Stack, side: Side): BattleUnit[] {
  const units: BattleUnit[] = [];
  for (const [key, count] of Object.entries(stack)) {
    const p = UNITS_BY_KEY[key];
    if (!p || !count || count < 0) continue;
    for (let i = 0; i < count; i++) {
      units.push({ uid: UID++, key, side, hp: p.hits, maxHp: p.hits });
    }
  }
  return units;
}

const isStructure = (key: string) => UNITS_BY_KEY[key]?.domain === "structure";
const isAir = (key: string) => UNITS_BY_KEY[key]?.domain === "air";
const isSea = (key: string) => UNITS_BY_KEY[key]?.domain === "sea";
const isLand = (key: string) => UNITS_BY_KEY[key]?.domain === "land";

/** Units that participate in normal general combat (not AA guns / structures /
 * submerged subs). */
const fights = (u: BattleUnit) =>
  u.key !== "aaGun" && !isStructure(u.key) && u.hp > 0 && !u.submerged;

const alive = (us: BattleUnit[]) => us.filter((u) => u.hp > 0);

function stackValue(units: BattleUnit[]): number {
  return units.reduce(
    (s, u) => s + (u.hp > 0 ? (UNITS_BY_KEY[u.key]?.cost ?? 0) : 0),
    0,
  );
}

function attackerHasAir(s: BattleState) {
  return alive(s.attacker).some((u) => isAir(u.key));
}
function defenderHasAA(s: BattleState) {
  return alive(s.defender).some((u) => u.key === "aaGun");
}
function hasDestroyer(units: BattleUnit[]) {
  return alive(units).some((u) => u.key === "destroyer");
}
function subsSurprise(own: BattleUnit[], enemy: BattleUnit[]) {
  // Subs fire in the surprise step when the enemy has no destroyer.
  return alive(own).some((u) => u.key === "submarine" && !u.submerged) && !hasDestroyer(enemy);
}
function attackerCanBombard(s: BattleState) {
  return alive(s.attacker).some((u) => u.key === "battleship" || u.key === "cruiser");
}

/** Effective fire value for one unit, applying the artillery→infantry boost. */
function fireValue(
  unit: BattleUnit,
  side: Side,
  boostedInfantryRemaining: { n: number },
): number {
  const p = UNITS_BY_KEY[unit.key];
  if (!p) return 0;
  if (side === "attacker") {
    if (unit.key === "infantry" && boostedInfantryRemaining.n > 0) {
      boostedInfantryRemaining.n -= 1;
      return 2; // artillery-supported infantry
    }
    return p.attack;
  }
  return p.defense;
}

/** Units that fire in the normal step for a side this round. */
function normalFirers(s: BattleState, side: Side): BattleUnit[] {
  const own = side === "attacker" ? s.attacker : s.defender;
  const enemy = side === "attacker" ? s.defender : s.attacker;
  const surprise = subsSurprise(own, enemy);
  return alive(own).filter((u) => {
    if (!fights(u)) return false;
    // Subs that surprise-struck this round don't also fire normally.
    if (u.key === "submarine" && surprise) return false;
    return true;
  });
}

function fireDice(s: BattleState, side: Side): DieSpec[] {
  const firers = normalFirers(s, side);
  const artillery = side === "attacker"
    ? alive(s.attacker).filter((u) => u.key === "artillery").length
    : 0;
  const boosted = { n: artillery };
  // Apply boost to infantry first so it's deterministic.
  const ordered = [...firers].sort((a, b) => (a.key === "infantry" ? -1 : 0) - (b.key === "infantry" ? -1 : 0));
  const dice: DieSpec[] = [];
  for (const u of ordered) {
    const v = fireValue(u, side, boosted);
    if (v > 0) dice.push({ uid: u.uid, key: u.key, hitOn: v });
  }
  return dice;
}

function subDice(s: BattleState, side: Side): DieSpec[] {
  const own = side === "attacker" ? s.attacker : s.defender;
  return alive(own)
    .filter((u) => u.key === "submarine" && !u.submerged)
    .map((u) => ({ uid: u.uid, key: u.key, hitOn: side === "attacker" ? 2 : 1 }));
}

function aaDice(s: BattleState): DieSpec[] {
  const guns = alive(s.defender).filter((u) => u.key === "aaGun").length;
  const air = alive(s.attacker).filter((u) => isAir(u.key)).length;
  const shots = Math.min(air, guns * 3);
  return Array.from({ length: shots }, () => ({ uid: 0, key: "aaGun", hitOn: 1 }));
}

function bombardDice(s: BattleState): DieSpec[] {
  return alive(s.attacker)
    .filter((u) => u.key === "battleship" || u.key === "cruiser")
    .map((u) => ({ uid: u.uid, key: u.key, hitOn: UNITS_BY_KEY[u.key].attack }));
}

/** Dice for a given step kind in the current state. */
function stepDice(s: BattleState, kind: StepKind): DieSpec[] {
  switch (kind) {
    case "aa_fire": return aaDice(s);
    case "attacker_sub_strike": return subDice(s, "attacker");
    case "defender_sub_strike": return subDice(s, "defender");
    case "bombardment": return bombardDice(s);
    case "attacker_fire": return fireDice(s, "attacker");
    case "defender_fire": return fireDice(s, "defender");
    default: return [];
  }
}

/**
 * Advance past any current non-decision step that has no dice to roll (e.g. a
 * side whose only remaining units are surprise-striking subs has an empty
 * normal-fire step). Such a step scores zero hits but must still move the round
 * machine forward, otherwise the UI/engine would stall on it.
 */
function settle(s: BattleState) {
  let guard = 0;
  while (s.status === "ongoing" && guard++ < 50) {
    const kind = s.steps[s.stepIndex];
    if (!kind || kind === "retreat") break;
    if (stepDice(s, kind).length > 0) break;
    s.stepIndex += 1;
    afterStep(s);
  }
}

/** Build the ordered list of step kinds for the current round. */
function roundSteps(s: BattleState): StepKind[] {
  const steps: StepKind[] = [];
  if (s.round === 1 && defenderHasAA(s) && attackerHasAir(s)) steps.push("aa_fire");
  if (subsSurprise(s.attacker, s.defender)) steps.push("attacker_sub_strike");
  if (subsSurprise(s.defender, s.attacker)) steps.push("defender_sub_strike");
  if (s.round === 1 && s.ctx.amphibious && attackerCanBombard(s)) steps.push("bombardment");
  steps.push("attacker_fire");
  steps.push("defender_fire");
  return steps;
}

/** Choose `hits` casualties from a side, cheapest-first, optionally restricted. */
function assignCasualties(
  units: BattleUnit[],
  hits: number,
  filter: (u: BattleUnit) => boolean,
): { key: string; side: Side }[] {
  const eligible = alive(units)
    .filter(filter)
    .sort((a, b) => {
      const ca = UNITS_BY_KEY[a.key]?.cost ?? 0;
      const cb = UNITS_BY_KEY[b.key]?.cost ?? 0;
      if (ca !== cb) return ca - cb;
      // Take single-hit units before multi-hit (keep battleships longest).
      return a.maxHp - b.maxHp;
    });
  const removed: { key: string; side: Side }[] = [];
  let i = 0;
  for (let h = 0; h < hits; h++) {
    while (i < eligible.length && eligible[i].hp <= 0) i++;
    if (i >= eligible.length) break;
    const u = eligible[i];
    u.hp -= 1;
    if (u.hp <= 0) {
      removed.push({ key: u.key, side: u.side });
      i++;
    }
  }
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────

export function createBattle(
  attackerStack: Stack,
  defenderStack: Stack,
  ctx?: Partial<BattleContext>,
): BattleState {
  const attacker = buildUnits(attackerStack, "attacker");
  const defender = buildUnits(defenderStack, "defender");
  const state: BattleState = {
    attacker,
    defender,
    round: 1,
    ctx: { amphibious: ctx?.amphibious ?? false, territoryValue: ctx?.territoryValue ?? 0 },
    log: [],
    status: "ongoing",
    steps: [],
    stepIndex: 0,
    pendingAttackerHits: 0,
    pendingDefenderHits: 0,
    startCost: { attacker: stackValue(attacker), defender: stackValue(defender) },
  };
  state.steps = roundSteps(state);
  evaluateStatus(state); // handle a defender that is empty from the start
  settle(state);
  return state;
}

/** Describe the step the UI should perform next, or null if the battle is over. */
export function peek(state: BattleState): PendingStep | null {
  if (state.status !== "ongoing") return null;
  const kind = state.steps[state.stepIndex];
  switch (kind) {
    case "aa_fire":
      return {
        kind, round: state.round, color: NEUTRAL_COLOR, dice: aaDice(state),
        title: "Antiaircraft Fire",
        explanation: "Defending AA guns fire at attacking aircraft (max 3 shots per gun). Each 1 destroys one aircraft before combat.",
      };
    case "attacker_sub_strike":
      return {
        kind, side: "attacker", round: state.round, color: ATTACKER_COLOR, dice: subDice(state, "attacker"), canSubmerge: true,
        title: "Attacking Submarine Surprise Strike",
        explanation: "No defending destroyer, so attacking subs may strike first (hit on 2) — or submerge and duck out of the battle.",
      };
    case "defender_sub_strike":
      return {
        kind, side: "defender", round: state.round, color: DEFENDER_COLOR, dice: subDice(state, "defender"), canSubmerge: true,
        title: "Defending Submarine Surprise Strike",
        explanation: "No attacking destroyer, so defending subs may strike first (hit on 1) — or submerge and duck out of the battle.",
      };
    case "bombardment":
      return {
        kind, side: "attacker", round: state.round, color: NEUTRAL_COLOR, dice: bombardDice(state),
        title: "Offshore Bombardment",
        explanation: "Attacking battleships (hit on 4) and cruisers (hit on 3) bombard the defenders. Hits are applied after the defenders fire this round.",
      };
    case "attacker_fire": {
      const dice = fireDice(state, "attacker");
      return {
        kind, side: "attacker", round: state.round, color: ATTACKER_COLOR, dice,
        title: `Round ${state.round} — Attacker Fires`,
        explanation: "Each attacking unit rolls one die, scoring a hit on its attack value or lower. Artillery boosts one infantry each to attack 2.",
      };
    }
    case "defender_fire": {
      const dice = fireDice(state, "defender");
      return {
        kind, side: "defender", round: state.round, color: DEFENDER_COLOR, dice,
        title: `Round ${state.round} — Defender Fires`,
        explanation: "Each defending unit rolls one die, scoring a hit on its defense value or lower. Casualties are applied simultaneously with the attacker's.",
      };
    }
    case "retreat":
      return {
        kind, side: "attacker", round: state.round, color: ATTACKER_COLOR, dice: [], decision: "retreat",
        title: `Round ${state.round} — Attacker may retreat`,
        explanation: "Both sides still stand. The attacker can press the assault into another round or retreat and withdraw surviving units.",
      };
    default:
      return null;
  }
}

function rollDetails(dice: DieSpec[], values: number[]): { details: RollDetail[]; hits: number } {
  const details: RollDetail[] = [];
  let hits = 0;
  dice.forEach((d, i) => {
    const value = values[i];
    const hit = value <= d.hitOn;
    if (hit) hits++;
    details.push({ key: d.key, value, hitOn: d.hitOn, hit });
  });
  return { details, hits };
}

/**
 * Resolve a dice-roll step. `values` are the d6 results, one per die in the
 * pending step's `dice`, in order. Returns the next state.
 */
export function resolveRoll(state: BattleState, values: number[]): BattleState {
  const step = peek(state);
  if (!step || step.dice.length === 0) return state;
  const { details, hits } = rollDetails(step.dice, values);
  const kind = step.kind;
  let casualties: { key: string; side: Side }[] = [];
  let text = "";

  if (kind === "aa_fire") {
    casualties = assignCasualties(state.attacker, hits, (u) => isAir(u.key));
    text = hits ? `${hits} aircraft shot down before combat.` : "All attacking aircraft get through.";
  } else if (kind === "attacker_sub_strike") {
    casualties = assignCasualties(state.defender, hits, (u) => isSea(u.key) && !u.submerged);
    text = hits ? `${hits} defending ship${hits > 1 ? "s" : ""} sunk by surprise.` : "The surprise strike misses.";
  } else if (kind === "defender_sub_strike") {
    casualties = assignCasualties(state.attacker, hits, (u) => isSea(u.key) && !u.submerged);
    text = hits ? `${hits} attacking ship${hits > 1 ? "s" : ""} sunk by surprise.` : "The surprise strike misses.";
  } else if (kind === "bombardment") {
    state.pendingAttackerHits += hits; // applied with this round's attacker fire
    text = hits ? `${hits} bombardment hit${hits > 1 ? "s" : ""} will land after the defenders fire.` : "The bombardment misses.";
  } else if (kind === "attacker_fire") {
    state.pendingAttackerHits += hits;
    text = `Attacker scores ${hits} hit${hits === 1 ? "" : "s"}.`;
  } else if (kind === "defender_fire") {
    state.pendingDefenderHits += hits;
    text = `Defender scores ${hits} hit${hits === 1 ? "" : "s"}.`;
  }

  state.log.push({
    round: state.round, kind, side: step.side, title: step.title,
    text, rolls: details, hits, casualties,
  });

  state.stepIndex += 1;
  afterStep(state);
  settle(state);
  return { ...state };
}

/** Apply the attacker's retreat decision. */
export function chooseRetreat(state: BattleState, retreat: boolean): BattleState {
  if (retreat) {
    state.status = "retreated";
    state.log.push({
      round: state.round, kind: "retreat", side: "attacker",
      title: `Round ${state.round} — Attacker Retreats`,
      text: "The attacker withdraws surviving units. The defender holds.",
      rolls: [], hits: 0, casualties: [],
    });
  } else {
    state.round += 1;
    state.steps = roundSteps(state);
    state.stepIndex = 0;
    settle(state);
  }
  return { ...state };
}

/** The current side's submarines submerge (duck out) instead of striking. They
 * survive but take no further part in the battle. */
export function submergeCurrent(state: BattleState): BattleState {
  const step = peek(state);
  if (!step || (step.kind !== "attacker_sub_strike" && step.kind !== "defender_sub_strike")) {
    return state;
  }
  const side = step.side as Side;
  const own = side === "attacker" ? state.attacker : state.defender;
  let count = 0;
  for (const u of own) {
    if (u.key === "submarine" && u.hp > 0 && !u.submerged) {
      u.submerged = true;
      count++;
    }
  }
  state.log.push({
    round: state.round,
    kind: step.kind,
    side,
    title: `${side === "attacker" ? "Attacking" : "Defending"} Submarines Submerge`,
    text: `${count} submarine${count === 1 ? "" : "s"} duck out of the battle and slip away.`,
    rolls: [],
    hits: 0,
    casualties: [],
  });
  evaluateStatus(state);
  if (state.status === "ongoing") {
    state.stepIndex += 1;
    settle(state);
  }
  return { ...state };
}

/** After a roll step advances stepIndex, apply end-of-fire effects. */
function afterStep(state: BattleState) {
  const finishedFire = state.stepIndex >= state.steps.length;
  if (!finishedFire) return;

  // Both sides have fired this round — apply simultaneous casualties.
  const aHits = state.pendingAttackerHits;
  const dHits = state.pendingDefenderHits;
  state.pendingAttackerHits = 0;
  state.pendingDefenderHits = 0;

  const defLost = assignCasualties(state.defender, aHits, (u) => fights(u));
  const atkLost = assignCasualties(state.attacker, dHits, (u) => fights(u));

  if (defLost.length || atkLost.length) {
    state.log.push({
      round: state.round, kind: "defender_fire",
      title: `Round ${state.round} — Casualties`,
      text: `${defLost.length} defending and ${atkLost.length} attacking unit${defLost.length + atkLost.length === 1 ? "" : "s"} removed.`,
      rolls: [], hits: 0, casualties: [...defLost, ...atkLost],
    });
  }

  evaluateStatus(state);
  if (state.status === "ongoing") {
    // Offer a retreat decision before the next round.
    state.steps = ["retreat"];
    state.stepIndex = 0;
  }
}

function evaluateStatus(state: BattleState) {
  const atk = alive(state.attacker).filter(fights);
  const def = alive(state.defender).filter(fights);
  const atkAlive = atk.length > 0;
  const defAlive = def.length > 0;

  if (!defAlive && !atkAlive) {
    state.status = "mutual";
  } else if (!defAlive) {
    const canHold = alive(state.attacker).some((u) => isLand(u.key) && u.key !== "aaGun");
    state.status = canHold ? "attacker_captured" : "attacker_cleared";
  } else if (!atkAlive) {
    state.status = "defender_won";
  } else {
    state.status = "ongoing";
  }
}

export interface BattleSummary {
  status: BattleStatus;
  rounds: number;
  attackerIpcLost: number;
  defenderIpcLost: number;
  attackerSurvivors: Stack;
  defenderSurvivors: Stack;
}

function survivorStack(units: BattleUnit[]): Stack {
  const s: Stack = {};
  for (const u of alive(units)) s[u.key] = (s[u.key] ?? 0) + 1;
  return s;
}

export function summarize(state: BattleState): BattleSummary {
  return {
    status: state.status,
    rounds: state.round,
    attackerIpcLost: state.startCost.attacker - stackValue(state.attacker),
    defenderIpcLost: state.startCost.defender - stackValue(state.defender),
    attackerSurvivors: survivorStack(state.attacker),
    defenderSurvivors: survivorStack(state.defender),
  };
}
