import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { LoadDetails, StopDetails } from "@/domain/details";
import type { EquipmentType, LoadStatus, StopType } from "@/domain/load/load";
import type { AppointmentType } from "@/domain/time-window";
import { carriers } from "./carrier";
import { parties } from "./party";
import { brokerageId, moneyCents, timestamps } from "./shared";

// The status, equipment, and stop-type vocabularies live in
// `@/domain/load/load` — they are business vocabulary a parser needs without
// reaching for the database. Re-exported here so existing importers of the
// schema keep working.
export {
  EQUIPMENT_TYPES,
  LOAD_STATUSES,
  STOP_TYPES,
  type EquipmentType,
  type LoadStatus,
  type StopType,
} from "@/domain/load/load";

export const loads = pgTable(
  "loads",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    /** The brokerage's own load number, as it appears on their paperwork. */
    referenceNumber: text("reference_number").notNull(),
    status: text("status").$type<LoadStatus>().notNull().default("draft"),
    equipmentType: text("equipment_type").$type<EquipmentType>(),
    commodityDescription: text("commodity_description"),
    weightLbs: integer("weight_lbs"),
    /** What the shipper pays the broker. */
    customerRateCents: moneyCents("customer_rate_cents"),
    /** What the broker pays the carrier. Margin is the difference. */
    carrierPayCents: moneyCents("carrier_pay_cents"),
    carrierId: uuid("carrier_id").references(() => carriers.id, { onDelete: "set null" }),
    details: jsonb("details").$type<LoadDetails>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("loads_brokerage_reference_key").on(table.brokerageId, table.referenceNumber),
    index("loads_brokerage_status_idx").on(table.brokerageId, table.status),
  ],
);

/**
 * An ordered event on a load. Two stops is the common dry-van case; drayage
 * and multi-stop runs are the same shape with more rows, which is why routing
 * isn't two foreign keys on the load.
 *
 * Window columns hold naive local wall time plus the facility's IANA zone, and
 * the original text from the source document — see src/domain/time-window.ts
 * for why absolute instants are derived rather than stored.
 */
export const stops = pgTable(
  "stops",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    loadId: uuid("load_id")
      .notNull()
      .references(() => loads.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").$type<StopType>().notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    /** Local wall time, no zone. Stored as a string, never coerced to an instant. */
    opensAtLocal: timestamp("opens_at_local", { mode: "string" }),
    closesAtLocal: timestamp("closes_at_local", { mode: "string" }),
    timeZone: text("time_zone"),
    appointmentType: text("appointment_type").$type<AppointmentType>(),
    /** Exactly what the source document said about timing, for audit. */
    windowRawText: text("window_raw_text"),
    details: jsonb("details").$type<StopDetails>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("stops_load_sequence_key").on(table.loadId, table.sequence),
    index("stops_brokerage_load_idx").on(table.brokerageId, table.loadId),
  ],
);

export type Load = typeof loads.$inferSelect;
export type NewLoad = typeof loads.$inferInsert;
export type Stop = typeof stops.$inferSelect;
export type NewStop = typeof stops.$inferInsert;
