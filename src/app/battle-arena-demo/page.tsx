import BattleStage from "@/components/BattleStage";

// DB-free demo of the full battle arena: the 3D battlefield and the dice roll
// shown side by side (build forces, then resolve round by round with real dice).
export const dynamic = "force-static";

export default function BattleArenaDemo() {
  return (
    <div className="max-w-[1600px] mx-auto py-6 space-y-4 px-4">
      <div>
        <h1 >Battle Arena — Demo</h1>
        <p className="label mt-1">
          The 3D battlefield and the dice roll, side by side. Build both forces,
          press Begin Battle, then roll it out round by round — attacker (blue)
          and defender (red) fire, casualties sink/burn as the dice land.
        </p>
      </div>
      <BattleStage />
    </div>
  );
}
