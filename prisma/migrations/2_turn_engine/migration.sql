-- Turn engine: per-power phase pointer on the campaign, plus the live
-- cross-round state model (treasury + unit inventory + pending purchases).

-- AlterTable: turn pointer.
ALTER TABLE "Campaign" ADD COLUMN "activePowerKey" TEXT NOT NULL DEFAULT 'USSR';
ALTER TABLE "Campaign" ADD COLUMN "activePhase" INTEGER NOT NULL DEFAULT 2;

-- CreateTable: NationState (authoritative live state per power).
CREATE TABLE "NationState" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "nation" TEXT NOT NULL,
    "ipc" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UnitStock (mobilized unit inventory).
CREATE TABLE "UnitStock" (
    "id" TEXT NOT NULL,
    "nationStateId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UnitStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PendingUnit (purchased, not yet placed).
CREATE TABLE "PendingUnit" (
    "id" TEXT NOT NULL,
    "nationStateId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PendingUnit_pkey" PRIMARY KEY ("id")
);

-- Indexes & constraints.
CREATE UNIQUE INDEX "NationState_campaignId_nation_key" ON "NationState"("campaignId", "nation");
CREATE INDEX "NationState_campaignId_idx" ON "NationState"("campaignId");
CREATE UNIQUE INDEX "UnitStock_nationStateId_unitType_key" ON "UnitStock"("nationStateId", "unitType");
CREATE INDEX "UnitStock_nationStateId_idx" ON "UnitStock"("nationStateId");
CREATE INDEX "PendingUnit_nationStateId_idx" ON "PendingUnit"("nationStateId");

-- Foreign keys.
ALTER TABLE "NationState" ADD CONSTRAINT "NationState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitStock" ADD CONSTRAINT "UnitStock_nationStateId_fkey" FOREIGN KEY ("nationStateId") REFERENCES "NationState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingUnit" ADD CONSTRAINT "PendingUnit_nationStateId_fkey" FOREIGN KEY ("nationStateId") REFERENCES "NationState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
