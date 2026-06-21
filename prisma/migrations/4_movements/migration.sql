-- Noncombat Move log (Phase 5): repositions recorded per power per round.

CREATE TABLE "Movement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "nation" TEXT NOT NULL,
    "fromTerritory" TEXT,
    "toTerritory" TEXT,
    "units" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Movement_campaignId_roundNumber_idx" ON "Movement"("campaignId", "roundNumber");

ALTER TABLE "Movement" ADD CONSTRAINT "Movement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
