"use client";

import { useState } from "react";

type State = "idle" | "restarting" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RestartButton() {
  const [state, setState] = useState<State>("idle");

  async function restart() {
    if (state === "restarting") return;
    setState("restarting");
    try {
      await fetch("/api/restart", { method: "POST" });
    } catch {
      // Expected — the server exits mid-request. Fall through to polling.
    }
    // Poll until the new server answers, then reload.
    const deadline = Date.now() + 90_000;
    await sleep(1500);
    while (Date.now() < deadline) {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // server still down — keep waiting
      }
      await sleep(1000);
    }
    setState("error");
  }

  const restarting = state === "restarting";

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <button
        type="button"
        onClick={restart}
        disabled={restarting}
        className="btn"
        title="Stop and relaunch the dev server (picks up .env and config changes)"
        style={restarting ? { opacity: 0.7 } : undefined}
      >
        <span style={{ color: state === "error" ? "var(--bad)" : "var(--accent)" }}>⟳</span>
        {restarting ? "Restarting…" : state === "error" ? "Restart failed — retry" : "Restart Server"}
      </button>
    </div>
  );
}
