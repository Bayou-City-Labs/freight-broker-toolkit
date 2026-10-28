import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { db } from "@/db/client";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { authEnv } from "@/env/auth";

/**
 * Passwordless sign-in by emailed magic link.
 *
 * No passwords are stored, so there is no reset flow, no hashing policy, and
 * no credential-stuffing surface. Sessions live in Postgres rather than a JWT
 * so they can be revoked and so sign-in is part of the audit trail — in a
 * product whose value is auditability, a stateless token that can't be
 * invalidated is the wrong default.
 *
 * Deliverability is the tradeoff: a dispatcher whose corporate filter
 * quarantines the link cannot sign in. If that shows up in practice, add a
 * second provider rather than replacing this one.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  secret: authEnv.AUTH_SECRET,
  providers: [
    Resend({
      apiKey: authEnv.AUTH_RESEND_KEY,
      from: authEnv.AUTH_EMAIL_FROM,
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
