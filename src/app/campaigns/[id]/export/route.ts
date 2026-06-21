import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
      rounds: {
        orderBy: { number: "asc" },
        include: { entries: { include: { losses: true, raids: true } } },
      },
    },
  });
  if (!campaign) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const slug = campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign";
  const body = JSON.stringify(
    { exportedFrom: "War Ledger", edition: "Anniversary", campaign },
    null,
    2,
  );

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${slug}.json"`,
    },
  });
}
