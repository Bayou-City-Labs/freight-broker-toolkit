import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";
import { brokerages } from "./brokerage";

/** Applied to every table. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

/**
 * Tenancy column. Present on every business table so multi-tenancy in Phase 2
 * is a policy change rather than a migration. Cascades on delete so removing a
 * brokerage leaves nothing orphaned.
 */
export const brokerageId = () =>
  uuid("brokerage_id")
    .notNull()
    .references(() => brokerages.id, { onDelete: "cascade" });

/**
 * Money is integer cents (see src/domain/money.ts). bigint rather than integer:
 * a 4-byte integer caps at about $21M in cents, which is fine for one load and
 * not fine for a sum over a year of them.
 */
export const moneyCents = (name: string) => bigint(name, { mode: "number" });
