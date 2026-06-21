"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { POWERS, SCENARIO_START_INCOME, UNITS_BY_KEY } from "@/lib/anniversary.config";
import { advance, startPhase } from "@/lib/turn";

export interface IncomeEntryInput {
  nation: string;
  income: number;
}

/**
 * Set each nation's income for a round, from the Production tool. Only touches
 * income — other fields (losses, attack power, etc.) are preserved.
 */
export async function saveRoundIncome(input: {
  campaignId: string;
  number: number;
  entries: IncomeEntryInput[];
}) {
  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: input.campaignId, number: input.number } },
  });
  if (!round) throw new Error("Round not found.");

  for (const e of input.entries) {
    await prisma.nationEntry.upsert({
      where: { roundId_nation: { roundId: round.id, nation: e.nation } },
      create: { roundId: round.id, nation: e.nation, income: e.income },
      update: { income: e.income },
    });
  }

  await prisma.campaign.update({ where: { id: input.campaignId }, data: {} });
  revalidatePath(`/campaigns/${input.campaignId}/production`);
  revalidatePath(`/campaigns/${input.campaignId}`);
}

/** Create empty nation entries for every power in a round. */
async function seedEntries(roundId: string) {
  await prisma.nationEntry.createMany({
    data: POWERS.map((p) => ({ roundId, nation: p.key })),
  });
}

/** Seed a round's entries pre-filled with the scenario's starting IPC income. */
async function seedEntriesWithStartIncome(roundId: string, scenario: string) {
  const start = SCENARIO_START_INCOME[scenario] ?? {};
  await prisma.nationEntry.createMany({
    data: POWERS.map((p) => ({ roundId, nation: p.key, income: start[p.key] ?? 0 })),
  });
}

/**
 * Seed the live NationState rows for a campaign. Each nation's treasury starts
 * at its scenario starting IPC — the cash it has on hand to spend on turn 1.
 * Idempotent: skips nations that already have a state row.
 */
async function seedNationStates(campaignId: string, scenario: string) {
  const start = SCENARIO_START_INCOME[scenario] ?? {};
  const existing = await prisma.nationState.findMany({
    where: { campaignId },
    select: { nation: true },
  });
  const have = new Set(existing.map((s) => s.nation));
  const missing = POWERS.filter((p) => !have.has(p.key));
  if (missing.length) {
    await prisma.nationState.createMany({
      data: missing.map((p) => ({ campaignId, nation: p.key, ipc: start[p.key] ?? 0 })),
    });
  }
}

/**
 * Ensure a campaign has its live NationState rows (lazy backfill for campaigns
 * created before the turn engine existed). Returns the states for the campaign.
 */
export async function ensureNationStates(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { scenario: true },
  });
  if (!campaign) throw new Error("Campaign not found.");
  await seedNationStates(campaignId, campaign.scenario);
}

export async function createCampaign(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Untitled Campaign";
  const opponent = String(formData.get("opponent") ?? "").trim() || null;
  const side = String(formData.get("side") ?? "ALLIES");
  const scenario = String(formData.get("scenario") ?? "Y1942");
  const trackingMode = String(formData.get("trackingMode") ?? "DETAILED");
  const victoryCityGoal = Number(formData.get("victoryCityGoal") ?? 15);

  const campaign = await prisma.campaign.create({
    data: { name, opponent, side, scenario, trackingMode, victoryCityGoal },
  });
  const round = await prisma.round.create({
    data: { campaignId: campaign.id, number: 1 },
  });
  await seedEntriesWithStartIncome(round.id, scenario);
  await seedNationStates(campaign.id, scenario);

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export interface NewCampaignPlayer {
  name: string;
  powers: string[]; // assignable power keys (China auto-rides with USA)
}
export interface CreateCampaignInput {
  name: string;
  scenario: string;
  trackingMode: string;
  victoryCityGoal: number;
  includeResearch: boolean;
  players: NewCampaignPlayer[];
}

export async function createCampaignWithPlayers(input: CreateCampaignInput) {
  const players = input.players
    .map((p) => ({ name: p.name.trim(), powers: p.powers }))
    .filter((p) => p.name.length > 0);
  if (players.length === 0) throw new Error("At least one player is required.");

  // Default perspective: coalition of the first power assigned to player 1.
  const firstPower = players.find((p) => p.powers.length > 0)?.powers[0];
  const side = firstPower
    ? (POWERS.find((p) => p.key === firstPower)?.coalition ?? "ALLIES")
    : "ALLIES";

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name.trim() || "Untitled Campaign",
      side,
      scenario: input.scenario,
      trackingMode: input.trackingMode,
      victoryCityGoal: input.victoryCityGoal,
      includeResearch: input.includeResearch,
    },
  });

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const player = await prisma.player.create({
      data: { campaignId: campaign.id, name: p.name, sortOrder: i },
    });
    if (p.powers.length) {
      await prisma.powerAssignment.createMany({
        data: p.powers.map((powerKey) => ({
          campaignId: campaign.id,
          playerId: player.id,
          powerKey,
        })),
      });
    }
  }

  const round = await prisma.round.create({
    data: { campaignId: campaign.id, number: 1 },
  });
  await seedEntriesWithStartIncome(round.id, input.scenario);
  await seedNationStates(campaign.id, input.scenario);

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export async function deleteCampaign(formData: FormData) {
  const id = String(formData.get("id"));
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function addRound(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const last = await prisma.round.findFirst({
    where: { campaignId },
    orderBy: { number: "desc" },
    include: { entries: true },
  });
  const number = (last?.number ?? 0) + 1;
  const round = await prisma.round.create({ data: { campaignId, number } });

  // Carry income forward from the previous round so territory control persists.
  if (last?.entries?.length) {
    await prisma.nationEntry.createMany({
      data: last.entries.map((e) => ({
        roundId: round.id,
        nation: e.nation,
        income: e.income,
      })),
    });
  } else {
    await seedEntries(round.id);
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: {} }); // touch updatedAt
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}/round/${number}`);
}

export async function setCampaignStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await prisma.campaign.update({ where: { id }, data: { status } });
  revalidatePath(`/campaigns/${id}`);
}

/**
 * Record the unit losses from a resolved battle onto a round's nation entries.
 * Attacker and defender losses are added to the chosen nations' itemized losses
 * (accumulating with anything already logged for that round).
 */
export async function logBattleLosses(input: {
  campaignId: string;
  roundNumber: number;
  attackerNation: string;
  defenderNation: string;
  attackerLosses: Record<string, number>;
  defenderLosses: Record<string, number>;
}) {
  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: input.campaignId, number: input.roundNumber } },
  });
  if (!round) throw new Error("Round not found.");

  const sides: [string, Record<string, number>][] = [
    [input.attackerNation, input.attackerLosses],
    [input.defenderNation, input.defenderLosses],
  ];

  for (const [nation, losses] of sides) {
    if (!nation) continue;
    const entry = await prisma.nationEntry.upsert({
      where: { roundId_nation: { roundId: round.id, nation } },
      create: { roundId: round.id, nation },
      update: {},
    });
    for (const [unitType, qty] of Object.entries(losses)) {
      if (!qty || qty <= 0) continue;
      const existing = await prisma.loss.findFirst({
        where: { nationEntryId: entry.id, unitType },
      });
      if (existing) {
        await prisma.loss.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + qty },
        });
      } else {
        await prisma.loss.create({
          data: { nationEntryId: entry.id, unitType, quantity: qty },
        });
      }
    }
  }

  await prisma.campaign.update({ where: { id: input.campaignId }, data: {} });
  revalidatePath(`/campaigns/${input.campaignId}`);
  revalidatePath(`/campaigns/${input.campaignId}/round/${input.roundNumber}`);
}

/**
 * Transfer IPC income from the losing defender to the winning attacker when
 * a territory changes hands.  Income is clamped to ≥ 0 for the defender.
 */
export async function logTerritoryCapture(input: {
  campaignId: string;
  roundNumber: number;
  attackerNation: string;
  defenderNation: string;
  ipcValue: number;
}) {
  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: input.campaignId, number: input.roundNumber } },
  });
  if (!round) throw new Error("Round not found.");

  // Attacker gains the territory's IPC.
  await prisma.nationEntry.upsert({
    where: { roundId_nation: { roundId: round.id, nation: input.attackerNation } },
    create: { roundId: round.id, nation: input.attackerNation, income: input.ipcValue },
    update: { income: { increment: input.ipcValue } },
  });

  // Defender loses it (floor at 0).
  const defEntry = await prisma.nationEntry.upsert({
    where: { roundId_nation: { roundId: round.id, nation: input.defenderNation } },
    create: { roundId: round.id, nation: input.defenderNation, income: 0 },
    update: {},
  });
  await prisma.nationEntry.update({
    where: { id: defEntry.id },
    data: { income: Math.max(0, defEntry.income - input.ipcValue) },
  });

  await prisma.campaign.update({ where: { id: input.campaignId }, data: {} });
  revalidatePath(`/campaigns/${input.campaignId}`);
  revalidatePath(`/campaigns/${input.campaignId}/round/${input.roundNumber}`);
}

/** Record a strategic bombing raid onto a round's nation entry. */
export async function logBomberRaid(input: {
  campaignId: string;
  roundNumber: number;
  nation: string;
  bombers: number;
  damage: number;
  bombersLost: number;
}) {
  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: input.campaignId, number: input.roundNumber } },
  });
  if (!round) throw new Error("Round not found.");
  const entry = await prisma.nationEntry.upsert({
    where: { roundId_nation: { roundId: round.id, nation: input.nation } },
    create: { roundId: round.id, nation: input.nation },
    update: {},
  });
  await prisma.bomberRaid.create({
    data: {
      nationEntryId: entry.id,
      bombers: input.bombers,
      damage: input.damage,
      bombersLost: input.bombersLost,
    },
  });
  await prisma.campaign.update({ where: { id: input.campaignId }, data: {} });
  revalidatePath(`/campaigns/${input.campaignId}`);
  revalidatePath(`/campaigns/${input.campaignId}/round/${input.roundNumber}`);
}

export interface EntryInput {
  nation: string;
  income: number;
  objectiveBonus: number;
  purchases: number;
  ipcRemaining: number;
  attackPower: number;
  ipcLost: number;
  losses: { unitType: string; quantity: number }[];
  raids: { bombers: number; damage: number; bombersLost: number }[];
}

export interface SaveRoundInput {
  roundId: string;
  campaignId: string;
  number: number;
  notes: string;
  territory: {
    tcEuropeOwned: number | null;
    tcEuropeTotal: number | null;
    tcAsiaOwned: number | null;
    tcAsiaTotal: number | null;
    tcAmericasOwned: number | null;
    tcAmericasTotal: number | null;
    vcAxis: number | null;
    vcAllies: number | null;
  };
  entries: EntryInput[];
}

export async function saveRound(input: SaveRoundInput) {
  await prisma.round.update({
    where: { id: input.roundId },
    data: { notes: input.notes || null, ...input.territory },
  });

  for (const e of input.entries) {
    const entry = await prisma.nationEntry.upsert({
      where: { roundId_nation: { roundId: input.roundId, nation: e.nation } },
      create: {
        roundId: input.roundId,
        nation: e.nation,
        income: e.income,
        objectiveBonus: e.objectiveBonus,
        purchases: e.purchases,
        ipcRemaining: e.ipcRemaining,
        attackPower: e.attackPower,
        ipcLost: e.ipcLost,
      },
      update: {
        income: e.income,
        objectiveBonus: e.objectiveBonus,
        purchases: e.purchases,
        ipcRemaining: e.ipcRemaining,
        attackPower: e.attackPower,
        ipcLost: e.ipcLost,
      },
    });

    // Replace child rows wholesale — simplest correct strategy for an editor.
    await prisma.loss.deleteMany({ where: { nationEntryId: entry.id } });
    const losses = e.losses.filter((l) => l.quantity > 0);
    if (losses.length) {
      await prisma.loss.createMany({
        data: losses.map((l) => ({
          nationEntryId: entry.id,
          unitType: l.unitType,
          quantity: l.quantity,
        })),
      });
    }

    await prisma.bomberRaid.deleteMany({ where: { nationEntryId: entry.id } });
    const raids = e.raids.filter((r) => r.bombers > 0 || r.damage > 0);
    if (raids.length) {
      await prisma.bomberRaid.createMany({
        data: raids.map((r) => ({
          nationEntryId: entry.id,
          bombers: r.bombers,
          damage: r.damage,
          bombersLost: r.bombersLost,
        })),
      });
    }
  }

  await prisma.campaign.update({ where: { id: input.campaignId }, data: {} });
  revalidatePath(`/campaigns/${input.campaignId}`);
  revalidatePath(`/campaigns/${input.campaignId}/round/${input.number}`);
}

// ───────────────────────────── Turn engine ──────────────────────────────────

function revalidateTurn(campaignId: string) {
  revalidatePath(`/campaigns/${campaignId}/turn`);
  revalidatePath(`/campaigns/${campaignId}`);
}

async function getNationState(campaignId: string, nation: string) {
  const state = await prisma.nationState.findUnique({
    where: { campaignId_nation: { campaignId, nation } },
  });
  if (!state) throw new Error(`No live state for ${nation} — campaign not seeded.`);
  return state;
}

/**
 * Phase 2 — Purchase Units. Validates the order is affordable against the
 * nation's treasury, deducts the cost, and records the units as pending
 * placement (Phase 6 mobilizes them). Purchases accumulate within the phase.
 */
export async function purchaseUnits(input: {
  campaignId: string;
  nation: string;
  units: { unitType: string; quantity: number }[];
}) {
  const items = input.units.filter(
    (u) => u.quantity > 0 && UNITS_BY_KEY[u.unitType],
  );
  if (!items.length) return;

  const cost = items.reduce(
    (sum, u) => sum + UNITS_BY_KEY[u.unitType].cost * u.quantity,
    0,
  );
  const state = await getNationState(input.campaignId, input.nation);
  if (cost > state.ipc) {
    throw new Error(
      `Insufficient IPC: order costs ${cost}, ${input.nation} holds ${state.ipc}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.nationState.update({
      where: { id: state.id },
      data: { ipc: { decrement: cost } },
    });
    for (const u of items) {
      const existing = await tx.pendingUnit.findFirst({
        where: { nationStateId: state.id, unitType: u.unitType },
      });
      if (existing) {
        await tx.pendingUnit.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + u.quantity },
        });
      } else {
        await tx.pendingUnit.create({
          data: { nationStateId: state.id, unitType: u.unitType, quantity: u.quantity },
        });
      }
    }
  });

  revalidateTurn(input.campaignId);
}

/** Undo a turn's purchases: refund the pending units' cost and clear them. */
export async function clearPendingPurchases(input: {
  campaignId: string;
  nation: string;
}) {
  const state = await prisma.nationState.findUnique({
    where: { campaignId_nation: { campaignId: input.campaignId, nation: input.nation } },
    include: { pending: true },
  });
  if (!state) return;
  const refund = state.pending.reduce(
    (sum, p) => sum + (UNITS_BY_KEY[p.unitType]?.cost ?? 0) * p.quantity,
    0,
  );
  await prisma.$transaction([
    prisma.pendingUnit.deleteMany({ where: { nationStateId: state.id } }),
    prisma.nationState.update({
      where: { id: state.id },
      data: { ipc: { increment: refund } },
    }),
  ]);
  revalidateTurn(input.campaignId);
}

/**
 * Phase 7 — Collect Income. Adds `amount` IPC to the nation's treasury and
 * records it as the round's income figure for the analytics ledger.
 */
export async function collectIncome(input: {
  campaignId: string;
  nation: string;
  roundNumber: number;
  amount: number;
}) {
  const amount = Math.max(0, Math.round(input.amount));
  const state = await getNationState(input.campaignId, input.nation);
  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: input.campaignId, number: input.roundNumber } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.nationState.update({
      where: { id: state.id },
      data: { ipc: { increment: amount } },
    });
    if (round) {
      await tx.nationEntry.upsert({
        where: { roundId_nation: { roundId: round.id, nation: input.nation } },
        create: { roundId: round.id, nation: input.nation, income: amount },
        update: { income: amount },
      });
    }
  });

  revalidateTurn(input.campaignId);
}

/**
 * Advance the turn pointer one phase. Walking off Phase 7 hands the turn to the
 * next power; wrapping past the last power opens a fresh round (carrying income
 * forward, mirroring addRound).
 */
export async function advancePhase(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found.");

  const result = advance(
    campaign.activePowerKey,
    campaign.activePhase,
    campaign.includeResearch,
  );

  if (result.roundEnded) {
    const last = await prisma.round.findFirst({
      where: { campaignId },
      orderBy: { number: "desc" },
      include: { entries: true },
    });
    const number = (last?.number ?? 0) + 1;
    const round = await prisma.round.create({ data: { campaignId, number } });
    if (last?.entries?.length) {
      await prisma.nationEntry.createMany({
        data: last.entries.map((e) => ({
          roundId: round.id,
          nation: e.nation,
          income: e.income,
        })),
      });
    } else {
      await seedEntries(round.id);
    }
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { activePowerKey: result.activePowerKey, activePhase: result.activePhase },
  });
  revalidateTurn(campaignId);
}

/** Jump the pointer directly to a phase of the active power (stepper clicks). */
export async function goToPhase(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const phase = Number(formData.get("phase"));
  if (!Number.isFinite(phase) || phase < 1 || phase > 7) return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { activePhase: phase },
  });
  revalidateTurn(campaignId);
}

/** Hand the turn to a specific power (used when starting a campaign's first turn). */
export async function setActivePower(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const powerKey = String(formData.get("powerKey"));
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { includeResearch: true },
  });
  if (!campaign) return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { activePowerKey: powerKey, activePhase: startPhase(campaign.includeResearch) },
  });
  revalidateTurn(campaignId);
}
