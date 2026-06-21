-- Combat Move orders: declared attacks (Phase 3) resolved on the Battle page (Phase 4).

CREATE TABLE "CombatMoveOrder" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "attackerNation" TEXT NOT NULL,
    "defenderNation" TEXT NOT NULL,
    "territory" TEXT,
    "territoryIpc" INTEGER NOT NULL DEFAULT 0,
    "units" JSONB NOT NULL,
    "amphibious" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatMoveOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CombatMoveOrder_campaignId_roundNumber_idx" ON "CombatMoveOrder"("campaignId", "roundNumber");

ALTER TABLE "CombatMoveOrder" ADD CONSTRAINT "CombatMoveOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
