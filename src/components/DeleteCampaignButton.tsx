"use client";

import { useState, useTransition } from "react";
import { deleteCampaign } from "@/app/actions";

export default function DeleteCampaignButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await deleteCampaign(fd);
    });
  }

  if (confirming) {
    return (
      <div
        className="absolute top-2 right-2 z-10 flex items-center gap-1 panel px-2 py-1"
        // Stop the surrounding card link from navigating.
        onClick={(e) => e.preventDefault()}
      >
        <span className="label">Delete?</span>
        <button
          type="button"
          className="btn px-2 py-1"
          style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
          onClick={doDelete}
          disabled={pending}
          aria-label={`Confirm delete ${name}`}
        >
          {pending ? "…" : "Yes"}
        </button>
        <button
          type="button"
          className="btn px-2 py-1"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="absolute top-2 right-2 z-10 w-6 h-6 rounded flex items-center justify-center text-muted hover:text-[var(--bad)]"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      onClick={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
      aria-label={`Delete ${name}`}
      title={`Delete ${name}`}
    >
      ✕
    </button>
  );
}
