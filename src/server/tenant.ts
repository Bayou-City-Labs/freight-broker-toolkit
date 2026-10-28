import "server-only";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
import { scopeFor, type BrokerageScope } from "@/domain/tenancy";

/**
 * Resolves which brokerage the current request acts on.
 *
 * This is the single place a BrokerageScope enters the system. Everything
 * downstream receives it as an argument, so no repository call can accidentally
 * run unscoped.
 *
 * Phase 1 is one brokerage per user. When a user can belong to several
 * (Phase 2), this grows a selection step; the signature does not change.
 */
export async function getCurrentBrokerage(): Promise<BrokerageScope | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [membership] = await db
    .select({ brokerageId: memberships.brokerageId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  return membership ? scopeFor(membership.brokerageId) : null;
}

/** Same, but for code paths where being signed out is a bug rather than a state. */
export async function requireBrokerage(): Promise<BrokerageScope> {
  const scope = await getCurrentBrokerage();
  if (!scope) {
    throw new Error("No brokerage in scope: the request is unauthenticated.");
  }
  return scope;
}
