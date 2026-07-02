-- Pre-game setting: how a power's combat moves flow into battles.
-- "DECLARE_THEN_FIGHT" (declare all, then fight) | "FIGHT_EACH" (fight as declared).

ALTER TABLE "Campaign" ADD COLUMN "combatResolution" TEXT NOT NULL DEFAULT 'DECLARE_THEN_FIGHT';
