import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { DocumentDetails } from "@/domain/details";
import { users } from "./auth";
import { loads } from "./load";
import { brokerageId, timestamps } from "./shared";

export const DOCUMENT_KINDS = ["rate_confirmation", "bill_of_lading"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Metadata for a generated document. The bytes live in a DocumentStore (local
 * filesystem in development, object storage when deployed) under `storageKey`.
 *
 * Rows are immutable once written: regenerating a rate confirmation creates a
 * new document rather than overwriting one, because the old one may already be
 * in a carrier's inbox. `sha256` is what makes the stored bytes verifiable
 * years later.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    brokerageId: brokerageId(),
    loadId: uuid("load_id").references(() => loads.id, { onDelete: "set null" }),
    kind: text("kind").$type<DocumentKind>().notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull().default("application/pdf"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    details: jsonb("details").$type<DocumentDetails>().notNull().default({}),
    ...timestamps,
  },
  (table) => [index("documents_brokerage_load_idx").on(table.brokerageId, table.loadId)],
);

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
