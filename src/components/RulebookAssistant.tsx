"use client";

import { useState } from "react";

interface QA {
  question: string;
  answer: string;
}

const SUGGESTIONS = [
  "How do amphibious assaults work?",
  "Can my submarine submerge if an enemy destroyer is present?",
  "How do National Objectives grant bonus income?",
  "Given the board, where should I focus my next offensive?",
];

export default function RulebookAssistant({
  campaignId,
  playerId,
  playerName,
}: {
  campaignId: string;
  playerId: string | null;
  playerName: string | null;
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QA[]>([]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, as: playerId, question: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed.");
      } else {
        setHistory((h) => [{ question: text, answer: data.answer }, ...h]);
        setQuestion("");
      }
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel p-5 flex flex-col gap-3">
      <div>
        <div className="label">Ask Claude — rules &amp; strategy</div>
        <p className="label mt-1">
          Grounded in the full Anniversary rulebook
          {playerName ? ` and aware of ${playerName}'s position` : " and the current game state"}.
        </p>
      </div>

      <div className="flex gap-2">
        <textarea
          className="field flex-1"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(question);
          }}
          placeholder="Ask a rules question, or for strategy advice on the current board…"
        />
        <button
          className="btn btn-primary self-stretch"
          onClick={() => ask(question)}
          disabled={pending}
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="label hover:text-accent text-left"
            style={{ border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px" }}
            onClick={() => ask(s)}
            disabled={pending}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--bad)" }}>{error}</p>
      )}

      <div className="flex flex-col gap-3">
        {history.map((qa, i) => (
          <div key={i} className="border-t border-border pt-3">
            <div className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              {qa.question}
            </div>
            <div className="text-sm mt-1 whitespace-pre-wrap leading-relaxed">
              {qa.answer}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
