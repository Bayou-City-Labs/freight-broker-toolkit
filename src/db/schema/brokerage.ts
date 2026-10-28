import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./shared";

/** The tenant. Single-tenant in Phase 1, the scope key everywhere regardless. */
export const brokerages = pgTable("brokerages", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  /** URL-safe identifier, also used to key per-brokerage document templates. */
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export type Brokerage = typeof brokerages.$inferSelect;
export type NewBrokerage = typeof brokerages.$inferInsert;
