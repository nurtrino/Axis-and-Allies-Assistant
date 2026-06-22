/**
 * End-to-end verification of the turn-engine server actions against a real
 * Postgres (pglite). Stubs next/cache + next/navigation via tsconfig.verify.json
 * so the actual action code in src/app/actions.ts runs unmodified.
 *
 * Run:
 *   DATABASE_URL=... TSX_TSCONFIG_PATH=tsconfig.verify.json \
 *     npx tsx --tsconfig tsconfig.verify.json scripts/verify-turn.mts
 */
import { prisma } from "@/lib/db";
import * as A from "@/app/actions";
import { advance } from "@/lib/turn";

let passed = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`✗ ${label}` + (detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""));
    throw new Error("assertion failed: " + label);
  }
  passed++;
  console.log(`✓ ${label}`);
}

function fd(obj: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

async function treasury(campaignId: string, nation: string) {
  const s = await prisma.nationState.findUnique({ where: { campaignId_nation: { campaignId, nation } } });
  return s?.ipc ?? -1;
}

async function main() {
  // Clean slate.
  await prisma.campaign.deleteMany({ where: { name: "VERIFY_TURN" } });

  // Setup: a campaign + round 1, R&D off so turns start at Phase 2.
  const campaign = await prisma.campaign.create({
    data: { name: "VERIFY_TURN", side: "ALLIES", scenario: "Y1942", includeResearch: false },
  });
  const id = campaign.id;
  await prisma.round.create({ data: { campaignId: id, number: 1 } });

  // --- Seeding (ensureNationStates) -----------------------------------------
  await A.ensureNationStates(id);
  const states = await prisma.nationState.findMany({ where: { campaignId: id } });
  ok("seeds 7 nation states", states.length === 7, states.length);
  ok("USSR treasury seeded from Y1942 start income (24)", (await treasury(id, "USSR")) === 24);
  ok("GERMANY treasury seeded (40)", (await treasury(id, "GERMANY")) === 40);

  // --- Phase 2: Purchase ----------------------------------------------------
  // 3 infantry (3×3=9) + 1 tank (5) = 14 → 24-14 = 10.
  await A.purchaseUnits({ campaignId: id, nation: "USSR", units: [
    { unitType: "infantry", quantity: 3 },
    { unitType: "tank", quantity: 1 },
  ] });
  ok("purchase deducts IPC (24-14=10)", (await treasury(id, "USSR")) === 10);
  let pend = await prisma.pendingUnit.findMany({ where: { nationState: { campaignId: id, nation: "USSR" } } });
  ok("purchase creates 2 pending lines", pend.length === 2, pend.map((p) => `${p.unitType}:${p.quantity}`));

  // Overspend is rejected.
  let threw = false;
  try {
    await A.purchaseUnits({ campaignId: id, nation: "USSR", units: [{ unitType: "battleship", quantity: 1 }] }); // 20 > 10
  } catch { threw = true; }
  ok("overspend rejected", threw && (await treasury(id, "USSR")) === 10);

  // Undo: refund pending, treasury back to 24.
  await A.clearPendingPurchases({ campaignId: id, nation: "USSR" });
  ok("clear refunds to 24", (await treasury(id, "USSR")) === 24);
  pend = await prisma.pendingUnit.findMany({ where: { nationState: { campaignId: id, nation: "USSR" } } });
  ok("clear empties pending", pend.length === 0);

  // Re-buy 2 infantry (6) → 18, accumulate same type twice → quantity 4.
  await A.purchaseUnits({ campaignId: id, nation: "USSR", units: [{ unitType: "infantry", quantity: 2 }] });
  await A.purchaseUnits({ campaignId: id, nation: "USSR", units: [{ unitType: "infantry", quantity: 2 }] });
  ok("re-buy accumulates IPC (24-12=12)", (await treasury(id, "USSR")) === 12);
  pend = await prisma.pendingUnit.findMany({ where: { nationState: { campaignId: id, nation: "USSR" } } });
  ok("same-type purchases merge to one line ×4", pend.length === 1 && pend[0].quantity === 4, pend);

  // --- Phase 3: Combat Move -------------------------------------------------
  await A.declareCombatMove({
    campaignId: id, roundNumber: 1, attackerNation: "USSR", defenderNation: "GERMANY",
    territory: "Eastern Poland", territoryIpc: 3, units: { infantry: 5, tank: 2 }, amphibious: false,
  });
  const orders = await prisma.combatMoveOrder.findMany({ where: { campaignId: id } });
  ok("combat order created PENDING", orders.length === 1 && orders[0].status === "PENDING");
  const ou = orders[0].units as Record<string, number>;
  ok("combat order stores unit stack JSON", ou.infantry === 5 && ou.tank === 2, ou);

  // Mark resolved (mirrors battle-page completion).
  await A.markCombatResolved({ campaignId: id, orderId: orders[0].id, resultStatus: "attacker_captured" });
  const resolved = await prisma.combatMoveOrder.findUnique({ where: { id: orders[0].id } });
  ok("combat order flips to RESOLVED", resolved?.status === "RESOLVED" && resolved?.resultStatus === "attacker_captured");

  // --- Phase 5: Noncombat Move ----------------------------------------------
  await A.recordMovement({
    campaignId: id, roundNumber: 1, nation: "USSR",
    fromTerritory: "Russia", toTerritory: "Caucasus", units: { infantry: 2 },
  });
  const moves = await prisma.movement.findMany({ where: { campaignId: id } });
  ok("movement recorded", moves.length === 1 && moves[0].toTerritory === "Caucasus");

  // --- Phase 6: Mobilize ----------------------------------------------------
  await A.mobilizeUnits({ campaignId: id, nation: "USSR" });
  const stock = await prisma.unitStock.findMany({ where: { nationState: { campaignId: id, nation: "USSR" } } });
  ok("mobilize moves pending → stock (infantry ×4)", stock.length === 1 && stock[0].unitType === "infantry" && stock[0].quantity === 4, stock);
  pend = await prisma.pendingUnit.findMany({ where: { nationState: { campaignId: id, nation: "USSR" } } });
  ok("mobilize empties pending", pend.length === 0);

  // --- Phase 7: Collect Income ----------------------------------------------
  await A.collectIncome({ campaignId: id, nation: "USSR", roundNumber: 1, amount: 18 });
  ok("income adds to treasury (12+18=30)", (await treasury(id, "USSR")) === 30);
  const entry = await prisma.nationEntry.findFirst({ where: { round: { campaignId: id, number: 1 }, nation: "USSR" } });
  ok("income written to round ledger (18)", entry?.income === 18, entry?.income);

  // --- Phase advance & turn handoff -----------------------------------------
  // Pointer starts at USSR / phase 2 (R&D off).
  let c = await prisma.campaign.findUnique({ where: { id } });
  ok("pointer starts USSR / phase 2", c?.activePowerKey === "USSR" && c?.activePhase === 2, [c?.activePowerKey, c?.activePhase]);

  await A.advancePhase(fd({ campaignId: id }));
  c = await prisma.campaign.findUnique({ where: { id } });
  ok("advance 2 → 3", c?.activePhase === 3);

  // Jump to USSR phase 7, then advance → hands off to GERMANY phase 2.
  await A.goToPhase(fd({ campaignId: id, phase: "7" }));
  await A.advancePhase(fd({ campaignId: id }));
  c = await prisma.campaign.findUnique({ where: { id } });
  ok("end of USSR turn → GERMANY phase 2", c?.activePowerKey === "GERMANY" && c?.activePhase === 2, [c?.activePowerKey, c?.activePhase]);

  // Pure advance() agrees with the engine across a USA→wrap boundary.
  const wrap = advance("USA", 7, false);
  ok("advance() wraps USA → USSR + roundEnded", wrap.activePowerKey === "USSR" && wrap.roundEnded === true);

  // Real round creation on wrap: force USA / phase 7 then advance.
  await prisma.campaign.update({ where: { id }, data: { activePowerKey: "USA", activePhase: 7 } });
  await A.advancePhase(fd({ campaignId: id }));
  const rounds = await prisma.round.findMany({ where: { campaignId: id }, orderBy: { number: "asc" } });
  ok("wrap creates round 2", rounds.length === 2 && rounds[1].number === 2, rounds.map((r) => r.number));
  c = await prisma.campaign.findUnique({ where: { id } });
  ok("wrap resets pointer to USSR / phase 2", c?.activePowerKey === "USSR" && c?.activePhase === 2);
  const r2Income = await prisma.nationEntry.findFirst({ where: { round: { campaignId: id, number: 2 }, nation: "USSR" } });
  ok("round 2 carries USSR income forward (18)", r2Income?.income === 18, r2Income?.income);

  // --- Export → Import round-trip -------------------------------------------
  // Build the same shape the export route emits, then load it back.
  const full = await prisma.campaign.findUnique({
    where: { id },
    include: {
      players: { include: { assignments: true } },
      rounds: { include: { entries: { include: { losses: true, raids: true } } } },
      nationStates: { include: { stocks: true, pending: true } },
      combatMoves: true,
      movements: true,
    },
  });
  const newId = await A.importCampaign({ exportedFrom: "War Ledger", version: 2, campaign: full });
  ok("import returns a new campaign id", typeof newId === "string" && newId !== id);

  const imp = await prisma.campaign.findUnique({
    where: { id: newId },
    include: {
      players: { include: { assignments: true } },
      rounds: { include: { entries: { include: { losses: true, raids: true } } } },
      nationStates: { include: { stocks: true, pending: true } },
      combatMoves: true,
      movements: true,
    },
  });
  ok("import name is suffixed", imp?.name === "VERIFY_TURN (imported)", imp?.name);
  ok("import preserves turn pointer", imp?.activePowerKey === full?.activePowerKey && imp?.activePhase === full?.activePhase);
  ok("import restores all rounds", imp?.rounds.length === full?.rounds.length, [imp?.rounds.length, full?.rounds.length]);
  ok("import restores nation states", imp?.nationStates.length === 7);
  const impUssr = imp?.nationStates.find((s) => s.nation === "USSR");
  ok("import restores USSR treasury (30)", impUssr?.ipc === 30, impUssr?.ipc);
  ok("import restores USSR stock (infantry ×4)", impUssr?.stocks.length === 1 && impUssr?.stocks[0].quantity === 4, impUssr?.stocks);
  ok("import restores combat orders", imp?.combatMoves.length === full?.combatMoves.length && (imp?.combatMoves.length ?? 0) > 0);
  ok("import restores movements", imp?.movements.length === full?.movements.length && (imp?.movements.length ?? 0) > 0);
  const r2 = imp?.rounds.find((r) => r.number === 2);
  ok("import restores carried income (round 2 USSR = 18)", r2?.entries.find((e) => e.nation === "USSR")?.income === 18);

  // v1 (legacy) export with no live-state tables → import backfills treasuries.
  const legacyId = await A.importCampaign({ campaign: { name: "LEGACY", scenario: "Y1942", side: "ALLIES", rounds: [] } });
  const legacy = await prisma.campaign.findUnique({ where: { id: legacyId }, include: { nationStates: true } });
  ok("v1 import backfills 7 nation states", legacy?.nationStates.length === 7);
  ok("v1 import backfills GERMANY treasury (40)", legacy?.nationStates.find((s) => s.nation === "GERMANY")?.ipc === 40);

  // Cleanup.
  await prisma.campaign.deleteMany({ where: { id: { in: [id, newId, legacyId] } } });
  console.log(`\nAll ${passed} assertions passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
