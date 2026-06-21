import { POWERS, POWERS_BY_KEY, type Coalition } from "./anniversary.config";

/** The six independently controllable powers (China is not assignable). */
export const ASSIGNABLE_POWERS = POWERS.filter((p) => !p.minor);

/**
 * Resolve the full set of power keys a player controls, applying the rule that
 * China is controlled by whoever holds the USA.
 */
export function resolvePowerKeys(assignedKeys: string[]): string[] {
  const keys = [...assignedKeys];
  if (keys.includes("USA") && !keys.includes("CHINA")) keys.push("CHINA");
  return keys;
}

/** A player's coalition, derived from their first assigned power. */
export function coalitionForPowers(keys: string[]): Coalition {
  for (const k of keys) {
    const c = POWERS_BY_KEY[k]?.coalition;
    if (c) return c;
  }
  return "ALLIES";
}

export interface ResolvedPlayer {
  id: string;
  name: string;
  powerKeys: string[]; // includes CHINA when USA is held
  coalition: Coalition;
}

/** Shape coming back from a Prisma query: players with their assignments. */
interface RawPlayer {
  id: string;
  name: string;
  sortOrder: number;
  assignments: { powerKey: string }[];
}

export function resolvePlayers(players: RawPlayer[]): ResolvedPlayer[] {
  return [...players]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => {
      const powerKeys = resolvePowerKeys(p.assignments.map((a) => a.powerKey));
      return {
        id: p.id,
        name: p.name,
        powerKeys,
        coalition: coalitionForPowers(powerKeys),
      };
    });
}
