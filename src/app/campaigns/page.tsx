import Link from "next/link";
import { prisma } from "@/lib/db";
import RestartButton from "@/components/RestartButton";
import DeleteCampaignButton from "@/components/DeleteCampaignButton";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      rounds: { orderBy: { number: "desc" }, take: 1 },
      players: { orderBy: { sortOrder: "asc" } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="label mt-1">Your logged Anniversary Edition games</p>
        </div>
        <Link href="/campaigns/new" className="btn btn-primary">
          + New Campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-muted">No campaigns yet.</p>
          <Link href="/campaigns/new" className="btn btn-primary mt-4">
            Start your first campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const round = c.rounds[0]?.number ?? 1;
            const isAxis = c.side === "AXIS";
            return (
              <div key={c.id} className="relative">
                <DeleteCampaignButton id={c.id} name={c.name} />
                <Link
                  href={`/campaigns/${c.id}`}
                  className="panel p-4 hover:border-accent transition-colors block"
                >
                  <div className="flex items-center justify-between pr-7">
                    <span
                      className="label"
                      style={{ color: isAxis ? "var(--axis)" : "var(--allies)" }}
                    >
                      {c.side}
                    </span>
                    <span className="label">{c.status}</span>
                  </div>
                  <h2 className="text-lg font-semibold mt-1">{c.name}</h2>
                  <p className="label mt-1">
                    {c.players.length > 0
                      ? `${c.players.length} player${c.players.length > 1 ? "s" : ""} · `
                      : c.opponent
                        ? `vs ${c.opponent} · `
                        : ""}
                    Round {round}
                  </p>
                  {c.players.length > 0 && (
                    <p className="label mt-1 truncate">
                      {c.players.map((p) => p.name).join(", ")}
                    </p>
                  )}
                  <p className="label mt-3">
                    {c.scenario === "Y1941" ? "1941 Scenario" : "1942 Scenario"} ·{" "}
                    Goal {c.victoryCityGoal} VC · {c.trackingMode}
                  </p>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {/* Dev-only: the restart button drives a local hidden dev server and has
          no meaning in a hosted deployment (where it would just kill the site). */}
      {process.env.NODE_ENV !== "production" && <RestartButton />}
    </div>
  );
}
