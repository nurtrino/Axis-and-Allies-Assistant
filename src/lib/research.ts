/**
 * Research & Development (Anniversary Edition, Phase 1).
 *
 * Two breakthrough charts of six techs each. A power buys research dice at
 * 5 IPC apiece; each die that rolls a 6 earns a breakthrough — the player
 * picks a chart and rolls again to see which tech they receive (re-rolling
 * results they already own). Pure data + helpers here; dice and persistence
 * live in the server actions.
 */

export const RESEARCH_DIE_COST = 5;

export interface ResearchTech {
  key: string;
  name: string;
  chart: 1 | 2;
  face: number; // die face that awards it on its chart
  effect: string; // one-line reminder of the rule
}

export const RESEARCH_TECHS: ResearchTech[] = [
  // Chart 1 — Land & Production
  { key: "advancedArtillery", name: "Advanced Artillery", chart: 1, face: 1, effect: "Each artillery supports 2 infantry (both attack at 2)." },
  { key: "rockets", name: "Rockets", chart: 1, face: 2, effect: "AA guns may launch rocket strikes: 1d6 IPC damage to an enemy complex within 3 spaces." },
  { key: "paratroopers", name: "Paratroopers", chart: 1, face: 3, effect: "Bombers may carry 1 infantry into an attacked territory (max 2 per battle)." },
  { key: "increasedFactory", name: "Increased Factory Production", chart: 1, face: 4, effect: "Complexes produce +2 units over territory value; repairs cost half." },
  { key: "warBonds", name: "War Bonds", chart: 1, face: 5, effect: "Collect 1d6 extra IPC during Collect Income each turn." },
  { key: "mechanizedInfantry", name: "Mechanized Infantry", chart: 1, face: 6, effect: "Infantry paired 1:1 with tanks may move 2 spaces." },
  // Chart 2 — Air & Naval
  { key: "superSubs", name: "Super Submarines", chart: 2, face: 1, effect: "Submarines attack at 3 instead of 2." },
  { key: "jetFighters", name: "Jet Fighters", chart: 2, face: 2, effect: "Fighters defend at 5 instead of 4." },
  { key: "improvedShipyards", name: "Improved Shipyards", chart: 2, face: 3, effect: "Ships cost less: BB 17 · CV 12 · CA 9 · DD 7 · SS 5 · TP 6." },
  { key: "radar", name: "Radar", chart: 2, face: 4, effect: "AA guns hit on 1 or 2." },
  { key: "longRangeAircraft", name: "Long-Range Aircraft", chart: 2, face: 5, effect: "Fighters range 6, bombers range 8." },
  { key: "heavyBombers", name: "Heavy Bombers", chart: 2, face: 6, effect: "Bombers roll 2 dice each when attacking or bombing." },
];

export const TECHS_BY_KEY: Record<string, ResearchTech> = Object.fromEntries(
  RESEARCH_TECHS.map((t) => [t.key, t]),
);

export const CHART_NAMES: Record<1 | 2, string> = {
  1: "Land & Production",
  2: "Air & Naval",
};

/** Techs on a chart, in die-face order. */
export function chartTechs(chart: 1 | 2): ResearchTech[] {
  return RESEARCH_TECHS.filter((t) => t.chart === chart).sort((a, b) => a.face - b.face);
}
