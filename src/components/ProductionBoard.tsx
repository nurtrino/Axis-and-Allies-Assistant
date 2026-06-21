"use client";

import Image from "next/image";
import {
  BREAKTHROUGHS,
  PRODUCTION_TRACK_MAX,
  type Coalition,
} from "@/lib/anniversary.config";

export interface BoardPower {
  key: string;
  name: string;
  color: string;
  flag: string;
  coalition: Coalition;
  income: number;
}

// Parchment palette to evoke the printed board.
const PARCHMENT = "#cdb78c";
const PARCHMENT_DARK = "#b89f6f";
const INK = "#3d2f1b";
const GOLD = "#9c7f3a";
const BAND = "#2f2113";
const BANNER_FROM = "#c0492f";
const BANNER_TO = "#9b3a23";

function trackNumber(income: number): number | null {
  if (income <= 0) return null;
  return Math.min(income, PRODUCTION_TRACK_MAX);
}

function BreakthroughColumn({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div
      className="flex flex-col"
      style={{ border: `1px solid ${GOLD}`, borderRadius: 4, overflow: "hidden", minWidth: 92 }}
    >
      <div
        className="px-1 py-1.5 text-center font-semibold leading-tight"
        style={{ background: BAND, color: PARCHMENT, fontSize: 10, letterSpacing: 0.3 }}
      >
        Breakthrough
        <br />
        {title}
      </div>
      <div className="flex-1 flex flex-col">
        {items.map((t, i) => (
          <div
            key={t}
            className="flex-1 flex items-center justify-center text-center px-1 py-1"
            style={{
              color: INK,
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 10.5,
              lineHeight: 1.1,
              borderTop: i === 0 ? "none" : `1px solid ${GOLD}`,
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductionBoard({
  powers,
  includeResearch = true,
}: {
  powers: BoardPower[];
  includeResearch?: boolean;
}) {
  // Group powers by the track number their income lands on.
  const byNumber = new Map<number, BoardPower[]>();
  for (const p of powers) {
    const n = trackNumber(p.income);
    if (n == null) continue;
    const list = byNumber.get(n) ?? [];
    list.push(p);
    byNumber.set(n, list);
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: `linear-gradient(160deg, ${PARCHMENT} 0%, ${PARCHMENT_DARK} 100%)`,
        border: `1px solid ${GOLD}`,
        boxShadow: "inset 0 0 60px rgba(0,0,0,0.15)",
      }}
    >
      {/* Title banner */}
      <div
        className="text-center py-2.5"
        style={{
          background: `linear-gradient(180deg, ${BANNER_FROM}, ${BANNER_TO})`,
          color: "#f5e9cf",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 0.5,
          textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          borderBottom: `2px solid ${GOLD}`,
        }}
      >
        {includeResearch
          ? "National Production / Research & Development Chart"
          : "National Production Chart"}
      </div>

      <div className="p-3 flex flex-wrap gap-3">
        {/* Breakthrough reference columns — only when R&D is in play */}
        {includeResearch && (
          <div className="flex gap-2">
            <BreakthroughColumn title="Chart 1" items={BREAKTHROUGHS.chart1} />
            <BreakthroughColumn title="Chart 2" items={BREAKTHROUGHS.chart2} />
          </div>
        )}

        {/* Income track 1–72 */}
        <div className="flex-1 min-w-[280px]">
          <div className="grid grid-cols-9 gap-1.5">
            {Array.from({ length: PRODUCTION_TRACK_MAX }, (_, i) => i + 1).map((n) => {
              const occupants = byNumber.get(n) ?? [];
              return (
                <div
                  key={n}
                  className="relative aspect-square rounded-full flex items-center justify-center"
                  style={{
                    background: occupants.length
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.12)",
                    border: `2px solid ${GOLD}`,
                  }}
                  title={
                    occupants.length
                      ? `${n} IPC — ${occupants.map((p) => p.name).join(", ")}`
                      : `${n} IPC`
                  }
                >
                  <span
                    style={{
                      color: INK,
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      fontWeight: 700,
                      fontSize: 13,
                      opacity: occupants.length ? 0.35 : 0.85,
                    }}
                  >
                    {n}
                  </span>
                  {occupants.length > 0 && (
                    <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-0.5">
                      {occupants.map((p) => (
                        <Image
                          key={p.key}
                          src={p.flag}
                          alt={p.name}
                          width={24}
                          height={16}
                          className="rounded-sm"
                          style={{
                            border: "1px solid rgba(0,0,0,0.55)",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p
            className="mt-2 text-center"
            style={{ color: INK, fontSize: 11, fontFamily: "Georgia, serif", opacity: 0.8 }}
          >
            Each nation&apos;s marker sits on its current IPC income.
          </p>
        </div>
      </div>
    </div>
  );
}
