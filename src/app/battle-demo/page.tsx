import BattleStage from "@/components/BattleStage";
import BombingRaid from "@/components/BombingRaid";

// Dev/verification route: the full battle simulator with no database dependency,
// so it can be exercised with `next dev` even without a local Postgres.
export const dynamic = "force-static";

export default function BattleDemoPage() {
  return (
    <div className="max-w-4xl mx-auto py-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Battle Simulator</h1>
      <p className="label">
        Anniversary Edition general combat — build the forces, then resolve it
        round by round with real dice.
      </p>
      <BattleStage />
      <BombingRaid />
    </div>
  );
}
