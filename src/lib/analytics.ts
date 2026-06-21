import { type Coalition } from "./anniversary.config";
import { coalitionOf, opposite, totalLossValue } from "./game";

// Shapes mirror the Prisma query includes used by the War Room page.
export interface LossRow {
  unitType: string;
  quantity: number;
}
export interface RaidRow {
  bombers: number;
  damage: number;
  bombersLost: number;
}
export interface EntryRow {
  nation: string;
  income: number;
  objectiveBonus: number;
  purchases: number;
  ipcRemaining: number;
  attackPower: number;
  ipcLost: number; // FAST mode flat loss; additive with itemized losses
  losses: LossRow[];
  raids: RaidRow[];
}
export interface RoundRow {
  number: number;
  notes: string | null;
  tcEuropeOwned: number | null;
  tcEuropeTotal: number | null;
  tcAsiaOwned: number | null;
  tcAsiaTotal: number | null;
  tcAmericasOwned: number | null;
  tcAmericasTotal: number | null;
  vcAxis: number | null;
  vcAllies: number | null;
  entries: EntryRow[];
}

export interface RoundMetrics {
  number: number;
  notes: string | null;
  friendlyIncome: number;
  enemyIncome: number;
  incomeAdv: number;
  cumIncomeAdv: number;
  friendlyLoss: number;
  enemyLoss: number;
  attritionAdv: number; // enemy IPC destroyed minus own losses (positive = good)
  cumAttritionAdv: number;
  friendlyAP: number;
  enemyAP: number;
  apAdv: number;
  netAdv: number; // incomeAdv + attritionAdv
  vcFriendly: number | null;
  vcEnemy: number | null;
  vcDelta: number | null;
}

function sideIncome(entries: EntryRow[], side: Coalition): number {
  return entries
    .filter((e) => coalitionOf(e.nation) === side)
    .reduce((s, e) => s + e.income + e.objectiveBonus, 0);
}
function sideLoss(entries: EntryRow[], side: Coalition): number {
  return entries
    .filter((e) => coalitionOf(e.nation) === side)
    .reduce((s, e) => s + totalLossValue(e.losses) + e.ipcLost, 0);
}
function sideAP(entries: EntryRow[], side: Coalition): number {
  return entries
    .filter((e) => coalitionOf(e.nation) === side)
    .reduce((s, e) => s + e.attackPower, 0);
}

/** Victory cities held by the friendly side, from a round's board snapshot. */
function friendlyVC(round: RoundRow, friendly: Coalition): number | null {
  const v = friendly === "AXIS" ? round.vcAxis : round.vcAllies;
  return v ?? null;
}

export interface NationTotal {
  nation: string;
  lossIpc: number;
}

/** Cumulative IPC value of units lost, per nation, across the whole campaign. */
export function lossesByNation(rounds: RoundRow[]): NationTotal[] {
  const totals = new Map<string, number>();
  for (const r of rounds) {
    for (const e of r.entries) {
      totals.set(
        e.nation,
        (totals.get(e.nation) ?? 0) + totalLossValue(e.losses) + e.ipcLost,
      );
    }
  }
  return [...totals.entries()].map(([nation, lossIpc]) => ({ nation, lossIpc }));
}

export function computeRounds(
  rounds: RoundRow[],
  playerSide: Coalition,
): RoundMetrics[] {
  const enemy = opposite(playerSide);
  let cumIncome = 0;
  let cumAttrition = 0;
  let prevVC: number | null = null;

  return [...rounds]
    .sort((a, b) => a.number - b.number)
    .map((r) => {
      const friendlyIncome = sideIncome(r.entries, playerSide);
      const enemyIncome = sideIncome(r.entries, enemy);
      const incomeAdv = friendlyIncome - enemyIncome;
      cumIncome += incomeAdv;

      const friendlyLoss = sideLoss(r.entries, playerSide);
      const enemyLoss = sideLoss(r.entries, enemy);
      const attritionAdv = enemyLoss - friendlyLoss;
      cumAttrition += attritionAdv;

      const friendlyAP = sideAP(r.entries, playerSide);
      const enemyAP = sideAP(r.entries, enemy);

      const vcFriendly = friendlyVC(r, playerSide);
      const vcEnemy = friendlyVC(r, enemy);
      const vcDelta =
        vcFriendly != null && prevVC != null ? vcFriendly - prevVC : null;
      if (vcFriendly != null) prevVC = vcFriendly;

      return {
        number: r.number,
        notes: r.notes,
        friendlyIncome,
        enemyIncome,
        incomeAdv,
        cumIncomeAdv: cumIncome,
        friendlyLoss,
        enemyLoss,
        attritionAdv,
        cumAttritionAdv: cumAttrition,
        friendlyAP,
        enemyAP,
        apAdv: friendlyAP - enemyAP,
        netAdv: incomeAdv + attritionAdv,
        vcFriendly,
        vcEnemy,
        vcDelta,
      };
    });
}
