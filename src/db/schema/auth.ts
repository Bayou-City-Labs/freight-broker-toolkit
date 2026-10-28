import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "@/domain/ids";
import { brokerages } from "./brokerage";
import { timestamps } from "./shared";

/**
 * Auth.js tables. Column names and types are dictated by @auth/drizzle-adapter
 * — see node_modules/@auth/drizzle-adapter/lib/pg.d.ts before changing any of
 * them. Sessions are stored in the database rather than signed into a JWT so
 * access can be revoked and so sign-in is part of the audit trail.
 */
export const users = pgTable("users", {
  // The adapter supplies a v4 UUID unless the column has a default; this keeps
  // user ids time-ordered like every other id in the schema.
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => newId()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  ...timestamps,
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/**
 * Joins a user to a brokerage. This is what makes tenant resolution a session
 * read: the signed-in user's membership supplies the brokerageId that every
 * repository call requires.
 */
export const MEMBERSHIP_ROLES = ["owner", "dispatcher", "viewer"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brokerageId: uuid("brokerage_id")
      .notNull()
      .references(() => brokerages.id, { onDelete: "cascade" }),
    role: text("role").$type<MembershipRole>().notNull().default("dispatcher"),
    ...timestamps,
  },
  (table) => [
    unique("memberships_user_brokerage_key").on(table.userId, table.brokerageId),
  ],
);

export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
