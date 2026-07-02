import type { Metadata } from "next";
import Link from "next/link";
import { Staatliches, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Staatliches({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "War Ledger — Axis & Allies Anniversary",
  description:
    "Campaign tracker and analytics for Axis & Allies Anniversary Edition.",
};

/** Compass-rose roundel — the War Ledger mark. */
function Roundel({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="11" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7.5" stroke="var(--accent)" strokeWidth="0.75" opacity="0.5" />
      <path
        d="M12 2.5 L14 10 L21.5 12 L14 14 L12 21.5 L10 14 L2.5 12 L10 10 Z"
        fill="var(--accent)"
      />
      <circle cx="12" cy="12" r="1.6" fill="var(--background)" />
    </svg>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header
          className="border-b border-border sticky top-0 z-10"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, transparent), color-mix(in srgb, var(--surface) 80%, transparent))",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <Link href="/campaigns" className="flex items-center gap-2.5">
              <Roundel />
              <span
                className="display text-xl tracking-wide"
                style={{ color: "var(--foreground)" }}
              >
                War Ledger
              </span>
              <span className="label hidden sm:inline" style={{ marginTop: 3 }}>
                Anniversary Edition
              </span>
            </Link>
            <Link href="/campaigns" className="label hover:text-foreground">
              Campaigns
            </Link>
          </div>
          {/* brass hairline under the header */}
          <div
            aria-hidden
            style={{
              height: 1,
              background:
                "linear-gradient(90deg, transparent, var(--accent-dim) 30%, var(--accent-dim) 70%, transparent)",
              opacity: 0.5,
            }}
          />
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 relative z-[2]">
          {children}
        </main>
        <footer className="border-t border-border py-4 relative z-[2]">
          <p className="mx-auto max-w-6xl px-4 label" style={{ textTransform: "none", letterSpacing: "0.02em" }}>
            Unofficial fan tool · Axis &amp; Allies® is a trademark of Hasbro, Inc.
          </p>
        </footer>
      </body>
    </html>
  );
}
