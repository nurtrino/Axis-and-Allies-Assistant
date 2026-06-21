-- AlterTable: add the Research & Development toggle to Campaign.
ALTER TABLE "Campaign" ADD COLUMN "includeResearch" BOOLEAN NOT NULL DEFAULT true;
