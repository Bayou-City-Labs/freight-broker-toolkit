"use server";

import { signOut } from "@/auth";

/**
 * Ends the session. With database sessions this deletes the row, so the
 * session is genuinely revoked rather than left to expire — which is the
 * reason database sessions were chosen over a JWT.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}
