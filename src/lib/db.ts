import { PrismaClient } from "@/generated/prisma/client";

// Reuse a single PrismaClient across hot reloads in development to avoid
// exhausting connections (and, for PGlite, re-opening the same data dir twice).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 connects through a driver adapter. We support two:
//
//  • Production / any real Postgres → `@prisma/adapter-pg` over DATABASE_URL
//    (e.g. Render's managed Postgres — see RENDER.md).
//  • Docker-free local development → PGlite (in-process Postgres) via
//    `pglite-prisma-adapter`, selected by setting PGLITE_DATA to a data dir
//    (see .env / scripts/db-migrate.mjs). This talks to PGlite directly — no
//    server process and no wire protocol — which sidesteps PGlite's partial
//    socket-protocol support that breaks Prisma's prepared statements.
//
// Dynamic imports keep each adapter (and PGlite's WASM) out of the bundle when
// it isn't the one in use.
async function createClient(): Promise<PrismaClient> {
  const pgliteData = process.env.PGLITE_DATA;
  // Skip PGlite during `next build`: nothing queries the DB at build time (the
  // DB-backed routes are force-dynamic), and PGlite's single-writer data dir
  // can't be opened by the many parallel build workers. The pg adapter below is
  // created but never connects at build, so the build stays clean.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (pgliteData && !isBuild) {
    const [{ PGlite }, { PrismaPGlite }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("pglite-prisma-adapter"),
    ]);
    const adapter = new PrismaPGlite(new PGlite(pgliteData));
    return new PrismaClient({ adapter });
  }
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (await createClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
