import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import RoundEditor, { type InitialEntry } from "@/components/RoundEditor";
import { POWERS, type TrackingMode } from "@/lib/anniversary.config";
import { resolvePlayers } from "@/lib/players";

export const dynamic = "force-dynamic";

export default async function RoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; n: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { id, n } = await params;
  const { as } = await searchParams;
  const number = Number(n);

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const asSuffix = (pid: string | null) => (pid ? `?as=${pid}` : "");

  const round = await prisma.round.findUnique({
    where: { campaignId_number: { campaignId: id, number } },
    include: { entries: { include: { losses: true, raids: true } } },
  });
  if (!round) notFound();

  const lastRound = await prisma.round.findFirst({
    where: { campaignId: id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const maxNumber = lastRound?.number ?? number;
  const hasPrev = number > 1;
  const hasNext = number < maxNumber;

  const byNation = new Map(round.entries.map((e) => [e.nation, e]));
  const initialEntries: InitialEntry[] = POWERS.map((p) => {
    const e = byNation.get(p.key);
    const raid = e?.raids[0];
    return {
      nation: p.key,
      income: e?.income ?? 0,
      objectiveBonus: e?.objectiveBonus ?? 0,
      purchases: e?.purchases ?? 0,
      ipcRemaining: e?.ipcRemaining ?? 0,
      attackPower: e?.attackPower ?? 0,
      ipcLost: e?.ipcLost ?? 0,
      losses: Object.fromEntries(
        (e?.losses ?? []).map((l) => [l.unitType, l.quantity]),
      ),
      raid: {
        bombers: raid?.bombers ?? 0,
        damage: raid?.damage ?? 0,
        bombersLost: raid?.bombersLost ?? 0,
      },
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/campaigns/${id}${asSuffix(selected?.id ?? null)}`} className="label hover:text-foreground">
          ← {campaign.name}
        </Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Round {number}
            {number < maxNumber && (
              <span className="label ml-2 align-middle">· editing past round</span>
            )}
          </h1>
          <div className="flex gap-2">
            {hasPrev ? (
              <Link href={`/campaigns/${id}/round/${number - 1}${asSuffix(selected?.id ?? null)}`} className="btn">
                ← R{number - 1}
              </Link>
            ) : (
              <span className="btn opacity-40 pointer-events-none">← R0</span>
            )}
            {hasNext ? (
              <Link href={`/campaigns/${id}/round/${number + 1}${asSuffix(selected?.id ?? null)}`} className="btn">
                R{number + 1} →
              </Link>
            ) : (
              <span className="btn opacity-40 pointer-events-none">
                R{number + 1} →
              </span>
            )}
          </div>
        </div>

        {/* Log-as switcher */}
        {players.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="label">Logging as:</span>
            {players.map((pl) => {
              const isSel = pl.id === selected?.id;
              return (
                <Link
                  key={pl.id}
                  href={`/campaigns/${id}/round/${number}?as=${pl.id}`}
                  className="btn"
                  style={
                    isSel
                      ? {
                          borderColor: pl.coalition === "AXIS" ? "var(--axis)" : "var(--allies)",
                          color: pl.coalition === "AXIS" ? "var(--axis)" : "var(--allies)",
                        }
                      : undefined
                  }
                >
                  {isSel ? "▸ " : ""}
                  {pl.name}
                </Link>
              );
            })}
          </div>
        )}
        <p className="label mt-2">
          Showing your powers. Save before handing the device to the next
          commander.
        </p>
      </div>

      <RoundEditor
        campaignId={id}
        roundId={round.id}
        number={number}
        trackingMode={campaign.trackingMode as TrackingMode}
        initialNotes={round.notes ?? ""}
        initialTerritory={{
          tcEuropeOwned: round.tcEuropeOwned,
          tcEuropeTotal: round.tcEuropeTotal,
          tcAsiaOwned: round.tcAsiaOwned,
          tcAsiaTotal: round.tcAsiaTotal,
          tcAmericasOwned: round.tcAmericasOwned,
          tcAmericasTotal: round.tcAmericasTotal,
          vcAxis: round.vcAxis,
          vcAllies: round.vcAllies,
        }}
        initialEntries={initialEntries}
        focusPowers={selected?.powerKeys ?? []}
        focusLabel={selected?.name ?? null}
      />
    </div>
  );
}
