import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolvePlayers } from "@/lib/players";
import OffensivePlanner from "@/components/OffensivePlanner";
import CampaignNav from "@/components/CampaignNav";

export const dynamic = "force-dynamic";

export default async function PlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { id } = await params;
  const { as } = await searchParams;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const asQuery = selected ? `?as=${selected.id}` : "";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <p className="label mt-1">
          Offensive Planner — model a battle&apos;s odds and economic return
          before you commit.
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="planner" />

      <OffensivePlanner />
    </div>
  );
}
