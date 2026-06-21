import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { addRound } from "@/app/actions";
import { POWERS, SCENARIO_START_INCOME, type Coalition } from "@/lib/anniversary.config";
import { computeRounds, lossesByNation } from "@/lib/analytics";
import { resolvePlayers } from "@/lib/players";
import { victoryHorizon } from "@/lib/intel";
import CampaignCharts from "@/components/CampaignCharts";
import CampaignNav from "@/components/CampaignNav";
import CompleteTurn from "@/components/CompleteTurn";

export const dynamic = "force-dynamic";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="stat text-xl" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export default async function WarRoom({
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
        include: {
          entries: { include: { losses: true, raids: true } },
        },
      },
    },
  });
  if (!campaign) notFound();

  // Resolve players and the current "commander" perspective.
  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const side: Coalition = selected?.coalition ?? (campaign.side as Coalition);
  const ownPowers = new Set(selected?.powerKeys ?? []);
  const playerByPower = new Map<string, string>();
  for (const pl of players) {
    for (const k of pl.powerKeys) playerByPower.set(k, pl.name);
  }
  const asQuery = selected ? `?as=${selected.id}` : "";

  const metrics = computeRounds(campaign.rounds, side);
  const current = campaign.rounds[campaign.rounds.length - 1];
  const currentNum = current?.number ?? 1;
  const latest = metrics[metrics.length - 1];

  // Per-nation snapshot from the current round.
  const entryByNation = new Map(
    (current?.entries ?? []).map((e) => [e.nation, e]),
  );

  const axisAP = latest ? (side === "AXIS" ? latest.friendlyAP : latest.enemyAP) : 0;
  const alliesAP = latest ? (side === "ALLIES" ? latest.friendlyAP : latest.enemyAP) : 0;
  const totalAP = Math.max(axisAP + alliesAP, 1);

  // Chart data (serializable props for the client charts component).
  const roundPoints = metrics.map((m) => ({
    round: `R${m.number}`,
    incomeAdv: m.incomeAdv,
    netAdv: m.netAdv,
    cumNetAdv: m.cumIncomeAdv + m.cumAttritionAdv,
    friendlyAP: m.friendlyAP,
    enemyAP: m.enemyAP,
  }));
  const lossBars = lossesByNation(campaign.rounds).map((n) => {
    const p = POWERS.find((x) => x.key === n.nation);
    return { name: p?.name ?? n.nation, value: n.lossIpc, color: p?.color ?? "#888" };
  });
  const apBars = POWERS.map((p) => ({
    name: p.name,
    value: entryByNation.get(p.key)?.attackPower ?? 0,
    color: p.color,
  }));
  const hasData = metrics.some(
    (m) => m.friendlyAP || m.enemyAP || m.friendlyLoss || m.enemyLoss,
  );

  const horizon = victoryHorizon(metrics, {
    playerSide: side,
    victoryCityGoal: campaign.victoryCityGoal,
    currentRound: currentNum,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/campaigns" className="label hover:text-foreground">
            ← Campaigns
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            {campaign.name}
          </h1>
          <p className="label mt-1">
            <span style={{ color: side === "AXIS" ? "var(--axis)" : "var(--allies)" }}>
              {side}
            </span>
            {" · Round "}
            {currentNum} · Goal {campaign.victoryCityGoal} VC ·{" "}
            <span style={{ color: campaign.status === "VICTORY" ? "var(--good)" : campaign.status === "DEFEAT" ? "var(--bad)" : undefined }}>
              {campaign.status}
            </span>
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/campaigns/${id}/round/${currentNum}${asQuery}`}
            className="btn btn-primary"
          >
            Edit Round {currentNum}
          </Link>
          <form action={addRound}>
            <input type="hidden" name="campaignId" value={id} />
            <button className="btn" type="submit">
              + New Round
            </button>
          </form>
        </div>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="war-room" />

      {/* Commander selector */}
      {players.length > 0 && (
        <div className="panel p-4">
          <div className="label mb-2">Commander — viewing as</div>
          <div className="flex flex-wrap gap-2">
            {players.map((pl) => {
              const isSel = pl.id === selected?.id;
              return (
                <Link
                  key={pl.id}
                  href={`/campaigns/${id}?as=${pl.id}`}
                  className="btn"
                  style={
                    isSel
                      ? {
                          borderColor:
                            pl.coalition === "AXIS" ? "var(--axis)" : "var(--allies)",
                          color:
                            pl.coalition === "AXIS" ? "var(--axis)" : "var(--allies)",
                        }
                      : undefined
                  }
                >
                  {isSel ? "▸ " : ""}
                  {pl.name}
                  <span className="label">
                    {pl.powerKeys.map((k) => k.slice(0, 3)).join(" ")}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Complete Turn — territory changes adjust IPC income */}
      <CompleteTurn
        campaignId={id}
        roundNumber={currentNum}
        powers={POWERS.filter((p) => !p.minor).map((p) => ({
          key: p.key,
          name: p.name,
          color: p.color,
          income: entryByNation.get(p.key)?.income ?? 0,
        }))}
      />

      {/* Battle bar */}
      <div className="panel p-5">
        <div className="label mb-2">Coalition Attack Power</div>
        <div className="flex items-center justify-between text-sm mb-1 stat">
          <span style={{ color: "var(--axis)" }}>AXIS {axisAP}</span>
          <span style={{ color: "var(--allies)" }}>{alliesAP} ALLIES</span>
        </div>
        <div className="flex h-3 rounded overflow-hidden bg-surface-2">
          <div style={{ width: `${(axisAP / totalAP) * 100}%`, background: "var(--axis)" }} />
          <div style={{ width: `${(alliesAP / totalAP) * 100}%`, background: "var(--allies)" }} />
        </div>
        {latest && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <Stat label="Income Adv" value={signed(latest.incomeAdv)} accent={latest.incomeAdv >= 0 ? "var(--good)" : "var(--bad)"} />
            <Stat label="Attrition Adv" value={signed(latest.attritionAdv)} accent={latest.attritionAdv >= 0 ? "var(--good)" : "var(--bad)"} />
            <Stat label="Net Adv" value={signed(latest.netAdv)} accent={latest.netAdv >= 0 ? "var(--good)" : "var(--bad)"} />
            <Stat label="AP Adv" value={signed(latest.apAdv)} accent={latest.apAdv >= 0 ? "var(--good)" : "var(--bad)"} />
          </div>
        )}
      </div>

      {/* Victory Horizon */}
      {horizon && (
        <div className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label">Victory Horizon — win forecast</span>
            <span className="label">heuristic model</span>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mt-2">
            <div>
              <div
                className="text-2xl font-semibold"
                style={{ color: horizon.favored === "AXIS" ? "var(--axis)" : "var(--allies)" }}
              >
                {horizon.favored} favored
              </div>
              <div className="stat text-3xl">{horizon.favoredProb}%</div>
            </div>
            <div className="label">
              {horizon.expectedVictoryRound
                ? `Victory projected by Round ${horizon.expectedVictoryRound}`
                : "Insufficient victory-city pace to project a finish"}
              <br />
              Your side ({side}) win chance: {horizon.playerProb}%
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {horizon.factors.map((f) => {
              const pct = Math.round(((f.score + 1) / 2) * 100);
              return (
                <div key={f.label}>
                  <div className="label">{f.label}</div>
                  <div className="h-2 rounded bg-surface-2 overflow-hidden mt-1 mb-1">
                    <div
                      style={{
                        width: `${pct}%`,
                        background: f.score >= 0 ? "var(--good)" : "var(--bad)",
                      }}
                      className="h-full"
                    />
                  </div>
                  <div className="label">{f.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nation cards */}
      <div>
        <div className="label mb-2">Powers — Round {currentNum}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {POWERS.map((p) => {
            const e = entryByNation.get(p.key);
            const owned = ownPowers.has(p.key);
            const controller = playerByPower.get(p.key);
            const startIpc = SCENARIO_START_INCOME[campaign.scenario]?.[p.key] ?? 0;
            return (
              <div
                key={p.key}
                className="panel p-4"
                style={owned ? { borderColor: "var(--accent)" } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold" style={{ color: p.color }}>
                    <Image
                      src={p.flag}
                      alt=""
                      width={22}
                      height={15}
                      className="rounded-sm border border-border"
                    />
                    {p.name}
                  </span>
                  {owned ? (
                    <span className="label" style={{ color: "var(--accent)" }}>★ Yours</span>
                  ) : (
                    <span className="label">{p.coalition}</span>
                  )}
                </div>
                {controller && (
                  <div className="label mt-1 truncate">cmdr: {controller}</div>
                )}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Stat label="Start IPC" value={String(startIpc)} />
                  <Stat label="IPC Income" value={String(e?.income ?? 0)} accent="var(--accent)" />
                  <Stat label="Attack Power" value={String(e?.attackPower ?? 0)} />
                  <Stat label="IPC Banked" value={String(e?.ipcRemaining ?? 0)} />
                  <Stat label="Purchases" value={String(e?.purchases ?? 0)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      {hasData ? (
        <CampaignCharts
          rounds={roundPoints}
          lossByNation={lossBars}
          apByNation={apBars}
          playerLabel={side === "AXIS" ? "Axis" : "Allies"}
        />
      ) : (
        <div className="panel p-6 text-center label">
          Log a round to unlock trend charts.
        </div>
      )}

      {/* History */}
      <div className="panel p-5 overflow-x-auto">
        <div className="label mb-3">Campaign History — your-side perspective</div>
        <table className="w-full text-sm stat">
          <thead>
            <tr className="label text-left">
              <th className="py-1 pr-3">RND</th>
              <th className="py-1 pr-3">Income Δ</th>
              <th className="py-1 pr-3">Σ Income Δ</th>
              <th className="py-1 pr-3">AP Δ</th>
              <th className="py-1 pr-3">Attrition Δ</th>
              <th className="py-1 pr-3">Σ Attrition Δ</th>
              <th className="py-1 pr-3">VC</th>
              <th className="py-1 pr-3">Notes</th>
              <th className="py-1 pr-3 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr
                key={m.number}
                className="border-t border-border hover:bg-surface-2/50 transition-colors"
              >
                <td className="py-1.5 pr-3">
                  <Link href={`/campaigns/${id}/round/${m.number}${asQuery}`} className="hover:text-accent">
                    R{m.number}
                  </Link>
                </td>
                <td className="py-1.5 pr-3" style={{ color: m.incomeAdv >= 0 ? "var(--good)" : "var(--bad)" }}>{signed(m.incomeAdv)}</td>
                <td className="py-1.5 pr-3 text-muted">{signed(m.cumIncomeAdv)}</td>
                <td className="py-1.5 pr-3" style={{ color: m.apAdv >= 0 ? "var(--good)" : "var(--bad)" }}>{signed(m.apAdv)}</td>
                <td className="py-1.5 pr-3" style={{ color: m.attritionAdv >= 0 ? "var(--good)" : "var(--bad)" }}>{signed(m.attritionAdv)}</td>
                <td className="py-1.5 pr-3 text-muted">{signed(m.cumAttritionAdv)}</td>
                <td className="py-1.5 pr-3">{m.vcFriendly ?? "—"}</td>
                <td className="py-1.5 pr-3 text-muted max-w-xs truncate">{m.notes ?? ""}</td>
                <td className="py-1.5 pr-3 text-right">
                  <Link
                    href={`/campaigns/${id}/round/${m.number}${asQuery}`}
                    className="label hover:text-accent"
                    aria-label={`Edit round ${m.number}`}
                  >
                    ✎ Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rounds list */}
      <div className="flex flex-wrap gap-2">
        {campaign.rounds.map((r) => (
          <Link
            key={r.id}
            href={`/campaigns/${id}/round/${r.number}${asQuery}`}
            className="btn"
          >
            Round {r.number}
          </Link>
        ))}
      </div>
    </div>
  );
}
