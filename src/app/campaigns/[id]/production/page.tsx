import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { POWERS, SCENARIO_START_INCOME } from "@/lib/anniversary.config";
import { resolvePlayers } from "@/lib/players";
import CampaignNav from "@/components/CampaignNav";
import ProductionChart from "@/components/ProductionChart";
import ProductionEditor from "@/components/ProductionEditor";

export const dynamic = "force-dynamic";

export default async function ProductionPage({
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
      rounds: { orderBy: { number: "asc" }, include: { entries: true } },
    },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const asQuery = selected ? `?as=${selected.id}` : "";

  const rounds = campaign.rounds;
  const incomeOf = (nation: string, roundNum: number) => {
    const r = rounds.find((x) => x.number === roundNum);
    const e = r?.entries.find((x) => x.nation === nation);
    return e?.income ?? 0;
  };

  const currentNum = rounds.length ? Math.max(...rounds.map((r) => r.number)) : 1;

  // Per-round series for the per-power line chart.
  const incomeByRound = rounds.map((r) => {
    const row: Record<string, number | string> = { round: `R${r.number}` };
    for (const p of POWERS) row[p.key] = incomeOf(p.key, r.number);
    return row;
  });

  // Coalition totals per round.
  const coalitionByRound = rounds.map((r) => {
    let axis = 0;
    let allies = 0;
    for (const p of POWERS) {
      const v = incomeOf(p.key, r.number);
      if (p.coalition === "AXIS") axis += v;
      else allies += v;
    }
    return { round: `R${r.number}`, Axis: axis, Allies: allies };
  });

  const hasData = incomeByRound.some((row) =>
    POWERS.some((p) => Number(row[p.key]) > 0),
  );

  const powerMeta = POWERS.map((p) => ({ key: p.key, name: p.name, color: p.color }));
  const editorPowers = POWERS.map((p) => ({
    key: p.key,
    name: p.name,
    color: p.color,
    flag: p.flag,
    coalition: p.coalition,
  }));
  const initialIncome = Object.fromEntries(
    POWERS.map((p) => {
      const r = rounds.find((x) => x.number === currentNum);
      const e = r?.entries.find((x) => x.nation === p.key);
      return [p.key, e?.income ?? 0];
    }),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 >{campaign.name}</h1>
        <p className="label mt-1">
          National Production Chart · Round {currentNum} ·{" "}
          {campaign.scenario === "Y1941" ? "1941" : "1942"} scenario
        </p>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="production" />

      {/* Editable game-board-style National Production / R&D Chart */}
      <ProductionEditor
        campaignId={id}
        roundNumber={currentNum}
        powers={editorPowers}
        initial={initialIncome}
        startIncome={SCENARIO_START_INCOME[campaign.scenario] ?? {}}
        scenarioLabel={campaign.scenario === "Y1941" ? "1941" : "1942"}
        includeResearch={campaign.includeResearch}
      />

      <div className="label pt-1">Analytics</div>

      {/* Charts */}
      {hasData ? (
        <ProductionChart
          incomeByRound={incomeByRound}
          powers={powerMeta}
          coalitionByRound={coalitionByRound}
        />
      ) : (
        <div className="panel p-6 text-center label">
          Log income for a round to populate the production chart.
        </div>
      )}
    </div>
  );
}
