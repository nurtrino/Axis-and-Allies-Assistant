export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight liveness probe used by the restart button to detect when the
// freshly started dev server is accepting requests again.
export function GET() {
  return Response.json({ ok: true });
}
