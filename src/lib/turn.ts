/**
 * Turn engine for the per-player phase portal.
 *
 * A "round" is one full pass through the powers in turn order; each power takes
 * a 7-phase turn. China is not a turn of its own — it folds into the USA turn.
 * The campaign stores the live pointer as `activePowerKey` + `activePhase`.
 *
 * This module is pure (no DB) so it can be unit-tested and used on client and
 * server alike. Mutations live in src/app/actions.ts.
 */

import { ASSIGNABLE_POWERS } from "./players";

/** Turn order: the six powers that take an independent turn, in sequence. */
export const TURN_ORDER: string[] = ASSIGNABLE_POWERS.map((p) => p.key);

export interface Phase {
  n: number;
  key: string;
  name: string;
  short: string;
  /** R&D is optional — skipped unless the campaign enables research. */
  optional?: boolean;
  /** Whether this phase has a working entry UI yet (vs. a placeholder). */
  implemented: boolean;
}

export const PHASES: Phase[] = [
  { n: 1, key: "research", name: "Research & Development", short: "R&D", optional: true, implemented: false },
  { n: 2, key: "purchase", name: "Purchase Units", short: "Purchase", implemented: true },
  { n: 3, key: "combatMove", name: "Combat Move", short: "Combat Move", implemented: true },
  { n: 4, key: "combat", name: "Conduct Combat", short: "Conduct Combat", implemented: true },
  { n: 5, key: "noncombatMove", name: "Noncombat Move", short: "Noncombat", implemented: true },
  { n: 6, key: "mobilize", name: "Mobilize New Units", short: "Mobilize", implemented: true },
  { n: 7, key: "income", name: "Collect Income", short: "Income", implemented: true },
];

export const PHASE_BY_N: Record<number, Phase> = Object.fromEntries(
  PHASES.map((p) => [p.n, p]),
);

export const FIRST_PHASE = 2; // start on Purchase (R&D is opt-in / skipped)
export const LAST_PHASE = 7;

/** Is a phase active for this campaign? R&D is hidden unless research is on. */
export function isPhaseEnabled(phase: Phase, includeResearch: boolean): boolean {
  if (phase.optional && phase.key === "research") return includeResearch;
  return true;
}

/** The starting phase for a turn, honoring the research toggle. */
export function startPhase(includeResearch: boolean): number {
  return includeResearch ? 1 : FIRST_PHASE;
}

/** Index of a power within the turn order (−1 if not found). */
export function turnIndex(powerKey: string): number {
  return TURN_ORDER.indexOf(powerKey);
}

/** The power whose turn follows `powerKey`, wrapping back to the first. */
export function nextPower(powerKey: string): { power: string; wrapped: boolean } {
  const i = turnIndex(powerKey);
  const next = (i + 1) % TURN_ORDER.length;
  return { power: TURN_ORDER[next] ?? TURN_ORDER[0], wrapped: next === 0 };
}

export interface AdvanceResult {
  activePowerKey: string;
  activePhase: number;
  /** True when the turn handed off to a new power. */
  turnEnded: boolean;
  /** True when the new power wraps to the top of the order (→ new round). */
  roundEnded: boolean;
}

/**
 * Compute the next pointer position from the current one. Walking off the last
 * phase hands the turn to the next power, starting them at their first phase.
 */
export function advance(
  activePowerKey: string,
  activePhase: number,
  includeResearch: boolean,
): AdvanceResult {
  if (activePhase < LAST_PHASE) {
    let next = activePhase + 1;
    // Skip R&D should it ever be the "next" phase with research disabled.
    if (next === 1 && !includeResearch) next = FIRST_PHASE;
    return { activePowerKey, activePhase: next, turnEnded: false, roundEnded: false };
  }
  // End of this power's turn → hand off.
  const { power, wrapped } = nextPower(activePowerKey);
  return {
    activePowerKey: power,
    activePhase: startPhase(includeResearch),
    turnEnded: true,
    roundEnded: wrapped,
  };
}
