"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  SCENARIOS,
  TRACKING_MODES,
  VICTORY_CITY_GOALS,
  POWERS_BY_KEY,
} from "@/lib/anniversary.config";
import { ASSIGNABLE_POWERS } from "@/lib/players";
import { createCampaignWithPlayers } from "@/app/actions";

const MAX_PLAYERS = 6;

// Sensible default power-to-player assignment for a given player count.
function autoAssign(count: number): Record<string, number> {
  const map: Record<string, number> = {};
  const keys = ASSIGNABLE_POWERS.map((p) => p.key);
  if (count === 2) {
    // Coalition split: P0 = Allies, P1 = Axis.
    for (const k of keys) {
      map[k] = POWERS_BY_KEY[k].coalition === "ALLIES" ? 0 : 1;
    }
  } else {
    // Round-robin in turn order.
    keys.forEach((k, i) => {
      map[k] = i % count;
    });
  }
  return map;
}

export default function PlayerSetup() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [scenario, setScenario] = useState("Y1942");
  const [trackingMode, setTrackingMode] = useState("DETAILED");
  const [victoryCityGoal, setVictoryCityGoal] = useState(15);
  const [includeResearch, setIncludeResearch] = useState(true);

  const [players, setPlayers] = useState<string[]>(["", ""]);
  const [assign, setAssign] = useState<Record<string, number>>(autoAssign(2));

  function setPlayerCount(next: string[]) {
    setPlayers(next);
    // Drop assignments pointing past the new last index.
    setAssign((prev) => {
      const fixed: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        fixed[k] = v < next.length ? v : -1;
      }
      return fixed;
    });
  }

  function addPlayer() {
    if (players.length < MAX_PLAYERS) setPlayerCount([...players, ""]);
  }
  function removePlayer(i: number) {
    if (players.length <= 1) return;
    const next = players.filter((_, idx) => idx !== i);
    // Reindex assignments around the removed player.
    setPlayers(next);
    setAssign((prev) => {
      const fixed: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v === i) fixed[k] = -1;
        else if (v > i) fixed[k] = v - 1;
        else fixed[k] = v;
      }
      return fixed;
    });
  }

  function submit() {
    setError(null);
    const named = players.map((n) => n.trim());
    if (named.every((n) => !n)) {
      setError("Enter at least one player name.");
      return;
    }
    const unassigned = ASSIGNABLE_POWERS.filter(
      (p) => (assign[p.key] ?? -1) < 0 || !named[assign[p.key]],
    );
    if (unassigned.length) {
      setError(
        `Assign every power to a named player. Missing: ${unassigned
          .map((p) => p.name)
          .join(", ")}.`,
      );
      return;
    }

    // Invert assignment map → per-player power lists.
    const payloadPlayers = named.map((pname, idx) => ({
      name: pname,
      powers: ASSIGNABLE_POWERS.filter((p) => assign[p.key] === idx).map(
        (p) => p.key,
      ),
    }));

    startTransition(async () => {
      try {
        await createCampaignWithPlayers({
          name,
          scenario,
          trackingMode,
          victoryCityGoal,
          includeResearch,
          players: payloadPlayers,
        });
      } catch (e) {
        // redirect() throws a control-flow signal; only surface real errors.
        if (e instanceof Error && !/NEXT_REDIRECT/.test(e.message)) {
          setError(e.message);
        }
      }
    });
  }

  const usaPlayerIdx = assign["USA"] ?? -1;

  return (
    <div className="max-w-2xl">
      <Link href="/campaigns" className="label hover:text-foreground">
        ← Campaigns
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mt-2 mb-1">
        New Campaign
      </h1>
      <p className="label mb-6">
        Name the players and assign powers. Each player logs their own powers
        from the shared War Room.
      </p>

      <div className="space-y-5">
        {/* Campaign meta */}
        <div className="panel p-5 space-y-4">
          <div>
            <label className="label block mb-1.5">Campaign Name</label>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friday Night Barbarossa"
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="label block mb-1.5">Scenario</label>
              <select className="field" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block mb-1.5">Tracking Mode</label>
              <select className="field" value={trackingMode} onChange={(e) => setTrackingMode(e.target.value)}>
                {TRACKING_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block mb-1.5">Victory Goal</label>
              <select className="field" value={victoryCityGoal} onChange={(e) => setVictoryCityGoal(Number(e.target.value))}>
                {VICTORY_CITY_GOALS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeResearch}
              onChange={(e) => setIncludeResearch(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-sm">Include Research &amp; Development</span>
            <span className="label">— shows the R&amp;D breakthrough columns on the Production board</span>
          </label>
        </div>

        {/* Players */}
        <div className="panel p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="label">Players ({players.length}/{MAX_PLAYERS})</span>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => setAssign(autoAssign(players.length))}>
                Auto-assign powers
              </button>
              <button type="button" className="btn" onClick={addPlayer} disabled={players.length >= MAX_PLAYERS}>
                + Add Player
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            {players.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="label w-6 text-center">P{i + 1}</span>
                <input
                  className="field"
                  value={p}
                  placeholder={`Player ${i + 1} name`}
                  onChange={(e) => {
                    const next = [...players];
                    next[i] = e.target.value;
                    setPlayers(next);
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => removePlayer(i)}
                  disabled={players.length <= 1}
                  aria-label={`Remove player ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Power assignment */}
        <div className="panel p-5 space-y-3">
          <span className="label">Power Assignment</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {ASSIGNABLE_POWERS.map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                <Image src={p.flag} alt="" width={22} height={15} className="rounded-sm border border-border" />
                <span className="font-semibold w-32 shrink-0" style={{ color: p.color }}>
                  {p.name}
                </span>
                <select
                  className="field"
                  value={assign[p.key] ?? -1}
                  onChange={(e) =>
                    setAssign((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))
                  }
                >
                  <option value={-1}>— Unassigned —</option>
                  {players.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name.trim() || `Player ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="label">
            China is controlled by{" "}
            {usaPlayerIdx >= 0
              ? players[usaPlayerIdx]?.trim() || `Player ${usaPlayerIdx + 1}`
              : "the USA player"}{" "}
            (rides with the USA).
          </p>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--bad)" }}>{error}</p>
        )}

        <div className="flex justify-end gap-3">
          <Link href="/campaigns" className="btn">Cancel</Link>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
