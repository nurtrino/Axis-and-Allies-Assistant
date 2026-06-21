import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureNationStates, setActivePower } from "@/app/actions";
import { POWERS, POWERS_BY_KEY, UNITS, type Coalition } from "@/lib/anniversary.config";
import { resolvePlayers } from "@/lib/players";
import { TURN_ORDER, PHASE_BY_N } from "@/lib/turn";
import CampaignNav from "@/components/CampaignNav";
import TurnPortal from "@/components/TurnPortal";

export const dynamic = "force-dynamic";

export default async function TurnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { id } = await params;
  const { as } = await searchParams;

  // Lazily backfill live state for campaigns created before the turn engine.
  await ensureNationStates(id);

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
      rounds: { orderBy: { number: "asc" }, include: { entries: true } },
      nationStates: { include: { pending: true } },
      combatMoves: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!campaign) notFound();

  const players = resolvePlayers(campaign.players);
  const selected = players.find((p) => p.id === as) ?? players[0] ?? null;
  const asQuery = selected ? `?as=${selected.id}` : "";

  // Who controls each power (for the turn rail + "it's X's turn" banner).
  const controllerByPower = new Map<string, string>();
  for (const pl of players) {
    for (const k of pl.powerKeys) controllerByPower.set(k, pl.name);
  }

  const activeKey = campaign.activePowerKey;
  const activePower = POWERS_BY_KEY[activeKey] ?? POWERS[0];
  const activePhase = campaign.activePhase;

  const currentRound = campaign.rounds[campaign.rounds.length - 1];
  const currentNum = currentRound?.number ?? 1;

  const stateByNation = new Map(campaign.nationStates.map((s) => [s.nation, s]));
  const activeState = stateByNation.get(activeKey);
  const treasury = activeState?.ipc ?? 0;
  const pending = (activeState?.pending ?? []).map((p) => ({
    unitType: p.unitType,
    quantity: p.quantity,
  }));
  const defaultIncome =
    currentRound?.entries.find((e) => e.nation === activeKey)?.income ?? 0;

  const portalUnits = UNITS.map((u) => ({
    key: u.key,
    name: u.name,
    cost: u.cost,
    domain: u.domain,
  }));

  const controller = controllerByPower.get(activeKey) ?? null;
  const isMyTurn = selected ? selected.powerKeys.includes(activeKey) : true;

  // Combat orders declared by the active power in the current round.
  const combatOrders = campaign.combatMoves
    .filter((o) => o.attackerNation === activeKey && o.roundNumber === currentNum)
    .map((o) => ({
      id: o.id,
      defenderNation: o.defenderNation,
      territory: o.territory,
      territoryIpc: o.territoryIpc,
      units: (o.units ?? {}) as Record<string, number>,
      amphibious: o.amphibious,
      status: o.status,
      resultStatus: o.resultStatus,
    }));

  const allPowers = POWERS.map((p) => ({
    key: p.key,
    name: p.name,
    color: p.color,
    flag: p.flag,
    coalition: p.coalition,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/campaigns/${id}${asQuery}`} className="label hover:text-foreground">
            ← {campaign.name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Turn Portal</h1>
          <p className="label mt-1">
            Round {currentNum} ·{" "}
            {campaign.scenario === "Y1941" ? "1941" : "1942"} scenario
          </p>
        </div>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="turn" />

      {/* Turn order rail */}
      <div className="panel p-4">
        <div className="label mb-2">Turn order — Round {currentNum}</div>
        <div className="flex flex-wrap gap-2">
          {TURN_ORDER.map((key) => {
            const p = POWERS_BY_KEY[key];
            const isActive = key === activeKey;
            return (
              <form action={setActivePower} key={key}>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="powerKey" value={key} />
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded border px-2.5 py-1.5"
                  style={{
                    borderColor: isActive ? p.color : "var(--border)",
                    background: isActive ? "var(--surface-2)" : "transparent",
                    opacity: isActive ? 1 : 0.7,
                  }}
                  title={`Hand the turn to ${p.name}`}
                >
                  <Image src={p.flag} alt="" width={20} height={13} className="rounded-sm border border-border" />
                  <span className="text-sm font-medium" style={{ color: isActive ? p.color : "var(--muted)" }}>
                    {p.name}
                  </span>
                  <span className="label">{controllerByPower.get(key) ?? "—"}</span>
                </button>
              </form>
            );
          })}
        </div>
      </div>

      {/* Active power banner */}
      <div
        className="panel p-4 flex flex-wrap items-center justify-between gap-3"
        style={{ borderColor: activePower.color }}
      >
        <div className="flex items-center gap-3">
          <Image
            src={activePower.flag}
            alt=""
            width={34}
            height={22}
            className="rounded-sm border border-border"
          />
          <div>
            <div className="text-lg font-semibold" style={{ color: activePower.color }}>
              {activePower.name}&apos;s turn
            </div>
            <div className="label">
              {(activePower.coalition as Coalition) === "AXIS" ? "Axis" : "Allies"}
              {controller ? ` · commander ${controller}` : ""} · Phase {activePhase} —{" "}
              {PHASE_BY_N[activePhase]?.name}
            </div>
          </div>
        </div>
        {!isMyTurn && selected && (
          <div className="label" style={{ color: "var(--muted)" }}>
            You are {selected.name}. Hand off above when it&apos;s your turn.
          </div>
        )}
      </div>

      <TurnPortal
        campaignId={id}
        roundNumber={currentNum}
        activePhase={activePhase}
        includeResearch={campaign.includeResearch}
        power={{
          key: activePower.key,
          name: activePower.name,
          color: activePower.color,
          flag: activePower.flag,
          coalition: activePower.coalition,
        }}
        controller={controller}
        treasury={treasury}
        pending={pending}
        defaultIncome={defaultIncome}
        units={portalUnits}
        powers={allPowers}
        combatOrders={combatOrders}
      />
    </div>
  );
}
