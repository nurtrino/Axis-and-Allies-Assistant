import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { POWERS } from "@/lib/anniversary.config";
import { resolvePlayers } from "@/lib/players";
import CampaignNav from "@/components/CampaignNav";
import CampaignBattle from "@/components/CampaignBattle";

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
    include: {
      players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
      rounds: { orderBy: { number: "asc" }, select: { number: true } },
    },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const asQuery = selected ? `?as=${selected.id}` : "";

  const roundNumbers = campaign.rounds.map((r) => r.number);
  const defaultRound = roundNumbers.length ? Math.max(...roundNumbers) : 1;
  const powers = POWERS.map((p) => ({ key: p.key, name: p.name, color: p.color }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="label hover:text-foreground">
          ← Campaigns
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{campaign.name}</h1>
        <p className="label mt-1">
          Battle Simulator — resolve an Anniversary Edition battle with animated dice
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="battle" />

      <CampaignBattle
        campaignId={id}
        rounds={roundNumbers.length ? roundNumbers : [1]}
        powers={powers}
        defaultRound={defaultRound}
      />
    </div>
  );
}
