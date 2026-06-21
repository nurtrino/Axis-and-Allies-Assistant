"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  POWERS,
  UNITS,
  UNITS_BY_KEY,
  type TrackingMode,
} from "@/lib/anniversary.config";
import { saveRound, type SaveRoundInput } from "@/app/actions";

export interface InitialEntry {
  nation: string;
  income: number;
  objectiveBonus: number;
  purchases: number;
  ipcRemaining: number;
  attackPower: number;
  ipcLost: number;
  losses: Record<string, number>;
  raid: { bombers: number; damage: number; bombersLost: number };
}

interface Territory {
  tcEuropeOwned: number | null;
  tcEuropeTotal: number | null;
  tcAsiaOwned: number | null;
  tcAsiaTotal: number | null;
  tcAmericasOwned: number | null;
  tcAmericasTotal: number | null;
  vcAxis: number | null;
  vcAllies: number | null;
}

function num(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export default function RoundEditor({
  campaignId,
  roundId,
  number,
  trackingMode,
  initialNotes,
  initialTerritory,
  initialEntries,
  focusPowers = [],
  focusLabel = null,
}: {
  campaignId: string;
  roundId: string;
  number: number;
  trackingMode: TrackingMode;
  initialNotes: string;
  initialTerritory: Territory;
  initialEntries: InitialEntry[];
  focusPowers?: string[];
  focusLabel?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [territory, setTerritory] = useState<Territory>(initialTerritory);
  const [entries, setEntries] = useState<InitialEntry[]>(initialEntries);
  const [showAll, setShowAll] = useState(focusPowers.length === 0);

  // Powers shown as accordions. State always holds all 7, so saving never
  // clobbers another commander's entries — only the display is filtered.
  const visiblePowers =
    showAll || focusPowers.length === 0
      ? POWERS
      : POWERS.filter((p) => focusPowers.includes(p.key));

  const [open, setOpen] = useState<string | null>(
    (focusPowers.length ? focusPowers[0] : POWERS[0]?.key) ?? null,
  );

  const detailed = trackingMode === "DETAILED";

  function patchEntry(nation: string, patch: Partial<InitialEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.nation === nation ? { ...e, ...patch } : e)),
    );
    setSaved(false);
  }
  function patchLoss(nation: string, unit: string, qty: number) {
    setEntries((prev) =>
      prev.map((e) =>
        e.nation === nation
          ? { ...e, losses: { ...e.losses, [unit]: qty } }
          : e,
      ),
    );
    setSaved(false);
  }

  function lossTotal(e: InitialEntry): number {
    return Object.entries(e.losses).reduce(
      (s, [k, q]) => s + (UNITS_BY_KEY[k]?.cost ?? 0) * q,
      0,
    );
  }

  function tNum(field: keyof Territory, v: string) {
    setTerritory((prev) => ({ ...prev, [field]: v === "" ? null : num(v) }));
    setSaved(false);
  }

  function save() {
    const payload: SaveRoundInput = {
      roundId,
      campaignId,
      number,
      notes,
      territory,
      entries: entries.map((e) => ({
        nation: e.nation,
        income: e.income,
        objectiveBonus: e.objectiveBonus,
        purchases: e.purchases,
        ipcRemaining: e.ipcRemaining,
        attackPower: e.attackPower,
        // In FAST mode the itemized losses are empty and ipcLost carries the
        // value; in DETAILED mode ipcLost stays 0 and losses are itemized.
        ipcLost: detailed ? 0 : e.ipcLost,
        losses: detailed
          ? Object.entries(e.losses).map(([unitType, quantity]) => ({ unitType, quantity }))
          : [],
        raids:
          e.raid.bombers > 0 || e.raid.damage > 0 ? [e.raid] : [],
      })),
    };
    startTransition(async () => {
      await saveRound(payload);
      setSaved(true);
      router.refresh();
    });
  }

  const numField =
    "field stat text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="space-y-4">
      {/* Focus toggle for multiplayer */}
      {focusPowers.length > 0 && (
        <div className="flex items-center justify-between panel px-4 py-2">
          <span className="label">
            {showAll
              ? "Showing all powers (scorekeeper)"
              : `Showing ${focusLabel ?? "your"} powers`}
          </span>
          <button type="button" className="btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show only mine" : "Show all powers"}
          </button>
        </div>
      )}

      {/* Nation accordions */}
      <div className="space-y-2">
        {visiblePowers.map((p) => {
          const e = entries.find((x) => x.nation === p.key)!;
          const isOpen = open === p.key;
          return (
            <div key={p.key} className="panel">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : p.key)}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: p.color }}
                  />
                  <span className="font-semibold">{p.name}</span>
                  <span className="label">{p.coalition}</span>
                </span>
                <span className="label stat">
                  IPC {e.income + e.objectiveBonus} · AP {e.attackPower}
                  {detailed
                    ? lossTotal(e) > 0 ? ` · −${lossTotal(e)} lost` : ""
                    : e.ipcLost > 0 ? ` · −${e.ipcLost} lost` : ""}
                  <span className="ml-2">{isOpen ? "▾" : "▸"}</span>
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-border pt-4 space-y-4">
                  {/* Economy row */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <Labeled label="Income">
                      <input className={numField} type="number" value={e.income}
                        onChange={(ev) => patchEntry(p.key, { income: num(ev.target.value) })} />
                    </Labeled>
                    <Labeled label="NO Bonus">
                      <input className={numField} type="number" value={e.objectiveBonus}
                        onChange={(ev) => patchEntry(p.key, { objectiveBonus: num(ev.target.value) })} />
                    </Labeled>
                    <Labeled label="Purchases">
                      <input className={numField} type="number" value={e.purchases}
                        onChange={(ev) => patchEntry(p.key, { purchases: num(ev.target.value) })} />
                    </Labeled>
                    <Labeled label="IPC Banked">
                      <input className={numField} type="number" value={e.ipcRemaining}
                        onChange={(ev) => patchEntry(p.key, { ipcRemaining: num(ev.target.value) })} />
                    </Labeled>
                    <Labeled label="Attack Power">
                      <input className={numField} type="number" value={e.attackPower}
                        onChange={(ev) => patchEntry(p.key, { attackPower: num(ev.target.value) })} />
                    </Labeled>
                    {!detailed && (
                      <Labeled label="IPC Lost">
                        <input className={numField} type="number" value={e.ipcLost}
                          onChange={(ev) => patchEntry(p.key, { ipcLost: num(ev.target.value) })} />
                      </Labeled>
                    )}
                  </div>

                  {/* Loss calculator (detailed mode) */}
                  {detailed && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="label">Losses (Loss Calculator)</span>
                        <span className="label stat">
                          Total: <span style={{ color: "var(--bad)" }}>−{lossTotal(e)} IPC</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                        {UNITS.filter((u) => u.domain !== "structure").map((u) => (
                          <label key={u.key} className="flex flex-col gap-1">
                            <span className="label" title={`${u.cost} IPC`}>
                              {u.name}
                            </span>
                            <input
                              className={numField}
                              type="number"
                              min={0}
                              value={e.losses[u.key] ?? 0}
                              onChange={(ev) =>
                                patchLoss(p.key, u.key, num(ev.target.value))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bomber raid */}
                  <div>
                    <span className="label">Strategic Bombing Raid</span>
                    <div className="grid grid-cols-3 gap-3 mt-1">
                      <Labeled label="Bombers">
                        <input className={numField} type="number" min={0} value={e.raid.bombers}
                          onChange={(ev) => patchEntry(p.key, { raid: { ...e.raid, bombers: num(ev.target.value) } })} />
                      </Labeled>
                      <Labeled label="Damage (IPC)">
                        <input className={numField} type="number" min={0} value={e.raid.damage}
                          onChange={(ev) => patchEntry(p.key, { raid: { ...e.raid, damage: num(ev.target.value) } })} />
                      </Labeled>
                      <Labeled label="Bombers Lost">
                        <input className={numField} type="number" min={0} value={e.raid.bombersLost}
                          onChange={(ev) => patchEntry(p.key, { raid: { ...e.raid, bombersLost: num(ev.target.value) } })} />
                      </Labeled>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Board snapshot */}
      <div className="panel p-4 space-y-3">
        <span className="label">Board Snapshot (optional)</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Labeled label="VC — Axis">
            <input className={numField} type="number" value={territory.vcAxis ?? ""}
              onChange={(ev) => tNum("vcAxis", ev.target.value)} />
          </Labeled>
          <Labeled label="VC — Allies">
            <input className={numField} type="number" value={territory.vcAllies ?? ""}
              onChange={(ev) => tNum("vcAllies", ev.target.value)} />
          </Labeled>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <RegionPair label="Europe & Africa" owned={territory.tcEuropeOwned} total={territory.tcEuropeTotal}
            onOwned={(v) => tNum("tcEuropeOwned", v)} onTotal={(v) => tNum("tcEuropeTotal", v)} numField={numField} />
          <RegionPair label="Asia & Pacific" owned={territory.tcAsiaOwned} total={territory.tcAsiaTotal}
            onOwned={(v) => tNum("tcAsiaOwned", v)} onTotal={(v) => tNum("tcAsiaTotal", v)} numField={numField} />
          <RegionPair label="Americas" owned={territory.tcAmericasOwned} total={territory.tcAmericasTotal}
            onOwned={(v) => tNum("tcAmericasOwned", v)} onTotal={(v) => tNum("tcAmericasTotal", v)} numField={numField} />
        </div>
      </div>

      {/* Notes */}
      <div className="panel p-4">
        <span className="label block mb-1.5">Round Notes</span>
        <textarea
          className="field"
          rows={2}
          value={notes}
          onChange={(ev) => {
            setNotes(ev.target.value);
            setSaved(false);
          }}
          placeholder="e.g. Bloodbath in Karelia — 3.5:1 trade"
        />
      </div>

      {/* Save */}
      <div className="flex items-center justify-end gap-3 sticky bottom-4">
        {saved && <span className="label" style={{ color: "var(--good)" }}>✓ Saved</span>}
        <button className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save Round"}
        </button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function RegionPair({
  label, owned, total, onOwned, onTotal, numField,
}: {
  label: string;
  owned: number | null;
  total: number | null;
  onOwned: (v: string) => void;
  onTotal: (v: string) => void;
  numField: string;
}) {
  return (
    <div>
      <span className="label block mb-1">{label}</span>
      <div className="flex items-center gap-1">
        <input className={numField} type="number" placeholder="held" value={owned ?? ""} onChange={(e) => onOwned(e.target.value)} />
        <span className="text-muted">/</span>
        <input className={numField} type="number" placeholder="total" value={total ?? ""} onChange={(e) => onTotal(e.target.value)} />
      </div>
    </div>
  );
}
