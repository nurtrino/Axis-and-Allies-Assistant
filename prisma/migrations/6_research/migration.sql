-- R&D tracker: breakthroughs unlocked per power per campaign (Phase 1).
-- One row per tech — the app tracks WHICH techs a power holds so players
-- don't have to remember chart state between sessions.

CREATE TABLE "Breakthrough" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "nation" TEXT NOT NULL,
    "techKey" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Breakthrough_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Breakthrough_campaignId_nation_techKey_key" ON "Breakthrough"("campaignId", "nation", "techKey");
CREATE INDEX "Breakthrough_campaignId_idx" ON "Breakthrough"("campaignId");

ALTER TABLE "Breakthrough" ADD CONSTRAINT "Breakthrough_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
