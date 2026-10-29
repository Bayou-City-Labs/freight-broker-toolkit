import { db, type DbExecutor } from "@/db/client";
import { brokerages } from "@/db/schema";
import { newId } from "@/domain/ids";
import { scopeFor, type BrokerageScope } from "@/domain/tenancy";

/** Thrown to unwind the transaction; never escapes withRollback. */
class Rollback extends Error {}

/**
 * Runs a test body inside a transaction that is always rolled back.
 *
 * Isolation without truncation or fixture cleanup: every test sees the schema
 * as migrated and nothing another test wrote. Tests share one database, so
 * vitest runs test files serially (see vitest.config.ts).
 */
export async function withRollback(
  body: (tx: DbExecutor) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Creates a brokerage inside the test transaction and returns its scope. */
export async function seedBrokerage(
  tx: DbExecutor,
  name = "Test Brokerage",
): Promise<BrokerageScope> {
  const id = newId();
  await tx.insert(brokerages).values({
    id,
    name,
    // The full id: the leading characters of a UUIDv7 are a millisecond
    // timestamp, so a prefix collides for rows created in the same tick.
    slug: `test-${id}`,
  });
  return scopeFor(id);
}
