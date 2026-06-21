/* One-off: create a small test campaign so the live Battle page has data to
 * render. Run with DATABASE_URL pointed at the target database:
 *   DATABASE_URL=<url> npx tsx scripts/seed-test-campaign.ts */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { POWERS, SCENARIO_START_INCOME } from "../src/lib/anniversary.config";

// Dedicated client that relaxes TLS cert verification (Render's external
// endpoint presents a cert that fails verify-full from outside their network).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.campaign.findFirst({ where: { name: "Sandbox — Battle Test" } });
  if (existing) {
    console.log("Already seeded:", existing.id);
    return;
  }
  const campaign = await prisma.campaign.create({
    data: { name: "Sandbox — Battle Test", side: "ALLIES", scenario: "Y1942", trackingMode: "DETAILED", victoryCityGoal: 15, includeResearch: true },
  });
  const player = await prisma.player.create({ data: { campaignId: campaign.id, name: "Solo", sortOrder: 0 } });
  await prisma.powerAssignment.createMany({
    data: POWERS.filter((p) => !p.minor).map((p) => ({ campaignId: campaign.id, playerId: player.id, powerKey: p.key })),
  });
  const round = await prisma.round.create({ data: { campaignId: campaign.id, number: 1 } });
  const start = SCENARIO_START_INCOME["Y1942"];
  await prisma.nationEntry.createMany({
    data: POWERS.map((p) => ({ roundId: round.id, nation: p.key, income: start[p.key] ?? 0 })),
  });
  console.log("Seeded campaign:", campaign.id);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
