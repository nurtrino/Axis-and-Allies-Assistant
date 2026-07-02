import Link from "next/link";
import ImportCampaign from "@/components/ImportCampaign";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <Link href="/campaigns" className="label hover:text-foreground">
          ← Campaigns
        </Link>
        <h1 className="mt-1">
          Import / Load Game
        </h1>
        <p className="label mt-1">
          Restore a campaign from a War Ledger JSON export — the full game state,
          including treasuries, unit inventories, declared moves, and history.
        </p>
      </div>

      <ImportCampaign />
    </div>
  );
}
