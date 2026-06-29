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
  /** desired largest dimension in world units (auto-scales the model) */
  target?: number;
  /** optional material color override (e.g. force the submarine black) */
  color?: string;
  /** extra yaw (radians) to make the model face the enemy (forward = +Z) */
  yaw?: number;
  /** auto-rotate the long horizontal axis onto Z (default true; off for planes) */
  autoOrient?: boolean;
  /** render both faces (needed for thin one-sided surfaces like the carrier deck) */
  doubleSide?: boolean;
  /** uniformly darken the model's textures (0..1, multiplies base color) */
  dim?: number;
  /** vertical offset in world units (negative sits the unit lower, e.g. a sub) */
  yOffset?: number;
  /** model ships a "death" animation clip — play it on kill instead of the
   *  collapse/burn wreck treatment (e.g. the rigged soldier) */
  animatedDeath?: boolean;
}

export const UNIT_VISUAL: Record<string, UnitVisual> = {
  // Every surface ship uses the same warship hull; carrier & sub are distinct.
  battleship: { shape: "warship", size: 15, model: "warship", target: 16, yaw: Math.PI, yOffset: -0.3 },
  cruiser: { shape: "warship", size: 11, model: "cruiser", target: 13, yaw: 0, yOffset: -0.25 },
  destroyer: { shape: "warship", size: 10, model: "destroyer", target: 11, yaw: 0, yOffset: -0.2 },
  transport: { shape: "warship", size: 11, model: "warship", target: 12, yaw: Math.PI, yOffset: -0.25 },
  carrier: { shape: "carrier", size: 20, model: "carrier", target: 22, yaw: Math.PI, doubleSide: true, dim: 0.6, yOffset: -0.9 },
  submarine: { shape: "sub", size: 8, model: "submarine", target: 8, color: "#141414", yaw: Math.PI, yOffset: -1.2 },
  fighter: { shape: "plane", size: 6, air: true, model: "fighter", target: 6.5, autoOrient: false, yaw: 0 },
  bomber: { shape: "plane", size: 8, air: true, model: "bomber", target: 9, autoOrient: false, yaw: 0 },
  // Fully textured, rigged Wehrmacht soldier with a Mixamo idle animation.
  // autoOrient off so the standing figure isn't rotated onto its side by its
  // shoulder width; yaw faces it down the attack axis.
  infantry: { shape: "infantry", size: 2, model: "infantry", target: 2.6, yaw: 0, autoOrient: false, animatedDeath: true },
  artillery: { shape: "artillery", size: 7, model: "artillery", target: 6, yaw: Math.PI },
  tank: { shape: "tank", size: 8, model: "tank", target: 8 },
  aaGun: { shape: "artillery", size: 7, model: "artillery", target: 5.5, yaw: Math.PI },
  factory: { shape: "structure", size: 4 },
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

/** Firing sound (file in /sounds/<name>.mp3) for a unit type. */
export function fireSoundFor(type: string): string {
  const d = typeDomain(type);
  if (d === "sea") return "naval-fire";
  if (d === "air") return "plane-fire";
  if (type === "tank") return "tank-fire";
  if (type === "artillery" || type === "aaGun") return "artillery-fire";
  return "infantry-fire";
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
  const perRow = Math.max(3, Math.ceil(Math.sqrt(units.length) * 1.3));
  // Spacing adapts to the largest unit present so big ships don't overlap while
  // small land units stay compact.
  const maxSize = Math.max(
    4,
    ...units.map((u) => visualFor(u.type).target ?? visualFor(u.type).size),
  );
  const spacingX = maxSize * 0.95;
  const spacingZ = maxSize * 1.1;
  // Closer to the enemy line (smaller gap between the two fleets).
  const baseZ = dir * (maxSize * 0.55 + 5);
  return units.map((unit, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = Math.min(perRow, units.length - row * perRow);
    const x = (col - (rowCount - 1) / 2) * spacingX;
    const z = baseZ + dir * row * spacingZ;
    return { unit, x, z, rotationY: side === "attacker" ? 0 : Math.PI };
  });
}
