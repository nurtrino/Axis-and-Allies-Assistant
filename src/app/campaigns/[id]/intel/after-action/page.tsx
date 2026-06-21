import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { type Coalition } from "@/lib/anniversary.config";
import { computeRounds } from "@/lib/analytics";
import { resolvePlayers } from "@/lib/players";
import { afterAction } from "@/lib/intel";
import CampaignNav from "@/components/CampaignNav";

export const dynamic = "force-dynamic";

export default async function AfterActionPage({
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

  const metrics = computeRounds(campaign.rounds, side);
  const report = afterAction(metrics, {
    playerSide: side,
    campaignName: campaign.name,
    status: campaign.status,
    victoryCityGoal: campaign.victoryCityGoal,
  });

  const outcomeColor =
    campaign.status === "VICTORY"
      ? "var(--good)"
      : campaign.status === "DEFEAT"
        ? "var(--bad)"
        : "var(--accent)";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <p className="label mt-1">
          After-Action Report ·{" "}
          <span style={{ color: side === "AXIS" ? "var(--axis)" : "var(--allies)" }}>
            {selected?.name ?? side}
          </span>
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="after-action" />

      <div className="panel p-6">
        <div className="label">Campaign Outcome</div>
        <h2 className="text-2xl font-semibold mt-1" style={{ color: outcomeColor }}>
          {report.outcome}
        </h2>
        <div className="space-y-2 mt-4">
          {report.summary.map((s, i) => (
            <p key={i} className="text-sm leading-relaxed">{s}</p>
          ))}
        </div>
        {report.turningPoint && (
          <p className="text-sm leading-relaxed mt-3" style={{ color: "var(--accent)" }}>
            {report.turningPoint}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {report.stats.map((s) => (
          <div key={s.label} className="panel p-4">
            <div className="label">{s.label}</div>
            <div className="stat text-xl mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {campaign.status === "ACTIVE" && (
        <p className="label">
          This campaign is still active — the report reflects the situation through
          the latest logged round.
        </p>
      )}
    </div>
  );
}
