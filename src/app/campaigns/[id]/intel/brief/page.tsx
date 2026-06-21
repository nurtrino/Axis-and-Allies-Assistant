import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { type Coalition } from "@/lib/anniversary.config";
import { computeRounds } from "@/lib/analytics";
import { resolvePlayers } from "@/lib/players";
import { victoryHorizon, commandBrief } from "@/lib/intel";
import CampaignNav from "@/components/CampaignNav";

export const dynamic = "force-dynamic";

export default async function CommandBriefPage({
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
      rounds: {
        orderBy: { number: "asc" },
        include: { entries: { include: { losses: true, raids: true } } },
      },
    },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const side: Coalition = selected?.coalition ?? (campaign.side as Coalition);
  const asQuery = selected ? `?as=${selected.id}` : "";
  const currentNum = campaign.rounds[campaign.rounds.length - 1]?.number ?? 1;

  const metrics = computeRounds(campaign.rounds, side);
  const horizon = victoryHorizon(metrics, {
    playerSide: side,
    victoryCityGoal: campaign.victoryCityGoal,
    currentRound: currentNum,
  });
  const brief = commandBrief(metrics, {
    playerSide: side,
    playerName: selected?.name ?? null,
    victoryCityGoal: campaign.victoryCityGoal,
    currentRound: currentNum,
    horizon,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <p className="label mt-1">
          Command Brief ·{" "}
          <span style={{ color: side === "AXIS" ? "var(--axis)" : "var(--allies)" }}>
            {selected?.name ?? side}
          </span>{" "}
          · Round {currentNum}
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="brief" />

      <div className="panel p-6">
        <div className="label">Chief of Staff Assessment</div>
        <h2 className="text-xl font-semibold mt-1 mb-4">{brief.headline}</h2>
        <div className="space-y-2">
          {brief.analysis.map((a, i) => (
            <p key={i} className="text-sm leading-relaxed">{a}</p>
          ))}
        </div>
      </div>

      <div className="panel p-6">
        <div className="label mb-3">Mission Orders</div>
        <ol className="space-y-2">
          {brief.orders.map((o, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="stat" style={{ color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</span>
              <span>{o}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
