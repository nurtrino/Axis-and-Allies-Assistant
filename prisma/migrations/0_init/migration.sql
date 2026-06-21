-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opponent" TEXT,
    "side" TEXT NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT 'Y1942',
    "trackingMode" TEXT NOT NULL DEFAULT 'DETAILED',
    "victoryCityGoal" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerAssignment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "powerKey" TEXT NOT NULL,

    CONSTRAINT "PowerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tcEuropeOwned" INTEGER,
    "tcEuropeTotal" INTEGER,
    "tcAsiaOwned" INTEGER,
    "tcAsiaTotal" INTEGER,
    "tcAmericasOwned" INTEGER,
    "tcAmericasTotal" INTEGER,
    "vcAxis" INTEGER,
    "vcAllies" INTEGER,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NationEntry" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "nation" TEXT NOT NULL,
    "income" INTEGER NOT NULL DEFAULT 0,
    "objectiveBonus" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "ipcRemaining" INTEGER NOT NULL DEFAULT 0,
    "attackPower" INTEGER NOT NULL DEFAULT 0,
    "ipcLost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loss" (
    "id" TEXT NOT NULL,
    "nationEntryId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Loss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomberRaid" (
    "id" TEXT NOT NULL,
    "nationEntryId" TEXT NOT NULL,
    "bombers" INTEGER NOT NULL DEFAULT 1,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "bombersLost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BomberRaid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Player_campaignId_idx" ON "Player"("campaignId");

-- CreateIndex
CREATE INDEX "PowerAssignment_campaignId_idx" ON "PowerAssignment"("campaignId");

-- CreateIndex
CREATE INDEX "PowerAssignment_playerId_idx" ON "PowerAssignment"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PowerAssignment_campaignId_powerKey_key" ON "PowerAssignment"("campaignId", "powerKey");

-- CreateIndex
CREATE INDEX "Round_campaignId_idx" ON "Round"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Round_campaignId_number_key" ON "Round"("campaignId", "number");

-- CreateIndex
CREATE INDEX "NationEntry_roundId_idx" ON "NationEntry"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "NationEntry_roundId_nation_key" ON "NationEntry"("roundId", "nation");

-- CreateIndex
CREATE INDEX "Loss_nationEntryId_idx" ON "Loss"("nationEntryId");

-- CreateIndex
CREATE INDEX "BomberRaid_nationEntryId_idx" ON "BomberRaid"("nationEntryId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerAssignment" ADD CONSTRAINT "PowerAssignment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerAssignment" ADD CONSTRAINT "PowerAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NationEntry" ADD CONSTRAINT "NationEntry_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loss" ADD CONSTRAINT "Loss_nationEntryId_fkey" FOREIGN KEY ("nationEntryId") REFERENCES "NationEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomberRaid" ADD CONSTRAINT "BomberRaid_nationEntryId_fkey" FOREIGN KEY ("nationEntryId") REFERENCES "NationEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

