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
      nationStates: { include: { pending: true, stocks: true } },
      combatMoves: { orderBy: { createdAt: "asc" } },
      movements: { orderBy: { createdAt: "asc" } },
      breakthroughs: { orderBy: { createdAt: "asc" } },
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
  const inventory = (activeState?.stocks ?? [])
    .filter((s) => s.quantity > 0)
    .map((s) => ({ unitType: s.unitType, quantity: s.quantity }));
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

  // Noncombat moves logged by the active power in the current round.
  const movements = campaign.movements
    .filter((m) => m.nation === activeKey && m.roundNumber === currentNum)
    .map((m) => ({
      id: m.id,
      fromTerritory: m.fromTerritory,
      toTerritory: m.toTerritory,
      units: (m.units ?? {}) as Record<string, number>,
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
          <h1 className="mt-1">Turn Portal</h1>
          <p className="label mt-1">
            Round {currentNum} ·{" "}
            {campaign.scenario === "Y1941" ? "1941" : "1942"} scenario
          </p>
        </div>
      </div>

      <CampaignNav id={id} asQuery={asQuery} active="turn" />

      {/* Command banner — whose turn it is */}
      <div className="command-banner doc-corners">
        <span className="stripe" style={{ background: activePower.color }} />
        <span className="watermark" style={{ color: activePower.color }}>
          {activePower.name}
        </span>
        <div className="relative flex flex-wrap items-center justify-between gap-4 p-5 pl-6">
          <div className="flex items-center gap-4">
            <Image
              src={activePower.flag}
              alt=""
              width={52}
              height={34}
              className="rounded-sm border border-border shadow-lg"
            />
            <div>
              <div className="display text-3xl leading-none" style={{ color: activePower.color }}>
                {activePower.name}
              </div>
              <div className="prose-quiet mt-1">
                {(activePower.coalition as Coalition) === "AXIS" ? "Axis" : "Allies"}
                {controller ? <> · Commander <span style={{ color: "var(--foreground)" }}>{controller}</span></> : null}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="label">Now in</div>
            <div className="font-medium" style={{ color: "var(--accent)" }}>
              Phase {activePhase} — {PHASE_BY_N[activePhase]?.name}
            </div>
            {!isMyTurn && selected && (
              <div className="prose-quiet mt-1">
                You are {selected.name} — hand off below when it&apos;s your turn.
              </div>
            )}
          </div>
        </div>
      </div>

      <TurnPortal
        campaignId={id}
        roundNumber={currentNum}
        activePhase={activePhase}
        includeResearch={campaign.includeResearch}
        combatResolution={campaign.combatResolution}
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
        inventory={inventory}
        defaultIncome={defaultIncome}
        units={portalUnits}
        powers={allPowers}
        combatOrders={combatOrders}
        movements={movements}
        breakthroughs={campaign.breakthroughs.map((b) => ({
          nation: b.nation,
          techKey: b.techKey,
          roundNumber: b.roundNumber,
        }))}
      />

      {/* Hand-off rail — jump the turn to another power (corrections / catch-up) */}
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label shrink-0">Turn order</span>
          {TURN_ORDER.map((key, i) => {
            const p = POWERS_BY_KEY[key];
            const isActive = key === activeKey;
            return (
              <form action={setActivePower} key={key} className="flex items-center gap-3">
                {i > 0 && <span style={{ color: "var(--faint)" }}>→</span>}
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors"
                  style={{
                    border: `1px solid ${isActive ? p.color : "transparent"}`,
                    background: isActive ? "var(--surface-2)" : "transparent",
                    color: isActive ? p.color : "var(--muted)",
                  }}
                  title={`Hand the turn to ${p.name} (${controllerByPower.get(key) ?? "unassigned"})`}
                >
                  <Image src={p.flag} alt="" width={18} height={12} className="rounded-[2px] border border-border" />
                  {p.name}
                </button>
                <input type="hidden" name="campaignId" value={id} />
                <input type="hidden" name="powerKey" value={key} />
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
