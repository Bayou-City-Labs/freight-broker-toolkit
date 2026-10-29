import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * Brings the test database up to the committed migrations once per run, so a
 * schema change that was generated but not applied fails the suite rather than
 * passing against a stale database.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env.example to .env.local and run `npm run db:up`.",
    );
  }

  // The migrator's CREATE ... IF NOT EXISTS statements emit NOTICEs on every
  // run after the first; they are not interesting and drown the test output.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }
}
