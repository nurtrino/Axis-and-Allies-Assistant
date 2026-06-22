"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importCampaign } from "@/app/actions";

export default function ImportCampaign() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErr(null);
    setText(await file.text());
  }

  function load() {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setErr("That isn't valid JSON. Paste the file contents or choose a .json file.");
      return;
    }
    start(async () => {
      try {
        const id = await importCampaign(parsed);
        router.push(`/campaigns/${id}`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Import failed.");
      }
    });
  }

  return (
    <div className="panel p-5 space-y-4">
      <div>
        <label className="label block mb-1">Choose an exported .json file</label>
        <input
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          className="block text-sm"
        />
        {fileName && <div className="label mt-1">Loaded: {fileName}</div>}
      </div>

      <div className="label text-center">— or paste the JSON —</div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder='{ "exportedFrom": "War Ledger", "campaign": { … } }'
        rows={8}
        className="w-full bg-surface-2 rounded border border-border px-3 py-2 text-sm font-mono"
      />

      {err && (
        <div className="text-sm" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="label max-w-md">
          The game is restored as a new campaign (fresh IDs), so importing never
          overwrites an existing game — it&apos;s also a safe way to clone one.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!text.trim() || pending}
          onClick={load}
        >
          {pending ? "Loading…" : "Load Game"}
        </button>
      </div>
    </div>
  );
}
