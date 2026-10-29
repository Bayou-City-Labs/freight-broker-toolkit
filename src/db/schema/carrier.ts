import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CarrierDetails } from "@/domain/details";
import type { AuthorityStatus, SafetyRating } from "@/domain/carrier/snapshot";
import type { VerdictLevel, VerdictReason } from "@/domain/carrier/verdict";
import { brokerageId, timestamps } from "./shared";

/** A trucking company, identified by USDOT and/or MC number. */
export const carriers = pgTable(
  "carriers",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    dotNumber: text("dot_number"),
    mcNumber: text("mc_number"),
    legalName: text("legal_name").notNull(),
    dbaName: text("dba_name"),
    details: jsonb("details").$type<CarrierDetails>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    // A carrier may be identified by either number, so uniqueness is per
    // identifier and only applies where one is present.
    uniqueIndex("carriers_brokerage_dot_key")
      .on(table.brokerageId, table.dotNumber)
      .where(sql`${table.dotNumber} is not null`),
    uniqueIndex("carriers_brokerage_mc_key")
      .on(table.brokerageId, table.mcNumber)
      .where(sql`${table.mcNumber} is not null`),
  ],
);

/**
 * One timestamped vetting snapshot.
 *
 * `payload` is the unmodified provider response and is the audit artifact.
 * The derived columns are a projection for list views and rule evaluation.
 * `payloadHash` makes Phase 3 monitoring cheap: re-check, compare the hash,
 * and only diff when it moved.
 *
 * The verdict is stored next to the ruleset version that produced it, so a
 * later rule change doesn't retroactively change what the broker was told —
 * and the raw payload means verdicts can still be re-derived.
 */
export const carrierChecks = pgTable(
  "carrier_checks",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    carrierId: uuid("carrier_id")
      .notNull()
      .references(() => carriers.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Which upstream produced this, e.g. "fmcsa.qcmobile". */
    source: text("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),

    // Derived projection of payload — see src/domain/carrier/snapshot.ts.
    authorityStatus: text("authority_status").$type<AuthorityStatus>().notNull(),
    insuranceOnFile: boolean("insurance_on_file"),
    safetyRating: text("safety_rating").$type<SafetyRating>().notNull(),
    outOfService: boolean("out_of_service").notNull(),
    outOfServiceDate: text("out_of_service_date"),
    powerUnits: integer("power_units"),
    drivers: integer("drivers"),

    // Verdict as shown to the broker at the time of the check.
    verdictLevel: text("verdict_level").$type<VerdictLevel>().notNull(),
    verdictReasons: jsonb("verdict_reasons").$type<VerdictReason[]>().notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    ...timestamps,
  },
  (table) => [
    index("carrier_checks_lookup_idx").on(
      table.brokerageId,
      table.carrierId,
      table.checkedAt.desc(),
    ),
  ],
);

export type Carrier = typeof carriers.$inferSelect;
export type NewCarrier = typeof carriers.$inferInsert;
export type CarrierCheck = typeof carrierChecks.$inferSelect;
export type NewCarrierCheck = typeof carrierChecks.$inferInsert;
