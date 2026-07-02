/**
 * Apply Prisma migrations to the Docker-free local database (PGlite, in-process)
 * — the local equivalent of `prisma migrate deploy`, which can't be used here
 * because PGlite has no server to connect to.
 *
 * Run it with the dev server stopped (PGlite is single-writer per data dir):
 *   npm run db:migrate
 *
 * Idempotent: tracks applied migrations in `_prisma_migrations`, so re-running
 * only applies new ones. Production (Render) keeps using `prisma migrate deploy`
 * against its managed Postgres — this script is local-only.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const DATA_DIR = process.env.PGLITE_DATA ?? "./.pgdata";
const MIGRATIONS_DIR = "prisma/migrations";

const db = await PGlite.create({ dataDir: DATA_DIR });

// Prisma's migration ledger (the columns we need to record applied migrations).
await db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  id varchar(36) PRIMARY KEY,
  checksum varchar(64) NOT NULL DEFAULT '',
  finished_at timestamptz,
  migration_name varchar(255) NOT NULL,
  logs text,
  rolled_back_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  applied_steps_count integer NOT NULL DEFAULT 0
);`);

const applied = new Set(
  (await db.query(`select migration_name from "_prisma_migrations"`)).rows.map(
    (r) => r.migration_name,
  ),
);

const names = readdirSync(MIGRATIONS_DIR)
  .filter((n) => existsSync(join(MIGRATIONS_DIR, n, "migration.sql")))
  .sort();

let applan = 0;
for (const name of names) {
  if (applied.has(name)) {
    console.log(`= ${name} (already applied)`);
    continue;
  }
  console.log(`▸ applying ${name}…`);
  const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
  await db.exec(sql);
  // checksum = sha256(migration.sql), matching Prisma — required NOT NULL when
  // the ledger was first created by `prisma migrate deploy`.
  const checksum = createHash("sha256").update(sql).digest("hex");
  await db.query(
    `insert into "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
     values ($1, $2, $3, now(), 1)`,
    [randomUUID(), checksum, name],
  );
  applan++;
}

console.log(applan ? `✓ applied ${applan} migration(s)` : "✓ database already up to date");
await db.close();
