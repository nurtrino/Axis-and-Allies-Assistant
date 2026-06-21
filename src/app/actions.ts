"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { POWERS, SCENARIO_START_INCOME } from "@/lib/anniversary.config";

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
  });
  const number = (last?.number ?? 0) + 1;
  const round = await prisma.round.create({ data: { campaignId, number } });
  await seedEntries(round.id);

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
