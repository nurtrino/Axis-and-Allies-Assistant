/* Engine self-test: plays the interactive battle engine with random dice and
 * checks it (a) always terminates with a valid status and (b) produces capture
 * rates close to the independent Monte-Carlo runPlanner. Run: npx tsx scripts/battle-test.ts */
import { createBattle, peek, resolveRoll, chooseRetreat, summarize, type Stack } from "../src/lib/battle";
import { runPlanner } from "../src/lib/combat";

function playRandom(atk: Stack, def: Stack, ctx?: { amphibious?: boolean }) {
  let s = createBattle(atk, def, ctx);
  let guard = 0;
  while (s.status === "ongoing" && guard++ < 2000) {
    const step = peek(s);
    if (!step) break;
    if (step.decision === "retreat") { s = chooseRetreat(s, false); continue; }
    const values = step.dice.map(() => 1 + Math.floor(Math.random() * 6));
    s = resolveRoll(s, values);
  }
  return { summary: summarize(s), guard, status: s.status };
}

function pct(atk: Stack, def: Stack, runs: number, ctx?: { amphibious?: boolean }) {
  let took = 0, hang = 0;
  const statuses: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const r = playRandom(atk, def, ctx);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    if (r.status === "attacker_captured" || r.status === "attacker_cleared") took++;
    if (r.guard >= 2000) hang++;
  }
  return { takePct: (took / runs) * 100, hang, statuses };
}

const cases: { name: string; atk: Stack; def: Stack; ctx?: { amphibious?: boolean } }[] = [
  { name: "3 inf+2 art+1 tank vs 2 inf+1 tank", atk: { infantry: 3, artillery: 2, tank: 1 }, def: { infantry: 2, tank: 1 } },
  { name: "10 inf vs 8 inf", atk: { infantry: 10 }, def: { infantry: 8 } },
  { name: "armor vs infantry", atk: { tank: 6 }, def: { infantry: 6 } },
  { name: "air+armor vs inf+aa", atk: { tank: 3, fighter: 2, bomber: 1 }, def: { infantry: 5, aaGun: 1 } },
  { name: "naval: 2BB 1cruiser 2destroyer vs 3 sub 1 destroyer", atk: { battleship: 2, cruiser: 1, destroyer: 2 }, def: { submarine: 3, destroyer: 1 } },
  { name: "naval subs no destroyer (surprise)", atk: { submarine: 4 }, def: { destroyer: 2, cruiser: 1 } },
  { name: "amphibious: 4 inf + 2BB bombard vs 3 inf", atk: { infantry: 4, battleship: 2 }, def: { infantry: 3 }, ctx: { amphibious: true } },
];

let ok = true;
for (const c of cases) {
  const mine = pct(c.atk, c.def, 6000, c.ctx);
  const mc = runPlanner(c.atk, c.def, { runs: 8000 });
  const diff = Math.abs(mine.takePct - mc.attackerTakePct);
  const flag = mine.hang > 0 ? " ⚠ HANG" : diff > 6 ? " ⚠ DIVERGE" : " ✓";
  if (mine.hang > 0 || diff > 6) ok = false;
  console.log(
    `${c.name}\n   engine take ${mine.takePct.toFixed(1)}%  vs MC ${mc.attackerTakePct.toFixed(1)}%  (Δ${diff.toFixed(1)})  hangs=${mine.hang}${flag}`,
  );
  console.log("   statuses:", JSON.stringify(mine.statuses));
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
