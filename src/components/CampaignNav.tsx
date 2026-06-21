import Link from "next/link";

const TABS = [
  { key: "war-room", label: "War Room", href: (id: string) => `/campaigns/${id}` },
  { key: "production", label: "Production", href: (id: string) => `/campaigns/${id}/production` },
  { key: "battle", label: "Battle", href: (id: string) => `/campaigns/${id}/battle` },
  { key: "rulebook", label: "Rulebook + Ask", href: (id: string) => `/campaigns/${id}/rulebook` },
];

export default function CampaignNav({
  id,
  asQuery,
  active,
}: {
  id: string;
  asQuery: string;
  active: "war-room" | "production" | "battle" | "rulebook";
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${t.href(id)}${asQuery}`}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-t"
            style={
              isActive
                ? { color: "var(--accent)", borderBottom: "2px solid var(--accent)" }
                : { color: "var(--muted)" }
            }
          >
            {t.label}
          </Link>
        );
      })}
      <a
        href={`/campaigns/${id}/export`}
        className="ml-auto px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground"
      >
        ↓ Export JSON
      </a>
    </nav>
  );
}
