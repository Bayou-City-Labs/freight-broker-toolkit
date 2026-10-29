import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * Applies committed SQL migrations from ./drizzle.
 *
 * Migrations are generated (`npm run db:generate`) and committed rather than
 * pushed from the schema, so every schema change is a reviewable artifact with
 * a known order — which is the whole point of an audit trail.
 *
 * Accepts a connection string argument so a deployed database can be migrated
 * without changing DATABASE_URL:
 *   npx tsx src/db/migrate.ts "postgresql://..."
 *
 * Note: no top-level await. package.json has no `"type": "module"`, so tsx
 * transforms this file as CJS and top-level await is a build error.
 */
async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("No connection string. Pass one as an argument or set DATABASE_URL.");
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied to ${new URL(url).host}`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
