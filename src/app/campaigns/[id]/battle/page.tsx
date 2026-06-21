import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { resolvePlayers } from "@/lib/players";
import CampaignNav from "@/components/CampaignNav";

export const dynamic = "force-dynamic";

export default async function BattlePage({
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
        <Link href="/campaigns" className="label hover:text-foreground">
          ← Campaigns
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{campaign.name}</h1>
        <p className="label mt-1">Battle Simulator — Anniversary Edition general combat</p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="battle" />

      <div className="panel p-10 text-center label">
        Battle setup &amp; animated resolution are under construction.
      </div>
    </div>
  );
}
