import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { brokerages, memberships } from "@/db/schema";
import { scopeFor, type BrokerageScope } from "@/domain/tenancy";

/**
 * Who the current request is acting as.
 *
 * Three states, not two. "Signed in but belonging to no brokerage" is its own
 * case: a user exists the moment Auth.js verifies their email, but nothing
 * creates their brokerage yet. Folding that into "signed out" would bounce
 * them to /signin, which redirects signed-in users back here — an infinite
 * loop. It needs its own screen.
 */
export type SessionState =
  | { readonly status: "signed_out" }
  | { readonly status: "no_brokerage"; readonly email: string }
  | {
      readonly status: "ready";
      readonly scope: BrokerageScope;
      readonly brokerageName: string;
      readonly email: string;
    };

/**
 * Cached per request: the layout resolves this to render the header, and the
 * page beneath it resolves the scope again. `cache` collapses that into one
 * session read and one join rather than repeating both.
 */
export const resolveSession = cache(async (): Promise<SessionState> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "signed_out" };

  const email = session.user?.email ?? "";

  const [row] = await db
    .select({
      brokerageId: memberships.brokerageId,
      brokerageName: brokerages.name,
    })
    .from(memberships)
    .innerJoin(brokerages, eq(brokerages.id, memberships.brokerageId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  if (!row) return { status: "no_brokerage", email };

  return {
    status: "ready",
    scope: scopeFor(row.brokerageId),
    brokerageName: row.brokerageName,
    email,
  };
});

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
  const state = await resolveSession();
  return state.status === "ready" ? state.scope : null;
}

/**
 * Same, but for code paths where being signed out is a bug rather than a state.
 *
 * Pages under the (app) route group use this: the layout has already redirected
 * anyone without a brokerage, so reaching here without one means the guard was
 * bypassed. Throwing is the correct outcome — a 500 beats rendering a page
 * whose queries have no tenant.
 */
export async function requireBrokerage(): Promise<BrokerageScope> {
  const scope = await getCurrentBrokerage();
  if (!scope) {
    throw new Error("No brokerage in scope: the request is unauthenticated.");
  }
  return scope;
}
