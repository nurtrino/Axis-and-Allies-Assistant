/**
 * Pure helpers for the 3D battle simulator (no React/three imports here so it
 * stays testable). Maps Anniversary unit types to a battlefield domain and a
 * placeholder visual spec, and lays units out in opposing formations.
 *
 * The placeholder specs are intentionally swappable: when real glTF models are
 * sourced, the model registry replaces `shape` per unit type — positions,
 * domain detection, and the firing/destruction loop stay identical.
 */
import { UNITS_BY_KEY } from "./anniversary.config";

export type Domain = "land" | "sea";
export type Side = "attacker" | "defender";
// All surface ships share one "warship" model; the carrier and submarine are
// the only distinct hulls.
export type Shape = "warship" | "carrier" | "sub" | "tank" | "infantry" | "artillery" | "plane" | "structure";

export interface SimUnit {
  id: string;
  type: string; // anniversary unit key
  side: Side;
}

export interface UnitVisual {
  shape: Shape; // fallback placeholder when no model is present
  /** approximate footprint length in world units, for spacing */
  size: number;
  /** true for aircraft — they hover above the field */
  air?: boolean;
  /** glTF model basename in /assets/sim/models/<model>.glb (omit for placeholder) */
  model?: string;
  /** desired longest horizontal dimension in world units (auto-scales the model) */
  target?: number;
}

export const UNIT_VISUAL: Record<string, UnitVisual> = {
  // Every surface ship uses the same warship hull; carrier & sub are distinct.
  battleship: { shape: "warship", size: 6, model: "warship", target: 7 },
  cruiser: { shape: "warship", size: 5, model: "warship", target: 5.5 },
  destroyer: { shape: "warship", size: 4.5, model: "warship", target: 5 },
  transport: { shape: "warship", size: 5, model: "warship", target: 5.5 },
  carrier: { shape: "carrier", size: 8, model: "carrier", target: 9 },
  submarine: { shape: "sub", size: 4, model: "submarine", target: 5 },
  fighter: { shape: "plane", size: 3, air: true, model: "fighter", target: 3.5 },
  bomber: { shape: "plane", size: 4, air: true, model: "bomber", target: 5 },
  infantry: { shape: "infantry", size: 1.2, model: "infantry", target: 1.8 },
  artillery: { shape: "artillery", size: 2, model: "artillery", target: 2.4 },
  tank: { shape: "tank", size: 2.2, model: "tank", target: 2.8 },
  aaGun: { shape: "artillery", size: 2, model: "artillery", target: 2.2 },
  factory: { shape: "structure", size: 2.5 },
};

/** All glTF model basenames used, for preloading. */
export const MODEL_FILES = Array.from(
  new Set(Object.values(UNIT_VISUAL).map((v) => v.model).filter((m): m is string => !!m)),
);

export function visualFor(type: string): UnitVisual {
  return UNIT_VISUAL[type] ?? { shape: "infantry", size: 1 };
}

/** Domain of a single unit type. */
export function typeDomain(type: string): "land" | "air" | "sea" | "structure" {
  return UNITS_BY_KEY[type]?.domain ?? "land";
}

/**
 * Decide whether a battle is fought at sea or on land from the units involved.
 * Sea if naval units are present and there are no land units; otherwise land
 * (aircraft can appear in either and don't decide it).
 */
export function detectDomain(types: string[]): Domain {
  let hasSea = false;
  let hasLand = false;
  for (const t of types) {
    const d = typeDomain(t);
    if (d === "sea") hasSea = true;
    if (d === "land" || d === "structure") hasLand = true;
  }
  return hasSea && !hasLand ? "sea" : "land";
}

/** Expand stacks ({ type: count }) into individual placeable units. */
export function expandStack(stack: Record<string, number>, side: Side): SimUnit[] {
  const out: SimUnit[] = [];
  for (const [type, n] of Object.entries(stack)) {
    for (let i = 0; i < n; i++) out.push({ id: `${side}-${type}-${i}`, type, side });
  }
  return out;
}

export interface Placement {
  unit: SimUnit;
  x: number;
  z: number;
  /** facing the enemy line (radians around Y) */
  rotationY: number;
}

/**
 * Lay a side's units out in tidy rows facing the opponent. Attackers occupy
 * negative Z, defenders positive Z, lines facing each other across Z=0.
 */
export function formation(units: SimUnit[], side: Side): Placement[] {
  const dir = side === "attacker" ? -1 : 1;
  const perRow = Math.max(4, Math.ceil(Math.sqrt(units.length) * 1.6));
  const spacingX = 4;
  const spacingZ = 5;
  const baseZ = dir * 12;
  return units.map((unit, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = Math.min(perRow, units.length - row * perRow);
    const x = (col - (rowCount - 1) / 2) * spacingX;
    const z = baseZ + dir * row * spacingZ;
    return { unit, x, z, rotationY: side === "attacker" ? 0 : Math.PI };
  });
}
