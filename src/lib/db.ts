import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reuse a single PrismaClient across hot reloads in development to avoid
// exhausting database connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7's generated client connects through a driver adapter rather than a
// datasource URL. Next.js loads .env into process.env for us. We target
// PostgreSQL (e.g. Render's managed Postgres in production, or a local Postgres
// for development — see docker-compose.yml / RENDER.md).
function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
