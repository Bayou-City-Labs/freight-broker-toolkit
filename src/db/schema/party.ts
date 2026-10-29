import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { PartyDetails } from "@/domain/details";
import { brokerageId, timestamps } from "./shared";

/**
 * A shipper, consignee, or other facility a load touches. Modelled once and
 * referenced from stops, because the same warehouse appears on many loads.
 */
export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    /** State or province. */
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("US"),
    /**
     * IANA zone for this facility, used as the default when creating a stop.
     * The stop carries its own copy so a correction there can't silently
     * rewrite the meaning of windows on historical loads.
     */
    timeZone: text("time_zone"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    details: jsonb("details").$type<PartyDetails>().notNull().default({}),
    ...timestamps,
  },
  (table) => [index("parties_brokerage_name_idx").on(table.brokerageId, table.name)],
);

export type Party = typeof parties.$inferSelect;
export type NewParty = typeof parties.$inferInsert;
