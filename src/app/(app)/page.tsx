import { redirect } from "next/navigation";

/**
 * There is no signed-in landing page worth showing: one module exists, and a
 * list of two that don't is a dead end. Send people to the work.
 *
 * The layout above has already established a session, so this never redirects
 * an anonymous visitor into the app — they were sent to /signin before this
 * ran.
 */
export default function Index() {
  redirect("/carriers");
}
