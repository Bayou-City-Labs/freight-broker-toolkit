/**
 * Every persisted row belongs to exactly one brokerage. The product is
 * single-tenant today and multi-tenant in Phase 2, so the discipline is
 * enforced now at the only layer that touches the database: repositories
 * take a BrokerageScope as their first argument and are responsible for
 * applying it to every read and write.
 *
 * Postgres row-level security can be layered on later without a schema change;
 * until then, this is the enforcement point.
 */
export interface BrokerageScope {
  readonly brokerageId: string;
}

export function scopeFor(brokerageId: string): BrokerageScope {
  if (!brokerageId) {
    throw new Error("A BrokerageScope requires a brokerageId");
  }
  return { brokerageId };
}
