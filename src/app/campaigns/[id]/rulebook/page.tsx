import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolvePlayers } from "@/lib/players";
import CampaignNav from "@/components/CampaignNav";
import RulebookAssistant from "@/components/RulebookAssistant";

export const dynamic = "force-dynamic";

export default async function RulebookPage({
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
        <h1 >{campaign.name}</h1>
        <p className="label mt-1">
          Rulebook &amp; game-aware assistant
          {selected ? ` · ${selected.name}` : ""}
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="rulebook" />

      <RulebookAssistant
        campaignId={id}
        playerId={selected?.id ?? null}
        playerName={selected?.name ?? null}
      />

      <div className="panel p-2">
        <div className="label px-2 py-1">Anniversary Edition Rulebook</div>
        <iframe
          src="/rulebook.pdf#view=FitH"
          title="Axis & Allies Anniversary Edition Rulebook"
          className="w-full rounded"
          style={{ height: "80vh", border: "1px solid var(--border)" }}
        />
        <p className="label px-2 py-1">
          Trouble viewing?{" "}
          <a href="/rulebook.pdf" target="_blank" rel="noopener" className="hover:text-accent">
            Open the PDF in a new tab
          </a>
          .
        </p>
      </div>
    </div>
  );
}
