import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "War Ledger — Axis & Allies Anniversary",
  description:
    "Campaign tracker and analytics for Axis & Allies Anniversary Edition.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface/60 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <Link href="/campaigns" className="flex items-center gap-2">
              <span className="text-accent text-lg">▰</span>
              <span className="font-mono tracking-widest text-sm">
                WAR&nbsp;LEDGER
              </span>
              <span className="label hidden sm:inline">
                · Anniversary Edition
              </span>
            </Link>
            <Link href="/campaigns" className="label hover:text-foreground">
              Campaigns
            </Link>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-border py-4">
          <p className="mx-auto max-w-6xl px-4 label">
            Unofficial fan tool · Axis &amp; Allies® is a trademark of Hasbro,
            Inc.
          </p>
        </footer>
      </body>
    </html>
  );
}
