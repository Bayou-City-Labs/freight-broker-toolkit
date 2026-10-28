import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { default: postgres } = await import("postgres");

/**
 * Applies committed SQL migrations from ./drizzle.
 *
 * Migrations are generated (`npm run db:generate`) and committed rather than
 * pushed from the schema, so every schema change is a reviewable artifact with
 * a known order — which is the whole point of an audit trail.
 *
 * Accepts a connection string argument so the test harness can migrate the
 * test database without touching DATABASE_URL.
 */
const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("No connection string. Pass one as an argument or set DATABASE_URL.");
}

const sql = postgres(url, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await sql.end();
}
