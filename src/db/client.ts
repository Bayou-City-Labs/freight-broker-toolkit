import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbEnv } from "@/env/db";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * Anything that can run a query: the pool, or a transaction inside it.
 * Repositories accept this so the same code works under a test transaction
 * that gets rolled back.
 */
export type DbExecutor =
  | PostgresJsDatabase<Schema>
  | PgTransaction<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

function createClient() {
  return postgres(dbEnv.DATABASE_URL, { max: 5 });
}

// Next.js reloads modules on every edit in development; without this the
// process accumulates connection pools until Postgres refuses new ones.
const globalForDb = globalThis as unknown as {
  freightSql?: ReturnType<typeof createClient>;
};

const sql = globalForDb.freightSql ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalForDb.freightSql = sql;
}

export const db: PostgresJsDatabase<Schema> = drizzle(sql, { schema });
