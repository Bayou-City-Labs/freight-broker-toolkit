import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { newId } from "../domain/ids";
import { brokerages, memberships, users } from "./schema";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * THROWAWAY. Delete this when first-run onboarding exists.
 *
 * Auth.js creates a user on first sign-in, but nothing creates the brokerage
 * that user belongs to — so `getCurrentBrokerage()` returns null and every
 * repository call has no scope to run in. This bridges that gap until there's
 * a real flow for it, which is a product decision, not a script.
 *
 *   npm run db:seed -- you@example.com
 *   npm run db:seed -- you@example.com "postgresql://..."   # a deployed database
 *
 * Idempotent: re-running reuses the existing brokerage and membership.
 */
const BROKERAGE_NAME = "Bayou City Labs";
const BROKERAGE_SLUG = "bayou-city-labs";

async function main(): Promise<void> {
  const email = process.argv[2];
  const url = process.argv[3] ?? process.env.DATABASE_URL;

  if (!email) {
    throw new Error('Usage: npm run db:seed -- <email> ["postgresql://..."]');
  }
  if (!url) {
    throw new Error("No connection string. Pass one as an argument or set DATABASE_URL.");
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema: { brokerages, memberships, users } });

  try {
    const [brokerage] = await db
      .insert(brokerages)
      .values({ id: newId(), name: BROKERAGE_NAME, slug: BROKERAGE_SLUG })
      .onConflictDoNothing({ target: brokerages.slug })
      .returning();

    const existingBrokerage =
      brokerage ??
      (
        await db
          .select()
          .from(brokerages)
          .where(eq(brokerages.slug, BROKERAGE_SLUG))
          .limit(1)
      )[0];

    // Normally Auth.js writes this row on first sign-in. Creating it here keeps
    // a fresh local database usable without going through an email round trip.
    const [user] = await db
      .insert(users)
      .values({ id: newId(), email, emailVerified: new Date() })
      .onConflictDoNothing({ target: users.email })
      .returning();

    const existingUser =
      user ?? (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

    const [membership] = await db
      .insert(memberships)
      .values({
        id: newId(),
        userId: existingUser.id,
        brokerageId: existingBrokerage.id,
        role: "owner",
      })
      .onConflictDoNothing()
      .returning();

    console.log(`database:  ${new URL(url).host}`);
    console.log(`brokerage: ${existingBrokerage.name} (${existingBrokerage.slug})`);
    console.log(`user:      ${existingUser.email}`);
    console.log(`membership: ${membership ? "created as owner" : "already existed"}`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
