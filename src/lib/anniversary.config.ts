/**
 * Axis & Allies: Anniversary Edition (50th) — game data.
 *
 * Every game-specific value lives here. To support another edition later,
 * add a sibling config with the same shape. Sourced from the Anniversary
 * Edition rulebook unit profiles and Order of Play.
 */

export type Coalition = "AXIS" | "ALLIES";
export type Scenario = "Y1941" | "Y1942";
export type TrackingMode = "FAST" | "DETAILED";

export interface Power {
  key: string;
  name: string;
  coalition: Coalition;
  color: string; // accent color used in the UI
  flag: string; // /flags/<file>.svg
  /** China is controlled by the USA player and is not a self-standing power. */
  minor?: boolean;
}

export interface UnitProfile {
  key: string;
  name: string;
  cost: number;
  attack: number; // base attack value (infantry gains +1 when supported by artillery)
  defense: number;
  move: number;
  hits: number; // battleships absorb 2 hits
  domain: "land" | "air" | "sea" | "structure";
}

// ── Powers (turn order). Anniversary adds Italy; China is US-controlled. ──
export const POWERS: Power[] = [
  { key: "USSR", name: "Soviet Union", coalition: "ALLIES", color: "#c0392b", flag: "/flags/russia.svg" },
  { key: "GERMANY", name: "Germany", coalition: "AXIS", color: "#4a4a4a", flag: "/flags/germany.svg" },
  { key: "UK", name: "United Kingdom", coalition: "ALLIES", color: "#b5894e", flag: "/flags/uk.svg" },
  { key: "ITALY", name: "Italy", coalition: "AXIS", color: "#3c8d5c", flag: "/flags/italy.svg" },
  { key: "JAPAN", name: "Japan", coalition: "AXIS", color: "#d4a017", flag: "/flags/japan.svg" },
  { key: "USA", name: "United States", coalition: "ALLIES", color: "#2e7d32", flag: "/flags/us.svg" },
  { key: "CHINA", name: "China", coalition: "ALLIES", color: "#7d6608", flag: "/flags/china.svg", minor: true },
];

export const POWERS_BY_KEY: Record<string, Power> = Object.fromEntries(
  POWERS.map((p) => [p.key, p]),
);

// ── Unit profiles (cost / attack / defense / move / hits). ──
// Values from the Anniversary Edition rulebook "Unit Profiles" section.
export const UNITS: UnitProfile[] = [
  { key: "infantry", name: "Infantry", cost: 3, attack: 1, defense: 2, move: 1, hits: 1, domain: "land" },
  { key: "artillery", name: "Artillery", cost: 4, attack: 2, defense: 2, move: 1, hits: 1, domain: "land" },
  { key: "tank", name: "Tank", cost: 5, attack: 3, defense: 3, move: 2, hits: 1, domain: "land" },
  { key: "aaGun", name: "AA Gun", cost: 6, attack: 0, defense: 1, move: 1, hits: 1, domain: "land" },
  { key: "factory", name: "Industrial Complex", cost: 15, attack: 0, defense: 0, move: 0, hits: 1, domain: "structure" },
  { key: "fighter", name: "Fighter", cost: 10, attack: 3, defense: 4, move: 4, hits: 1, domain: "air" },
  { key: "bomber", name: "Bomber", cost: 12, attack: 4, defense: 1, move: 6, hits: 1, domain: "air" },
  { key: "battleship", name: "Battleship", cost: 20, attack: 4, defense: 4, move: 2, hits: 2, domain: "sea" },
  { key: "carrier", name: "Aircraft Carrier", cost: 14, attack: 1, defense: 2, move: 2, hits: 1, domain: "sea" },
  { key: "cruiser", name: "Cruiser", cost: 12, attack: 3, defense: 3, move: 2, hits: 1, domain: "sea" },
  { key: "destroyer", name: "Destroyer", cost: 8, attack: 2, defense: 2, move: 2, hits: 1, domain: "sea" },
  { key: "submarine", name: "Submarine", cost: 6, attack: 2, defense: 1, move: 2, hits: 1, domain: "sea" },
  { key: "transport", name: "Transport", cost: 7, attack: 0, defense: 0, move: 2, hits: 1, domain: "sea" },
];

export const UNITS_BY_KEY: Record<string, UnitProfile> = Object.fromEntries(
  UNITS.map((u) => [u.key, u]),
);

// ── Victory conditions. 18 VC tokens total; standard win at 15. ──
export const VICTORY_CITY_GOALS = [
  { value: 13, label: "13 — Short Game" },
  { value: 15, label: "15 — Standard" },
  { value: 18, label: "18 — Total Victory" },
];
export const TOTAL_VICTORY_CITIES = 18;

export const SCENARIOS: { value: Scenario; label: string; blurb: string }[] = [
  { value: "Y1941", label: "1941 — Operation Barbarossa", blurb: "Axis attack; Pearl Harbor + invasion of Russia." },
  { value: "Y1942", label: "1942 — Axis High-Water Mark", blurb: "Traditional start; Axis at peak expansion." },
];

export const TRACKING_MODES: { value: TrackingMode; label: string; blurb: string }[] = [
  { value: "FAST", label: "Fast", blurb: "Log essential stats per nation in seconds." },
  { value: "DETAILED", label: "Detailed", blurb: "Track unit-level losses and inventory for deeper analytics." },
];

// Region groupings for the territory-control SITREP panel.
export const REGIONS = ["Europe & Africa", "Asia & Pacific", "Americas"] as const;

// The two Research & Development "Breakthrough" reference columns printed on the
// physical National Production/R&D Chart (each tech selected by a d6 roll).
export const BREAKTHROUGHS = {
  chart1: [
    "Advanced Artillery",
    "Rockets",
    "Paratroopers",
    "Increased Factory Production",
    "War Bonds",
    "Mechanized Infantry",
  ],
  chart2: [
    "Super Submarines",
    "Jet Fighters",
    "Improved Shipyards",
    "Radar",
    "Long-Range Aircraft",
    "Heavy Bombers",
  ],
};

// The income/production track on the physical chart runs 1–72.
export const PRODUCTION_TRACK_MAX = 72;

// Starting IPC income (national production) per power at scenario setup.
// Source: Anniversary Edition national setup charts (community-confirmed totals;
// China collects no IPCs in Anniversary — Chinese units are placed, not bought).
// These seed Round 1 on campaign creation and are user-editable thereafter.
export const SCENARIO_START_INCOME: Record<string, Record<string, number>> = {
  Y1942: { USSR: 24, GERMANY: 40, UK: 32, ITALY: 10, JAPAN: 30, USA: 38, CHINA: 0 },
  Y1941: { USSR: 30, GERMANY: 31, UK: 43, ITALY: 10, JAPAN: 17, USA: 40, CHINA: 0 },
};
