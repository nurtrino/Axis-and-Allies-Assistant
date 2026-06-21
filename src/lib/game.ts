import {
  POWERS,
  POWERS_BY_KEY,
  UNITS_BY_KEY,
  type Coalition,
} from "./anniversary.config";

/** IPC value of a single loss line (unit cost × quantity). */
export function lossValue(unitType: string, quantity: number): number {
  const unit = UNITS_BY_KEY[unitType];
  if (!unit) return 0;
  return unit.cost * quantity;
}

/** Total IPC value of a set of loss lines. */
export function totalLossValue(
  losses: { unitType: string; quantity: number }[],
): number {
  return losses.reduce((sum, l) => sum + lossValue(l.unitType, l.quantity), 0);
}

/**
 * Attack power of a unit inventory, accounting for the artillery–infantry
 * bonus: each artillery raises one infantry's attack from 1 to 2.
 * `inventory` maps unit keys to counts (units the player is attacking with).
 */
export function attackPower(inventory: Record<string, number>): number {
  let power = 0;
  const infantry = inventory["infantry"] ?? 0;
  const artillery = inventory["artillery"] ?? 0;
  const boostedInfantry = Math.min(infantry, artillery);

  for (const [key, count] of Object.entries(inventory)) {
    if (!count) continue;
    const unit = UNITS_BY_KEY[key];
    if (!unit) continue;
    if (key === "infantry") {
      power += boostedInfantry * 2 + (infantry - boostedInfantry) * 1;
    } else {
      power += unit.attack * count;
    }
  }
  return power;
}

export function coalitionOf(nation: string): Coalition | undefined {
  return POWERS_BY_KEY[nation]?.coalition;
}

export const POWERS_OF = (coalition: Coalition) =>
  POWERS.filter((p) => p.coalition === coalition);

/** Sum a numeric field across all nation entries belonging to a coalition. */
export function sumByCoalition<T extends { nation: string }>(
  entries: T[],
  coalition: Coalition,
  field: (e: T) => number,
): number {
  return entries
    .filter((e) => coalitionOf(e.nation) === coalition)
    .reduce((sum, e) => sum + field(e), 0);
}

export const opposite = (c: Coalition): Coalition =>
  c === "AXIS" ? "ALLIES" : "AXIS";
