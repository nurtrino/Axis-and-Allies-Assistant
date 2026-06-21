import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";

// Restart the dev server: launch a detached helper (node) that waits for this
// process to release port 3000, then relaunches the dev server hidden. This
// process exits shortly after responding.
//
// This is a local-development convenience only. In a hosted/production
// deployment (e.g. Render) there is no dev server to relaunch — killing this
// process would just take the site down — so the route is disabled there. The
// platform's own restart/redeploy controls take its place.
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Restart is disabled in production; use your host's restart control." },
      { status: 404 },
    );
  }

  const cwd = process.cwd();
  try {
    const child = spawn(process.execPath, [path.join(cwd, "scripts", "restart.js")], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: `Could not launch restarter: ${detail}` }, { status: 500 });
  }

  setTimeout(() => process.exit(0), 600);
  return Response.json({ ok: true });
}
